# Frequently Asked Questions

---

## Wasn't this repository "verification without code access"? What changed?

Yes — this repository previously published documentation only and argued for "verifiability rather than reproducibility". That stance is retired: the full source (circuits, contracts, server, client, scripts) is now public, together with a specification and a precise map of what the proofs do and do not guarantee. The earlier claim that withholding the code protected its security did not hold up; the security-relevant gaps are in what the circuits don't yet constrain, and those are now documented openly.

---

## Is this production-ready?

No. Earlier versions of this documentation called the system "product-ready"; that was wrong and is retracted.

This is a **research implementation**: a minimal construction implemented end-to-end and exercised on Sepolia, with known, documented gaps between "implemented" and "proven" — see the proof-scope table in [`REVISION19.md`](REVISION19.md) §17.3 and [`threat-model.md`](threat-model.md). Do not use it for a real election.

---

## Can the coordinator see individual votes?

**Technically, yes.** The coordinator holds the single ElGamal private key and could decrypt any individual ciphertext. The protocol is designed so it only ever decrypts the aggregate, and the implementation does exactly that — but this is a norm, not an enforced property. Making it enforced requires threshold decryption, which is on the roadmap.

---

## Can the coordinator manipulate the result?

It cannot publish a result that isn't the correct sum-and-decryption of *some* committed batch — the tally proof prevents that. But it **chooses the batch**: the contract does not check that the tallied batch matches the votes submitted on-chain, so omission or substitution is not automatically detectable today. It can also simply decline to relay a vote. See [`threat-model.md`](threat-model.md) for the full honest list.

---

## Can a voter cheat?

With the standard client, no: re-votes are rejected (the nullifier is derived deterministically, and each nullifier is spendable once on-chain).

With a modified client, currently yes, in two ways. First, the nullifier is not circuit-bound to the voter's leaf or key, so a modified client can derive fresh nullifiers from the same leaf and vote multiple times — one-voter-one-vote is not cryptographically enforced. Second, a modified client can submit out-of-range plaintexts that a valid-looking proof does not exclude — the vote circuit does not yet constrain the `{0, weight}` range (malformed curve points are now rejected server-side, but that only holds while the server is honest; the circuit does not constrain them either). These are the most important known gaps; fixing them is the next circuit revision.

---

## How were these gaps found?

Three independent code audits (July–August 2026) of this codebase converged on the same core findings. The published threat model and proof-scope map are the integration of those findings.

---

## What's the difference from MACI?

Different threat models. MACI centers anti-collusion: its coordinator decrypts every vote but can't alter the result, and voters can't prove how they voted. Commitra centers data minimization: by design only the aggregate is ever decrypted, and voters *can* prove their vote (not receipt-free — an intentional trade-off). Neither subsumes the other. Vocdoni's DAVINCI is prior art for the aggregate-only-decryption direction.

---

## Can I run it?

Yes — [`BUILD.md`](BUILD.md) covers building the circuits and client, [`../usage/`](../usage/) covers operating the full lifecycle against Sepolia. The trusted-setup artifacts and their hashes are in [`PROVENANCE.md`](PROVENANCE.md); note both zkeys come from a single phase-2 contribution.

---

## What's the license?

GPL-3.0 (the circuits depend on GPL-3.0 circomlib). Earlier revisions of this repository used CC BY-NC for documentation; that is replaced.

---

## Who is behind this?

A solo builder — contact: [@0xgumi](https://x.com/0xgumi) on X. Feedback, review, and demo requests welcome.
