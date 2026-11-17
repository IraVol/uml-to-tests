// Turns a parsed diagram into a technique model with deterministic coverage items.
// The same builders run on a model the AI wrote for an image (see references/schema.md).
import { parseMermaidState, parseMermaidFlowchart, parseMermaidSequence } from './mermaid.mjs';
import { parsePlantState, parsePlantActivity, parsePlantSequence, parsePlantUseCase } from './plantuml.mjs';

export const TECHNIQUE = {
  state: 'state-transition',
  activity: 'decision-table',
  sequence: 'path',
  dfd: 'crud',
  usecase: 'use-case',
};

// Every built model carries:
//   unparsed — source lines the parser did not understand ({line, text}); the checker fails
//              on them unless an unknown names those lines
//   errors   — problems that make the item list untrustworthy (e.g. truncated paths)
function finish(b) {
  if (b.unsupported) return b;
  b.errors = b.errors || [];
  b.unparsed = [];
  for (const w of b.warnings || []) {
    const m = w.match(/^line (\d+): (.*)$/);
    if (m) b.unparsed.push({ line: Number(m[1]), text: m[2] });
    else if (/not closed|without (block|while|repeat|if|switch)/.test(w)) b.errors.push(w);
  }
  return b;
}

export function parseDiagram(d) {
  return finish(parseDiagramRaw(d));
}

function parseDiagramRaw(d) {
  const { format, kind, lines } = d;
  if (format === 'mermaid') {
    if (kind === 'state') return fromState(parseMermaidState(lines));
    if (kind === 'activity') return fromFlowchart(parseMermaidFlowchart(lines));
    if (kind === 'dfd') return fromDfd(parseMermaidFlowchart(lines));
    if (kind === 'sequence') return fromSequence(parseMermaidSequence(lines));
    if (kind === 'usecase') return { warnings: ['Mermaid has no use case diagram; use PlantUML'], unsupported: true };
  }
  if (format === 'plantuml') {
    if (kind === 'state') return fromState(parsePlantState(lines));
    if (kind === 'activity') return fromActivityGraph(parsePlantActivity(lines));
    if (kind === 'sequence') return fromSequence(parsePlantSequence(lines));
    if (kind === 'usecase') return fromUseCase(parsePlantUseCase(lines));
    if (kind === 'dfd') return { warnings: ['DFD is supported as a Mermaid flowchart with [( )] stores'], unsupported: true };
  }
  return { unsupported: true, warnings: [`diagram kind ${kind} is not supported`] };
}

// Build from an AI-written model (images). Shapes mirror the parser output.
export function buildFromModel(kind, m) {
  return finish(buildFromModelRaw(kind, m));
}

function buildFromModelRaw(kind, m) {
  if (kind === 'sequence') {
    // accept "parent": "F1" as shorthand for {fragment: "F1", operand: 0}
    for (const f of m.fragments || []) if (typeof f.parent === 'string') f.parent = { fragment: f.parent, operand: 0 };
    for (const x of m.messages || []) if (typeof x.context === 'string') x.context = { fragment: x.context, operand: 0 };
  }
  if (kind === 'state') return fromState({ states: m.states || [], transitions: (m.transitions || []).map((t) => ({ ...t })), notes: [], warnings: [] });
  if (kind === 'activity') return fromActivityGraph({ nodes: m.nodes || [], edges: m.edges || [], notes: [], warnings: [] });
  if (kind === 'sequence') return fromSequence({ participants: m.participants || [], messages: (m.messages || []).map((x, i) => ({ id: x.id || `M${i + 1}`, ...x })), fragments: m.fragments || [], notes: [], warnings: [] });
  if (kind === 'dfd') return dfdFrom(m.entities || [], m.processes || [], m.stores || [], m.flows || [], []);
  if (kind === 'usecase') return fromUseCase({ actors: m.actors || [], usecases: m.usecases || [], associations: m.associations || [], includes: m.includes || [], extends: m.extends || [], generalizations: m.generalizations || [], notes: [], warnings: [] });
  return { unsupported: true, warnings: [`kind ${kind} is not supported`] };
}

