// PlantUML parsers: state, activity (new syntax), sequence, use case.
import { parseTransitionLabel, cleanLabel, unquote } from './common.mjs';

const SKIP = /^(skinparam|hide|show|title|caption|header|footer|legend|endlegend|scale|left to right direction|top to bottom direction|!|autonumber|newpage|allowmixing|<style>|<\/style>)/i;

function* statements(lines) {
  let inNote = null;
  let inLegend = false;
  let inComment = false;
  for (const { no, text } of lines) {
    // block comments /' … '/ (may span lines)
    let raw = text;
    if (inComment) {
      const end = raw.indexOf("'/");
      if (end < 0) continue;
      raw = raw.slice(end + 2);
      inComment = false;
    }
    raw = raw.replace(/\/'.*?'\//g, '');
    const open = raw.indexOf("/'");
    if (open >= 0) { raw = raw.slice(0, open); inComment = true; }
    const t = raw.trim();
    if (inNote) {
      if (/^end\s*note$/i.test(t)) { inNote.done = true; yield { no: inNote.line, t: '__note__', note: inNote }; inNote = null; }
      else inNote.text += (inNote.text ? ' ' : '') + t;
      continue;
    }
    if (inLegend) { if (/^endlegend$/i.test(t)) inLegend = false; continue; }
    if (!t || t.startsWith("'") || /^@(start|end)uml/i.test(t)) continue;
    if (/^legend\b/i.test(t)) { inLegend = true; continue; }
    if (SKIP.test(t)) continue;
    const nm = t.match(/^[hr]?note\s+(?:(left|right|top|bottom|over)\b(?:\s+of)?\s*([^:]*?))?\s*(?::\s*(.*))?$/i);
    if (nm) {
      if (nm[3] != null) { yield { no, t: '__note__', note: { line: no, target: (nm[2] || '').trim() || null, text: nm[3] } }; continue; }
      const alias = t.match(/^note\s+"([^"]*)"\s+as\s+(\w+)/i);
      if (alias) { yield { no, t: '__note__', note: { line: no, target: null, alias: alias[2], text: alias[1] } }; continue; }
      inNote = { line: no, target: (nm[2] || '').trim() || null, text: '' };
      continue;
    }
    const na = t.match(/^note\s+"([^"]*)"\s+as\s+(\w+)/i);
    if (na) { yield { no, t: '__note__', note: { line: no, target: null, alias: na[2], text: na[1] } }; continue; }
    yield { no, t };
  }
}

// ---------------------------------------------------------------- state
const ARROW_STATE = /^([\w.]+|\[\*\]|"[^"]+")\s*(-+(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|l|r|u|d)?-*>|<-+(?:\[[^\]]*\])?-*)\s*([\w.]+|\[\*\]|"[^"]+")\s*(?::\s*(.*))?$/;

