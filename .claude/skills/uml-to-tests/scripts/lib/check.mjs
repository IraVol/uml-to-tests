// Checks a <name>.tests.json against the diagram it claims to cover.
//
// Coverage is counted honestly:
//  - only `covers` (what a test asserts) counts; `path` (what it passes through to get
//    there) does not;
//  - an item named by a blocking unknown is "waiting", even if a test touches it;
//  - a diagram with items but no tested item fails;
//  - quoted UI texts and error codes in expectations must come from the diagram.
import fs from 'node:fs';
import path from 'node:path';
import { loadSource } from './source.mjs';
import { parseDiagram, buildFromModel, walkSequence, stateHelpers, TECHNIQUE } from './model.mjs';

const KINDS = Object.keys(TECHNIQUE);
const ABOUT = ['exceptions', 'response', 'boundary', 'data', 'behaviour', 'other'];

export function resolveSource(jsonPath, src) {
  if (!src || typeof src !== 'string') return null;
  // `source` is the path the skill was given, relative to the working directory;
  // a path relative to the JSON file is accepted too.
  const candidates = [path.resolve(src), path.resolve(path.dirname(jsonPath), src)];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

const isStrList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const norm = (s) => String(s).toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”«»]/g, '"').trim();

export function check(jsonPath) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push({ where, msg });
  const warn = (where, msg) => warnings.push({ where, msg });
  let doc;
  try { doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
  catch (e) { return { ok: false, errors: [{ where: 'file', msg: `not valid JSON: ${e.message}` }], warnings, diagrams: [], doc: null, source: null }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errors: [{ where: 'file', msg: 'the file must hold a JSON object with "source" and "diagrams"' }], warnings, diagrams: [], doc: null, source: null };
  const srcPath = resolveSource(jsonPath, doc.source);
  if (!srcPath) return { ok: false, errors: [{ where: 'file', msg: `source "${doc.source}" not found (relative to the working directory or the JSON file)` }], warnings, diagrams: [], doc, source: null };
  const source = loadSource(srcPath);
  const entries = Array.isArray(doc.diagrams) ? doc.diagrams.filter((e) => e && typeof e === 'object') : [];
  if (!entries.length) err('file', '"diagrams" must be a non-empty array of objects');
  const seenIdx = new Set();
  for (const e of entries) { if (seenIdx.has(e.index)) err(`diagram #${e.index}`, 'two entries have this index; keep one'); seenIdx.add(e.index); }

  const out = [];
  const allTestIds = new Set();
  const allUnknownIds = new Set();

  for (const d of source.diagrams) {
    const entry = entries.find((e) => e.index === d.index);
    const where = `diagram #${d.index}`;
    if (source.format !== 'image' && (d.kind || '').startsWith('unsupported')) {
      if (entry) warn(where, `${d.kind.split(':')[1]} diagrams are not supported; entry ignored`);
      out.push({ index: d.index, kind: d.kind, skipped: true, lines: [d.firstLine, d.lastLine] });
      continue;
    }
    if (!entry) { err(where, `${d.kind} diagram (lines ${d.firstLine}–${d.lastLine}) has no entry in "diagrams"`); continue; }
    let built;
    const verified = source.format !== 'image';
    if (verified) {
      if (entry.kind && entry.kind !== d.kind) err(where, `kind is "${entry.kind}" but the source is a ${d.kind} diagram`);
      built = parseDiagram(d);
    } else {
      if (!KINDS.includes(entry.kind)) { err(where, `image source: "kind" must be one of ${KINDS.join(', ')}`); continue; }
      if (!entry.model || typeof entry.model !== 'object') { err(where, 'image source: "model" is required (what you read from the picture, see references/schema.md)'); continue; }
      built = buildFromModel(entry.kind, entry.model);
    }
    if (built.unsupported) { err(where, built.warnings.join('; ')); continue; }
    for (const e of built.errors || []) err(where, e);
    const unparsedSet = new Set((built.unparsed || []).map((u) => u.line));
    for (const w of built.warnings || []) if (!/^line \d+:/.test(w)) warn(where, w);
    const kind = built.kind;
    const items = new Map(built.items.map((i) => [i.id, i]));
    // text the expectations may quote from
    const blockText = verified ? d.lines.map((l) => l.text).join('\n') : JSON.stringify(entry.model);
    const blockNorm = norm(blockText);

    // derived items (AI-added, each backed by a quote from the source)
    const derived = Array.isArray(entry.derived) ? entry.derived : [];
    for (const x of derived) {
      const wx = `${where} derived ${x?.id ?? '?'}`;
      if (!x || !x.id || !/^X\d+$/.test(x.id)) { err(wx, 'derived item id must look like X1, X2, …'); continue; }
      if (items.has(x.id)) { err(wx, 'duplicate id'); continue; }
      if (!x.label) err(wx, 'label is required');
      const rel = isStrList(x.relates_to) ? x.relates_to : [];
      for (const r of rel) if (!items.has(r)) err(wx, `relates_to "${r}" is not an item of this diagram`);
      const q = x.quote;
      if (!q || typeof q.text !== 'string' || !q.text.trim()) err(wx, 'quote {line, text} from the diagram is required — no quote, no item (put it in unknowns instead)');
      else {
        if (q.text.trim().split(/\s+/).length < 3) err(wx, `quote "${q.text}" is too short to prove anything — quote at least three words of the diagram`);
        if (verified) {
          const inBlock = d.lines.find((l) => l.no === q.line && l.text.includes(q.text));
          if (!inBlock) {
            const at = d.lines.find((l) => l.text.includes(q.text));
            if (at) warn(wx, `quote is on line ${at.no}, not ${q.line}`);
            else err(wx, `quote not found in this diagram (lines ${d.firstLine}–${d.lastLine}): "${q.text}"`);
          }
        }
      }
      items.set(x.id, { id: x.id, group: 'derived', type: x.type || 'derived', label: x.label, relates_to: rel, quote: q, derived: true });
    }

    // unknowns
    const unknowns = (Array.isArray(entry.unknowns) ? entry.unknowns : []).filter((u) => u && typeof u === 'object');
    const blockedBy = new Map();
    const openBy = new Map();
    const acknowledged = new Set();
    for (const u of unknowns) {
      const wu = `${where} unknown ${u.id ?? '?'}`;
      if (!u.id) { err(wu, 'id is required'); continue; }
      if (allUnknownIds.has(u.id)) err(wu, 'duplicate unknown id');
      allUnknownIds.add(u.id);
      if (!u.question) err(wu, 'question is required');
      if (typeof u.blocking !== 'boolean') err(wu, '"blocking" is required: true if the items cannot be tested until it is answered, false if they can be tested now and only part of the expectation is open');
      if (u.about != null && !ABOUT.includes(u.about)) err(wu, `"about" must be one of ${ABOUT.join(', ')}`);
      const aff = isStrList(u.affects) ? u.affects : [];
      const lines = Array.isArray(u.lines) ? u.lines : [];
      if (!aff.length && !lines.length) err(wu, '"affects" must name the items this question blocks or leaves open (or "lines" the diagram lines it is about) — an unknown that affects nothing hides the gap');
      for (const a of aff) {
        if (!items.has(a)) { err(wu, `affects "${a}" is not an item of this diagram`); continue; }
        const map = u.blocking ? blockedBy : openBy;
        if (!map.has(a)) map.set(a, []);
        map.get(a).push(u.id);
      }
      for (const l of lines) acknowledged.add(l);
    }
    const unknownIds = new Set(unknowns.map((u) => u.id));
    for (const u of built.unparsed || []) if (!acknowledged.has(u.line)) err(where, `line ${u.line} was not understood (${u.text}) — the items may be incomplete. Ask about it in an unknown with "lines": [${u.line}]`);

    // tests
    const tests = (Array.isArray(entry.tests) ? entry.tests : []).filter((t) => t && typeof t === 'object');
    const coveredBy = new Map();
    const reachedBy = new Map();
    const mark = (map, id, t) => { if (!map.has(id)) map.set(id, []); map.get(id).push(t); };
    for (const t of tests) {
      const wt = `${where} ${t.id ?? 'test ?'}`;
      if (!t.id || typeof t.id !== 'string') { err(wt, 'test id is required'); continue; }
      if (allTestIds.has(t.id)) err(wt, 'duplicate test id');
      allTestIds.add(t.id);
      if (!t.title || typeof t.title !== 'string') err(wt, 'title is required');
      if (t.technique && t.technique !== built.technique) warn(wt, `technique "${t.technique}" — this diagram uses ${built.technique}`);
      if (!isStrList(t.covers) || !t.covers.length) { err(wt, 'covers must be a non-empty list of item ids — the items this test checks'); t.covers = isStrList(t.covers) ? t.covers : []; continue; }
      if (t.path != null && !isStrList(t.path)) { err(wt, 'path must be a list of item ids'); t.path = []; }
      t.path = t.path || [];
      for (const c of [...t.path, ...t.covers]) {
        if (/^M\d+$/.test(c)) err(wt, `${c} is a message — messages are reached through branches, list the branches instead`);
        else if (!items.has(c)) err(wt, `"${c}" is not an item of this diagram`);
        else if (items.get(c).group === 'finding') err(wt, `${c} is a finding about the diagram — answer it with an unknown, not a test`);
      }
      if (t.preconditions != null && !isStrList(t.preconditions)) { err(wt, 'preconditions must be a list of strings'); t.preconditions = [String(t.preconditions)]; }
      if (!Array.isArray(t.steps) || !t.steps.length) { err(wt, 'steps must be a non-empty list'); t.steps = []; }
      else t.steps.forEach((s, k) => { if (!s || typeof s !== 'object' || !s.action || !s.expected) err(wt, `step ${k + 1} needs both action and expected`); });
      t.steps = t.steps.filter((s) => s && typeof s === 'object');
      if (!t.expected_result || typeof t.expected_result !== 'string') err(wt, 'expected_result is required');
      if (t.unknowns != null && !isStrList(t.unknowns)) { err(wt, 'unknowns must be a list of unknown ids'); t.unknowns = []; }
      for (const u of t.unknowns || []) if (!unknownIds.has(u)) err(wt, `refers to unknown "${u}" that is not listed`);
      for (const c of t.covers) if (items.has(c)) mark(coveredBy, c, t.id);

      inventedText(t, blockNorm, (m) => err(wt, m), new Set([...unknownIds, ...tests.map((x) => x?.id), ...items.keys()].filter(Boolean).map((x) => norm(x))));
      // a boundary test must use the value the data type gives (999.99 EUR, 4 min 59 s, 9 attempts)
      const ownText = norm(JSON.stringify([t.test_data ?? null, t.steps.map((s) => s.action), t.preconditions ?? null, t.title]));
      for (const c of t.covers) {
        const b = items.get(c)?.boundary;
        if (!b) continue;
        const found = b.forms.some((f) => new RegExp(`(^|[^\\d.,])${norm(f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d])`).test(ownText));
        if (!found) err(wt, `${c} should be tested with ${b.test_value} (step ${b.step} for ${b.type}), but the test's data, steps or preconditions do not name it`);
      }

      if (kind === 'state') checkStatePath(built, t, items, (m) => err(wt, m));
      if (kind === 'activity') {
        const rs = t.covers.filter((c) => /^R\d+$/.test(c));
        if (rs.length > 1) err(wt, `covers ${rs.length} decision-table rules (${rs.join(', ')}); one test = one rule`);
      }
      if (kind === 'sequence') {
        const chosen = [...t.path, ...t.covers].filter((c) => /^F\d+\./.test(c));
        const walk = walkSequence(built.model, chosen);
        walk.problems.forEach((p) => err(wt, `path ${p}`));
        for (const m of walk.messages) mark(reachedBy, m, t.id);
      }
    }

    // coverage — blocked wins over covered; only covers count
    let total = 0, covered = 0, blocked = 0, open = 0;
    const status = new Map();
    const findings = [];
    for (const it of items.values()) {
      if (it.group === 'finding') {
        const asked = [...(blockedBy.get(it.id) || []), ...(openBy.get(it.id) || [])];
        findings.push({ ...it, askedBy: asked });
        status.set(it.id, asked.length ? 'asked' : 'miss');
        if (!asked.length) err(where, `${it.id}: ${it.label} — ask this in an unknown that affects it`);
        continue;
      }
      total++;
      if (blockedBy.has(it.id)) { blocked++; status.set(it.id, 'wait'); continue; }
      if (coveredBy.has(it.id)) { covered++; status.set(it.id, openBy.has(it.id) ? 'open' : 'ok'); if (openBy.has(it.id)) open++; continue; }
      status.set(it.id, 'miss');
      err(where, `${it.id} (${it.label}) is not checked by any test${openBy.has(it.id) ? ` — ${openBy.get(it.id).join(', ')} is not blocking, so it must be tested now` : ''} and no blocking unknown explains why`);
    }
    if (total && !covered) err(where, `no item is tested (${blocked} waiting for answers) — at least the items the diagram fully defines must have tests`);
    else if (total && blocked > total / 2) warn(where, `${blocked} of ${total} items wait for answers — check that the unknowns really block them`);

    if (kind === 'usecase') {
      for (const it of items.values()) {
        if (it.group !== 'main') continue;
        const ex = [...items.values()].some((x) => x.derived && /exception/i.test(x.type) && x.relates_to.includes(it.id) && coveredBy.has(x.id));
        const asked = unknowns.some((u) => (u.affects || []).includes(it.id) && u.about === 'exceptions');
        if (!ex && !asked) err(where, `${it.id}: no exception flow quoted from the diagram and no unknown with "about": "exceptions" for it`);
      }
    }
    if (kind === 'dfd') for (const it of items.values()) if (it.unclear && !blockedBy.has(it.id) && !openBy.has(it.id)) err(where, `${it.id}: the flow label does not say create or update — ask in an unknown that affects it`);

    const harness = Array.isArray(entry.harness) ? entry.harness.filter((h) => h && typeof h === 'object') : [];
    if (entry.harness != null && !Array.isArray(entry.harness)) err(where, '"harness" must be a list of {participant, how}');
    for (const h of harness) if (typeof h.participant !== 'string' || typeof h.how !== 'string') err(where, 'every harness entry needs "participant" and "how" as text');
    out.push({ index: d.index, kind, technique: built.technique, harness, findings, verified, lines: [d.firstLine, d.lastLine], title: typeof entry.title === 'string' ? entry.title : null, built, items: [...items.values()], status, coveredBy, reachedBy, blockedBy, openBy, tests, unknowns, total, covered, blocked, open, unparsed: built.unparsed || [], acknowledged });
  }
  for (const e of entries) if (!source.diagrams.some((d) => d.index === e.index)) err(`diagram #${e.index}`, 'no diagram with this index in the source');

  return { ok: errors.length === 0, errors, warnings, diagrams: out, doc, source, srcPath };
}

