# `<name>.tests.json` format

Lives in `results/<name>/<name>.tests.json` (the path `extract` prints as
`output.tests_json`).

```json
{
  "source": "examples/door-lock.mmd",
  "diagrams": [
    {
      "index": 0,
      "kind": "state",
      "title": "Door lock",
      "harness": [
        { "participant": "Lock", "how": "A test unit on the bench; the PIN is configured to 1234 before each test" }
      ],
      "derived": [],
      "tests": [
        {
          "id": "TC-ST-002",
          "title": "Correct PIN unlocks a locked door",
          "technique": "state-transition",
          "path": ["T1"],
          "covers": ["T2"],
          "priority": "high",
          "preconditions": ["The lock has just been powered on"],
          "test_data": { "PIN": "the PIN configured for the lock" },
          "steps": [
            { "action": "Check the lock state", "expected": "LOCKED" },
            { "action": "Enter the correct PIN", "expected": "The lock opens" }
          ],
          "expected_result": "The lock is UNLOCKED",
          "expected_state": "UNLOCKED",
          "unknowns": []
        }
      ],
      "unknowns": [
        {
          "id": "U-01",
          "question": "What does the lock show when it gets an event it does not accept?",
          "affects": ["N:LOCKED:lock", "N:LOCKED:reset"],
          "blocking": false,
          "about": "response"
        }
      ]
    }
  ]
}
```

| Field | Rules |
|---|---|
| `source` | path of the diagram exactly as passed to `extract` (relative to the working directory) |
| `diagrams[].index` | the `index` printed by `extract`; one entry per supported diagram |
| `kind` | `state`, `activity`, `sequence`, `usecase`, `dfd` — must match `extract` |
| `title` | optional, a short name for the report |
| `harness` | optional: `[{participant, how}]` — how each participant or external system is brought into the condition the tests need. Rendered once per diagram |
| `tests[].id` | unique in the file |
| `tests[].technique` | `state-transition`, `decision-table`, `path`, `use-case`, `crud` |
| `tests[].covers` | the items this test **checks** — item IDs from `extract` or your `derived` IDs. Only these count as coverage |
| `tests[].path` | optional: items the test passes through to reach what it checks (setup). State: transitions in order, before `covers`. Sequence: the branches chosen in fragments the test is not about. Never counts as coverage |
| `tests[].priority` | `high`, `medium`, `low` (optional) |
| `tests[].preconditions` | list of strings |
| `tests[].test_data` | object or list; concrete values, no real personal data |
| `tests[].steps` | non-empty list of `{action, expected}` |
| `tests[].expected_result` | required |
| `tests[].expected_state` | required for state tests: the (leaf) state after the last step of `path` + `covers` |
| `tests[].unknowns` | IDs of unknowns this test depends on |
| `unknowns[].id`, `.question` | required; one question per unknown |
| `unknowns[].affects` | required, non-empty: the item IDs the question blocks or leaves partly open |
| `unknowns[].blocking` | required: `true` — the items cannot be tested until answered (shown as *waiting*); `false` — they are tested now, only part of the expectation is open |
| `unknowns[].about` | optional: `exceptions`, `response`, `boundary`, `data`, `behaviour`, `other`. Use `exceptions` for "what can go wrong in this use case" questions |
| `unknowns[].lines` | optional: diagram line numbers the question is about — required for every line `extract` lists in `unparsed_lines` (then `affects` may be empty) |

Rules the checker enforces on top of the fields:

- Every item is either checked by a test (`covers`) or affected by a
  **blocking** unknown. At least one item per diagram must be checked.
- Items in group `finding` (`Q:…`) are never tested: each must be in some
  unknown's `affects`.
- A test that checks a boundary item (`B:…`) names that item's computed value
  (`999.99`, `4 min 59 s` / `299 s` / `4:59`, `9`) in its data, steps,
  preconditions or title.
- A quoted text (`"…"`, `“…”`, `«…»`) or an error code (`HTTP 409`,
  `E-42`) in `expected` / `expected_result` must appear on the diagram, in the
  test's own data or in its own actions.