export function parsePlantState(lines) {
  const states = new Map();
  const transitions = [];
  const notes = [];
  const warnings = [];
  const stack = [];
  const add = (name, extra = {}) => {
    if (name === '[*]') return;
    if (!states.has(name)) states.set(name, { name, label: name, pseudo: null, parent: stack.at(-1) || null, line: extra.line ?? null });
    const s = states.get(name);
    for (const [k, v] of Object.entries(extra)) if (v != null && k !== 'line') s[k] = v;
  };
  for (const { no, t, note } of statements(lines)) {
    if (note) { notes.push(note); continue; }
    let m;
    if (t === '}' ) { stack.pop(); continue; }
    if (/^(--|\|\|)$/.test(t)) continue;
    if ((m = t.match(/^state\s+"([^"]+)"\s+as\s+([\w.]+)\s*(<<\s*\w+\s*>>)?\s*(\{)?/i))) { add(m[2], { label: m[1], line: no, pseudo: pseudoOf(m[3]) }); if (m[4]) stack.push(m[2]); continue; }
    if ((m = t.match(/^state\s+([\w.]+)\s*(<<\s*\w+\s*>>)?\s*(?::\s*(.*?))?\s*(\{)?$/i))) { add(m[1], { line: no, pseudo: pseudoOf(m[2]), description: m[3] || null }); if (m[4]) stack.push(m[1]); continue; }
    if ((m = t.match(ARROW_STATE))) {
      let from = unquote(m[1]), to = unquote(m[3]);
      if (m[2].startsWith('<')) [from, to] = [to, from];
      add(from, { line: no }); add(to, { line: no });
      transitions.push({ from, to, ...parseTransitionLabel(m[4] ?? null), scope: stack.at(-1) || null, line: no });
      continue;
    }
    if ((m = t.match(/^([\w.]+)\s*:\s*(.+)$/))) { add(m[1], { description: m[2], line: no }); continue; }
    warnings.push(`line ${no}: not understood: ${t}`);
  }
  return { states: [...states.values()], transitions, notes, warnings };
}
const pseudoOf = (s) => { if (!s) return null; const v = s.replace(/[<>\s]/g, '').toLowerCase(); return ['choice', 'fork', 'join', 'end', 'entrypoint', 'exitpoint'].includes(v) ? v : null; };

// ---------------------------------------------------------------- activity
// Builds a control-flow graph from the structured syntax. fork branches are
// chained one after another (all branches run), so decisions inside them combine.
export function parsePlantActivity(lines) {
  const nodes = [];
  const edges = [];
  const notes = [];
  const warnings = [];
  let tails = []; // [{id, label}]
  const frames = [];
  const node = (type, label, line) => { const id = `N${nodes.length + 1}`; nodes.push({ id, type, label: cleanLabel(label ?? ''), line }); return id; };
  const link = (to, line) => { for (const tl of tails) edges.push({ from: tl.id, to, label: tl.label ?? null, line }); tails = [{ id: to, label: null }]; };
  let pendingLabel = null;
  let buf = null; // multi-line :action;
  for (const st of statements(lines)) {
    if (st.note) { notes.push(st.note); continue; }
    const { no } = st;
    let t = st.t;
    if (buf) {
      buf.text += ' ' + t;
      if (/[;|<>\]}/]$/.test(t)) { t = buf.text; buf = null; } else continue;
    }
    if (t.startsWith(':') && !/[;|<>\]}/]$/.test(t)) { buf = { text: t }; continue; }
    let m;
    if (/^\|.*\|$/.test(t) || /^(partition|group|package|rectangle|card)\b/i.test(t) || t === '}' || /^end\s*group$/i.test(t)) continue;
    if ((m = t.match(/^-+(?:\[[^\]]*\])?->\s*(.*?);?$/))) { pendingLabel = m[1] ? cleanLabel(m[1]) : null; if (pendingLabel) tails = tails.map((x) => ({ ...x, label: x.label ?? pendingLabel })); continue; }
    if (/^start$/i.test(t)) { const id = node('start', 'start', no); tails = [{ id, label: null }]; continue; }
    if (/^(stop|end|kill|detach)$/i.test(t)) { const id = node('end', t.toLowerCase(), no); link(id, no); tails = []; continue; }
    if ((m = t.match(/^:(.*)[;|<>\]}/]$/s))) { const id = node('action', m[1], no); link(id, no); continue; }
    if ((m = t.match(/^if\s*\((.*?)\)\s*then\s*(?:\((.*)\))?\s*$/i)) || (m = t.match(/^if\s*\((.*?)\)\s*is\s*\((.*)\)\s*then$/i)) || (m = t.match(/^if\s*\((.*)\)\s*$/i))) {
      const d = node('decision', m[1], no); link(d, no);
      const thenLabel = cleanLabel(m[2] ?? 'yes');
      frames.push({ type: 'if', last: d, branchTails: [], hasElse: false, thenLabel });
      tails = [{ id: d, label: thenLabel }];
      continue;
    }
    if ((m = t.match(/^else\s*if\s*\((.*?)\)\s*then\s*(?:\((.*)\))?$/i)) || (m = t.match(/^elseif\s*\((.*?)\)\s*then\s*(?:\((.*)\))?$/i)) || (m = t.match(/^else\s*if\s*\((.*)\)$/i))) {
      const f = frames.at(-1); if (!f || f.type !== 'if') { warnings.push(`line ${no}: elseif outside if`); continue; }
      f.branchTails.push(...tails);
      const d = node('decision', m[1], no);
      edges.push({ from: f.last, to: d, label: 'no', line: no });
      f.last = d;
      tails = [{ id: d, label: cleanLabel(m[2] ?? 'yes') }];
      continue;
    }
    if ((m = t.match(/^else\s*(?:\((.*)\))?$/i))) {
      const f = frames.at(-1); if (!f || f.type !== 'if') { warnings.push(`line ${no}: else outside if`); continue; }
      f.branchTails.push(...tails);
      f.hasElse = true;
      tails = [{ id: f.last, label: cleanLabel(m[1] ?? 'no') }];
      continue;
    }
    if (/^end\s*if$/i.test(t)) {
      const f = frames.pop(); if (!f || f.type !== 'if') { warnings.push(`line ${no}: endif without if`); continue; }
      f.branchTails.push(...tails);
      // implicit else: the opposite of the then-label when it is yes/no
      const opposite = { yes: 'no', no: 'yes', true: 'false', false: 'true' }[String(f.thenLabel).toLowerCase()] ?? 'else';
      if (!f.hasElse) f.branchTails.push({ id: f.last, label: opposite });
      tails = f.branchTails;
      continue;
    }
    if ((m = t.match(/^while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?$/i))) {
      const d = node('decision', m[1], no); link(d, no);
      frames.push({ type: 'while', d });
      tails = [{ id: d, label: cleanLabel(m[2] ?? 'yes') }];
      continue;
    }
    if ((m = t.match(/^end\s*while\s*(?:\((.*)\))?$/i))) {
      const f = frames.pop(); if (!f || f.type !== 'while') { warnings.push(`line ${no}: endwhile without while`); continue; }
      for (const tl of tails) edges.push({ from: tl.id, to: f.d, label: tl.label ?? null, line: no, back: true });
      tails = [{ id: f.d, label: cleanLabel(m[1] ?? 'no') }];
      continue;
    }
    if (/^repeat$/i.test(t) || /^repeat\s*:(.*);$/i.test(t)) {
      const r = node('merge', 'repeat', no); link(r, no);
      frames.push({ type: 'repeat', r });
      const a = t.match(/^repeat\s*:(.*);$/i); if (a) { const id = node('action', a[1], no); link(id, no); }
      continue;
    }
    if ((m = t.match(/^repeat\s*while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?\s*(?:not\s*\((.*?)\))?$/i))) {
      const f = frames.pop(); if (!f || f.type !== 'repeat') { warnings.push(`line ${no}: repeat while without repeat`); continue; }
      const d = node('decision', m[1], no); link(d, no);
      edges.push({ from: d, to: f.r, label: cleanLabel(m[2] ?? 'yes'), line: no, back: true });
      tails = [{ id: d, label: cleanLabel(m[3] ?? 'no') }];
      continue;
    }
    if ((m = t.match(/^switch\s*\((.*)\)$/i))) {
      const d = node('decision', m[1], no); link(d, no);
      frames.push({ type: 'switch', d, branchTails: [], started: false });
      tails = [];
      continue;
    }
    if ((m = t.match(/^case\s*\((.*)\)$/i))) {
      const f = frames.at(-1); if (!f || f.type !== 'switch') { warnings.push(`line ${no}: case outside switch`); continue; }
      if (f.started) f.branchTails.push(...tails);
      f.started = true;
      tails = [{ id: f.d, label: cleanLabel(m[1]) }];
      continue;
    }
    if (/^end\s*switch$/i.test(t)) {
      const f = frames.pop(); if (!f || f.type !== 'switch') { warnings.push(`line ${no}: endswitch without switch`); continue; }
      f.branchTails.push(...tails); tails = f.branchTails; continue;
    }
    if (/^(fork|split)$/i.test(t)) { frames.push({ type: 'fork', branchEnds: [] }); continue; }
    if (/^(fork|split)\s+again$/i.test(t)) { continue; } // branches are chained: keep going from current tails
    if (/^end\s*(fork|split|merge)\b/i.test(t)) { frames.pop(); continue; }
    warnings.push(`line ${no}: not understood: ${t}`);
  }
  if (frames.length) warnings.push(`${frames.length} block(s) not closed`);
  // implicit end for flows without stop
  if (tails.length && nodes.length) { const id = node('end', '(end)', null); link(id, null); }
  return { nodes, edges, notes, warnings };
}

