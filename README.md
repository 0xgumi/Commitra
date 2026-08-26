# Commitra

Commitra is a **solo research implementation** of privacy-preserving, token-weighted voting for the EVM ecosystem, built on homomorphic aggregation: votes are ElGamal-encrypted in the browser, homomorphically summed, and **only the aggregate is ever decrypted** in the implemented tally path. Under the current single-key coordinator this is protocol behaviour, not a cryptographically enforced guarantee (see the threat model). Groth16 proofs for the precisely scoped vote/tally statements below are verified on-chain (Ethereum Sepolia).

This repository contains the **full source**: circuits, contracts, server, client, and operational scripts, together with the protocol specification and a precise map of what the proofs do and do not guarantee.

**What this is:** a minimal construction (two circuits, one curve, browser-side proving) implemented end-to-end and exercised on a public testnet, published together with the boundary of what it actually proves — drawn with the help of three independent code-review passes.

**What this is not:** a production-ready system. It has known, documented gaps between "implemented" and "proven" (see below), a single-operator trust model, and a deliberately small scope (100 votes per tally batch). Earlier versions of this repository described the system as "product-ready"; that claim was wrong and is retracted.

---

## Design in one paragraph

Eligible voters are listed in a per-vote snapshot (EOA → weight). Each voter derives a deterministic keypair from a wallet signature, registers a commitment leaf into a Merkle tree, and submits ElGamal ciphertexts — `encrypt(weight)` for the chosen option, `encrypt(0)` for the rest — with a Groth16 proof of Merkle membership, nullifier derivation from a supplied secret, and an EdDSA signature binding the ciphertext hash. A coordinator relays all transactions (participant EOAs are absent from the intended on-chain submission path), homomorphically sums the ciphertexts after closing, decrypts **the aggregate only** in the implemented tally path, and submits a second Groth16 proof. That proof constrains group-element aggregation/decryption for a committed batch; it does not bind the batch to the submitted set or enforce a unique canonical integer tally. Full specification: [`docs/REVISION19.md`](docs/REVISION19.md).

---

## What the proofs prove — and what they don't

The honest version, condensed (full statement: [`docs/REVISION19.md`](docs/REVISION19.md) §17.3):

| Proven | Not proven (current gaps) |
|--------|---------------------------|
| Merkle membership under an accepted root | Ciphertexts are well-formed ElGamal encryptions (valid curve points) — the server now rejects invalid points, but the circuit does not constrain them |
| Each nullifier is spendable once per vote (on-chain) | Plaintexts are in `{0, weight}`, one choice only |
| Ciphertexts stored for tally are exactly those the proof committed to (server-checked) | **One vote per voter** — the nullifier is not circuit-bound to the leaf or key; a modified client can derive fresh nullifiers from the same leaf and re-vote |
| Aggregate group element = homomorphic sum of a proof-committed batch | Committed weight equals the snapshot weight (server-gated, not circuit-bound) |
| Published tally scalar maps to the decrypted aggregate point | Published tally is the unique canonical integer in the supported range |
| — | The tallied batch equals the canonical on-chain submitted set |
| — | The coordinator decrypted only the aggregate (single-key ElGamal cannot prove this) |

Consequences, stated plainly: a malicious **voter** with a modified client could corrupt the aggregate with unconstrained plaintext values, or vote multiple times from one leaf; a malicious **coordinator** could tally a different batch, replay a tally proof to another eligible voteId, publish a non-canonical scalar representative, and technically decrypt individual ciphertexts. The implementation demonstrates the honest-participant flow end-to-end; it does not yet remove these trust assumptions. See [`docs/threat-model.md`](docs/threat-model.md).

---

## Trust assumptions (v1.5)

- **Single coordinator** holds the ElGamal key: aggregate-only decryption is a protocol norm, not an enforced property.
- **Relayer censorship**: the coordinator can decline to relay a vote.
- **Server-side registration**: `leaf_data` has no explicit EOA column, but the server stores EOA snapshot records and can correlate registration via timing/session/order/logs (Demo also prints new EOAs to stdout). Unlinkability claims are scoped to **chain observers**.
- **Trusted setup**: both proving keys were produced with a **single phase-2 contribution** by the author. Soundness rests on that contribution's randomness being discarded. See [`docs/PROVENANCE.md`](docs/PROVENANCE.md).
- **Not receipt-free** (intentional scope): a voter can reveal ElGamal randomness to prove their vote. Anti-collusion is out of scope; this design prioritizes limiting what everyone — operator included — learns.

---

## Selected implementation issues

Operational subset, not an exhaustive roadmap. At the 2026-08-26 publication-preparation snapshot, the local Product database had no open vote:

- The leaf admission token's single-use set is in-memory (a restart clears it until tokens expire; the registration cap still bounds leaves)
- `leafLocks` has no TTL; no graceful shutdown handlers; error response format not standardized
- Snapshot weights are not validated against the BSGS-recoverable range at snapshot creation
- Product can accept more than 100 real permits; `finalize` detects this only after closing and cannot produce a tally for that voteId
- Fresh clones must create the ignored tally-output directories before running tally (documented in [`docs/BUILD.md`](docs/BUILD.md))

