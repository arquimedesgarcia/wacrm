import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/pizzeria/init-knowledge
 *
 * Ingesta el menú de pizzas de la pizzería en la base de conocimiento
 * de IA (ai_knowledge_documents + ai_knowledge_chunks) para que el
 * asistente de respuestas tenga contexto del menú.
 *
 * Este endpoint es el PUENTE entre la base de datos independiente de
 * la pizzería (pizzeria_pizzas) y la KB de waCRM. Si mañana cambias
 * de motor de comunicaciones, solo reescribes este endpoint para leer
 * de otra fuente — los datos no cambian.
 *
 * Idempotente: reemplaza el documento del menú si ya existe (mismo
 * título), nunca lo duplica. Requiere sesión con rol admin u owner.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Solo admins pueden escribir en la KB (RLS: admin+).
    // profiles se enlaza con auth.users por user_id (no por id) y el
    // rol dentro de la cuenta vive en account_role (enum), no en la
    // columna legado `role`.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (profile.account_role !== 'admin' && profile.account_role !== 'owner') {
      return NextResponse.json(
        { error: 'Admin role required' },
        { status: 403 }
      );
    }

    const accountId = profile.account_id as string;

    const { data: pizzas, error: pizzasError } = await supabase
      .from('pizzeria_pizzas')
      .select('*')
      .eq('account_id', accountId)
      .order('price_small');

    if (pizzasError) {
      return NextResponse.json({ error: pizzasError.message }, { status: 500 });
    }

    if (!pizzas || pizzas.length === 0) {
      return NextResponse.json(
        { error: 'No pizzas found. Import pizzas first (migration 051).' },
        { status: 400 }
      );
    }

    // Idempotency: replace any previous menu document with this title.
    const title = 'Menú de Pizzería La Vecchia - Pizzas';
    await supabase
      .from('ai_knowledge_documents')
      .delete()
      .eq('account_id', accountId)
      .eq('title', title);

    const { data: doc, error: docError } = await supabase
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        title,
        content: buildMenuDocument(pizzas),
      })
      .select('id')
      .single();

    if (docError || !doc) {
      return NextResponse.json(
        { error: docError?.message || 'Failed to insert document' },
        { status: 500 }
      );
    }

    const chunks = pizzas.map((pizza, index) => ({
      document_id: doc.id,
      account_id: accountId,
      chunk_index: index,
      content: buildPizzaChunk(pizza),
    }));

    const { error: chunksError } = await supabase
      .from('ai_knowledge_chunks')
      .insert(chunks);

    if (chunksError) {
      return NextResponse.json({ error: chunksError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      document_id: doc.id,
      chunks_inserted: chunks.length,
      message: `Knowledge base fed with ${chunks.length} pizzas.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type PizzaRow = {
  name: string;
  sku: string;
  description: string | null;
  ingredients: string[] | null;
  price_small: number | null;
  price_medium: number | null;
  price_large: number | null;
  preparation_minutes: number | null;
  category?: string | null;
  is_vegetarian: boolean | null;
  is_gluten_free: boolean | null;
  is_popular?: boolean | null;
  is_spicy?: boolean | null;
  notes?: string | null;
};

function buildMenuDocument(pizzas: PizzaRow[]): string {
  const lines = [
    'MENÚ DE PIZZERÍA LA VECCHIA - PIZZAS DISPONIBLES',
    '',
    ...pizzas
      .map(
        (p) =>
          `=== ${p.name} ($${p.price_small} pequeña / $${p.price_medium} mediana / $${p.price_large} grande) ===
Descripción: ${p.description || ''}
Ingredientes: ${p.ingredients?.join(', ') || ''}
Categoría: ${p.category || 'General'}
Vegetariana: ${p.is_vegetarian ? 'Sí' : 'No'}
Sin gluten: ${p.is_gluten_free ? 'Sí' : 'No'}
Preparación: ${p.preparation_minutes ?? '?'} min`
      )
      .filter(Boolean),
    '',
    'NOTA: Las pizzas vegetarianas son Margarita y Vegetariana. ' +
      'Napolitana tiene jamón, Pescadora tiene atún y La Vecchia Especial tiene chorizo.',
  ];

  return lines.join('\n');
}

function buildPizzaChunk(pizza: PizzaRow): string {
  return [
    `PIZZA: ${pizza.name}`,
    `SKU: ${pizza.sku}`,
    `Descripción: ${pizza.description || ''}`,
    `Ingredientes: ${pizza.ingredients?.join(', ') || ''}`,
    `Precio: $${pizza.price_small} (peq) / $${pizza.price_medium} (med) / $${pizza.price_large} (grande)`,
    `Preparación: ${pizza.preparation_minutes ?? '?'} min`,
    `Vegetariana: ${pizza.is_vegetarian ? 'Sí' : 'No'}`,
    `Sin gluten: ${pizza.is_gluten_free ? 'Sí' : 'No'}`,
    '---',
  ].join('\n');
}
