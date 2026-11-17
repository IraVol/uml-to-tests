---
type: llm
focus: trace
weight: 1
---

Judge only the test cases this run produced — in any file it wrote or in its final answer. If the run produced no test cases, FAIL.

The tests for Place order and Ship order check the data stores afterwards: a new order in Orders, the decremented quantity in Stock, the order marked as shipped.