// ---------------------------------------------------------------- boundary values
// A numeric comparison in a guard, decision or fragment label ("> 1000 EUR",
// "within 5 minutes", "at most 10 attempts") gets three items: the boundary minus one
// step, the boundary, and plus one step — each with whether the condition then holds.
// The step is the smallest step of the value's data type, not the unit as written:
// money 0.01 (1000 EUR → 999.99 / 1000.00 / 1000.01), time 1 second (5 minutes →
// 4 min 59 s / 5 min 0 s / 5 min 1 s), counts 1, a decimal value its last decimal
// place. A number with no recognisable unit gets step 1 and a note to confirm the type.
const DATA_TYPES = [
  { type: 'money', step: 0.01, units: ['eur', 'euro', 'euros', 'usd', 'dollar', 'dollars', 'gbp', 'uah', 'грн', 'pln', 'chf', '€', '$', '£'] },
  { type: 'time', seconds: { ms: 0.001, msec: 0.001, millisecond: 0.001, milliseconds: 0.001, s: 1, sec: 1, secs: 1, second: 1, seconds: 1, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, week: 604800, weeks: 604800 } },
  { type: 'percent', step: 0.01, units: ['%', 'percent', 'pct'] },
  { type: 'count', step: 1, units: ['attempt', 'attempts', 'time', 'times', 'try', 'tries', 'retry', 'retries', 'item', 'items', 'piece', 'pieces', 'pcs', 'unit', 'units', 'book', 'books', 'order', 'orders', 'user', 'users', 'people', 'person', 'persons', 'guest', 'guests', 'ticket', 'tickets', 'seat', 'seats', 'product', 'products', 'character', 'characters', 'chars', 'symbol', 'symbols', 'digit', 'digits', 'letter', 'letters', 'line', 'lines', 'file', 'files', 'request', 'requests', 'login', 'logins', 'step', 'steps', 'level', 'levels', 'year', 'years'] },
];
const decimals = (v) => (String(v).split(/[.,]/)[1] || '').length;
function dataType(value, unit) {
  const u = (unit || '').toLowerCase();
  if (u) for (const t of DATA_TYPES) {
    if (t.type === 'time' && t.seconds[u] != null) return { type: 'time', step: Math.min(1, t.seconds[u]), factor: t.seconds[u], unit };
    if (t.units?.includes(u)) return { type: t.type, step: t.type === 'count' && decimals(value) ? 10 ** -decimals(value) : t.step, unit };
  }
  const dec = decimals(value);
  return { type: dec ? 'decimal' : 'number', step: dec ? 10 ** -dec : 1, unit: unit || null, confirm: true };
}
const fmtNum = (n, dp) => n.toFixed(dp);
function fmtDuration(totalSeconds) {
  const neg = totalSeconds < 0 ? '-' : '';
  let s = Math.abs(totalSeconds);
  const ms = Math.round((s % 1) * 1000);
  s = Math.floor(s);
  const parts = [[Math.floor(s / 86400), 'd'], [Math.floor((s % 86400) / 3600), 'h'], [Math.floor((s % 3600) / 60), 'min'], [s % 60, 's']];
  const first = parts.findIndex(([v]) => v > 0);
  const shown = first < 0 ? [[0, 's']] : parts.slice(first);
  return neg + shown.map(([v, u]) => `${v} ${u}`).join(' ') + (ms ? ` ${ms} ms` : '');
}
// the three values with every way a test might write them (used by the checker)
function boundaryValues(value, unit) {
  const t = dataType(value, unit);
  const v = Number(String(value).replace(',', '.'));
  if (t.type === 'time') {
    const total = v * t.factor;
    return { ...t, values: [total - t.step, total, total + t.step].map((x) => {
      const r = Math.round(x * 1000) / 1000;
      const whole = Math.floor(r), mm = Math.floor(whole / 60), ss = String(whole % 60).padStart(2, '0'), hh = Math.floor(whole / 3600), m2 = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
      const forms = [fmtDuration(r), `${r} s`, `${r}s`, `${r} sec`, `${r} seconds`, `${mm}:${ss}`, `${hh}:${m2}:${ss}`];
      if (r % 60 === 0) forms.push(`${r / 60} min`, `${r / 60} minutes`);
      if (r % 3600 === 0) forms.push(`${r / 3600} h`, `${r / 3600} hours`);
      return { text: `${fmtDuration(r)}${r >= 60 ? ` (${r} s)` : ''}`, forms };
    }) };
  }
  const dp = Math.max(decimals(t.step), decimals(value));
  return { ...t, values: [v - t.step, v, v + t.step].map((x) => {
    const s = fmtNum(x, dp);
    const forms = [s, s.replace('.', ',')];
    if (dp && /\.0+$/.test(s)) forms.push(String(Math.round(x))); // 1000.00 may be written 1000
    return { text: `${s}${t.unit ? ` ${t.unit}` : ''}`, forms };
  }) };
}
const CMP_WORDS = [
  ['>=', 'ge'], ['≥', 'ge'], ['=>', 'ge'], ['<=', 'le'], ['≤', 'le'], ['=<', 'le'], ['>', 'gt'], ['<', 'lt'],
  ['at least', 'ge'], ['no less than', 'ge'], ['not less than', 'ge'], ['minimum of', 'ge'], ['min', 'ge'],
  ['at most', 'le'], ['up to', 'le'], ['no more than', 'le'], ['not more than', 'le'], ['maximum of', 'le'], ['max', 'le'],
  // "within 5 minutes": is 5:00 still within? The words do not settle it — ask
  ['within', 'askhi'],
  ['more than', 'gt'], ['greater than', 'gt'], ['over', 'gt'], ['above', 'gt'], ['exceeds', 'gt'], ['exceeding', 'gt'],
  ['less than', 'lt'], ['fewer than', 'lt'], ['under', 'lt'], ['below', 'lt'],
];
const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '(?:\\s*([A-Za-z%€$£°грн][\\w%°]*))?';
// a currency sign may come first: "> €1000", "< $50"
const CMP_RE = new RegExp(`(?:^|[^\\w])(${CMP_WORDS.map(([w]) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*([€$£])?\\s*${NUM}${UNIT}`, 'gi');
const OR_RE = new RegExp(`${NUM}${UNIT}\\s+or\\s+(more|fewer|less)\\b`, 'gi');
const BETWEEN_RE = new RegExp(`between\\s+${NUM}\\s*(?:and|-|–)\\s*${NUM}${UNIT}`, 'gi');
const HOLDS = { ge: ['no', 'yes', 'yes'], gt: ['no', 'no', 'yes'], le: ['yes', 'yes', 'no'], lt: ['yes', 'no', 'no'], ask: ['no', 'ask', 'yes'], askhi: ['yes', 'ask', 'no'] };

