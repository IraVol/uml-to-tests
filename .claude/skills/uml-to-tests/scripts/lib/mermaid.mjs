// Mermaid parsers: stateDiagram(-v2), flowchart/graph (activity or DFD), sequenceDiagram.
import { parseTransitionLabel, cleanLabel } from './common.mjs';

const fixId = (s) => s.replace(/:::\S+$/, '').trim();

// ---------------------------------------------------------------- state
export function parseMermaidState(lines) {
  const states = new Map();
  const transitions = [];
  const notes = [];
  const warnings = [];
  const stack = [];
  let inNote = null;
  const add = (name, extra = {}) => {
    if (name === '[*]') return;
    if (!states.has(name)) states.set(name, { name, label: name, pseudo: null, parent: stack.at(-1) || null, line: extra.line ?? null });
    const s = states.get(name);
    for (const [k, v] of Object.entries(extra)) if (v != null && k !== 'line') s[k] = v;
    if (s.line == null && extra.line) s.line = extra.line;
  };
  for (const { no, text } of lines) {
    const t = text.replace(/%%.*$/, '').trim();
    if (inNote) {
      if (/^end\s+note$/i.test(t)) { notes.push(inNote); inNote = null; } else inNote.text += (inNote.text ? ' ' : '') + t;
      continue;
    }
    if (!t || /^stateDiagram/i.test(t) || /^direction\b/i.test(t) || /^(classDef|class|style|accTitle|accDescr|title)\b/.test(t) || /^-{2,}$/.test(t)) continue;
    let m;
    if ((m = t.match(/^note\s+(?:left|right)\s+of\s+(\S+)\s*:\s*(.*)$/i))) { notes.push({ line: no, target: m[1], text: m[2] }); continue; }
    if ((m = t.match(/^note\s+(?:left|right)\s+of\s+(\S+)\s*$/i))) { inNote = { line: no, target: m[1], text: '' }; continue; }
    if ((m = t.match(/^state\s+"([^"]*)"\s+as\s+(\S+?)(\s*\{)?$/))) { add(m[2], { label: m[1], line: no }); if (m[3]) stack.push(m[2]); continue; }
    if ((m = t.match(/^state\s+(\S+?)\s*<<\s*(choice|fork|join)\s*>>\s*$/i))) { add(m[1], { pseudo: m[2].toLowerCase(), line: no }); continue; }
    if ((m = t.match(/^state\s+(\S+?)\s*\{$/))) { add(m[1], { composite: true, line: no }); stack.push(m[1]); continue; }
    if (t === '}') { stack.pop(); continue; }
    if ((m = t.match(/^(\S+?)\s*-->\s*(\S+?)(?:\s*:\s*(.*))?$/))) {
      const from = fixId(m[1]);
      const to = fixId(m[2]);
      add(from, { line: no });
      add(to, { line: no });
      transitions.push({ from, to, ...parseTransitionLabel(m[3] ?? null), scope: stack.at(-1) || null, line: no });
      continue;
    }
    if ((m = t.match(/^state\s+(\S+)$/))) { add(fixId(m[1]), { line: no }); continue; }
    if ((m = t.match(/^([A-Za-z_][\w.]*)\s*:\s*(.+)$/))) { add(m[1], { description: m[2].trim(), line: no }); continue; }
    if ((m = t.match(/^([A-Za-z_][\w.]*)$/))) { add(m[1], { line: no }); continue; }
    warnings.push(`line ${no}: not understood: ${t}`);
  }
  return { states: [...states.values()], transitions, notes, warnings };
}

// ---------------------------------------------------------------- flowchart
const OPENERS = [
  ['(((', ')))', 'circle'], ['([', '])', 'stadium'], ['[(', ')]', 'store'], ['[[', ']]', 'subroutine'],
  ['((', '))', 'circle'], ['{{', '}}', 'hexagon'], ['[/', '/]', 'para'], ['[/', '\\]', 'trap'],
  ['[\\', '\\]', 'para'], ['[\\', '/]', 'trap'], ['[', ']', 'box'], ['(', ')', 'round'],
  ['{', '}', 'decision'], ['>', ']', 'flag'],
];

function readNode(s, pos) {
  // hyphen/dot are allowed inside ids, but not when they start an arrow (A-->B, A-.->B)
  const idm = s.slice(pos).match(/^([A-Za-z0-9_](?:\w|[-.](?![-.>=ox])|[-.](?=[ox]\w))*)/);
  if (!idm) return null;
  let p = pos + idm[1].length;
  const id = idm[1];
  let label = null, shape = null;
  for (const [open, close, name] of OPENERS) {
    if (!s.startsWith(open, p)) continue;
    let q = p + open.length;
    let end;
    if (s[q] === '"') {
      const qe = s.indexOf('"', q + 1);
      if (qe < 0) continue;
      label = s.slice(q + 1, qe);
      end = s.indexOf(close, qe + 1);
      if (end < 0) continue;
    } else {
      end = s.indexOf(close, q);
      if (end < 0) continue;
      label = s.slice(q, end);
    }
    shape = name;
    p = end + close.length;
    break;
  }
  const cls = s.slice(p).match(/^:::[\w-]+/);
  if (cls) p += cls[0].length;
  return { id, label: label != null ? cleanLabel(label) : null, shape, end: p };
}

function readEdge(s, pos) {
  const rest = s.slice(pos);
  // inline label: -- text -->, == text ==>, -. text .->
  let m = rest.match(/^\s*(--|==|-\.)\s+(.+?)\s+(-{2,}>|={2,}>|\.-*->|-{3,}|={3,}|\.-+)\s*/);
  if (m) return { label: cleanLabel(m[2]), end: pos + m[0].length, dotted: m[1] === '-.' };
  m = rest.match(/^\s*(<?(?:-\.+-|-{2,}|={2,})(?:>|o|x)?)\s*(?:\|([^|]*)\|)?\s*/);
  if (m && /[-=]/.test(m[1])) return { label: m[2] != null ? cleanLabel(m[2]) : null, end: pos + m[0].length, dotted: m[1].includes('.') };
  return null;
}

function readGroup(s, pos) {
  const nodes = [];
  let p = pos;
  for (;;) {
    while (s[p] === ' ') p++;
    const n = readNode(s, p);
    if (!n) return nodes.length ? { nodes, end: p } : null;
    nodes.push(n);
    p = n.end;
    const amp = s.slice(p).match(/^\s*&\s*/);
    if (!amp) return { nodes, end: p };
    p += amp[0].length;
  }
}

export function parseMermaidFlowchart(lines) {
  const nodes = new Map();
  const edges = [];
  const warnings = [];
  const touch = (n, line) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { id: n.id, label: n.label ?? n.id, shape: n.shape ?? 'box', line });
    else if (n.label != null) { const o = nodes.get(n.id); if (o.label === o.id) { o.label = n.label; o.shape = n.shape; } else if (o.shape === 'box' && n.shape && n.shape !== 'box') o.shape = n.shape; }
  };
  for (const { no, text } of lines) {
    for (const stmt of text.replace(/%%.*$/, '').split(/;\s*(?=\S|$)/)) {
      const t = stmt.trim();
      if (!t || /^(flowchart|graph)\b/i.test(t) || /^(subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr|title)\b/.test(t)) continue;
      let g = readGroup(t, 0);
      if (!g) { warnings.push(`line ${no}: not understood: ${t}`); continue; }
      g.nodes.forEach((n) => touch(n, no));
      let p = g.end;
      while (p < t.length) {
        const e = readEdge(t, p);
        if (!e) { if (t.slice(p).trim()) warnings.push(`line ${no}: ignored tail: ${t.slice(p)}`); break; }
        const g2 = readGroup(t, e.end);
        if (!g2) { warnings.push(`line ${no}: edge without target: ${t}`); break; }
        g2.nodes.forEach((n) => touch(n, no));
        for (const a of g.nodes) for (const b of g2.nodes) edges.push({ from: a.id, to: b.id, label: e.label, line: no });
        g = g2;
        p = g2.end;
      }
    }
  }
  return { nodes: [...nodes.values()], edges, warnings };
}

