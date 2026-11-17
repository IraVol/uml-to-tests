// Helpers shared by the parsers.

// "event [guard] / action (note)" → parts. Works for UML-style transition labels
// and for free-text Mermaid labels like "cancel (operator, narrow window)".
export function parseTransitionLabel(label) {
  if (label == null) return { event: null, guard: null, action: null, note: null, raw: null };
  const raw = label.trim();
  let s = raw;
  let guard = null, action = null, note = null;
  const g = s.match(/\[([^\]]*)\]/);
  if (g) { guard = g[1].trim(); s = (s.slice(0, g.index) + ' ' + s.slice(g.index + g[0].length)).trim(); }
  const slash = s.indexOf(' / ') >= 0 ? s.indexOf(' / ') : (s.startsWith('/') ? 0 : -1);
  if (slash >= 0) { action = s.slice(slash).replace(/^\s*\/\s*/, '').trim() || null; s = s.slice(0, slash).trim(); }
  const p = s.match(/\(([^()]*)\)\s*$/);
  if (p) { note = p[1].trim(); s = s.slice(0, p.index).trim(); }
  return { event: s || null, guard: guard || null, action, note, raw: raw || null };
}

export function unquote(s) {
  if (s == null) return s;
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function cleanLabel(s) {
  if (s == null) return s;
  return unquote(s).replace(/<br\s*\/?>/gi, ' ').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}
