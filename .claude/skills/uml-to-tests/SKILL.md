---
name: uml-to-tests
description: Designs manual test cases from a behavioural UML diagram (state, activity, sequence, use case, data flow) in a Mermaid or PlantUML file, a Markdown file with diagram blocks, or an image, plus an HTML coverage report. Picks the technique per diagram kind — state transition testing with a full state × event table, decision tables, branch paths over alt/opt/loop, use case flows, a CRUD matrix. A bundled checker fails the run if anything drawn is untested or a test expects something the diagram does not say. Use for "generate test cases from this state diagram", "test design for checkout.puml", "згенеруй тест-кейси з діаграми", "покрий тестами діаграму послідовностей". Not for automation code (Playwright, Cypress, pytest), drawing, converting, explaining or fixing diagrams, ER/class/component diagrams, or reviewing existing tests.
argument-hint: "<diagram file: .mmd | .puml | .md | image>"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write(**/*.tests.json)
  - Edit(**/*.tests.json)
  - Write(diagrams/**)
  - Bash(node *uml-tests.mjs *)
---

# UML diagram → test cases

Diagram: $ARGUMENTS

- Empty? Take the diagram path from the user's message.
- The diagram is pasted into the chat instead of a file? Save it unchanged to
  `diagrams/<short-name>.mmd` (or `.puml`) and use that path.
- Neither a path nor a diagram, or the file does not exist → write nothing and
  ask for the file in one line.

Accepted input: `.mmd`/`.mermaid`, `.puml`/`.plantuml`/`.pu`, a Markdown file
with ```` ```mermaid ```` or ```` ```plantuml ```` blocks (every block is one
diagram), or an image (`.png`, `.jpg`, `.webp`, `.svg`, …).

Outputs go to `results/<name>/` in the working directory, one folder per
diagram file (`<name>` = its file name without extension). Nothing is written
next to the diagram. `extract` creates the folder and prints the paths.

| File in `results/<name>/` | Who writes it |
|---|---|
| `<name>.tests.json` | you — the only file you write |
| `<name>.test-cases.md` | the script, from `templates/test-case.md` |
| `<name>.coverage.html` | the script — the coverage picture for QA |

A second run on the same diagram overwrites that folder. Never edit the `.md`
or `.html` by hand: fix the JSON and run the report again.

**Language.** Write titles, steps, expectations and questions in the language
the user writes in. Keep diagram labels, states and messages exactly as they
are on the diagram.

## The one rule: the diagram is the only source

The diagram file is the whole world: not the code, not other documents, not
"how such systems usually work".

- Every expected result comes from the diagram: a target state, a label, an
  action on the path, a reply message, a note. If the diagram does not say what
  the system answers (an error text, a status code, a sound), you do not say it
  either: assert what the diagram does define ("the state stays LOCKED") and
  ask about the rest in `unknowns`. The checker fails any expectation that
  quotes a text or an error code that is not on the diagram.
- Anything you test beyond the extracted items — an exception flow, a rule from
  a note — is a `derived` item quoting at least three words of the diagram,
  verbatim, with the line. No quote, no item: ask in `unknowns` instead.
- An unknown always names what it is about (`affects`) and says whether it
  **blocks** those items (`"blocking": true` — they cannot be tested until it
  is answered; they show as *waiting*) or only leaves part of the expectation
  open (`"blocking": false` — the items must still be tested now). A guessed
  test is worse than an honest question, and a question that blocks
  everything is not a test design.

## Steps

1. **Extract.** Run

   ```
   node "${CLAUDE_SKILL_DIR}/scripts/uml-tests.mjs" extract <diagram>
   ```

   It prints:
   - `output` — the `results/<name>/` folder and the file paths to use;
   - every diagram in the file with its `kind`, the `technique`, and the
     coverage `items` with their IDs (`T3`, `N:LOCKED:lock`, `R4`, `F2.in`,
     `UC:Member:Borrow book`, `CRUD:Ship order:Stock:U`, …);
   - `notes` from the diagram (often rules worth a derived item or a question);
   - `unparsed_lines` — lines the parser did not understand. Items from them
     are missing. Do not edit the diagram: add an unknown with
     `"lines": [<line numbers>]` asking what the line means, and mention it in
     your answer;
   - `skip` on diagrams that need no tests (ER, class, …). If
     `supported_diagrams` is 0, stop: write nothing and tell the user which
     blocks were found and why each was skipped.

   **Image?** `extract` cannot parse it. Look at the picture with Read, then
   write what you see as `model` in the JSON (format in
   [references/schema.md](references/schema.md)). The script builds the items
   from your model and the report marks the diagram as *not machine-verified*.
   Copy only what is drawn; an unreadable label is an unknown, not a guess.

2. **Design.** Read the sections of
   [references/techniques.md](references/techniques.md) for the kinds you have
   before writing tests. In short:

   | Diagram | Technique | Every one of these needs a test |
   |---|---|---|
   | State machine | State transition testing | each transition `T`; each invalid cell `N:` of the state × event table (substates inherit their parent's transitions); `G:` — none of the guards on an event holds; `P:` — a guard that counts history ("in a row", "attempts") again after the state is re-entered another way |
   | Activity | Decision table | each rule `R`: a feasible combination of decision outcomes. Decisions whose branches all meet again are independent: each outcome once, not in every combination. A loop gets one rule where it runs once |
   | Sequence | Branch paths | each branch: `alt` operand (`.else` when the alt has no else), `opt`/`break`/`loop` taken and not taken |
   | Use case | Use case testing | main flow per actor and use case (child actors inherit), alternative flow per extend, include; exception flows only quoted from the diagram, otherwise an unknown with `"about": "exceptions"` per use case |
   | Data flow (DFD) | CRUD matrix + flows | each flow `FL`, each CRUD cell; a write whose label does not say create or update needs an unknown |
   | Any | Boundary values | `B:…:below / at / above` for every number in a guard, decision or fragment label: the boundary and one minimal step of its data type on each side — money 0.01 (`> 1000 EUR` → 999.99 / 1000.00 / 1000.01), time 1 second (`within 5 minutes` → 4 min 59 s / 5 min 0 s / 5 min 1 s), counts 1 (`at most 10 attempts` → 9 / 10 / 11). `extract` computes the values |

   Items in group `finding` (`Q:…`: an unreachable state, a dead end, a store
   nothing deletes from, a process with no input) are not tested: each must be
   asked in an unknown that `affects` it.

3. **Write** the JSON to `output.tests_json` (`results/<name>/<name>.tests.json`)
   — format in [references/schema.md](references/schema.md). Its `source` is
   the diagram path exactly as you passed it to `extract`.
   - **One test = one outcome.** `covers` lists only what the test *checks*;
     the items it merely passes through to get there go into `path`. Only
     `covers` counts as coverage. The title names the single outcome.
   - Steps are concrete enough that another tester runs them without asking
     you. Describe once per diagram, in `harness`, how each participant or
     external system is brought into the condition the tests need (a closed
     restaurant, a declining card, a lock with two wrong PINs). If the diagram
     gives no way, write what is needed and ask how in an unknown.
   - A state test starts from `[*]`, or its preconditions say how the object got
     into its first state.
   - A boundary test uses exactly the value `extract` gives for its item
     (`999.99 EUR`, `4 min 59 s`, `9 attempts`) and names it in its test data,
     steps or preconditions — the checker looks for it. If the item says the
     data type is unconfirmed (a number with no unit), confirm it in a
     non-blocking unknown with `"about": "boundary"`.
   - Test IDs: `TC-ST-001`, `TC-DT-001`, `TC-PATH-001`, `TC-UC-001`,
     `TC-CRUD-001`, unique in the file.

4. **Check and render.** Run

   ```
   node "${CLAUDE_SKILL_DIR}/scripts/uml-tests.mjs" report results/<name>/<name>.tests.json
   ```

   It writes the `.md` and `.html` into the same folder. `OK` → done. `FAIL` →
   fix every listed problem in the JSON and run it again, at most 3 rounds.
   Fix a gap with the missing test, or — only when the diagram really does not
   tell you what to expect — with a blocking unknown that `affects` the item.
   Never fix a problem by moving a checked item into `path`, by pointing a test
   at an item it does not check, by shortening or rewording a quote until it
   matches, or by marking a question blocking just to silence a gap. Still
   `FAIL` after 3 rounds → stop and report the problems.

## Return

A short summary in the user's language, nothing else:

- the report line printed by the script (`OK …` or `FAIL …`);
- the `results/<name>/` folder and the three files in it;
- per diagram: technique, items checked / total, waiting, number of tests;
  skipped diagrams with the reason;
- the open questions, one line each (`U-01 (blocking) — question`);
- unparsed lines and warnings the user should know about.

Do not paste the JSON or the test cases back.