export function boundaries(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const add = (op, value, unit, at) => { const key = `${at}:${value}`; if (seen.has(key)) return; seen.add(key); out.push({ op, value, unit: unit || null }); };
  for (const m of text.matchAll(BETWEEN_RE)) { add('ask', m[1], m[3], m.index); add('askhi', m[2], m[3], m.index + 1); }
  for (const m of text.matchAll(CMP_RE)) {
    let op = CMP_WORDS.find(([w]) => w.toLowerCase() === m[1].toLowerCase())[1];
    // a deadline: "cancel up to 2h before the start" = allowed while at least 2h remain
    const after = text.slice(m.index + m[0].length);
    if (op === 'le' && /^\s*(before|in advance|ahead)\b/i.test(after) && /^(up to|at the latest|no later than)$/i.test(m[1])) op = 'ge';
    if (!out.some((b) => b.value === m[3])) add(op, m[3], m[2] || m[4], m.index);
  }
  for (const m of text.matchAll(OR_RE)) if (!out.some((b) => b.value === m[1])) add(m[3].toLowerCase() === 'more' ? 'ge' : 'le', m[1], m[2], m.index);
  return out;
}

function boundaryItems(anchor, text, what, line) {
  const bs = boundaries(text);
  const items = [];
  bs.forEach((b, k) => {
    const base = `B:${anchor}${bs.length > 1 ? `#${k + 1}` : ''}`;
    const h = HOLDS[b.op];
    const bv = boundaryValues(b.value, b.unit);
    const stepText = bv.type === 'time' ? (bv.step < 1 ? '1 ms' : '1 s') : `${bv.step}`;
    const typeNote = bv.confirm ? ` (no unit on the diagram: step ${stepText} assumed — confirm the data type in an unknown)` : '';
    ['below', 'at', 'above'].forEach((side, i) => items.push({
      id: `${base}:${side}`, group: 'boundary', line: line ?? null,
      label: `${what}: ${bv.values[i].text} → ${h[i] === 'ask' ? 'the diagram does not say if the boundary is included — ask' : `condition ${h[i] === 'yes' ? 'holds' : 'does not hold'}`}${i === 0 ? typeNote : ''}`,
      boundary: { anchor, value: b.value, unit: b.unit, side, holds: h[i], type: bv.type, step: stepText, test_value: bv.values[i].text, forms: bv.values[i].forms, confirm: !!bv.confirm },
    }));
  });
  return items;
}

// ---------------------------------------------------------------- state
// Composite states: a substate inherits every transition of its ancestors (the nearest
// level that handles an event wins); entering a composite means entering its initial
// substate ([*] inside it). The state × event table therefore has leaf states only.
export function stateHelpers(model) {
  const byName = new Map(model.states.map((s) => [s.name, s]));
  const ancestors = (name) => { const out = []; let s = byName.get(name); const seen = new Set(); while (s && s.parent && !seen.has(s.parent)) { seen.add(s.parent); out.push(s.parent); s = byName.get(s.parent); } return out; };
  const isLeaf = (name) => { const s = byName.get(name); return !!s && !s.pseudo && !s.composite; };
  const within = (leaf, state) => leaf === state || ancestors(leaf).includes(state);
  return { byName, ancestors, isLeaf, within };
}