// ---------------------------------------------------------------- sequence
const SEQ_ARROWS = ['<<-->>', '<<->>', '-->>', '->>', '--x', '-x', '--)', '-)', '-->', '->'];

export function parseMermaidSequence(lines) {
  const participants = new Map();
  const messages = [];
  const fragments = [];
  const notes = [];
  const warnings = [];
  const stack = []; // {type:'fragment', frag} | {type:'ignore'}
  const addP = (name, label, line) => { if (!participants.has(name)) participants.set(name, { name, label: label || name, line }); };
  const ctx = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === 'fragment') return { fragment: stack[i].frag.id, operand: stack[i].frag.operands.length - 1 };
    return null;
  };
  for (const { no, text } of lines) {
    const t = text.replace(/%%.*$/, '').trim();
    // keywords only when followed by a space or the end: a participant may be named "Details"
    if (!t || /^sequenceDiagram/i.test(t) || /^(autonumber|activate|deactivate|link|links|properties|details|title|accTitle|accDescr|destroy)(\s|:|$)/i.test(t)) continue;
    let m;
    if ((m = t.match(/^(?:create\s+)?(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i))) { addP(m[2], m[3]?.trim(), no); continue; }
    if ((m = t.match(/^note\s+(?:left of|right of|over)\s+([^:]+):\s*(.*)$/i))) { notes.push({ line: no, target: m[1].trim(), text: m[2] }); continue; }
    if ((m = t.match(/^(alt|opt|loop|par|critical|break)\b\s*(.*)$/i))) {
      const frag = { id: `F${fragments.length + 1}`, type: m[1].toLowerCase(), line: no, parent: ctx(), operands: [{ label: m[2].trim() || null, line: no }] };
      fragments.push(frag);
      stack.push({ type: 'fragment', frag });
      continue;
    }
    if ((m = t.match(/^(else|and|option)\b\s*(.*)$/i))) {
      const top = [...stack].reverse().find((x) => x.type === 'fragment');
      if (!top) { warnings.push(`line ${no}: ${m[1]} outside a fragment`); continue; }
      top.frag.operands.push({ label: m[2].trim() || null, line: no });
      continue;
    }
    if (/^(rect|box)\b/i.test(t)) { stack.push({ type: 'ignore' }); continue; }
    if (/^end$/i.test(t)) {
      if (!stack.length) warnings.push(`line ${no}: end without block`);
      else { const b = stack.pop(); if (b.type === 'fragment') b.frag.endLine = no; }
      continue;
    }
    const msg = parseSeqMessage(t);
    if (msg) {
      addP(msg.from, null, no);
      addP(msg.to, null, no);
      messages.push({ id: `M${messages.length + 1}`, ...msg, line: no, context: ctx() });
      continue;
    }
    warnings.push(`line ${no}: not understood: ${t}`);
  }
  if (stack.length) warnings.push(`${stack.length} block(s) not closed with end`);
  return { participants: [...participants.values()], messages, fragments, notes, warnings };
}

function parseSeqMessage(t) {
  const colon = t.indexOf(':');
  const head = colon >= 0 ? t.slice(0, colon) : t;
  for (const a of SEQ_ARROWS) {
    const i = head.indexOf(a);
    if (i <= 0) continue;
    const from = head.slice(0, i).trim();
    const to = head.slice(i + a.length).trim().replace(/^[+-]\s*/, '');
    if (!from || !to || /\s/.test(from) && !/^".*"$/.test(from)) continue;
    return { from, to, arrow: a, text: colon >= 0 ? t.slice(colon + 1).trim() : '', reply: a.startsWith('--') };
  }
  return null;
}
