// Reads a diagram file and splits it into diagrams with absolute line numbers.
// Supported: Mermaid (.mmd/.mermaid or ```mermaid fences in .md),
// PlantUML (.puml/.plantuml/.pu/.iuml/.wsd, @startuml blocks, ```plantuml fences),
// images (.png/.jpg/.jpeg/.gif/.webp/.svg) — no parsing, the model comes from the AI.
import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const PUML_EXT = ['.puml', '.plantuml', '.pu', '.iuml', '.wsd'];
const MERMAID_EXT = ['.mmd', '.mermaid'];
const MD_EXT = ['.md', '.markdown'];

export function loadSource(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.includes(ext)) {
    return { file, format: 'image', text: null, fileLines: [], diagrams: [{ index: 0, format: 'image', kind: null, lines: [], firstLine: null, lastLine: null }] };
  }
  const text = fs.readFileSync(file, 'utf8');
  const fileLines = text.split(/\r?\n/);
  const numbered = fileLines.map((t, i) => ({ no: i + 1, text: t }));
  let blocks = [];
  if (MD_EXT.includes(ext)) {
    blocks = fencedBlocks(numbered);
  } else if (PUML_EXT.includes(ext)) {
    blocks = pumlBlocks(numbered);
  } else if (MERMAID_EXT.includes(ext)) {
    blocks = [{ format: 'mermaid', lines: numbered }];
  } else {
    // .txt or unknown: sniff
    if (/@startuml/i.test(text)) blocks = pumlBlocks(numbered);
    else if (/```\s*(mermaid|plantuml|puml)/i.test(text)) blocks = fencedBlocks(numbered);
    else blocks = [{ format: 'mermaid', lines: numbered }];
  }
  const diagrams = blocks.map((b, index) => {
    const lines = b.lines;
    return {
      index,
      format: b.format,
      kind: detectKind(b.format, lines),
      lines,
      firstLine: lines.length ? lines[0].no : null,
      lastLine: lines.length ? lines[lines.length - 1].no : null,
    };
  });
  return { file, format: diagrams[0]?.format ?? 'unknown', text, fileLines, diagrams };
}

function fencedBlocks(numbered) {
  const out = [];
  for (let i = 0; i < numbered.length; i++) {
    const m = numbered[i].text.match(/^\s*(```+|~~~+)\s*(mermaid|plantuml|puml|uml)\b/i);
    if (!m) continue;
    const fence = m[1];
    const lang = m[2].toLowerCase();
    const body = [];
    i++;
    while (i < numbered.length && !numbered[i].text.trim().startsWith(fence)) {
      body.push(numbered[i]);
      i++;
    }
    out.push({ format: lang === 'mermaid' ? 'mermaid' : 'plantuml', lines: body });
  }
  return out;
}

function pumlBlocks(numbered) {
  const out = [];
  let cur = null;
  for (const l of numbered) {
    if (/^\s*@startuml/i.test(l.text)) { cur = []; continue; }
    if (/^\s*@enduml/i.test(l.text)) { if (cur) out.push({ format: 'plantuml', lines: cur }); cur = null; continue; }
    if (cur) cur.push(l);
  }
  if (!out.length) out.push({ format: 'plantuml', lines: numbered.filter((l) => !/^\s*@(start|end)uml/i.test(l.text)) });
  return out;
}

// Returns one of: state | activity | sequence | dfd | usecase | unsupported:<name>
export function detectKind(format, lines) {
  const texts = lines.map((l) => l.text);
  const directive = texts.map((t) => t.match(/^\s*(?:%%|'|\/\/)\s*kind\s*:\s*([a-z]+)/i)).find(Boolean);
  if (directive) return directive[1].toLowerCase();
  if (format === 'mermaid') {
    const first = texts.map((t) => t.trim()).find((t) => t && !t.startsWith('%%') && t !== '---' && !/^\w+\s*:/.test(t)) || '';
    if (/^stateDiagram/i.test(first)) return 'state';
    if (/^sequenceDiagram/i.test(first)) return 'sequence';
    if (/^(flowchart|graph)\b/i.test(first)) {
      return texts.some((t) => /\[\(/.test(t)) ? 'dfd' : 'activity';
    }
    const name = (first.split(/\s+/)[0] || 'empty');
    return `unsupported:${name}`;
  }
  // PlantUML heuristics — most specific first
  const body = texts.map((t) => t.trim()).filter((t) => t && !t.startsWith("'"));
  const has = (re) => body.some((t) => re.test(t));
  if (has(/^(start|stop)$/i) || has(/^:.*;?$/) && has(/^(if\s*\(|endif|while\s*\(|repeat\b|stop$|end$)/i)) return 'activity';
  if (has(/^:[^:]+;$/)) return 'activity';
  if (has(/\[\*\]/) || has(/^state\s+/i)) return 'state';
  // sequence before use case: "alt 3-D Secure (EU)" has parentheses but is a fragment
  if (has(/^(participant|boundary|control|entity|database|collections|queue)\b/i) || has(/^(alt|opt|loop|par|break|critical|group)\b/i) || has(/^(autonumber|activate|deactivate)\b/i)) return 'sequence';
  const leftOfColon = (t) => t.split(':')[0];
  if (has(/^usecase\b/i) || body.some((t) => /\([^)]+\)/.test(leftOfColon(t)) && /[-.]{1,}/.test(t)) || has(/^:[^:]+:/)) return 'usecase';
  if (has(/^actor\b/i) || has(/^\S+\s*-+>+\s*\S+\s*:/)) return 'sequence';
  return 'unsupported:plantuml';
}

export function stripComment(t, format) {
  if (format === 'mermaid') return t.replace(/%%.*$/, '');
  return t.replace(/^\s*'.*$/, '');
}
