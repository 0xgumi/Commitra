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

It must publish aggregate/result signals that satisfy the tally circuit's group equations for *some* committed private batch. But it **chooses the batch**, the proof is replayable to another eligible voteId, and the published tally scalars are not constrained to a unique canonical integer range. The contracts also treat dummy registration as a boolean rather than validating padding contents. The coordinator can additionally decline to relay a vote or close a vote early. See [`threat-model.md`](threat-model.md) for the full list.

---

## Can a voter cheat?

With the standard client, an honest re-vote is rejected because the same exact nullifier is derived and that nullifier is spendable once per voteId.

A modified/direct client can currently violate more: the server does not verify ownership of an EOA submitted to `/weight`; the nullifier is not circuit-bound to the leaf/key; and the vote circuit does not constrain plaintexts to `{0, weight}` or bind committed weight to the snapshot. Malformed points are rejected server-side, but valid-point arbitrary plaintexts remain possible. These are current gaps; authenticated admission and the next vote-circuit revision are the stated directions.

---

## How were these gaps found?

Three independent code-review passes (July–August 2026) over this codebase converged on the same core findings. The published threat model and proof-scope map are the integration of those findings.

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