Resolved in the 2026-08-25 server hardening pass: Cloudflare-aware rate limiting, auth-failure throttling, generic error responses, locally pinned snarkjs, the exactly-100-votes finalize case, server-side ciphertext point validation (a mitigation — the circuit gap in the table above remains), and the `package.json` license field. Added 2026-08-27: the snapshot scripts refuse to adopt an on-chain voteId unknown to the local DB (explicit `--adopt` for open ids only), finalize/tally/submit refuse already-finalized ids, and `scripts/listVoteIds.js` lists on-chain voteId state — on-chain voteId state is permanent, so ids must never be reused. Full list and details: [`docs/REVISION19.md`](docs/REVISION19.md) §17.5.

---

## Code review

Three independent code-review passes (2026-07-05, 2026-07-23, 2026-08-23) covered the implementation. Their consensus findings — unauthenticated EOA admission, nullifier–leaf non-binding, unproven ciphertext validity, unbound tally batch — are what drew the proof-scope map above and drive the roadmap. The reviews were of the code in this repository; the full write-ups are not published, but every consensus finding is reflected in [`docs/threat-model.md`](docs/threat-model.md) and the spec.

---

## Repository layout

| Path | Contents |
|------|----------|
| `circuits/` | `vote.circom`, `tally.circom` (Groth16, BabyJubJub, Poseidon) |
| `contracts/` | Voting + tally contracts and snarkjs-generated verifiers |
| `src/` | Express server, SQLite modules, tally pipeline, browser client source |
| `scripts/` | Snapshot creation, finalize, on-chain setup |
| `public/` | Client artifacts incl. `vote.wasm`, `vote_final.zkey` (browser proving) |
| `test/` | Regression tests (`npm test`) — ciphertext point validation |
| `usage/` | Step-by-step operational guides |
| `docs/` | [`REVISION19.md`](docs/REVISION19.md) (spec) · [`threat-model.md`](docs/threat-model.md) · [`verification.md`](docs/verification.md) · [`PROVENANCE.md`](docs/PROVENANCE.md) · [`BUILD.md`](docs/BUILD.md) |
| `samples/` | Recorded end-to-end runs on Sepolia (transactions, screenshots) |

---

## Deployments (Ethereum Sepolia)

| | VotingContract | TallyContract |
|---|---|---|
| Product configuration | [`0xdd200F4cb1f559D6c3FC76752B9e6221e32254e1`](https://sepolia.etherscan.io/address/0xdd200F4cb1f559D6c3FC76752B9e6221e32254e1) | [`0xFda0641b252409bA40e43d0303e70CCbbC3b270A`](https://sepolia.etherscan.io/address/0xFda0641b252409bA40e43d0303e70CCbbC3b270A) |
| Demo | [`0x896fB9AcbD6A2a3A2Db9635D3215c0eC5ffc33D9`](https://sepolia.etherscan.io/address/0x896fB9AcbD6A2a3A2Db9635D3215c0eC5ffc33D9) | [`0x0323e975db2a48f82c84b48dDD63c0eA6bF66198`](https://sepolia.etherscan.io/address/0x0323e975db2a48f82c84b48dDD63c0eA6bF66198) |

Recorded runs: [`samples/demo/walkthrough.md`](samples/demo/walkthrough.md), [`samples/production/`](samples/production/). Deployment dates and artifact hashes: [`docs/PROVENANCE.md`](docs/PROVENANCE.md).

---

## Demo

A request-based demo runs on Sepolia. It is an **honest-client flow demonstration**, not an adversarially secure election — and it is most useful as a **self-verification device**: vote from several wallets you control, then check that the on-chain tally equals the sum of your own weights. This detects omissions or substitutions that change participant-known totals; it does not establish exact batch identity. No gas is paid by participants in the standard client flow. Details and constraints: [`docs/demo.md`](docs/demo.md). Access: DM [@0xgumi](https://x.com/0xgumi).

---

## Roadmap

Direction only — problem statements, not commitments or dates: [`docs/roadmap.md`](docs/roadmap.md). The order follows the review findings: input integrity in the vote circuit, snapshot binding, tally-batch binding, threshold decryption, scale.

---

## Related work

[MACI](https://github.com/privacy-ethereum/maci) and [Vocdoni's DAVINCI](https://github.com/vocdoni/davinci-node) address adjacent problems; DAVINCI in particular is the closest prior art for homomorphic ballot aggregation with aggregate-only decryption. Commitra's dated development record (from December 2025) is in [`docs/PROVENANCE.md`](docs/PROVENANCE.md). Its threat model differs from MACI's (data minimization vs. anti-collusion) and its value here is the worked minimal implementation together with its failure map, not a claim of novelty or superiority.

---

## License

GPL-3.0 — see [`LICENSE`](LICENSE). The circuits depend on [circomlib](https://github.com/iden3/circomlib) (GPL-3.0); proofs are generated with [snarkjs](https://github.com/iden3/snarkjs).

---

## Contact

- X (Twitter): [@0xgumi](https://x.com/0xgumi) — demo access, review discussion, collaboration

Feedback on the proof-scope gaps and the planned circuit revisions is especially welcome.
