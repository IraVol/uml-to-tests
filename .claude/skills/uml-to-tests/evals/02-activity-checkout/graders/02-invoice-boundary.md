---
type: llm
focus: trace
weight: 1
---

Judge only the test cases this run produced — in any file it wrote or in its final answer. If the run produced no test cases, FAIL.

For "Order total > 1000 EUR?" there are tests with a total of 999.99 EUR and exactly 1000.00 EUR (invoice accepted) and 1000.01 EUR (invoice rejected) — the minimal step for money is one cent, so 999 or 1001 EUR do not count.
