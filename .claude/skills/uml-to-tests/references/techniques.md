# Techniques by diagram type

The script decides *what* has to be covered (the items). This file says *how*
to write good tests for those items. Read only the sections for the diagram
kinds you have.

## State machine → state transition testing

Items from `extract`:

| Item | Meaning | Test expects |
|---|---|---|
| `T1`, `T2`, … | a transition drawn on the diagram (initial ones from `[*]` too) | the target state, plus the action after `/` if the label has one |
| `N:<STATE>:<event>` | a cell of the state × event table with no transition: the event is not accepted in that state | the state stays `<STATE>` |
| `G:<STATE>:<event>` | every transition for this event in this state has a guard, and none of them holds | the state does not change |
| `P:<Ti>><Tj>` | `Tj`'s guard counts or remembers ("in a row", "attempts", "retries"); test it again right after the state was re-entered through `Ti` | what the diagram says for `Tj` — and whether the history starts over is usually a question |
| `B:<Tn>:below/at/above` | a number in the guard or note of `Tn` | whether the guard holds just below, exactly at, just above the value |
| `Q:<STATE>:unreachable`, `Q:<STATE>:dead-end` | findings: a state nothing leads to, a non-final state with no way out | not tested — ask in an unknown |

How to write them:

- **Path and target.** A test reaches what it checks through earlier
  transitions. Put those in `path` and the checked item in `covers`:
  `"path": ["T1", "T2"], "covers": ["T4"]`. The script walks `path` + `covers`
  in order and fails it if it breaks (`T4` must start where `T2` ended), and
  only `covers` counts as coverage. `expected_state` is required and must be the
  state after the last step.
- **Composite states.** A substate inherits its parent's transitions: if
  `On --power--> Off`, then `power` in `Idle` (inside `On`) leads to `Off`, and
  a path may take that transition from any substate. Entering a composite
  lands in its initial substate (`enters` in `extract`). The table has leaf
  states only.
- **Preconditions** say how to get into the start state. If the start state can
  only be reached by other transitions, include them in the path instead of
  assuming a magic setup.
- **Guards.** `G:` covers "none of the guards holds" for a (state, event)
  pair: pick data that makes every guard on that event false. If no such data
  exists (the guards cover every case, like "PIN correct" / "PIN wrong"), say
  so in a blocking unknown that affects the `G:` item — do not invent a third
  case.
- **History (`P:`).** Run the counting guard again after re-entering the state
  another way: after a reset from ALARM, are three new wrong PINs needed or
  only one? The diagram rarely says — test what it does say and ask the rest
  (non-blocking if the transition itself is still testable). The path must
  take `Ti` and then `Tj` with no other transition in between.
- **Invalid cells (`N:`).** UML says an event with no transition in the current
  state does not change the state. That is what you assert. The diagram almost
  never says how the system *answers* (error code, message, beep): leave that
  to one shared unknown with `"blocking": false, "about": "response"` that
  `affects` all `N:` cells, e.g. "What does the system show for an event it
  does not accept?", and reference it from the tests. The cells are still
  tested now: the state part is defined.
- **Events nobody can trigger.** If a label or note marks an event as
  automatic or internal (e.g. "(automatic)", "timer"), an `N:` cell for it may
  not be reachable by a tester. Do not invent a way to fire it: add a
  blocking unknown asking whether it can happen in that state, with the cell
  in `affects`.
- **Notes** attached to states are part of the spec: a note like "terminal" or
  "never observed at rest" changes what a test can check — quote it as a
  `derived` item if it adds a rule, or turn it into an unknown.

## Activity diagram → decision table

Numbers in decision labels also get boundary items `B:<condition>:below/at/above`
— see "Boundary values" at the end.

Items: `R1`, `R2`, … — one per rule. A rule is one feasible combination of
decision outcomes from start to end. `extract` prints for each rule its
`choices`, the `actions` on its path and where it `ends_at`. Decisions not
reached on that path are "–" in the table. Loops: every rule runs each loop
zero times, plus one extra rule per loop in which it runs once — that decision
then appears twice, e.g. `no→yes`. More than 128 rules is an error: the
diagram has too many independent decisions to test exhaustively — say so and
suggest splitting it.

