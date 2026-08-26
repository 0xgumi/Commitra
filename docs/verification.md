# Verification Guide

This document explains what you can verify about Commitra — from the public on-chain record, and now also from the source in this repository — and, just as importantly, **what the on-chain record alone does not establish**.

An earlier version of this guide claimed that on-chain artifacts suffice to detect omission or manipulation of votes, and that "the tally corresponds exactly to submitted votes" is verifiable. Those claims overstated the system; the honest scope is below.

---

## 1. What a transaction shows

### Vote submission (`VotingContract.submitVote`)

For any recorded vote transaction (examples: [`../samples/demo/walkthrough.md`](../samples/demo/walkthrough.md), [`../samples/production/vote-sample.md`](../samples/production/vote-sample.md)):

- The transaction succeeded, meaning the on-chain Groth16 verifier accepted the proof
- The calldata contains the proof and all eight public signals: Merkle root, voterID, nullifier, encryptedVotesHash, voteId, pubkeyCommitment, chainId and voteHash. The contract required the root to be coordinator-accepted and the exact nullifier to be fresh for this voteId
- A `VoteSubmitted` event was emitted

This establishes: *someone holding a membership witness and signing key for a leaf under a coordinator-accepted root produced a valid proof over this ciphertext hash, with an exact nullifier not seen before in this voteId.* It does not establish that the accepted root came from the published snapshot.

It does **not** establish that the ciphertexts are well-formed encryptions of an in-range vote — the circuit does not constrain that (the server rejects invalid curve points before relaying, but a valid point encoding an out-of-range plaintext passes). Nor does it establish one-vote-per-voter: the nullifier is not circuit-bound to the leaf, so the same leaf holder could have submitted other votes under other nullifiers (see [`threat-model.md`](threat-model.md)).

### Tally finalization (`TallyContract.finalizeTally`)

- The transaction succeeded: an authorized coordinator called the function, the tally verifier accepted the proof, the configured VotingContract reported voting closed and its dummy-registration boolean set, and the proof's public-key coordinates matched the constructor-configured coordinates
- The recorded result equals the proof's public `tallyResult` signals

This establishes: *the aggregate/result signals satisfy the tally circuit's group equations for **a** private batch of 100 ciphertext sets that hashes to the committed batch hash.* It does not establish that each published result is the unique canonical integer in the intended tally range: the circuit permits scalar aliases representing the same BabyJub point, and the contract adds no range or sum check.

It does **not** establish that this batch equals the set of votes submitted on-chain: the contracts never reconstruct the batch hash from `VoteSubmitted`/dummy events. Nor is the proof bound to voteId, chainId or contract identity, so the same proof can be replayed to another closed, dummy-registered voteId (or compatible deployment). Comparing event counts/hashes is only an out-of-band check today.

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

The demo can be used as a **self-verification device**: vote from several wallets you control, record your own weights and choices, and check that the finalized result equals your sums. This detects omissions or substitutions that change the participant-known totals; it does not establish exact batch identity, because a different batch can produce the same aggregate. See [`demo.md`](demo.md).

---

## 4. Honest summary

| Claim | Verifiable today? |
|-------|-------------------|
| Each counted-as-submitted vote carried a valid membership proof and fresh nullifier | Yes — on-chain |
| Each voter voted at most once | **No** — nullifiers are single-use, but not circuit-bound to the voter's leaf |
| No vote choice or voter address is on-chain | Yes — inspect the transactions |
| Aggregate/result signals satisfy the group equations for a committed private batch | Yes — on-chain proof |
| Published result is the unique canonical integer tally | **No** — no canonical scalar/range/total bound |
| The committed batch = the actual submitted votes | **No** — not enforced or checkable on-chain; out-of-band only |
| The tally proof is bound to this voteId/deployment | **No** — vote/deployment domain is absent and replay is possible when state checks pass |
| Ballots are well-formed encryptions of in-range votes | **No** — not constrained by the circuit (point validity is server-checked only) |
| The operator decrypted only the aggregate | **No** — unprovable under single-key ElGamal |
| The deployed verifiers match these circuits | Yes — by rebuilding ([`BUILD.md`](BUILD.md)) |

For the mechanism behind each row: [`REVISION19.md`](REVISION19.md) §17.3. For the adversary-oriented view: [`threat-model.md`](threat-model.md).
