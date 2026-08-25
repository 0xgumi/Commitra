# Provenance

This document binds the published artifacts to cryptographic hashes, states the trusted-setup facts plainly, and records the date evidence for when this system was built.

---

## Artifact hashes (SHA-256)

| Artifact | Size (bytes) | SHA-256 |
|----------|--------------|---------|
| `circuits/vote/vote.circom` | 6,057 | `6ea4feb520d8646f3e94a2f157e104425e290c79d78344334b5cc453b42edf0f` |
| `circuits/tally/tally.circom` | 5,175 | `d5fd67c403680686990d305ee74595a04d289e1584d64c12d02daad9c7626d94` |
| `public/vote.wasm` | 4,921,443 | `324bbaa8d9ed1320b2ecc4dcade7635b70b15a2edc553bfac145dd66ae558086` |
| `public/vote_final.zkey` | 10,301,285 | `5f7d333e9752614f91eaabd3580dae12b25005918f2bd5b11bcbf4bf1c8ec827` |
| `circuits/tally/tally.wasm` | 4,623,724 | `2103cb1d829451c01ea20b89d58c4ac417752b90320fb24443525d0820d017b3` |
| `tally_final.zkey` | 104,009,674 | `0184a871a8791ab313b21d09dd9d5c72ed7db62486ca48e913d3dcf62ad532ff` |

`tally_final.zkey` (~99 MiB) is not stored in the repository; it is distributed separately (see the repository's releases). Verify any copy against the hash above before use.

---

## Trusted setup — stated honestly

Both proving keys are Groth16 zkeys with a **single phase-2 contribution, made by the author**. There was no multi-party ceremony. This is verifiable: the contribution list is parseable from the zkey files themselves (`snarkjs zkey verify` prints it, given the matching r1cs and ptau).

What this means: if the author had retained the contribution randomness, false proofs could be forged that the on-chain verifiers would accept. The author states the randomness was discarded — but the whole point of stating this section plainly is that you should not have to take that on faith for anything that matters. Treat proof soundness accordingly; a real circuit release requires a proper multi-party ceremony, and the planned circuit revision will get one (see [`roadmap.md`](roadmap.md)).

Phase 1 uses a public powers-of-tau file (2^19 for the tally circuit, per build records). Its identity can be checked as part of `snarkjs zkey verify`; it is not separately attested here.

---

## Deployments and date evidence

### On-chain (Ethereum Sepolia)

| Contract | Address |
|----------|---------|
| VotingContract (Product) | `0xdd200F4cb1f559D6c3FC76752B9e6221e32254e1` |
| TallyContract (Product) | `0xFda0641b252409bA40e43d0303e70CCbbC3b270A` |
| VotingContract (Demo) | `0x896fB9AcbD6A2a3A2Db9635D3215c0eC5ffc33D9` |
| TallyContract (Demo) | `0x0323e975db2a48f82c84b48dDD63c0eA6bF66198` |

Each address page on a block explorer shows the **contract-creation transaction and its timestamp** — this is the strongest, non-forgeable date evidence for when the system existed and worked. The verifier contract addresses are readable from each main contract's `verifier()` view function. Recorded end-to-end runs with transaction hashes and block numbers: [`../samples/`](../samples/).

### Source history

The circuit sources were first committed on **2025-12-31** in the author's private development repository. The implementation history in this repository was extracted from that repository as a path subset, and the author identity across this repository's entire history was normalized before publication. **Because this history was rewritten, its commit dates and GitHub timestamps are not independent evidence** of when the work was done.

Independent date evidence consists of (1) the Sepolia contract-creation transactions listed above, and (2) the private development repository's GitHub push record from 2025-12-31, which can be shown to reviewers on request. The circuit files published here are byte-identical to that first commit. The public history of this repository (documentation-only since December 2025, full source from this release) reflects the publication path, not the development timeline.

---

## How to verify

1. **Hashes**: `shasum -a 256 <file>` against the table above
2. **Setup**: compile the circuits ([`BUILD.md`](BUILD.md)), then `snarkjs zkey verify <circuit>.r1cs <ptau> <zkey>` — confirms the zkey matches the circuit and lists the (single) contribution
3. **Deployed verifiers**: export the verification key (`snarkjs zkey export verificationkey`) and the Solidity verifier (`snarkjs zkey export solidityverifier`), and compare against [`../contracts/`](../contracts/) and the deployed bytecode
