# Roadmap

Direction, not commitments. No dates. Items are ordered by the review findings: the gaps that most undermine the system's claims get fixed first. Problem statements are given; detailed designs are intentionally not published here.

---

## Near term — server & operational hardening (no circuit changes)

Close the known implementation issues listed in [`REVISION19.md`](REVISION19.md) §17.5, and add server-side enforcement that doesn't require new circuits:

- ~~Proxy-aware rate limiting and auth-failure throttling~~ — done (2026-08-25)
- ~~Ciphertext point validation at submission time~~ — done (2026-08-25), recorded as *mitigated, not resolved*: the circuit gap remains
- Durable dedupe of pubkey commitments per vote
- Fail-fast bounds on batch size and snapshot weights (BSGS-recoverable range)
- Authenticated, once-per-EOA leaf admission for the closed-snapshot configuration

## Vote circuit revision — input integrity

**Problem**: the current vote proof does not constrain what is encrypted. Malformed points, out-of-range plaintexts, and weights unbound to the snapshot all pass.

The next vote circuit must prove: well-formed ElGamal ciphertexts on the curve's prime-order subgroup, plaintexts in `{0, weight}` with exactly one choice carrying the full weight, and the committed weight bound to the eligibility set. This requires a new trusted setup ceremony (and a real multi-party one — see [`PROVENANCE.md`](PROVENANCE.md) for why).

## Tally binding & coordinator de-trusting

**Problem 1 — batch binding**: the tally proof commits to a batch, but the chain never checks that batch against the submitted votes. The contract should be able to enforce "the tallied batch is exactly the submitted set" (and bind the voteId inside the proof).

**Problem 2 — single decryption key**: aggregate-only decryption must become enforced rather than normative. Direction: threshold decryption (k-of-n key shares, partial decryptions with proofs), which also removes the individual-decryption capability from any single party.

**Problem 3 — scale**: one fixed batch of 100 does not scale; aggregation needs to handle 10k+ votes without proportionally growing a single circuit.

**Problem 4 — canonical result scalars**: the current tally proof equates published scalars with decrypted BabyJub group elements but does not enforce a unique supported integer representation or total-weight bound. The tally revision must add strict scalar/range/total constraints shared by the circuit and contract.

## Exploratory

Titles and problem statements only:

- **Multi-chain snapshots** — one eligibility set aggregated from balances on several chains
- **Cross-chain result settlement** — vote where it's cheap, verify the tally proof where governance executes
- **Confidential outcomes** — settings where even the aggregate should be revealed selectively

---

## Not on the roadmap

- Receipt-freeness / anti-collusion — an intentional scope decision, not a pending fix. See [`threat-model.md`](threat-model.md)
