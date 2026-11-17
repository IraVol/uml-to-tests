---
type: llm
focus: trace
weight: 1
---

Judge only the test cases this run produced — in any file it wrote or in its final answer. If the run produced no test cases, FAIL.

The tests use exactly three states — OFF, HEATING, BOILED — and these transitions: initial → OFF, OFF → HEATING on "switch on" when there is water in the kettle, HEATING → OFF on "switch off", HEATING → BOILED on "water boils", BOILED → OFF on "auto off after 3 s". No other state or transition is tested as if it were on the diagram.
