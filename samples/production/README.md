# Product-Configuration Samples

These samples are recorded transactions from Commitra's **Product configuration** — the closed-eligibility deployment where voting weights come from a predefined snapshot (EOA → weight) rather than demo auto-registration.

They are **representative records of author-operated runs**, not a reproducible test suite and not evidence of adversarial robustness. The trust assumptions in [`../../docs/threat-model.md`](../../docs/threat-model.md) apply to these runs exactly as documented — including the single-coordinator key and the unbound tally batch.

---

## Contents

| File | Description |
|------|-------------|
| [`vote-sample.md`](vote-sample.md) | A vote submission transaction (snapshot-based weights) |
| [`tally-sample.md`](tally-sample.md) | The corresponding tally finalization transaction |

---

## How to read them

1. Open each transaction link in a block explorer and confirm the status is **Success** and the expected event (`VoteSubmitted` / `TallyFinalized`) was emitted
2. What a successful transaction does and does not establish is spelled out in [`../../docs/verification.md`](../../docs/verification.md) — read the vote and tally sections there rather than taking "Success" as a blanket guarantee