function fromState(p) {
  const warnings = [...p.warnings];
  const states = p.states.map((s) => ({ ...s }));
  const byName = new Map(states.map((s) => [s.name, s]));
  for (const s of states) if (s.parent && byName.has(s.parent)) byName.get(s.parent).composite = true;
  const composite = new Set(states.filter((s) => s.composite).map((s) => s.name));
  const initialOf = new Map();
  for (const t of p.transitions) if (t.from === '[*]' && t.scope) initialOf.set(t.scope, t.to);
  const resolve = (name, seen = new Set()) => {
    if (!composite.has(name) || seen.has(name)) return name;
    seen.add(name);
    const i = initialOf.get(name);
    return i ? resolve(i, seen) : name;
  };
  for (const c of composite) if (!initialOf.has(c)) warnings.push(`composite state ${c} has no [*] inside: entering it has no defined substate`);
  const leaves = states.filter((s) => !s.pseudo && !composite.has(s.name)).map((s) => s.name);
  const pseudo = states.filter((s) => s.pseudo).map((s) => s.name);
  const { ancestors } = stateHelpers({ states });

  const items = [];
  const transitions = [];
  let n = 0;
  for (const t of p.transitions) {
    if (t.to === '[*]' && !t.event) continue; // final marker (or a composite finishing) — not a transition to test
    if (t.from === '[*]' && t.scope) continue; // initial substate: exercised by the transition that enters the composite
    n++;
    const id = `T${n}`;
    const event = t.event ?? (t.from === '[*]' ? '(initial)' : '(completion)');
    const toLeaf = resolve(t.to);
    const tr = { id, ...t, event, toLeaf, enters: toLeaf !== t.to ? toLeaf : null };
    transitions.push(tr);
    items.push({ id, group: 'transition', label: `${t.from} --${event}${t.guard ? ` [${t.guard}]` : ''}--> ${t.to}${tr.enters ? ` (enters ${tr.enters})` : ''}`, line: t.line ?? null });
    items.push(...boundaryItems(id, [t.guard, t.note].filter(Boolean).join(' '), `${t.from} --${event}`, t.line));
  }
  const handled = transitions.filter((t) => t.from !== '[*]' && !pseudo.includes(t.from) && !t.event.startsWith('('));
  // guard-none: when every transition for (state, event) is guarded, "none of the guards
  // holds" is its own case — the state does not change. One item per (state, event),
  // not per guard: "PIN not correct" alone may still be the third wrong PIN.
  const groups = new Map();
  for (const t of handled) { const k = `${t.from}\u0000${t.event}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  for (const ts of groups.values()) {
    if (!ts.every((t) => t.guard)) continue;
    const { from, event } = ts[0];
    items.push({ id: `G:${from}:${event}`, group: 'guard-none', label: `${event} in ${from} with none of ${ts.map((t) => `[${t.guard}]`).join(', ')} true → state unchanged${ts.length > 1 ? ' (if the guards cover every case, this cannot happen — say so in a blocking unknown)' : ''}`, line: ts[0].line ?? null, guardOf: { from, event, transitions: ts.map((t) => t.id) } });
  }
  // history pairs: a guard that depends on what happened before ("third wrong PIN in a
  // row", "after 3 attempts") must also be tested after re-entering its state another way
  // — e.g. after a reset, does the count start over?
  const HISTORY = /\b(in a row|consecutive|attempts?|times|retr(?:y|ies)|again|count|previous|last|first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\b/i;
  const { within: inside } = stateHelpers({ states });
  for (const tj of handled) {
    if (!HISTORY.test([tj.guard, tj.note, tj.event].filter(Boolean).join(' '))) continue;
    for (const ti of transitions) {
      if (ti.from === '[*]' || ti.id === tj.id || !inside(ti.toLeaf, tj.from)) continue;
      items.push({ id: `P:${ti.id}>${tj.id}`, group: 'history', label: `${tj.id} (${tj.event}${tj.guard ? ` [${tj.guard}]` : ''}) after re-entering ${tj.from} via ${ti.id} (${ti.event}) — does the history start over?`, pair: [ti.id, tj.id] });
    }
  }
  const events = [...new Set(handled.map((t) => t.event))];
  const finals = new Set(p.transitions.filter((t) => t.to === '[*]' && !t.scope).map((t) => t.from));
  const initials = new Set(transitions.filter((t) => t.from === '[*]').map((t) => t.toLeaf));
  const matrix = [];
  for (const s of leaves) {
    for (const e of events) {
      let legal = [];
      let via = null;
      for (const level of [s, ...ancestors(s)]) {
        legal = handled.filter((t) => t.from === level && t.event === e);
        if (legal.length) { via = level === s ? null : level; break; }
      }
      if (legal.length) { matrix.push({ state: s, event: e, legal: legal.map((t) => t.id), inherited: via }); continue; }
      const id = `N:${s}:${e}`;
      matrix.push({ state: s, event: e, negative: id });
      items.push({ id, group: 'invalid', label: `${e} in ${s} → not accepted, stays ${s}`, expectState: s });
    }
  }
  // findings: things the diagram itself leaves open — answered by a question, not a test
  const reach = new Set(); // leaf and pseudo states reachable from [*]
  const todo = [...initials];
  while (todo.length) {
    const s = todo.pop();
    if (reach.has(s)) continue;
    reach.add(s);
    for (const t of transitions) {
      if (t.from === '[*]') continue;
      const applies = pseudo.includes(s) ? t.from === s : inside(s, t.from);
      if (applies && t.toLeaf && t.toLeaf !== '[*]') todo.push(t.toLeaf);
    }
  }
  if (initials.size) for (const s of leaves) if (!reach.has(s)) items.push({ id: `Q:${s}:unreachable`, group: 'finding', label: `${s} cannot be reached from the initial state — how does an object get there?` });
  for (const s of leaves) {
    const exits = transitions.some((t) => t.from !== '[*]' && inside(s, t.from));
    if (!exits && !finals.has(s)) items.push({ id: `Q:${s}:dead-end`, group: 'finding', label: `${s} has no way out and is not marked final — is it terminal?` });
  }
  return {
    kind: 'state', technique: TECHNIQUE.state,
    model: { states, transitions, events, leaves, initial: [...initials], final: [...finals], pseudo },
    views: { matrix },
    notes: p.notes, items, warnings,
  };
}

// ---------------------------------------------------------------- activity (decision table)
function fromFlowchart(p) {
  const nodes = p.nodes.map((n) => ({ id: n.id, label: n.label, type: n.shape === 'decision' || n.shape === 'hexagon' ? 'decision' : 'action', line: n.line }));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const outdeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of p.edges) { indeg.set(e.to, (indeg.get(e.to) || 0) + 1); outdeg.set(e.from, (outdeg.get(e.from) || 0) + 1); }
  for (const n of nodes) {
    if (indeg.get(n.id) === 0 && n.type !== 'decision') n.type = 'start';
    else if (outdeg.get(n.id) === 0 && n.type !== 'decision') n.type = 'end';
  }
  return fromActivityGraph({ nodes, edges: p.edges, notes: [], warnings: p.warnings });
}

function fromActivityGraph(p) {
  const nodes = p.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  p.edges.forEach((e, i) => { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push({ ...e, idx: i }); });
  const warnings = [...p.warnings];
  for (const n of nodes) if (n.type !== 'decision' && n.type !== 'end' && (out.get(n.id) || []).length > 1) warnings.push(`node "${n.label}" has several outgoing flows but is not a decision; treated as alternatives`);
  for (const n of nodes) if (n.type === 'decision') for (const e of out.get(n.id) || []) if (!e.label) warnings.push(`decision "${n.label}" has an unlabeled outgoing flow`);
  let starts = nodes.filter((n) => n.type === 'start').map((n) => n.id);
  if (!starts.length && nodes.length) starts = [nodes[0].id];

  // Rules = every path through the decisions with each loop taken zero times, plus one
  // rule per loop (back edge) where the loop runs once and then the flow goes on to an end.
  const CAP = 128;
  const rules = [];
  const seen = new Set();
  const errors = [];
  let truncated = false;
  const isChoiceNode = (id) => byId.get(id)?.type === 'decision' || (out.get(id) || []).length > 1;
  const step = (id, e) => (isChoiceNode(id) ? [{ decision: id, condition: byId.get(id)?.label ?? id, choice: e.label ?? '(unlabeled)', edge: e.idx }] : []);

  // 1. back edges: an edge into a node that is still on the DFS stack
  const back = new Set();
  const state = new Map(); // 1 = on stack, 2 = done
  const mark = (id) => {
    state.set(id, 1);
    for (const e of out.get(id) || []) {
      if (state.get(e.to) === 1) back.add(e.idx);
      else if (!state.get(e.to)) mark(e.to);
    }
    state.set(id, 2);
  };
  for (const s of starts) if (!state.get(s)) mark(s);
  const fwd = (id) => (out.get(id) || []).filter((e) => !back.has(e.idx));
  const isEnd = (id) => (out.get(id) || []).length === 0;

  // Independent decisions: all branches of a decision meet again at one node before
  // anything can end or loop (its immediate post-dominator). Its outcome does not change
  // what can happen afterwards, so each outcome is tested once (each-choice) instead of
  // in every combination with the decisions after it.
  const EXIT = '\u0000exit';
  const succ = (id) => { const f = fwd(id).map((e) => e.to); return f.length && !isEnd(id) && f.length === (out.get(id) || []).length ? f : [...f, EXIT]; };
  const all = nodes.map((n) => n.id);
  const pdom = new Map(all.map((id) => [id, new Set([...all, EXIT])]));
  pdom.set(EXIT, new Set([EXIT]));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of all) {
      const ss = succ(id).map((s) => pdom.get(s) ?? new Set([s]));
      const inter = ss.length ? [...ss[0]].filter((x) => ss.every((set) => set.has(x))) : [];
      const next = new Set([id, ...inter]);
      if (next.size !== pdom.get(id).size) { pdom.set(id, next); changed = true; }
    }
  }
  const ipdom = (id) => {
    const cands = [...pdom.get(id)].filter((x) => x !== id);
    return cands.find((x) => cands.every((y) => y === x || pdom.get(x)?.has(y))) ?? EXIT;
  };
  const collapsible = new Map(); // decision id -> join node id
  for (const n of nodes) {
    if (!isChoiceNode(n.id) || fwd(n.id).length < 2) continue;
    const j = ipdom(n.id);
    if (j === EXIT) continue;
    // the region between the decision and the join must not loop
    const region = new Set();
    const grow = (x) => { if (x === j || region.has(x)) return; region.add(x); fwd(x).forEach((e) => grow(e.to)); };
    fwd(n.id).forEach((e) => grow(e.to));
    const loops = [...back].some((i) => region.has(p.edges[i].from) || region.has(p.edges[i].to));
    if (!loops) collapsible.set(n.id, j);
  }

  const addRule = (choices, end, path) => {
    // the signature uses the edges taken, so two flows with the same label stay two rules
    const sig = JSON.stringify(choices.map((c) => c.edge));
    if (seen.has(sig)) return null;
    if (rules.length >= CAP) { truncated = true; return null; }
    seen.add(sig);
    const r = { choices: choices.map((c) => ({ ...c })), end, path: [...path] };
    rules.push(r);
    return r;
  };

  // 2. forward paths from a node to a real end (no loops); an independent decision takes
  //    only its first branch here — its other branches get one rule each below
  const forwardPaths = (from, limit = Infinity, collapse = true, until = null) => {
    const found = [];
    const walk = (id, choices, path) => {
      if (found.length >= limit) return;
      if (id === until || (!until && isEnd(id))) { found.push({ choices, end: id, path }); return; }
      const edges = fwd(id);
      const take = collapse && collapsible.has(id) ? edges.slice(0, 1) : edges;
      for (const e of take) walk(e.to, [...choices, ...step(id, e).map((c) => ({ ...c, at: path.length - 1 }))], [...path, e.to]);
    };
    walk(from, [], [from]);
    return found;
  };
  const baseRules = [];
  for (const s of starts) for (const fp of forwardPaths(s, CAP + 1)) { const r = addRule(fp.choices, fp.end, fp.path); if (r) baseRules.push(r); }
  // each other branch of an independent decision: one rule — the first rule through that
  // decision, with the stretch from the decision to its join replaced by that branch
  const collapsed = [];
  for (const [d, j] of collapsible) {
    const base = baseRules.find((r) => r.path.includes(d) && r.path.indexOf(j, r.path.indexOf(d)) > 0);
    if (!base) continue;
    const iD = base.path.indexOf(d), iJ = base.path.indexOf(j, iD);
    const before = base.choices.filter((c) => c.at < iD), after = base.choices.filter((c) => c.at >= iJ);
    for (const e of fwd(d).slice(1)) {
      const seg = forwardPaths(e.to, 1, true, j)[0];
      if (!seg) continue;
      addRule([...before, ...step(d, e), ...seg.choices, ...after], base.end, [...base.path.slice(0, iD + 1), ...seg.path, ...base.path.slice(iJ + 1)]);
    }
    collapsed.push({ decision: d, condition: byId.get(d)?.label ?? d, join: byId.get(j)?.label ?? j, outcomes: fwd(d).map((e) => e.label ?? '(unlabeled)') });
  }
  const fullCount = collapsible.size ? starts.reduce((n, s) => n + forwardPaths(s, 1000, false).length, 0) : null;

  // 3. one pass through each loop: a forward path to the back edge's source, the back
  //    edge, then the first forward continuation from the loop head to an end
  for (const idx of back) {
    const e = p.edges[idx];
    const reach = (from) => {
      const walk = (id, choices, path, seenNodes) => {
        if (id === e.from) return { choices, path };
        for (const x of fwd(id)) {
          if (seenNodes.has(x.to)) continue;
          const r = walk(x.to, [...choices, ...step(id, x)], [...path, x.to], new Set([...seenNodes, x.to]));
          if (r) return r;
        }
        return null;
      };
      return walk(from, [], [from], new Set([from]));
    };
    const pre = starts.map(reach).find(Boolean);
    // the continuation may leave an enclosing loop through *other* back edges (each once)
    const continuePath = (from) => {
      const walk = (id, choices, path, usedBack) => {
        if (isEnd(id)) return { choices, end: id, path };
        const edges = [...fwd(id), ...(out.get(id) || []).filter((x) => back.has(x.idx) && x.idx !== idx && !usedBack.has(x.idx))];
        for (const x of edges) {
          const ub = back.has(x.idx) ? new Set([...usedBack, x.idx]) : usedBack;
          const r = walk(x.to, [...choices, ...step(id, x)], [...path, x.to], ub);
          if (r) return r;
        }
        return null;
      };
      return walk(from, [], [from], new Set());
    };
    const cont = forwardPaths(e.to, 1)[0] ?? continuePath(e.to); // shortest way out first
    if (!pre || !cont) { warnings.push(`the loop back to "${byId.get(e.to)?.label ?? e.to}" never reaches an end`); continue; }
    addRule([...pre.choices, ...step(e.from, { ...e, idx }), ...cont.choices], cont.end, [...pre.path, ...cont.path]);
  }
  if (truncated) errors.push(`more than ${CAP} paths through the decisions: the table would be incomplete. Split the diagram or reduce independent decisions`);

  const decisions = nodes.filter((n) => n.type === 'decision');
  const items = rules.map((r, i) => {
    const id = `R${i + 1}`;
    r.id = id;
    const endNode = byId.get(r.end);
    r.actions = r.path.map((x) => byId.get(x)).filter((x) => x && x.type === 'action').map((x) => x.label);
    // "stop" says nothing: show the last action before it as the outcome
    const generic = !endNode || /^(stop|end|\(end\)|kill|detach)$/i.test(endNode.label || '');
    r.endLabel = generic ? (r.actions.at(-1) ?? endNode?.label ?? r.end) : endNode.label;
    const cond = r.choices.map((c) => `${c.condition} = ${c.choice}`).join('; ');
    return { id, group: 'rule', label: `${cond || '(no decisions)'} → ${r.endLabel}`, line: null };
  });
  // numeric conditions get boundary values on top of the rules
  for (const d of nodes.filter((n) => isChoiceNode(n.id))) items.push(...boundaryItems(d.label, d.label, `"${d.label}"`, d.line));
  if (collapsed.length) warnings.push(`${collapsed.map((c) => `"${c.condition}"`).join(', ')} ${collapsed.length === 1 ? 'is' : 'are'} independent of what follows (all branches meet again): each outcome is tested once — ${rules.length} rules instead of ${fullCount}${fullCount >= 1000 ? '+' : ''}`);
  const reached = new Set();
  const visit = (id) => { if (reached.has(id)) return; reached.add(id); for (const e of out.get(id) || []) visit(e.to); };
  starts.forEach(visit);
  for (const n of nodes) if (!reached.has(n.id)) warnings.push(`node "${n.label}" is not reachable from a start node`);
  const onRule = new Set(rules.flatMap((r) => r.path));
  for (const n of nodes) if (reached.has(n.id) && !onRule.has(n.id) && !truncated) warnings.push(`node "${n.label}" is on no rule`);
  // decision table: condition rows × rule columns; a loop decision may get "yes→no"
  const table = decisions.map((d) => ({
    decision: d.id, condition: d.label,
    cells: rules.map((r) => { const cs = r.choices.filter((c) => c.decision === d.id).map((c) => c.choice); return cs.length ? cs.join('→') : '–'; }),
  }));
  return {
    kind: 'activity', technique: TECHNIQUE.activity,
    model: { nodes, edges: p.edges, decisions: decisions.map((d) => ({ id: d.id, condition: d.label, line: d.line })) },
    views: { rules, table: table.map((row) => ({ ...row, independent: collapsed.some((c) => c.decision === row.decision) })), collapsed, fullCount },
    notes: p.notes, items, warnings, errors,
  };
}

// ---------------------------------------------------------------- sequence (paths)
const ALT_LIKE = new Set(['alt', 'critical']);
const OPT_LIKE = new Set(['opt', 'break', 'loop']);

function fromSequence(p) {
  const items = [];
  const frags = p.fragments.filter((f) => f.type !== 'par' && f.type !== 'group');
  for (const f of frags) {
    if (ALT_LIKE.has(f.type)) {
      f.operands.forEach((o, k) => items.push({ id: `${f.id}.${k + 1}`, group: 'branch', label: `${f.type} [${o.label ?? '…'}]`, line: o.line }));
      // an alt with no else still has a way past it: none of its conditions holds
      if (f.operands.length === 1) items.push({ id: `${f.id}.else`, group: 'branch', label: `${f.type} [${f.operands[0].label ?? '…'}] does not hold (no else on the diagram)`, line: f.line });
    }
    else if (OPT_LIKE.has(f.type)) {
      const lbl = f.operands[0]?.label ?? '…';
      // "until …" loops usually run at least once: zero runs may be impossible
      const always = f.type === 'loop' && /\buntil\b/i.test(lbl) ? ' — the label says "until", so zero runs may be impossible: ask in a blocking unknown rather than invent a test' : '';
      items.push({ id: `${f.id}.in`, group: 'branch', label: f.type === 'loop' ? `loop [${lbl}] runs at least once` : `${f.type} [${lbl}] taken`, line: f.line });
      items.push({ id: `${f.id}.out`, group: 'branch', label: f.type === 'loop' ? `loop [${lbl}] runs zero times${always}` : `${f.type} [${lbl}] not taken`, line: f.line });
    }
    // numbers in fragment labels ("within 5 minutes", "at most 10 attempts")
    f.operands.forEach((o, k) => items.push(...boundaryItems(f.operands.length > 1 ? `${f.id}.${k + 1}` : f.id, o.label, `${f.type} [${o.label}]`, o.line)));
  }
  // messages are not coverage items: a test reaches them through the branches it takes
  return {
    kind: 'sequence', technique: TECHNIQUE.sequence,
    model: { participants: p.participants, messages: p.messages, fragments: p.fragments },
    views: {},
    notes: p.notes, items, warnings: p.warnings,
  };
}

// For a test path (list of chosen branch ids) → which fragments are reached and which messages run.
export function walkSequence(model, chosen) {
  const set = new Set(chosen);
  const frags = new Map(model.fragments.map((f) => [f.id, f]));
  const branchOf = (f, k) => (ALT_LIKE.has(f.type) ? `${f.id}.${k + 1}` : OPT_LIKE.has(f.type) ? (k === 0 ? `${f.id}.in` : null) : 'always');
  const sameCtx = (a, b) => (!a && !b) || (a && b && a.fragment === b.fragment && a.operand === b.operand);
  // a taken `break` ends its enclosing operand: whatever comes after it there is skipped
  const cutBy = (ctx, line) => model.fragments.some((f) => f.type === 'break' && set.has(`${f.id}.in`) && f.endLine != null && line > f.endLine && sameCtx(f.parent, ctx) && fragActive(f));
  const fragActive = (f) => active(f.parent) && !cutBy(f.parent, f.line);
  const active = (ctx) => {
    if (!ctx) return true;
    const f = frags.get(ctx.fragment);
    if (!f) return true;
    if (!fragActive(f)) return false;
    const b = branchOf(f, ctx.operand);
    return b === 'always' || set.has(b);
  };
  const problems = [];
  for (const f of model.fragments) {
    if (!fragActive(f)) {
      const mine = [...set].filter((x) => x.startsWith(`${f.id}.`));
      if (mine.length) problems.push(`chooses ${mine.join(', ')} but ${f.id} is not reached on this path`);
      continue;
    }
    if (ALT_LIKE.has(f.type)) {
      const options = f.operands.map((_, k) => `${f.id}.${k + 1}`);
      if (f.operands.length === 1) options.push(`${f.id}.else`);
      const picked = options.filter((x) => set.has(x));
      if (picked.length !== 1) problems.push(picked.length ? `picks ${picked.length} branches of ${f.type} ${f.id}, a path takes one` : `does not say which branch of ${f.type} ${f.id} it takes`);
    } else if (OPT_LIKE.has(f.type)) {
      const a = set.has(`${f.id}.in`), b = set.has(`${f.id}.out`);
      if (a === b) problems.push(a ? `takes both ${f.id}.in and ${f.id}.out` : `does not say whether ${f.type} ${f.id} is taken (${f.id}.in / ${f.id}.out)`);
    }
  }
  const messages = model.messages.filter((m) => active(m.context) && !cutBy(m.context, m.line)).map((m) => m.id);
  return { problems, messages };
}

// ---------------------------------------------------------------- DFD (CRUD)
function fromDfd(p) {
  const entities = [], processes = [], stores = [];
  for (const n of p.nodes) {
    if (n.shape === 'store') stores.push(n.label);
    else if (['circle', 'round', 'stadium'].includes(n.shape)) processes.push(n.label);
    else entities.push(n.label);
  }
  const label = new Map(p.nodes.map((n) => [n.id, n.label]));
  const flows = p.edges.map((e) => ({ from: label.get(e.from) ?? e.from, to: label.get(e.to) ?? e.to, label: e.label, line: e.line }));
  return dfdFrom(entities, processes, stores, flows, p.warnings);
}

// Whole words only: "address" is not "add", "login" is not "log", "cancel order" is
// usually a status update, so it stays W (ask) instead of D.
const VERBS = {
  D: ['delete', 'deletes', 'deleted', 'remove', 'removes', 'removed', 'purge', 'purges', 'erase', 'erases', 'drop', 'drops'],
  U: ['update', 'updates', 'updated', 'modify', 'modifies', 'edit', 'edits', 'change', 'changes', 'set', 'sets', 'adjust', 'adjusts', 'decrement', 'decrements', 'increment', 'increments', 'mark', 'marks', 'overwrite', 'overwrites'],
  C: ['create', 'creates', 'created', 'insert', 'inserts', 'inserted', 'add', 'adds', 'added', 'new', 'register', 'registers', 'append', 'appends'],
};
function crudOp(label) {
  const words = new Set((label || '').toLowerCase().split(/[^a-z]+/).filter(Boolean));
  const hits = Object.entries(VERBS).filter(([, list]) => list.some((w) => words.has(w))).map(([op]) => op);
  return hits.length === 1 ? hits[0] : 'W';
}

function dfdFrom(entities, processes, stores, flows, warnings) {
  const items = [];
  const kinds = new Map([...entities.map((x) => [x, 'entity']), ...processes.map((x) => [x, 'process']), ...stores.map((x) => [x, 'store'])]);
  const fl = flows.map((f, i) => ({ id: `FL${i + 1}`, ...f }));
  const w = [...warnings];
  for (const f of fl) {
    items.push({ id: f.id, group: 'flow', label: `${f.from} → ${f.to}${f.label ? `: ${f.label}` : ''}`, line: f.line ?? null });
    const a = kinds.get(f.from), b = kinds.get(f.to);
    if (a !== 'process' && b !== 'process') w.push(`flow ${f.id} (${f.from} → ${f.to}) does not touch a process — not valid in a DFD`);
  }
  const crud = new Map();
  for (const f of fl) {
    const a = kinds.get(f.from), b = kinds.get(f.to);
    let proc, store, op;
    if (a === 'process' && b === 'store') { proc = f.from; store = f.to; op = crudOp(f.label); }
    else if (a === 'store' && b === 'process') { proc = f.to; store = f.from; op = 'R'; }
    else continue;
    const id = `CRUD:${proc}:${store}:${op}`;
    if (!crud.has(id)) crud.set(id, { id, process: proc, store, op, flows: [] });
    crud.get(id).flows.push(f.id);
  }
  for (const c of crud.values()) items.push({ id: c.id, group: 'crud', label: `${c.process} ${({ C: 'creates in', R: 'reads', U: 'updates', D: 'deletes from', W: 'writes to (C or U not stated)' })[c.op]} ${c.store}`, unclear: c.op === 'W' });
  // findings on the matrix as a whole: gaps in a store's life cycle, processes that only
  // consume or only produce — questions for the analyst, not tests
  const ops = (s) => new Set([...crud.values()].filter((c) => c.store === s).map((c) => c.op));
  for (const s of stores) {
    const o = ops(s);
    if (!o.has('C') && !o.has('W')) items.push({ id: `Q:${s}:no-create`, group: 'finding', label: `no process creates records in ${s} — where do they come from?` });
    if (!o.has('R')) items.push({ id: `Q:${s}:never-read`, group: 'finding', label: `${s} is written but never read — who uses this data?` });
    if (!o.has('D')) items.push({ id: `Q:${s}:no-delete`, group: 'finding', label: `nothing deletes or archives records in ${s} — are they kept forever?` });
  }
  for (const proc of processes) {
    if (!fl.some((f) => f.to === proc)) items.push({ id: `Q:${proc}:no-input`, group: 'finding', label: `process ${proc} has no input flow — what starts it and with what data?` });
    if (!fl.some((f) => f.from === proc)) items.push({ id: `Q:${proc}:no-output`, group: 'finding', label: `process ${proc} has no output flow — what is its result?` });
  }
  return {
    kind: 'dfd', technique: TECHNIQUE.dfd,
    model: { entities, processes, stores, flows: fl },
    views: { crud: [...crud.values()] },
    notes: [], items, warnings: w,
  };
}

// ---------------------------------------------------------------- use case
function fromUseCase(p) {
  const items = [];
  for (const a of p.associations) items.push({ id: `UC:${a.actor}:${a.usecase}`, group: 'main', label: `${a.actor} — ${a.usecase}: main flow`, line: a.line ?? null });
  // a child actor (Child --|> Parent) can do everything its parent can
  const actorNames = new Set(p.actors.map((a) => a.name));
  const parentsOf = (a, seen = new Set()) => p.generalizations.filter((g) => g.child === a && actorNames.has(g.parent) && !seen.has(g.parent)).flatMap((g) => [g.parent, ...parentsOf(g.parent, new Set([...seen, g.parent]))]);
  for (const a of actorNames) {
    for (const parent of parentsOf(a)) {
      for (const as of p.associations.filter((x) => x.actor === parent)) {
        const id = `UC:${a}:${as.usecase}`;
        if (!items.some((i) => i.id === id)) items.push({ id, group: 'main', label: `${a} — ${as.usecase}: main flow (inherited from ${parent})`, line: as.line ?? null, inherited: parent });
      }
    }
  }
  const withActor = new Set(p.associations.map((a) => a.usecase));
  const included = new Set(p.includes.map((i) => i.included));
  const extending = new Set(p.extends.map((e) => e.extension));
  for (const u of p.usecases) if (!withActor.has(u.name) && !included.has(u.name) && !extending.has(u.name)) items.push({ id: `UC:-:${u.name}`, group: 'main', label: `${u.name}: main flow (no actor on the diagram)`, line: u.line ?? null });
  for (const e of p.extends) items.push({ id: `EXT:${e.extension}:${e.base}`, group: 'alternative', label: `${e.base} extended by ${e.extension}${e.condition ? ` (${e.condition})` : ''}`, line: e.line ?? null });
  for (const i of p.includes) items.push({ id: `INC:${i.base}:${i.included}`, group: 'include', label: `${i.base} includes ${i.included}`, line: i.line ?? null });
  return {
    kind: 'usecase', technique: TECHNIQUE.usecase,
    model: { actors: p.actors, usecases: p.usecases, associations: p.associations, includes: p.includes, extends: p.extends, generalizations: p.generalizations },
    views: {},
    notes: p.notes, items, warnings: p.warnings,
  };
}
