# Production Samples

These samples reflect Commitra's intended production configuration.

They are generated under:

- Snapshot-based voting weights
- Isolated vote sessions (`voteId` separation)
- Full security assumptions as described in `docs/threat-model.md`

These samples are provided as **representative evidence**,
not as a reproducible test suite.

---

## Contents

| File | Description |
|------|-------------|
| `vote-sample.md` | Representative vote submission transaction |
| `tally-sample.md` | Representative tally finalization transaction |

---

## How to verify

1. Open each transaction link in a block explorer
2. Confirm the transaction status is **Success**
3. Verify that the expected events were emitted
4. Cross-reference with `docs/verification.md` for detailed steps