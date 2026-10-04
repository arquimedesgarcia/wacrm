/**
 * Valida el grafo del flujo "Pizzería La Vecchia — Pedidos" insertado por
 * la migración 054 / el script pizzeria-simulation.sql contra las reglas
 * del engine (src/lib/flows/engine.ts + types.ts):
 *
 *   1. flows.entry_node_id apunta a un node_key existente de tipo start.
 *   2. Todo next_node_key / button.next_node_key / condition.*_next
 *      apunta a un node_key existente (evita "node_not_found").
 *   3. send_buttons: 1-3 botones, cada uno con reply_id + next_node_key.
 *   4. collect_input: prompt_text + var_key + next_node_key.
 *   5. condition: subject/var capturada ANTES por un collect_input
 *      alcanzable (BFS desde start, acumulando vars) — evita condiciones
 *      que evalúan siempre undefined.
 *   6. Interpolación {{vars.x}} solo usa vars capturadas.
 *
 * Uso: node scripts/validate-pizzeria-flow.mjs <archivo.sql>
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const sql = readFileSync(file, 'utf-8');

// --- Extraer los INSERT INTO flow_nodes -------------------------------------
// Cada fila: VALUES (v_flow_id, '<key>', '<type>', <json-literal>::JSONB, x, y, n)
// El literal puede ser '...' único o varios '...' || '...' concatenados.
const nodes = [];
const rowRe =
  /VALUES \(v_flow_id,\s*'([a-z0-9_]+)',\s*'([a-z_]+)',\s*((?:'(?:[^']|'')*'(?:\s*\|\|\s*)?)+)::JSONB/gi;
let m;
while ((m = rowRe.exec(sql)) !== null) {
  const [, key, type, literal] = m;
  // Convertir el literal SQL ('' escape, concatenaciones) a texto JSON.
  let jsonText = '';
  const partRe = /'((?:[^']|'')*)'/g;
  let p;
  while ((p = partRe.exec(literal)) !== null) {
    jsonText += p[1].replace(/''/g, "'");
  }
  let config;
  try {
    config = JSON.parse(jsonText);
  } catch (e) {
    console.error(`[FAIL] nodo '${key}': JSON inválido -> ${e.message}`);
    process.exit(1);
  }
  nodes.push({ key, type, config });
}

if (nodes.length === 0) {
  console.error('[FAIL] No se encontraron nodos de flujo en el archivo.');
  process.exit(1);
}

const errors = [];
const byKey = new Map(nodes.map((n) => [n.key, n]));

// --- Regla 1: entry node ------------------------------------------------------
// Estructural: en el INSERT INTO flows, entry_node_id es el literal que
// sigue a 'active' (status) y precede a 'keyword' (trigger_type).
const entryDeclared = sql.match(/'active',[\s\S]{0,80}?'([a-z0-9_]+)',[\s\S]{0,60}?'keyword'/i);
const entry = entryDeclared?.[1];
if (!entry) {
  console.error('[FAIL] No se encontró el INSERT INTO flows con entry_node_id.');
  process.exit(1);
}
const entryNode = byKey.get(entry);
if (!entryNode) {
  errors.push(`entry_node_id '${entry}' no existe entre los nodos.`);
} else if (entryNode.type !== 'start') {
  errors.push(`entry_node_id '${entry}' no es de tipo 'start'.`);
}

// --- Helpers de targets -------------------------------------------------------
function targetsOf(node) {
  const c = node.config;
  switch (node.type) {
    case 'start':
    case 'send_message':
    case 'send_media':
    case 'collect_input':
    case 'set_tag':
      return c.next_node_key ? [c.next_node_key] : [];
    case 'send_buttons':
      return (c.buttons ?? []).map((b) => b.next_node_key);
    case 'send_list':
      return (c.sections ?? []).flatMap((s) => (s.rows ?? []).map((r) => r.next_node_key));
    case 'condition':
      return [c.true_next, c.false_next].filter(Boolean);
    default:
      return []; // handoff / end son terminales
  }
}

// --- Regla 2: todos los targets existen --------------------------------------
for (const node of nodes) {
  for (const t of targetsOf(node)) {
    if (!byKey.has(t)) {
      errors.push(`nodo '${node.key}': apunta a '${t}' que NO existe (node_not_found).`);
    }
  }
}

// --- Regla 3: shape de send_buttons -------------------------------------------
for (const node of nodes.filter((n) => n.type === 'send_buttons')) {
  const btns = node.config.buttons ?? [];
  if (btns.length < 1 || btns.length > 3) {
    errors.push(`nodo '${node.key}': ${btns.length} botones (Meta permite 1-3).`);
  }
  for (const b of btns) {
    if (!b.reply_id) errors.push(`nodo '${node.key}': botón sin reply_id.`);
    if (!b.title) errors.push(`nodo '${node.key}': botón sin title.`);
    if (!b.next_node_key)
      errors.push(`nodo '${node.key}': botón '${b.reply_id}' sin next_node_key.`);
  }
}

// --- Regla 4: shape de collect_input ------------------------------------------
for (const node of nodes.filter((n) => n.type === 'collect_input')) {
  const c = node.config;
  if (!c.prompt_text) errors.push(`nodo '${node.key}': sin prompt_text.`);
  if (!c.var_key) errors.push(`nodo '${node.key}': sin var_key.`);
  if (!c.next_node_key) errors.push(`nodo '${node.key}': sin next_node_key.`);
}

// --- Regla 5/6: BFS acumulando vars capturadas --------------------------------
const captured = new Set();
const visited = new Set();
const queue = [entry];
const VAR_RE = /\{\{vars\.([a-zA-Z0-9_]+)\}\}/g;
while (queue.length > 0) {
  const key = queue.shift();
  if (visited.has(key)) continue;
  visited.add(key);
  const node = byKey.get(key);
  if (!node) continue;
  if (node.type === 'collect_input') captured.add(node.config.var_key);
  // interpolación usada en textos del nodo
  for (const textField of ['text', 'prompt_text', 'caption']) {
    const txt = node.config[textField];
    if (typeof txt !== 'string') continue;
    for (const vm of txt.matchAll(VAR_RE)) {
      if (!captured.has(vm[1])) {
        errors.push(
          `nodo '${node.key}': interpola {{vars.${vm[1]}}} pero esa var no se captura antes en el camino.`
        );
      }
    }
  }
  if (node.type === 'condition') {
    if (node.config.subject === 'var' && !captured.has(node.config.subject_key)) {
      errors.push(
        `nodo '${node.key}': condition lee var '${node.config.subject_key}' que ningún collect_input alcanzable captura.`
      );
    }
  }
  queue.push(...targetsOf(node));
}

// Terminales alcanzables
for (const node of nodes) {
  if (!visited.has(node.key)) {
    errors.push(`nodo '${node.key}' NO es alcanzable desde '${entry}'.`);
  }
}

// --- Resultado -----------------------------------------------------------------
if (errors.length > 0) {
  console.error(`[FAIL] ${errors.length} problema(s) en el grafo:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `[OK] Grafo válido: ${nodes.length} nodos, entry='${entry}', vars capturadas: ${[...captured].join(', ')}`
);
