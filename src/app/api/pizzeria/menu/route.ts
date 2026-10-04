import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pizzeria/menu
 *
 * Returns the full pizzeria menu as JSON — pizzas, sizes, prices —
 * sourced from the independent pizzeria tables (pizzeria_pizzas,
 * pizzeria_sizes). This endpoint is portable: it reads from the
 * pizzeria_* tables that don't depend on any WhatsApp engine.
 *
 * Query params:
 *   ?account_id=UUID   — optional filter. When omitted, RLS returns
 *                        the menu of the caller's own account (empty
 *                        for anonymous requests).
 *
 * Response shape:
 *   {
 *     restaurant: { name, description, phone, address, delivery_fee },
 *     pizzas: [...],
 *     sizes: [...]
 *   }
 */
export async function GET(request: NextRequest) {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id');

    // Fetch pizzas — RLS (is_account_member) scopes the rows to the
    // caller's account when no explicit filter is given.
    let pizzasQuery = supabase
      .from('pizzeria_pizzas')
      .select('*')
      .order('price_small');
    if (accountId) pizzasQuery = pizzasQuery.eq('account_id', accountId);

    const { data: pizzas, error: pizzasError } = await pizzasQuery;

    if (pizzasError) {
      return NextResponse.json({ error: pizzasError.message }, { status: 500 });
    }

    let sizesQuery = supabase
      .from('pizzeria_sizes')
      .select('*')
      .order('price_modifier');
    if (accountId) sizesQuery = sizesQuery.eq('account_id', accountId);

    const { data: sizes, error: sizesError } = await sizesQuery;

    if (sizesError) {
      return NextResponse.json({ error: sizesError.message }, { status: 500 });
    }

    // Static restaurant info (could be a pizzeria_config table, but keeping it simple)
    const restaurant = {
      name: 'Pizzería La Vecchia',
      description: 'Pizzas artesanales desde 2010. Delivery y recogida.',
      phone: '+581****6789',
      address: 'Av. 10, Casa 123',
      delivery_fee: { small: 2, medium: 2, large: 3 },
    };

    return NextResponse.json({ restaurant, pizzas, sizes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