// A UI text in quotes or an error code in an expectation must come from the diagram,
// the test's own data or its own actions — otherwise it was invented.
function inventedText(t, blockNorm, fail, known = new Set()) {
  const own = norm(JSON.stringify([t.test_data ?? null, (t.steps || []).map((s) => s?.action), t.preconditions ?? null]));
  const expectations = [...(t.steps || []).map((s) => s?.expected), t.expected_result].filter((x) => typeof x === 'string');
  for (const e of expectations) {
    for (const m of e.matchAll(/"([^"]{3,})"|“([^”]{3,})”|«([^»]{3,})»/g)) {
      const q = norm(m[1] ?? m[2] ?? m[3]);
      if (!blockNorm.includes(q) && !own.includes(q)) fail(`expects the text "${m[1] ?? m[2] ?? m[3]}", which is not on the diagram — ask what the system shows instead of inventing it`);
    }
    for (const m of e.matchAll(/\b(?:HTTP|status(?:\s+code)?|error(?:\s+code)?|code)\s*[:#]?\s*([A-Z]{0,5}-?\d{3,})\b|\b([A-Z]{1,5}-\d{1,5})\b/g)) {
      const code = norm(m[1] ?? m[2]);
      if (known.has(code)) continue; // an unknown, test or item id (U-01, TC-ST-003) is not an error code
      if (!blockNorm.includes(code) && !own.includes(code)) fail(`expects code ${m[1] ?? m[2]}, which is not on the diagram — ask instead of inventing it`);
    }
  }
}

function checkStatePath(built, t, items, fail) {
  const tr = new Map(built.model.transitions.map((x) => [x.id, x]));
  const { isLeaf, within } = stateHelpers(built.model);
  const isStateItem = (c) => /^T\d+$/.test(c) || c.startsWith('N:') || c.startsWith('G:');
  const seq = [...t.path, ...t.covers].filter(isStateItem);
  if (!seq.length) return;
  // history pairs: Ti must be followed by Tj with no other transition in between
  for (const c of t.covers.filter((x) => x.startsWith('P:'))) {
    const pair = items.get(c)?.pair; if (!pair) continue;
    const [ti, tj] = pair;
    const iI = seq.indexOf(ti);
    const iJ = iI >= 0 ? seq.indexOf(tj, iI + 1) : -1;
    if (iI < 0 || iJ < 0) fail(`${c} needs ${ti} and then ${tj} in the path`);
    else if (seq.slice(iI + 1, iJ).some((x) => /^T\d+$/.test(x))) fail(`${c}: between ${ti} and ${tj} the test takes another transition`);
  }
  const first = seq[0];
  const fromInitial = /^T\d+$/.test(first) && tr.get(first)?.from === '[*]';
  if (!fromInitial && !(t.preconditions || []).length) fail(`starts in the middle of the machine (${first}) without preconditions saying how to get there — start from [*] or describe the setup`);
  let cur = null;
  seq.forEach((c, i) => {
    if (/^T\d+$/.test(c)) {
      const x = tr.get(c); if (!x) return;
      if (x.from === '[*]' && i > 0) fail(`path restarts: ${c} starts from the initial state, but it is not the first step`);
      else if (cur && x.from !== '[*]' && !within(cur, x.from)) fail(`path breaks: ${c} starts in ${x.from}, but the previous step ends in ${cur}`);
      cur = x.toLeaf ?? x.to;
    } else if (c.startsWith('G:')) {
      const g = items.get(c)?.guardOf; if (!g) return;
      if (cur && !within(cur, g.from)) fail(`path breaks: ${c} needs ${g.from}, but the test is in ${cur}`);
      cur = cur ?? g.from;
    } else {
      const it = items.get(c); if (!it) return;
      if (cur && it.expectState !== cur) fail(`path breaks: ${c} needs ${it.expectState}, but the test is in ${cur}`);
      cur = it.expectState;
    }
  });
  if (!t.expected_state) fail(`expected_state is required (the state after the last step: ${cur})`);
  else if (cur && t.expected_state !== cur) fail(`expected_state is ${t.expected_state}, but following ${seq.join(' → ')} ends in ${cur}`);
  else if (cur && cur !== '[*]' && !isLeaf(cur)) fail(`the path ends in ${cur}, a pseudo or composite state — a test must end in a real state`);
}
