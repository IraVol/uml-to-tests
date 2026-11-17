---
type: regex
target:
  source: file
  path: results/checkout/checkout.coverage.html
match: contains
arm: with-only
weight: 1
---

data-verdict="ok"
