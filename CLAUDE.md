# CLAUDE.md

## What this is

`uml-to-tests` is a Claude Code skill that turns a UML diagram into test cases
and an HTML coverage report. It is universal: no project, product or domain is
baked in. It is also a Claude Code plugin: the skill folder is the plugin root
(a skills-dir plugin — `.claude-plugin/plugin.json` with `"skills": ["./"]`),
so in this project Claude Code loads it as `uml-to-tests@skills-dir`. The
repository root is the `qa-unicorns` marketplace, published as the public
GitHub repository `IraVol/uml-to-tests`; it installs the plugin elsewhere as
`uml-to-tests@qa-unicorns`. The skill's full name is
`uml-to-tests:uml-to-tests`; `/uml-to-tests` works too.

## Layout

```
.claude-plugin/marketplace.json  marketplace "qa-unicorns" (source: the skill folder)
README.md, LICENSE               the GitHub page; the plugin folder has its own copies
.claude/skills/uml-to-tests/     plugin root and skill root at once — everything here ships
  .claude-plugin/plugin.json  plugin manifest: name, version, "skills": ["./"]
  README.md                 for people who install the plugin
  SKILL.md                  the skill: rules, steps, return format
  references/techniques.md  how to write tests per diagram kind (read on demand)
  references/schema.md      <name>.tests.json format, image model format
  templates/test-case.md    template the script fills for <name>.test-cases.md
  scripts/uml-tests.mjs     CLI: extract | report
  scripts/lib/              source.mjs (files, fences, kind detection)
                            mermaid.mjs, plantuml.mjs (parsers)
                            model.mjs (coverage items per technique)
                            check.mjs (checker), render.mjs (md + html)
  evals/                    claude plugin eval cases
dist/                       built zips, uml-to-tests-<version>.zip — not committed
examples/                   sample diagrams (inputs only)
results/<diagram name>/     run outputs, one folder per diagram — created by `extract`, not committed:
                            <name>.tests.json, <name>.test-cases.md, <name>.coverage.html
```

## Supported input

| Diagram | Mermaid | PlantUML | Technique |
|---|---|---|---|
| State machine | `stateDiagram-v2` | `[*] -->`, `state` | state transition testing |
| Activity | `flowchart` with `{decisions}` | `start` / `:action;` / `if` | decision table |
| Sequence | `sequenceDiagram` | `participant`, `->` | path testing over alt/opt/loop/break |
| Use case | — (Mermaid has none) | `actor`, `usecase`, `<<include>>`, `<<extend>>` | use case testing |
| Data flow | `flowchart` with `[(stores)]` or `%% kind: dfd` | — | CRUD matrix + flows |
| Any of the above as an image | `.png` `.jpg` `.svg` … | | the AI writes the model; report says "not machine-verified" |

Markdown files may hold several ```` ```mermaid ```` / ```` ```plantuml ````
blocks; each is a separate diagram, unsupported ones (ER, class) are skipped.
A `%% kind: <kind>` (Mermaid) or `' kind: <kind>` (PlantUML) comment overrides
the detected kind.

## Commands

Node 18+, no dependencies, nothing to install.

```bash
# what the diagram requires to be covered; also creates results/door-lock/
node .claude/skills/uml-to-tests/scripts/uml-tests.mjs extract examples/door-lock.mmd

# check a tests file and write the .md + .html next to it (exit 1 on FAIL)
node .claude/skills/uml-to-tests/scripts/uml-tests.mjs report results/door-lock/door-lock.tests.json

# run the skill
claude "/uml-to-tests examples/checkout.puml"

# evals: one run per case while iterating, 3 runs before trusting a change
claude plugin eval .claude/skills/uml-to-tests --scaffold --allow-tools Bash Write Edit --runs 1 --no-publish
claude plugin eval .claude/skills/uml-to-tests --scaffold --allow-tools Bash Write Edit --case "01-*"
```

