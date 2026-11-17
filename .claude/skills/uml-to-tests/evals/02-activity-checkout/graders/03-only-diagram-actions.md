---
type: llm
focus: trace
weight: 1
---

Judge only the test cases this run produced — in any file it wrote or in its final answer. If the run produced no test cases, FAIL.

Expected results mention only actions that are on the diagram (open checkout, the empty-cart message, ask to log in or continue as guest, charge card, show payment error, redirect to PayPal, reject invoice payment, create invoice, confirm order) — no confirmation email, stock reservation or receipt.