- State tests: the path `path` + `covers` must be continuous, may start from
  `[*]` only at the first step, and must end in a real (leaf) state. A
  transition from a composite state may be taken from any of its substates.
  A test that does not start from `[*]` needs preconditions. A history item
  `P:Ti>Tj` needs `Ti` and then `Tj` with no other transition in between.
- Activity tests: at most one rule `R` per test.
- Sequence tests: in every fragment the path reaches, exactly one branch is
  chosen (in `path` or `covers`); none inside fragments it does not reach.
  Messages (`M…`) are not items — never list them.

## Derived items

Something you test that the script did not extract — an exception flow, a rule
from a note, an extra decision — must be quoted from the diagram file:

```json
{
  "id": "X1",
  "type": "exception-flow",
  "label": "A member with an unpaid fine cannot borrow",
  "relates_to": ["UC:Member:Borrow book"],
  "quote": { "line": 18, "text": "a member with an unpaid fine cannot borrow." }
}
```

IDs are `X1`, `X2`, …; `quote.text` is at least three words and must appear on
`quote.line` of the diagram (inside this diagram's block) exactly as written. `type` is free text (`exception-flow`, `rule`,
`constraint`, …). Derived items must be covered by a test like any other item.

## Model for an image

For an image there is nothing to parse, so add `model` to the diagram entry.
Write only what is drawn. Use the shape for the diagram kind:

State: a substate names its composite in `parent`; `[*]` inside a composite is
a transition with `"scope": "<composite>"`.

```json
{ "kind": "state", "model": {
  "states": [{ "name": "OFF" }, { "name": "HEATING" }],
  "transitions": [
    { "from": "[*]", "to": "OFF", "event": null, "guard": null },
    { "from": "OFF", "to": "HEATING", "event": "switch on", "guard": "water in the kettle" }
  ] } }
```

```json
{ "kind": "activity", "model": {
  "nodes": [
    { "id": "s", "type": "start", "label": "start" },
    { "id": "d1", "type": "decision", "label": "Cart is empty?" },
    { "id": "a1", "type": "action", "label": "Show empty cart" },
    { "id": "e", "type": "end", "label": "end" }
  ],
  "edges": [
    { "from": "s", "to": "d1", "label": null },
    { "from": "d1", "to": "a1", "label": "yes" },
    { "from": "a1", "to": "e", "label": null }
  ] } }
```

Sequence: `context` and `parent` are `{ "fragment": "F1", "operand": 0 }` —
`operand` is 0-based (0 = the first operand, 1 = the `else`).

```json
{ "kind": "sequence", "model": {
  "participants": [{ "name": "User" }, { "name": "App" }],
  "messages": [
    { "id": "M1", "from": "User", "to": "App", "text": "Log in", "context": null },
    { "id": "M2", "from": "App", "to": "User", "text": "Welcome", "context": { "fragment": "F1", "operand": 0 } }
  ],
  "fragments": [
    { "id": "F1", "type": "alt", "parent": null, "operands": [{ "label": "valid password" }, { "label": "invalid password" }] }
  ] } }
```

```json
{ "kind": "usecase", "model": {
  "actors": [{ "name": "Member" }],
  "usecases": [{ "name": "Borrow book" }, { "name": "Check membership" }],
  "associations": [{ "actor": "Member", "usecase": "Borrow book" }],
  "includes": [{ "base": "Borrow book", "included": "Check membership" }],
  "extends": [{ "extension": "Pay fine", "base": "Return book", "condition": null }]
} }
```

```json
{ "kind": "dfd", "model": {
  "entities": ["Customer"], "processes": ["Place order"], "stores": ["Orders"],
  "flows": [{ "from": "Customer", "to": "Place order", "label": "order details" },
            { "from": "Place order", "to": "Orders", "label": "create order" }]
} }
```

For images `derived` quotes cannot be checked by the script; quote the label
exactly as it is written in the picture anyway.
