# qa-unicorns

A [Claude Code](https://claude.com/claude-code) plugin marketplace with QA
tools. One plugin for now:

| Plugin | What it does |
|---|---|
| [uml-to-tests](.claude/skills/uml-to-tests) | Turns a behavioural UML diagram — state, activity, sequence, use case or data flow; Mermaid, PlantUML, Markdown or an image — into manual test cases and an HTML coverage report. A bundled checker fails the run if anything drawn is untested or a test expects something the diagram does not say. |

## Install

In Claude Code:

```
/plugin marketplace add IraVol/uml-to-tests
/plugin install uml-to-tests@qa-unicorns
```

Or from a terminal:

```bash
claude plugin marketplace add IraVol/uml-to-tests
claude plugin install uml-to-tests@qa-unicorns
```

The plugin needs Node.js 18 or newer on `PATH`; nothing else to install.

## Use

```
/uml-to-tests docs/checkout.puml
```

Or ask in plain words: "generate test cases from docs/checkout.puml". Results
go to `results/<diagram name>/` in the working directory: the test design
(`.tests.json`), the test cases (`.test-cases.md`) and a coverage report
(`.coverage.html`). Try it on the diagrams in [`examples/`](examples). More in
the [plugin README](.claude/skills/uml-to-tests/README.md).

## Repository layout

| Path | What it is |
|---|---|
| `.claude-plugin/marketplace.json` | the `qa-unicorns` marketplace |
| `.claude/skills/uml-to-tests/` | the plugin; opened in Claude Code, this repository also loads it as a project skill |
| `examples/` | sample diagrams |
| `CLAUDE.md` | notes for working on the plugin |

## License

[MIT](LICENSE)
