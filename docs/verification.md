# Verification Guide

This document explains what you can verify about Commitra — from the public on-chain record, and now also from the source in this repository — and, just as importantly, **what the on-chain record alone does not establish**.

An earlier version of this guide claimed that on-chain artifacts suffice to detect omission or manipulation of votes, and that "the tally corresponds exactly to submitted votes" is verifiable. Those claims overstated the system; the honest scope is below.

---

## 1. What a transaction shows

### Vote submission (`VotingContract.submitVote`)

For any recorded vote transaction (examples: [`../samples/demo/walkthrough.md`](../samples/demo/walkthrough.md), [`../samples/production/vote-sample.md`](../samples/production/vote-sample.md)):

- The transaction succeeded, meaning the on-chain Groth16 verifier accepted the proof
- The proof's public signals include the Merkle root (which the contract required to be registered), the nullifier (which the contract required to be fresh for this voteId), and the ciphertext hash
- A `VoteSubmitted` event was emitted

This establishes: *someone holding secrets for a registered leaf produced a valid proof over exactly these ciphertext hashes, with a nullifier not seen before in this voteId.*

It does **not** establish that the ciphertexts are well-formed encryptions of an in-range vote — the circuit does not constrain that. Nor does it establish one-vote-per-voter: the nullifier is not circuit-bound to the leaf, so the same leaf holder could have submitted other votes under other nullifiers (see [`threat-model.md`](threat-model.md)).

### Tally finalization (`TallyContract.finalizeTally`)

- The transaction succeeded: the tally verifier accepted the proof, voting was closed, dummy padding was registered, and the coordinator public key matched
- The recorded result equals the proof's public `tallyResult` signals

This establishes: *the published result is the correct homomorphic sum and decryption of **a** batch of 100 ciphertext sets that hashes to the committed batch hash.*

It does **not** establish that this batch equals the set of votes submitted on-chain: the contract never reconstructs the batch hash from `VoteSubmitted` events. Comparing the on-chain event count and hashes against the tallied batch is possible only out-of-band today. This is the single most important limitation of the current verification story.

---

## 2. What you can verify from the source (this repository)

With the code public, deeper checks are possible:

1. **Circuits**: read [`../circuits/`](../circuits/) — `vote.circom` and `tally.circom` are short. You can confirm directly which constraints exist and which (ciphertext validity, plaintext range, snapshot binding, batch binding) do not. The proof-scope table in [`REVISION19.md`](REVISION19.md) §17.3 is checkable against the source.
2. **Verifier correspondence**: rebuild the circuits and compare the generated verifier contracts against the deployed bytecode, and the verification keys against the published zkeys. Procedure: [`BUILD.md`](BUILD.md); artifact hashes: [`PROVENANCE.md`](PROVENANCE.md).
3. **Server behavior**: the relaying, admission-token, and hash-binding logic is in [`../src/routes/`](../src/routes/) — including the checks the server performs that the circuits do not.
4. **End-to-end**: run the full lifecycle locally against Sepolia using [`../usage/`](../usage/).

Note the setup caveat: both zkeys come from a single phase-2 contribution ([`PROVENANCE.md`](PROVENANCE.md)), so "the verifier accepted the proof" is only as strong as that setup.

---

## 3. Demo self-verification

The most direct verification available to an outside party is the demo used as a **self-verification device**: vote from several wallets you control, record your own weights and choices, and check that the finalized on-chain result equals your sums. Since all voters are you, batch substitution or omission would be visible to you directly. See [`demo.md`](demo.md).

---

## 4. Honest summary

| Claim | Verifiable today? |
|-------|-------------------|
| Each counted-as-submitted vote carried a valid membership proof and fresh nullifier | Yes — on-chain |
| Each voter voted at most once | **No** — nullifiers are single-use, but not circuit-bound to the voter's leaf |
| No vote choice or voter address is on-chain | Yes — inspect the transactions |
| Result = correct sum + decryption of a committed batch | Yes — on-chain proof |
| The committed batch = the actual submitted votes | **No** — not enforced or checkable on-chain; out-of-band only |
| Ballots are well-formed encryptions of in-range votes | **No** — not constrained by the circuit |
| The operator decrypted only the aggregate | **No** — unprovable under single-key ElGamal |
| The deployed verifiers match these circuits | Yes — by rebuilding ([`BUILD.md`](BUILD.md)) |

For the mechanism behind each row: [`REVISION19.md`](REVISION19.md) §17.3. For the adversary-oriented view: [`threat-model.md`](threat-model.md).