How to write them:

- **One test per rule.** `covers` holds exactly one `R`. The script rejects a
  test that claims two rules.
- **Test data** must make every condition of the rule come out as listed, and
  nothing else. Name the values: "cart with 2 items", "card that the payment
  provider declines".
- **Independent decisions.** When all branches of a decision meet again
  before anything else is decided (e.g. "logged in?" only adds a login step,
  then checkout continues the same way), its outcome cannot change what
  happens later. `extract` then lists each of its outcomes once instead of in
  every combination and says so in `warnings`. Everything that can change the
  outcome stays fully combined.
- **Expected result** = the actions on the path in order and the end. Do not
  add actions that are not on the diagram ("an email is sent").
- **Merged conditions.** A decision label with AND/OR ("member and not
  blocked?") is one row of the table. If the outcome depends on which part is
  false, add a `derived` rule with the quote and an extra test.

## Sequence diagram → path testing

Items: one per branch.

| Fragment | Items |
|---|---|
| `alt`, `critical` | `F1.1`, `F1.2`, … — one per operand; an `alt` without `else` also gets `F1.else` (no condition holds) |
| `opt`, `break` | `F2.in` (taken), `F2.out` (not taken) |
| `loop` | `F3.in` (runs at least once), `F3.out` (runs zero times) |
| `par`, `group` | no items — always executed |

Messages `M1`, `M2`, … are not items. A test reaches them through the
branches it takes; the report shows which messages no path reaches. Never list
them in `covers` or `path`.

How to write them:

- **A test is one path** through the whole interaction. Choose a branch for
  every fragment the path reaches: one operand of each `alt`, `in` or `out`
  for each `opt`/`loop`/`break`. Do not choose branches inside a fragment the
  path does not enter. The script checks all of this.
- **One new outcome per test.** Put the branch the test is about in `covers`
  and the other choices it needs in `path`. A test that checks two independent
  outcomes hides the second when the first fails.
- **Things that must not happen.** On a path that skips a call (the restaurant
  is closed, so no charge), assert that the skipped call did not happen when a
  tester can observe it.
- **Steps** follow the messages in order. Calls (`->>`) are actions or system
  steps; replies (`-->>`) are the expected results. Quote the message text
  where it is a user-visible message.
- **Loops.** For a loop with a limit in its label ("at most 3 attempts") the
  `in` test should hit the limit; if the diagram does not say what happens
  after it, ask. If the label says the loop always runs ("until a courier is
  assigned"), `out` (zero runs) may be impossible: a blocking unknown that
  affects it, not an invented test.

## Use case diagram → use case testing

Items:

| Item | Flow |
|---|---|
| `UC:<actor>:<use case>` | main flow (happy path) for that actor |
| `EXT:<extension>:<base>` | alternative flow: the base use case with the extension happening |
| `INC:<base>:<included>` | the included behaviour runs inside the base flow |
| `X1`, … (derived) | exception flows you found in the diagram text |

How to write them:

- **What you can write.** A use case diagram has no steps, so these are test
  conditions at the level the diagram allows; the details of each flow are
  open questions unless a note gives them.
- **Main flow** per actor: the actor reaches the goal named by the use case.
  A child actor (`Child --|> Parent`) inherits the parent's use cases and gets
  its own main-flow items.
  An `include` is a step inside the main flow, so the main-flow test usually
  covers the `INC` item too.
- **Alternative flow** per `extend`: the base flow where the extension is
  triggered. If the extend has a condition, the test data meets it.
- **Exception flows** come only from the diagram: a note, a condition, an
  extension point. Each one is a `derived` item with `type: "exception-flow"`,
  `relates_to` the main-flow item, and a verbatim quote. For every use case
  with no exception on the diagram, add one unknown with
  `"about": "exceptions"` that asks what can go wrong and `affects` its
  main-flow item (`"blocking": false` — the main flow is still tested). The
  script fails a use case that has neither.
- **Actors without a use-case description** do not get invented steps: write
  steps at the level the diagram allows ("Member starts *Borrow book*") and
  ask for the details in an unknown.

## Boundary values (all kinds)

Every number in a guard, a decision label or a fragment label gets three
items: `B:<anchor>:below`, `:at`, `:above` — the boundary and one **minimal
step of its data type** on each side. The step comes from the type, not from
the unit as written:

| Data type | Recognised by | Step | Example |
|---|---|---|---|
| money | EUR, USD, UAH, €, $, £ … | 0.01 | `> 1000 EUR` → 999.99 / 1000.00 / 1000.01 EUR |
| time | ms, s, min, h, day, week | 1 second (1 ms for ms) | `within 5 minutes` → 4 min 59 s / 5 min 0 s / 5 min 1 s |
| percent | %, percent | 0.01 | `> 15%` → 14.99 / 15.00 / 15.01 % |
| count | attempts, items, retries, tickets … | 1 | `at most 10 attempts` → 9 / 10 / 11 |
| decimal measure | 2.5 kg | the last decimal place | `<= 2.5 kg` → 2.4 / 2.5 / 2.6 kg |
| no unit | `age >= 18` | 1, marked *confirm the type* | 17 / 18 / 19 |

`extract` computes the three values and says for each whether the condition
then holds (`> 1000` → no, no, yes; `at most 10` → yes, yes, no). Where the
words do not settle it ("within 5 minutes" — is 5:00 inside?) the `at` item
says *ask*: test it with an open question, or block it. A deadline ("cancel
up to 2h before the start") means *at least* 2 h must remain.

- One boundary item per test, usually together with the rule or branch it
  falls into (`covers: ["R6", "B:Order total > 1000 EUR?:at"]`).
- Use exactly the computed value and write it in the test data or steps
  (`999.99 EUR`, `4 min 59 s` or `299 s`, `9 attempts`); the checker looks for
  it. For a number with no unit, confirm the data type in a non-blocking
  unknown with `"about": "boundary"`.

## Findings (all kinds)

Items in group `finding` (`Q:…`) are gaps in the diagram itself, not
behaviour to test: a state nothing leads to, a non-final state with no way
out, a store nothing creates, reads or deletes, a process with no input or no
output. Each one goes into an unknown's `affects` with a plain question for the
analyst. Never write a test for them.

## Data flow diagram → CRUD matrix and flows

The DFD comes as a Mermaid flowchart with this shape convention (say so if the
user's diagram uses another one):

| Shape | Meaning |
|---|---|
| `[( Name )]` | data store |
| `(( Name ))`, `( Name )`, `([ Name ])` | process |
| `[ Name ]` | external entity |

Items: `FL1`, `FL2`, … — every flow; `CRUD:<process>:<store>:<op>` — every
cell of the process × store matrix. A flow from a store into a process is R;
a flow from a process into a store is C, U or D from its label (create/insert →
C, update/decrement/mark → U, delete/remove → D). When the label does not say
which, the op is `W` and the report asks for an unknown.

How to write them:

- **One test per process** is usually right: it sends the input flows in,
  checks the output flows out, and checks the stores afterwards.
- **Read (R)**: prepare the store so the result depends on it (e.g. stock = 0
  vs stock > 0) and check that the process used the stored value.
- **Create / Update / Delete**: check the store content after the process —
  a new record, a changed field, a removed record.
- **`W`**: do not guess C or U. Add a blocking unknown "Does *Restock*
  create a stock record or update an existing one?" with the CRUD item in
  `affects`. The checker fails a `W` cell without one.
- Life-cycle gaps come as findings (`Q:Orders:no-delete`, `Q:Stock:never-read`,
  `Q:<process>:no-input`): ask them, never invent a delete test.