// ---------------------------------------------------------------- sequence
const PARTICIPANT = /^(participant|actor|boundary|control|entity|database|collections|queue)\s+("[^"]+"|[\w.]+)(?:\s+as\s+("[^"]+"|[\w.]+))?/i;
const MSG = /^("[^"]+"|[\w.]+|\[|\])\s*([xo]?<{0,2}(?:-+|\.+)(?:\[[^\]]*\])?(?:-+|\.+)?>{0,2}[xo]?|[xo]?<{0,2}-+[xo]?)\s*("[^"]+"|[\w.]+|\[|\])\s*(?:\+\+|--|\*\*|!!)?\s*(?::\s*(.*))?$/;

export function parsePlantSequence(lines) {
  const participants = new Map();
  const aliases = new Map();
  const messages = [];
  const fragments = [];
  const notes = [];
  const warnings = [];
  const stack = [];
  const ctx = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === 'fragment') return { fragment: stack[i].frag.id, operand: stack[i].frag.operands.length - 1 }; return null; };
  const name = (s) => { const u = unquote(s); return aliases.get(u) ?? u; };
  const addP = (n, line) => { if (!participants.has(n)) participants.set(n, { name: n, label: n, line }); };
  for (const { no, t, note } of statements(lines)) {
    if (note) { notes.push(note); continue; }
    let m;
    // keywords need a word boundary: "CreateOrderHandler -> DB" is a message, not `create`
    if (/^(==.*==|\.\.\..*|\|\|\|?.*|(activate|deactivate|destroy|create|autoactivate)\b(?!\s*-)|ref\s+over\b|end\s+ref\b|box\b(?!\s*-)|end\s*box\b)/i.test(t)) continue;
    if (/^return\b(?!\s*-)/i.test(t)) { warnings.push(`line ${no}: "return" reply is not modelled as a message: ${t}`); continue; }
    if ((m = t.match(PARTICIPANT))) {
      const a = unquote(m[2]); const b = m[3] ? unquote(m[3]) : null;
      // `participant "Long name" as L` or `participant L as "Long name"`
      const id = b ? (m[2].startsWith('"') ? b : a) : a;
      const label = b ? (m[2].startsWith('"') ? a : b) : a;
      aliases.set(id, id); addP(id, no); participants.get(id).label = label;
      continue;
    }
    if ((m = t.match(/^(alt|opt|loop|par|critical|break|group)\b\s*(.*)$/i))) {
      const frag = { id: `F${fragments.length + 1}`, type: m[1].toLowerCase(), line: no, parent: ctx(), operands: [{ label: m[2].trim() || null, line: no }] };
      fragments.push(frag); stack.push({ type: 'fragment', frag }); continue;
    }
    if ((m = t.match(/^else\b\s*(.*)$/i))) {
      const top = [...stack].reverse().find((x) => x.type === 'fragment');
      if (!top) { warnings.push(`line ${no}: else outside a fragment`); continue; }
      top.frag.operands.push({ label: m[1].trim() || null, line: no }); continue;
    }
    if (/^end$/i.test(t) || /^end\s+(alt|opt|loop|par|critical|break|group)$/i.test(t)) {
      if (!stack.length) warnings.push(`line ${no}: end without block`);
      else { const b = stack.pop(); if (b.type === 'fragment') b.frag.endLine = no; }
      continue;
    }
    if ((m = t.match(MSG)) && /-|\./.test(m[2])) {
      let from = name(m[1]), to = name(m[3]);
      const op = m[2];
      if (op.includes('<') && !op.includes('>')) [from, to] = [to, from];
      if (from !== '[' && from !== ']') addP(from, no);
      if (to !== '[' && to !== ']') addP(to, no);
      messages.push({ id: `M${messages.length + 1}`, from, to, arrow: op, text: (m[4] || '').trim(), reply: /^-{2,}|\.\./.test(op.replace(/^[xo<]+/, '')), line: no, context: ctx() });
      continue;
    }
    warnings.push(`line ${no}: not understood: ${t}`);
  }
  if (stack.length) warnings.push(`${stack.length} block(s) not closed with end`);
  // `group` is a visual frame, not a branch: drop it and re-parent its content
  const groups = new Set(fragments.filter((f) => f.type === 'group').map((f) => f.id));
  const lift = (c) => { while (c && groups.has(c.fragment)) c = fragments.find((f) => f.id === c.fragment).parent; return c; };
  for (const f of fragments) f.parent = lift(f.parent);
  for (const msg of messages) msg.context = lift(msg.context);
  const kept = fragments.filter((f) => !groups.has(f.id));
  const renum = new Map(kept.map((f, i) => [f.id, `F${i + 1}`]));
  for (const f of kept) { f.id = renum.get(f.id); if (f.parent) f.parent = { ...f.parent, fragment: renum.get(f.parent.fragment) }; }
  for (const msg of messages) if (msg.context) msg.context = { ...msg.context, fragment: renum.get(msg.context.fragment) };
  return { participants: [...participants.values()], messages, fragments: kept, notes, warnings };
}