`--scaffold` is needed: each case copies its diagram from `files/` into the
sandbox with `place-files.sh`.

Plugin:

```bash
# check the plugin and the marketplace manifests
claude plugin validate .claude/skills/uml-to-tests
claude plugin validate --strict .

# build dist/uml-to-tests-<version>.zip; try it with: claude --plugin-dir dist/<zip>
V=$(node -p "require('./.claude/skills/uml-to-tests/.claude-plugin/plugin.json').version")
mkdir -p dist && rm -f "dist/uml-to-tests-$V.zip"
(cd .claude/skills/uml-to-tests && zip -qr "../../../dist/uml-to-tests-$V.zip" . -x 'evals/results/*' -x '*.DS_Store')

# install from the published marketplace (on another machine or project)
claude plugin marketplace add IraVol/uml-to-tests
claude plugin install uml-to-tests@qa-unicorns
```

## Conventions

- Everything in the skill, references, templates, scripts and evals is in
  English. The skill answers the user in the user's language.
- Keep it universal: no product names, project paths or domain rules from any
  real project in the skill, references or evals. Examples use neutral domains
  (door lock, checkout, library, password reset, inventory, kettle).
- The diagram is the only source of truth for the skill. Anti-hallucination
  rules live in `SKILL.md`; the checker enforces the structural part (every
  item covered, no unknown IDs, quotes exist, paths are valid).
- The split of work stays as it is: the script extracts items, checks and
  renders; the model only writes `<name>.tests.json`. If the checker misses a
  class of mistake, add a check to `check.mjs` rather than more prose to
  `SKILL.md`.
- Coverage item IDs (`T3`, `N:STATE:event`, `G:STATE:event`, `P:T4>T3`,
  `R4`, `F2.in`, `F2.else`, `UC:actor:use case`, `EXT:…`, `INC:…`, `FL1`,
  `CRUD:process:store:op`, `B:<anchor>:below|at|above`, findings `Q:…`, `X1`)
  are a contract between `extract`, the JSON and the evals. Changing their
  format means changing all three.
- Test design decisions live in `model.mjs`, each with a comment saying why:
  guard-none per (state, event) not per guard; history pairs only for guards
  that count; independent decisions (all branches meet at the immediate
  post-dominator, no loop inside) are collapsed to each-choice; boundary
  values step by the data type (money 0.01, time 1 s, counts 1 — `DATA_TYPES`),
  "within N" leaves the boundary as a question, "up to N before" is a deadline
  (at least N). Change them there, not in prose.
- The coverage number must stay honest — it is what people trust. Only
  `covers` counts (`path` is setup), a blocking unknown turns an item into
  "waiting" even if a test touches it, a diagram with nothing checked fails,
  and unparsed diagram lines fail unless an unknown names them. Do not relax
  these to make a run pass.
- Scripts print through `done()` in `uml-tests.mjs`, never `console.log` +
  `process.exit` (that truncates piped output at 64 KiB). Exit 2 is for bad
  input or a crash, exit 1 only for "checked and failed".
- Outputs never go next to the diagram: `results/<diagram name>/` under the
  working directory, so a diagram in a read-only or shared folder (another
  repo's docs) is never touched. A second run on the same diagram overwrites
  its folder. Two diagrams with the same file name share a folder — rename one.
  The folder name lives in one place: `RESULTS_DIR` in `scripts/uml-tests.mjs`.
- `examples/` holds inputs only.
- Plugin: the version lives only in `plugin.json` (the marketplace entry has
  none, so the two cannot disagree). A push to `main` is a release for
  everyone who added the marketplace, so bump the version in the same commit
  as the change — installed copies are cached per version. Only the skill folder ships;
  `evals/results/` is local run output and stays out of the zip. Do not
  install the plugin from the marketplace inside this repository: it already
  loads as `uml-to-tests@skills-dir` and the skill would appear twice.
- After changing a parser, run `extract` on every file in `examples/` and check
  the items by eye before running evals.
