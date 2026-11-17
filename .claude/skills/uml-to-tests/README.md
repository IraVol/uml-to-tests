# uml-to-tests

A Claude Code plugin that turns a behavioural UML diagram into manual test
cases and an HTML coverage report. The diagram is the only source of truth: a
bundled checker fails the run if anything drawn is left untested, or if a test
expects something the diagram does not say. Open questions are listed instead
of guessed.

## Supported input

| Diagram | Mermaid | PlantUML | Technique |
|---|---|---|---|
| State machine | `stateDiagram-v2` | `[*] -->`, `state` | state transition testing |
| Activity | `flowchart` with `{decisions}` | `start` / `:action;` / `if` | decision table |
| Sequence | `sequenceDiagram` | `participant`, `->` | path testing over alt/opt/loop/break |
| Use case | — | `actor`, `usecase`, `<<include>>`, `<<extend>>` | use case testing |
| Data flow | `flowchart` with `[(stores)]` or `%% kind: dfd` | — | CRUD matrix + flows |
| Any of the above as an image | `.png` `.jpg` `.svg` … | | marked "not machine-verified" |

Files: `.mmd`, `.mermaid`, `.puml`, `.plantuml`, `.pu`, a Markdown file with
```` ```mermaid ```` / ```` ```plantuml ```` blocks (each block is one diagram),
or an image. ER, class and component diagrams are skipped. Every number in a
guard or decision also gets boundary-value tests.

## Requirements

Node.js 18 or newer on `PATH`. No dependencies to install.

## Install

From the `qa-unicorns` marketplace
([github.com/IraVol/uml-to-tests](https://github.com/IraVol/uml-to-tests)), in
Claude Code:

```
/plugin marketplace add IraVol/uml-to-tests
/plugin install uml-to-tests@qa-unicorns
```

For one session, from a folder or a `.zip` of this folder:

```
claude --plugin-dir path/to/uml-to-tests-0.1.0.zip
```

## Use

```
/uml-to-tests:uml-to-tests docs/checkout.puml
```

Or ask in plain words: "generate test cases from docs/checkout.puml". The
answer, titles, steps and questions follow the language you write in; diagram
labels stay as drawn.

Outputs go to `results/<diagram name>/` in the working directory — nothing is
written next to the diagram:

| File | What it is |
|---|---|
| `<name>.tests.json` | the test design Claude writes |
| `<name>.test-cases.md` | the test cases, rendered from the JSON |
| `<name>.coverage.html` | the coverage report for QA |

A second run on the same diagram overwrites its folder.

## How it works

1. `scripts/uml-tests.mjs extract <diagram>` parses the diagram and prints the
   coverage items (transitions, invalid state × event cells, decision rules,
   fragment branches, use case flows, CRUD cells, boundary values) and any
   lines it could not parse.
2. Claude designs the tests and writes `<name>.tests.json` — the only file it
   writes.
3. `scripts/uml-tests.mjs report <tests.json>` checks the JSON against the
   diagram and renders the Markdown and HTML. On `FAIL` Claude fixes the JSON,
   at most three rounds.

## Evals

```
claude plugin eval <path to this folder> --scaffold --allow-tools Bash Write Edit --runs 1 --no-publish
```

`--scaffold` is needed: each case copies its diagram into the sandbox.

## License

MIT — see [LICENSE](LICENSE).