// ---------------------------------------------------------------- use case
const UC_REL = /^(.+?)\s*([<]?[|]?[.-]+(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|l|r|u|d)?[.-]*[|]?[>]?)\s*(.+?)\s*(?::\s*(.*))?$/;

export function parsePlantUseCase(lines) {
  const actors = new Map();
  const usecases = new Map();
  const alias = new Map(); // alias -> {kind, name}
  const associations = [];
  const includes = [];
  const extendsRel = [];
  const generalizations = [];
  const notes = [];
  const noteLinks = [];
  const warnings = [];
  const addActor = (n, a, line) => { if (!actors.has(n)) actors.set(n, { name: n, line }); if (a) alias.set(a, { kind: 'actor', name: n }); alias.set(n, { kind: 'actor', name: n }); };
  const addUc = (n, a, line) => { if (!usecases.has(n)) usecases.set(n, { name: n, line }); if (a) alias.set(a, { kind: 'usecase', name: n }); alias.set(n, { kind: 'usecase', name: n }); };
  const token = (raw, line) => {
    let s = raw.trim();
    let m;
    if ((m = s.match(/^:(.+?):(?:\s+as\s+(\w+))?$/))) { addActor(cleanLabel(m[1]), m[2], line); return { kind: 'actor', name: cleanLabel(m[1]) }; }
    if ((m = s.match(/^\((.+?)\)(?:\s+as\s+(\w+))?$/))) { addUc(cleanLabel(m[1]), m[2], line); return { kind: 'usecase', name: cleanLabel(m[1]) }; }
    if ((m = s.match(/^actor\s+(.+?)(?:\s+as\s+(\w+))?$/i))) { addActor(cleanLabel(m[1].replace(/^:|:$/g, '')), m[2], line); return alias.get(cleanLabel(m[1].replace(/^:|:$/g, ''))); }
    if ((m = s.match(/^usecase\s+(.+?)(?:\s+as\s+(\w+))?$/i))) { const n = cleanLabel(m[1].replace(/^\(|\)$/g, '')); addUc(n, m[2], line); return alias.get(n); }
    const u = unquote(s);
    if (alias.has(u)) return alias.get(u);
    if (/^N\d+$|^note/i.test(u)) return { kind: 'note', name: u };
    return null;
  };
  for (const { no, t, note } of statements(lines)) {
    if (note) { notes.push(note); continue; }
    if (/^(rectangle|package|frame|node|folder|cloud)\b.*\{$/i.test(t) || t === '}') continue;
    let m;
    if ((m = t.match(/^(actor|usecase)\s+(.+)$/i)) && !UC_REL.test(t.replace(/^(actor|usecase)\s+/i, '').replace(/\s+as\s+\w+$/, '') + ' ')) { token(t, no); continue; }
    if (/^(actor|usecase)\s/i.test(t) && !/[.-]{2,}|-+>/.test(t)) { token(t, no); continue; }
    if (/^(:[^:]+:|\([^)]+\))(\s+as\s+\w+)?$/.test(t)) { token(t, no); continue; }
    if ((m = t.match(UC_REL)) && /[.-]/.test(m[2])) {
      const op = m[2];
      const label = (m[4] || '').trim();
      let L = token(m[1], no), R = token(m[3], no);
      if (!L || !R) { warnings.push(`line ${no}: unknown element in: ${t}`); continue; }
      if (L.kind === 'note' || R.kind === 'note') { noteLinks.push({ note: L.kind === 'note' ? L.name : R.name, target: L.kind === 'note' ? R : L, line: no }); continue; }
      const leftArrow = op.startsWith('<');
      let [a, b] = leftArrow ? [R, L] : [L, R]; // a → b
      if (op.includes('|')) { generalizations.push({ child: op.includes('<|') ? R.name : L.name, parent: op.includes('<|') ? L.name : R.name, kind: L.kind, line: no }); continue; }
      if (/include/i.test(label)) { includes.push({ base: a.name, included: b.name, line: no }); continue; }
      if (/extend/i.test(label)) { extendsRel.push({ extension: a.name, base: b.name, condition: label.replace(/<<\s*extends?\s*>>/i, '').trim() || null, line: no }); continue; }
      if (a.kind === 'actor' && b.kind === 'usecase') { associations.push({ actor: a.name, usecase: b.name, line: no }); continue; }
      if (b.kind === 'actor' && a.kind === 'usecase') { associations.push({ actor: b.name, usecase: a.name, line: no }); continue; }
      warnings.push(`line ${no}: relation not classified: ${t}`);
      continue;
    }
    warnings.push(`line ${no}: not understood: ${t}`);
  }
  for (const nl of noteLinks) { const n = notes.find((x) => x.alias === nl.note); if (n) n.target = nl.target.name; }
  return { actors: [...actors.values()], usecases: [...usecases.values()], associations, includes, extends: extendsRel, generalizations, notes, warnings };
}
