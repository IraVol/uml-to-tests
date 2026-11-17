#!/usr/bin/env node
// uml-to-tests helper. Plain Node 18+, no dependencies.
//
//   node uml-tests.mjs extract <diagram>     print the coverage items the diagram defines (JSON)
//                                            and create results/<name>/ for this diagram's outputs
//   node uml-tests.mjs report  <tests.json>  check the tests against the diagram, then write
//                                            <name>.test-cases.md and <name>.coverage.html next to it
//
// Outputs never go next to the diagram: they live in results/<diagram name>/ under the
// current working directory (the diagram may sit in a read-only or shared folder).
//
// Exit codes: 0 OK · 1 check failed (report is still written) · 2 usage / input error.
import fs from 'node:fs';
import path from 'node:path';
import { loadSource } from './lib/source.mjs';
import { parseDiagram } from './lib/model.mjs';
import { check } from './lib/check.mjs';
import { renderMarkdown, renderHtml } from './lib/render.mjs';

const RESULTS_DIR = 'results';

// Write everything before exiting: process.exit() right after console.log
// truncates piped output at 64 KiB.
function done(text, code) {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`, () => process.exit(code));
}
function fail(msg) { process.stderr.write(`${msg}\n`, () => process.exit(2)); }

function outputPaths(diagram) {
  const name = path.basename(diagram).replace(/\.[^.]+$/, '');
  const dir = path.join(RESULTS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    tests_json: path.join(dir, `${name}.tests.json`),
    test_cases: path.join(dir, `${name}.test-cases.md`),
    coverage: path.join(dir, `${name}.coverage.html`),
  };
}

function extract(file) {
  const src = loadSource(file);
  if (src.format === 'image') {
    return done(JSON.stringify({
      source: file, format: 'image', output: outputPaths(file),
      note: 'Images are not parsed. Read the picture, write its model into diagrams[].model (references/schema.md), then run report: coverage items are built from your model and marked as not machine-verified.',
    }, null, 2), 0);
  }
  const diagrams = src.diagrams.map((d) => {
    const base = { index: d.index, format: d.format, kind: d.kind, lines: [d.firstLine, d.lastLine] };
    if ((d.kind || '').startsWith('unsupported')) return { ...base, skip: `${d.kind.split(':')[1]} is not a supported diagram kind — no tests` };
    const b = parseDiagram(d);
    if (b.unsupported) return { ...base, skip: b.warnings.join('; ') };
    const view = {};
    if (b.kind === 'state') {
      view.states = b.model.states.filter((s) => !s.pseudo && !s.composite).map((s) => (s.parent ? `${s.name} (in ${s.parent})` : s.name));
      view.composite = b.model.states.filter((s) => s.composite).map((s) => s.name);
      view.events = b.model.events;
      view.transitions = b.model.transitions.map((t) => ({ id: t.id, from: t.from, event: t.event, guard: t.guard, to: t.to, ...(t.enters ? { enters: t.enters } : {}), note: t.note, line: t.line }));
    }
    if (b.kind === 'activity') { view.conditions = b.views.table.map((r) => r.condition); view.rules = b.views.rules.map((r) => ({ id: r.id, choices: r.choices.map((c) => `${c.condition} = ${c.choice}`), ends_at: r.endLabel, actions: r.actions })); }
    if (b.kind === 'sequence') { view.participants = b.model.participants.map((p) => (p.label === p.name ? p.name : `${p.name} (${p.label})`)); view.fragments = b.model.fragments.map((f) => ({ id: f.id, type: f.type, parent: f.parent?.fragment ?? null, operands: f.operands.map((o) => o.label), line: f.line })); view.messages = b.model.messages.map((m) => ({ id: m.id, text: `${m.from} → ${m.to}: ${m.text}`, in: m.context ? `${m.context.fragment} operand ${m.context.operand + 1}` : null, line: m.line })); }
    if (b.kind === 'dfd') { view.entities = b.model.entities; view.processes = b.model.processes; view.stores = b.model.stores; view.crud = b.views.crud.map((c) => ({ id: c.id, op: c.op, flows: c.flows })); }
    if (b.kind === 'usecase') { view.actors = b.model.actors.map((a) => a.name); view.usecases = b.model.usecases.map((u) => u.name); view.includes = b.model.includes; view.extends = b.model.extends; view.generalizations = b.model.generalizations; }
    return {
      ...base, kind: b.kind, technique: b.technique,
      items: b.items.filter((i) => i.group !== 'message').map((i) => ({ id: i.id, group: i.group, label: i.label, ...(i.line ? { line: i.line } : {}) })),
      ...(b.kind === 'sequence' ? { message_items: 'Messages M1…Mn are not items: they are reached through the branches a test takes' } : {}),
      view,
      notes: b.notes.map((n) => ({ line: n.line, target: n.target ?? null, text: n.text })),
      ...(b.unparsed.length ? { unparsed_lines: b.unparsed } : {}),
      ...(b.errors?.length ? { errors: b.errors } : {}),
      warnings: b.warnings.filter((w) => !b.unparsed.some((u) => w.startsWith(`line ${u.line}:`))),
    };
  });
  const supported = diagrams.filter((d) => !d.skip).length;
  const out = { source: file, supported_diagrams: supported };
  if (supported) out.output = outputPaths(file);
  else out.stop = 'No supported diagram in this file. Write nothing; tell the user which blocks were found and why each was skipped.';
  out.diagrams = diagrams;
  return done(JSON.stringify(out, null, 2), 0);
}

function report(file) {
  const res = check(file);
  if (!res.source) return done(res.errors.map((e) => `FAIL ${e.where}: ${e.msg}`).join('\n'), 2);
  const base = file.replace(/\.tests\.json$/i, '').replace(/\.json$/i, '');
  const html = `${base}.coverage.html`;
  const md = `${base}.test-cases.md`;
  renderHtml(res, html);
  renderMarkdown(res, md);
  const live = res.diagrams.filter((d) => !d.skipped && d.items);
  const summary = live.map((d) => `#${d.index} ${d.kind}: ${d.covered}/${d.total} covered${d.blocked ? `, ${d.blocked} waiting for answers` : ''}${d.open ? `, ${d.open} with open questions` : ''}, ${d.tests.length} tests${d.verified ? '' : ' (image — not machine-verified)'}`).join(' · ');
  const lines = [];
  if (res.ok) lines.push(`OK ${summary}`);
  else {
    lines.push(`FAIL ${res.errors.length} problem(s) · ${summary}`);
    for (const e of res.errors) lines.push(`  - ${e.where}: ${e.msg}`);
  }
  for (const w of res.warnings) lines.push(`  ~ ${w.where}: ${w.msg}`);
  lines.push(`report: ${path.relative(process.cwd(), html) || html}`);
  lines.push(`cases:  ${path.relative(process.cwd(), md) || md}`);
  return done(lines.join('\n'), res.ok ? 0 : 1);
}

const [cmd, file] = process.argv.slice(2);
if (!cmd || !file || !['extract', 'report'].includes(cmd)) fail('usage: uml-tests.mjs extract <diagram> | report <tests.json>');
else if (!fs.existsSync(file)) fail(`not found: ${file}`);
else if (fs.statSync(file).isDirectory()) fail(`${file} is a folder; pass a diagram file`);
else {
  try {
    if (cmd === 'extract') extract(file); else report(file);
  } catch (e) {
    fail(`error: ${e.message}`);
  }
}
