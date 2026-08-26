# ZK Voting System — Architecture (Revision 19)

Written: 2026-08-24 | Version: Revision 19 | Status: **v1.5 implementation reference (with v2 server hardening)**

Revision 19 reflects the current codebase: the v1.5 protocol plus the v2 server-side hardening pass (leaf admission tokens, server-side proof-hash verification, transactional persistence, recovery logging). This document covers the **protocol specification** — cryptographic flow, circuit details, contract internals, privacy model, and security posture.

Two things this document is explicit about, throughout:

1. **What the ZK proofs actually prove — and what they do not.** See §17.3 (Proof Scope).
2. **Which privacy properties hold against which observer.** Unlinkability claims in this document are stated **relative to a chain observer** (someone reading the public blockchain). The server/coordinator occupies a strictly stronger position; §11 and §17.4 spell out what it could learn.
3. **How current gaps relate to future work.** Where a direction is named, it is a design direction rather than a delivery promise or date. Current enforcement and planned enforcement are kept separate.

For other topics, see:
- Build and reproduction → [`BUILD.md`](BUILD.md)
- Artifact hashes and setup provenance → [`PROVENANCE.md`](PROVENANCE.md)
- Operational guides → [`../usage/USAGE_PRODUCT.md`](../usage/USAGE_PRODUCT.md), [`../usage/USAGE_DEMO.md`](../usage/USAGE_DEMO.md)
- Known issues → §17.5 (summarized in [`../README.md`](../README.md))

---

# 1. Goals

The system satisfies five core goals:

1. **Voter address privacy against chain observers**: The voter's EOA never appears on-chain; no on-chain data links an EOA to a leaf, a nullifier, or a ciphertext. (This claim is scoped to chain observers. The server is in a stronger position — see §11.)
2. **Off-chain computation + on-chain minimal verification**: Gas cost borne entirely by coordinator
3. **ZK-based tamper evidence**: Both vote validity and tally aggregation/decryption are ZK-proven, within the scope stated in §17.3
4. **Single-visit UX**: Registration, voting, and proof generation all complete in the browser
5. **Multi-vote support**: Independent voting sessions per voteId

---

# 2. High-Level Flow

```
Phase 0 — Snapshot (per voteId)
Phase 1 — Registration (EOA submission → admission token → credential signature/secrets → leaf registration)
Phase 2 — Voting (vote choice → encryption → ZK proof generation)
Phase 3 — On-chain Vote Submission (relayer submission → server hash check → ZK proof verify)
Phase 4 — Finalize (close voting → dummy vote generation)
Phase 5 — Tally (off-chain aggregation → decryption → ZK TallyProof → on-chain record)
```

### Environments

Two parallel deployments share the same protocol:

| | Product | Demo |
|---|---------|------|
| Eligibility | Closed snapshot list (JSON) | Auto-register on first `/weight` call, random weight 1–100 |
| Registration cap | Snapshot size | 80 voters per voteId |
| Server / DB | port 3000, `voting.db` | port 4000, `voting_demo.db` |

The Demo is an **honest-client flow demonstration**, not an adversarially secure election. Unless a Demo difference is stated, the cryptographic flow is the same; eligibility, registration cap, UI disclosure, database, deployed contracts and environment configuration are separate.

---

# 3. Phase 0 — Snapshot

- Coordinator stores per-voteId EOA → weight lists in the server DB
- Managed via snapshot JSON files (e.g., `snapshots/vote1.json`)
- `createSnapshot.js` execution:
    - Calls on-chain `createVoteId()` **first**; DB insertion only on success (idempotent re-sync on retry)
    - Inserts voteId, title into `active_votes` table
    - Inserts voteId, eoa, weight into `snapshot` table
    - Duplicate EOA entries in the input file fail immediately (no silent overwrite)

### Snapshot JSON Format

```json
{
  "voteId": 1,
  "title": "Q1 Budget Proposal",
  "voters": [
    { "eoa": "0x1E4cF7E883501b76ACD4F46E8Fe440fEF05aef6D", "weight": 450 },
    { "eoa": "0x6138e476fd55aF82d8c24DC8b51bD3d0d1Df2c01", "weight": 330 },
    { "eoa": "0x14d732A45Cfc795b55b9AF21f7e7f85b7EdE918f", "weight": 220 }
  ]
}
```

---

# 4. Phase 1 — Registration

### Step 1 — voteId Selection + EOA Submission + Credential Signature

- User selects active voteId from dropdown
- Browser obtains the connected wallet address and submits `{ voteId, eoa }` to `POST /weight`
- **The server checks only EOA format and snapshot presence (or auto-registers it in Demo); it does not verify ownership of the submitted EOA.** A caller who knows a snapshot-listed address can obtain its weight and an admission token. Direction: authenticated, once-per-EOA admission in the near-term server-hardening phase, followed by circuit-level eligibility/weight binding
- After the weight response, the wallet signs `"zkVote | voteId=1"`. This signature derives the browser credential; it is not sent to or verified by the server as EOA-ownership authentication
- `seedMaster = keccak256(toUtf8Bytes(signature))` — signature is a hex string; `toUtf8Bytes` encodes it as UTF-8 characters (NOT raw bytes), then hashed
- On success, the server returns the weight **and a `leafAdmissionToken`** (see Step 4)

### Step 2 — Secrets Generation (browser)

- `secret_nullifier = keccak256("secret_nullifier", seedMaster) % p`
- `secret_weight = keccak256("secret_weight", seedMaster) % p`
- `secret_voterid = keccak256("voter-id-secret", seedMaster) % p`
- `babyjub_priv = keccak256("babyjub_priv", seedMaster)`

### Step 3 — Commitments Generation (browser)

- `babyjub_pubkey = eddsa.prv2pub(babyjub_priv)`
- `pubkeyCommit = Poseidon(babyjub_pubkey_x, babyjub_pubkey_y)`
- `weightCommit = Poseidon(weight, secret_weight)`
- `leaf = Poseidon(pubkeyCommit, weightCommit)`

### Step 4 — Leaf Registration on Server

- Browser → Server: `{ voteId, leaf, leafAdmissionToken }`
- Server: verifies the admission token, checks the registration cap, and builds the candidate Merkle tree/root in memory
- Server: calls `VotingContract.updateRoot(voteId, root)`, waits for the receipt, then saves `leaf_data` + `root_history` in one SQLite transaction, consumes the admission token and returns `{ root, pathElements, pathIndices, txHash }`
- Browser waits for that server response; it does not independently poll the transaction by txHash

**Leaf admission token** (server hardening, v2):

- Issued by `POST /weight` after the submitted EOA string passes the snapshot check for that voteId (Demo: after auto-registration). EOA ownership is not verified
- Format: `base64url(payload).base64url(HMAC-SHA256(payload, LEAF_TOKEN_SECRET))` with payload `{ voteId, jti, exp }`
- TTL: `LEAF_TOKEN_TTL_SEC` (default 600 s); `jti` is single-use for a successful **new** leaf registration (constant-time signature comparison; used-`jti` set held in memory). An already-registered leaf is returned idempotently before token verification and creates no new admission
- **Does not encode the EOA or the leaf.** The token proves only that a recent `/weight` request **naming** a snapshot-listed EOA passed for this voteId; it proves neither ownership of that EOA nor that the subsequent leaf belongs to it. It is an **admission-rate mitigation, not identity authentication or a cryptographic eligibility proof** — authenticated admission and circuit-level binding are future directions (see §17.3)
- **Registration cap**: new leaves are rejected once the leaf count reaches the snapshot size for the voteId (Demo: hard cap of 80)
- Registration outcomes handled after basic request validation (registered / already-registered / token or cap rejection / caught error) are appended to an audit log (`recovery_logs/leaf_audit_*.jsonl`). Missing fields and malformed leaf values return before this log path
- The server refuses to start if `LEAF_TOKEN_SECRET` is unset (fail-fast)

**Ordering and recovery**: The on-chain transaction executes first, and the DB save runs only after chain success. This avoids recording a DB success for a failed chain transaction, but it is **not atomic across chain and SQLite**: chain success followed by DB failure can still occur. `/submit-vote` writes a recovery record for that case; `/leaf` does not have an equivalent durable reconciliation record.

**Concurrency**: voteId-based mutex (`leafLocks` Map) prevents duplicate leafIndex assignment from concurrent requests.

### Step 5 — voterID, nullifier Generation (browser)

- `voterID = Poseidon(voteId, pubkeyCommit, secret_voterid)`
- `nullifier = Poseidon(secret_nullifier, voteId)`

**Privacy after this point — stated precisely:** `leaf_data` stores no explicit EOA column, and the intended on-chain flow records no participant EOA. The server nevertheless stores EOAs in `snapshot` and can correlate `/weight` with `/leaf` through timing, source/session context, insertion/order information and logs; Demo additionally prints new EOAs to stdout. The unlinkability guarantee is therefore **against chain observers**. Against the server, schema separation is a data-minimization practice, not a cryptographic or guaranteed storage unlinkability property.

---

# 5. Phase 2 — Voting

### Step 1 — Vote Choice

- User selects YES(0), NO(1), or ABSTAIN(2)

### Step 2 — ElGamal Encryption (browser)

- Coordinator pubkey loaded from server (pubkey only)
- Selected choice: `encrypt(weight)`, others: `encrypt(0)`
- `encryptedVotes = [encYes, encNo, encAbstain]`
- Each ciphertext: `C = (r*G, vote*G + r*PK)` on BabyJubJub curve

### Step 3 — Hash Computation (browser)

- `encryptedVotesHash = Poseidon(12 ciphertext coordinates)`
- `voteHash = Poseidon(encryptedVotesHash, voteId, voterID, chainId, nullifier)`

### Step 4 — EdDSA Signature (browser)

- `signature = eddsa.signPoseidon(babyjub_priv, voteHash)`
- Extracts `(R8x, R8y, S)`

### Step 5 — ZK Proof Generation (browser)

- `snarkjs.groth16.fullProve(voteInput, vote.wasm, vote_final.zkey)`
- Approximately 30 seconds

---

# 6. vote.circom (ZK Proof)

vote.circom proves:

1. `pubkeyCommit = Poseidon(babyjub_pubkey_x, babyjub_pubkey_y)`
2. `weightCommit = Poseidon(weight, secret_weight)`
3. `leaf = Poseidon(pubkeyCommit, weightCommit)`
4. `leaf ∈ merkleRoot` via MerkleProof
5. `voterID = Poseidon(voteId, pubkeyCommit, secret_voterid)`
6. `nullifier = Poseidon(secret_nullifier, voteId)`
7. `encryptedVotesHash` consistency with encrypted votes
8. `voteHash = Poseidon(encryptedVotesHash, voteId, voterID, chainId, nullifier)`
9. EdDSA signature validity over voteHash

For what this list does **not** cover (ciphertext well-formedness, plaintext range, snapshot binding), see §17.3.

### Public Inputs (8)

| Index | Signal |
|-------|--------|
| 0 | merkleRoot |
| 1 | voterID |
| 2 | nullifier |
| 3 | encryptedVotesHash |
| 4 | voteId |
| 5 | pubkeyCommitment |
| 6 | chainId |
| 7 | voteHash |

### Private Inputs

- `babyjub_pubkey_x`, `babyjub_pubkey_y`
- `weight`, `secret_weight`
- `merklePath[15]`, `merkleIndices[15]`
- `secret_nullifier`, `secret_voterid`
- `R8x`, `R8y`, `S`
- `encryptedVotes[3][2][2]`

---

# 7. Phase 3 — On-chain Vote Submission

### Multi-Coordinator Structure

- Multiple coordinator wallets used in round-robin
- Reduces the chance of nonce collision under concurrent requests (does not eliminate it)
- Configured via `COORDINATOR_PRIVATE_KEYS` env variable (JSON array)

### Server Pre-validation (gas saving + DB integrity)

1. `encryptedVotes` validated: shape (3×2×2 decimal strings), then each of the 6 points checked for canonical field range, on-curve, prime-order subgroup membership, and non-identity `C1` (`src/lib/ciphertextValidation.js`). This is a **server-side mitigation** — the circuit itself still does not constrain point validity, see §17.3
2. merkleRoot validity checked against on-chain `validRoots` (per voteId)
3. Nullifier checked against `used_nullifiers` table (per voteId)
4. **Proof-hash binding (v2)**: the server recomputes `Poseidon(12 ciphertext coordinates)` from the submitted `encryptedVotes` and rejects the submission unless it equals `publicSignals[3]`. This guarantees the ciphertexts the server stores for tallying are exactly the ones the ZK proof committed to — a client cannot pass a proof over one set of ciphertexts while handing the server another

### On-chain Verification (VotingContract.submitVote)

0. Caller is an authorized coordinator (`onlyCoordinator` modifier)
1. `chainId` check
2. `voteId` validity check
3. `votingClosed` check
4. `merkleRoot ∈ validRoots[voteId]` check
5. `nullifier ∉ nullifiers[voteId]` check
6. `Verifier.verifyProof(pA, pB, pC, publicSignals)`
7. `nullifiers[voteId][nullifier] = true`
8. Emit `VoteSubmitted` event

### Server Post-processing (after on-chain success)

- Insert `(voteId, nullifier, txHash)` into `used_nullifiers` and `(voteId, id, encryptedVotes, encryptedVotesHash)` into `permits` — both inside a **single SQLite transaction** (v2), so a partial write cannot leave the two tables inconsistent
- **On-chain first, DB second**: prevents DB-first false success, but does not make the chain and SQLite one atomic transaction
- **Recovery logging (v2)**: if the DB write fails *after* on-chain success, the server attempts to append the full submission (voteId, nullifier, txHash, ciphertexts, hash) to `recovery_logs/submit_vote_recovery_*.jsonl` and returns an explicit error. The append helper can itself fail (it logs that failure to stderr), so this is a manual recovery path rather than durable atomicity/outbox. The on-chain nullifier is already consumed

---

# 8. Phase 4 — Finalize

`finalize.js` performs the following:

### Step 1 — closeVoting

- Calls on-chain `VotingContract.closeVoting(voteId)`
- Voting is disabled for this voteId afterward

### Step 2 — active_votes Update

- Sets `closedAt` in DB `active_votes` table
- Excluded from `/active-votes` API
- Recovery caveat: if the process stops after on-chain closure but before this DB update, a rerun takes the `alreadyClosed` branch and does not currently heal `closedAt`

### Step 3 — Dummy Vote Generation

- Queries current permit count
- If < 100, generates dummies (r=1, weight=0, all 3 choices encrypt to zero)
- Calls on-chain `registerDummyVotes(voteId, dummyHashes)`
- Inserts dummy permits into DB

**The tally circuit is compiled for n=100, so exactly 100 permits are always required.**

`registerDummyVotes` is called even when exactly 100 real votes need no padding (with an empty batch), because `finalizeTally` requires the on-chain `dummyRegistered` flag. More than 100 permits is a fail-fast error because the tally circuit cannot process it; the current check occurs **after** `closeVoting`, so preventing a 101st submission earlier remains an operational direction.

### Step 4 — Lock Cleanup

- Calls `POST /voter/cleanup-locks` with `INTERNAL_API_TOKEN` to release the voteId's leafLock
- Sends the Basic Auth header when `BASIC_AUTH_PASSWORD` is set (v2)
- Non-critical: server may not be running

---

# 9. Phase 5 — Tally

### Step 1 — Load Permits

- Load `encryptedVotes` from DB `permits` table
- **ORDER BY id** (order must be preserved for `encryptedBatchHash`)
- **Filtered by voteId**

### Step 2 — encryptedVotesHashes Verification

- Recalculate each permit's `encryptedVotesHash` from its `encryptedVotes`
- Compare against stored DB value
- Mismatch indicates DB tampering

### Step 3 — encryptedBatchHash Computation

- Poseidon chaining: `hash = Poseidon(hash, nextHash)`
- Produces final `encryptedBatchHash`

### Step 4 — Homomorphic Sum

- `aggregatedCiphertext[3][2][2]` computed
- `sumYes = Σ encYes` (ElGamal homomorphic addition on BabyJubJub)
- `sumNo = Σ encNo`
- `sumAbstain = Σ encAbstain`

### Step 5 — Decryption

- Coordinator privkey decrypts aggregate ciphertext
- `M = C2 - privkey × C1`
- Twisted Edwards negation: `(-x, y)`, NOT `(x, -y)`

### Step 6 — BSGS

- Baby-step Giant-step recovers discrete log from `M = m × G`
- `tallyResult = [yesTotal, noTotal, abstainTotal]`
- `bsgs.js` default maxRange = 100,000,000,000 (10^11)
- `tally.js` explicitly passes maxRange = 1,000,000 for the tally call — per-option totals of 10^6 or more are unrecoverable with the current setting (the covered range is `[0, 10^6)`)

### Step 7 — tally.circom Proof Generation

- Generates `tally_input.json` (coordinator privkey excluded from file)
- `snarkjs.groth16.fullProve` with tally circuit (n=100, pot19)
- `pbSwap` applied for Solidity-compatible proof format
- Saved as `tally_proof_{voteId}.json`

### Step 8 — finalizeTally

- `TallyContract.finalizeTally(voteId, pA, pB, pC, publicSignals)`
- Caller must be an authorized coordinator
- VotingContract state checks: `isVotingClosed`, `isDummyRegistered`
- `coordinatorPubkey` match verification
- Tally proof verification
- Final result recorded on-chain (per voteId)

**Scope note**: `encryptedBatchHash` is a public input of the tally proof, but the contract does **not** reconstruct it from the `VoteSubmitted` / `DummyVotesRegistered` events and compare. `isDummyRegistered` is only a boolean indicating one post-close registration call, not validation of dummy contents/count. The proof therefore binds the result to *a* batch, not to *the* canonical on-chain submitted set. See §17.3.

---

# 10. tally.circom (ZK Proof)

tally.circom proves:

1. `encryptedBatchHash` = Poseidon chain of all `encryptedVotesHashes`
2. `aggregatedCiphertext` = homomorphic sum of all `encryptedVotes`
3. each `tallyResult` scalar maps to the same BabyJubJub group element as the decrypted `aggregatedCiphertext`
4. `coordinatorPubkey` matches

### Public Inputs (18)

| Index | Signal |
|-------|--------|
| 0 | encryptedBatchHash |
| 1-12 | aggregatedCiphertext[3][2][2] |
| 13-15 | tallyResult[3] |
| 16-17 | coordinatorPubkey[2] |

### Private Inputs

- `encryptedVotes[100][3][2][2]`
- `coordinatorPrivkey`

### Circuit Parameters

- `nVoters = 100`
- Powers of Tau: `pot19` (powersOfTau28_hez_final_19.ptau, per build records — not separately attested; see `PROVENANCE.md`)
- Constraints: ~101,297

**Note**: voteId, chainId and contract/deployment identity are absent from the tally public signals. The contract stores results under the caller-supplied voteId and prevents a second write to that same key, but this does not bind the proof to the key: the same accepted proof/publicSignals can be replayed to another closed, dummy-registered voteId, and potentially to a compatible deployment with the same verifier/key configuration. Direction: bind voteId and deployment domain in the tally circuit revision (v6 direction).

---

# 11. Privacy Structure

The table below states visibility per item. "Cannot trace back" claims are **relative to a chain observer**; the server-side caveats follow the table.

| Item | Visibility | Description |
|------|-----------|-------------|
| encryptedVotes | Server only | Ciphertext, **order preserved per voteId** |
| encryptedVotesHash | Public | On-chain event, DB stored |
| encryptedBatchHash | Public | Tally consistency proof (Poseidon chaining) |
| aggregatedCiphertext | Public | Tally public input |
| tallyResult | Public | Final vote result (per voteId) |
| coordinatorPubkey | Public | ElGamal encryption key |
| coordinatorPrivkey | Private | Tally decryption key |
| pubkeyCommit | Public | Public input |
| voterID | Public | Public input; a chain observer cannot trace it to an EOA |
| nullifier | Public | Single-use per voteId (on-chain); not circuit-bound to the leaf — see §17.3 |
| weight | Browser + server, not on-chain | Stored with EOA in the server snapshot; privately witnessed in the proof (see §17.3 for the missing snapshot/ciphertext bindings) |
| secret_weight | Private | For weightCommit generation |
| secret_nullifier | Private | For nullifier generation |
| secret_voterid | Private | For voterID generation |
| babyjub_priv | Private | For EdDSA signing |
| EOA | Never on-chain in the intended relayer flow | Stored in `snapshot`; `leaf_data` has no EOA column, but that schema separation is not cryptographic unlinkability |

### What the server could still learn

- **EOA↔leaf correlation at registration time**: `/weight` (EOA) and `/leaf` (leaf) arrive close together with matching timing/source/session context. There is no direct EOA column in `leaf_data`, but this is not proof that no correlatable record persists. Demo registration stores the EOA in `snapshot` and emits each newly registered EOA to server stdout; infrastructure logs may retain additional timing/source data. This is a data-minimization practice, not a cryptographic guarantee.
- **Vote timing**: the server sees when each ciphertext arrives.

### Coordinator Knowledge

The coordinator holds the ElGamal private key. By protocol design, only aggregate decryption is performed. However, the coordinator **could** technically decrypt individual ciphertexts using the same private key. This is a standing trust assumption of the current single-coordinator design; removing it requires threshold ElGamal, planned as a future upgrade (v6). Until then, "the coordinator never sees individual votes" is a **protocol norm, not an enforced property**.

---

# 12. Database (SQLite)

| Table | Columns | Purpose |
|-------|---------|---------|
| active_votes | **voteId**, title, createdAt, closedAt | Active vote list |
| snapshot | **voteId**, eoa, weight | Per-voteId EOA → weight lookup |
| leaf_data | **voteId**, leaf, leafIndex, root, pathElements, pathIndices | Merkle proof storage |
| root_history | **voteId**, id, root, createdAt | Past root validity tracking |
| used_nullifiers | **voteId**, nullifier, txHash, createdAt | Nullifier single-use tracking (per voteId) |
| permits | **voteId**, id, encryptedVotes, encryptedVotesHash | Tally data (id order preserved) |

**Key properties:**
- All tables use voteId as part of the primary key
- `leaf_data` has no EOA column or direct EOA↔leaf mapping; separate tables, insertion order and operational logs must not be described as cryptographic unlinkability (see §11)
- Same EOA can vote in different voteIds (nullifier is voteId-specific)
- `root_history` has `UNIQUE(voteId, root)` — required for `INSERT OR IGNORE` in voter.js
- Product uses `src/db/voting.db`, Demo uses `src/db/voting_demo.db`

**Append-style operational logs** (filesystem, not DB and not tamper-evident): `recovery_logs/submit_vote_recovery_*.jsonl` (chain-succeeded/DB-failed submissions when recovery logging itself succeeds), `recovery_logs/leaf_audit_*.jsonl` (registration outcomes that reach the handler's logging paths; malformed requests can return earlier).

---

# 13. API Endpoints

All endpoints below are under the `/voter` prefix, except `/health` which is registered at the app root level.

| Method | Endpoint | Description | Validation |
|--------|----------|-------------|------------|
| GET | /active-votes | List active (unclosed) votes | — |
| GET | /vote-info/:voteId | Vote details (voterCount, totalWeight) | — |
| POST | /weight | `{ voteId, eoa }` → weight + `leafAdmissionToken` | EOA format (`0x` + 40 hex); Product snapshot presence / Demo auto-registration; **no EOA-ownership proof** |
| POST | /leaf | `{ voteId, leaf, leafAdmissionToken }` → Merkle proof registration/return | Leaf format; for a new leaf: HMAC token/TTL/single-use + cap. Existing leaf data returns idempotently before token verification |
| POST | /proof | `{ voteId, leaf }` → Merkle proof query | — |
| POST | /verify-root | `{ voteId, root }` → root validity check | — |
| GET | /coordinator-key | Return coordinator pubkey | — |
| POST | /submit-vote | Proof submission → on-chain vote | encryptedVotes shape + curve-point validation; nullifier dedupe; on-chain root check; `publicSignals[3]` hash binding |
| POST | /cleanup-locks | Release leafLock for voteId | `INTERNAL_API_TOKEN` required |

**App-level endpoint** (not under `/voter`):

| Method | Endpoint | Description | Validation |
|--------|----------|-------------|------------|
| GET | /health | Health check (returns "OK") | — |

---

# 14. Gas Model

| Operation | Gas Cost | Performed By |
|-----------|----------|-------------|
| Local registration work (DB/tree/proof data) | None | Server |
| updateRoot() | Yes | Server (Coordinator) |
| submitVote() | Yes (ZK verify) | Server (Coordinator) |
| closeVoting() | Yes | Server (Coordinator) |
| registerDummyVotes() | Yes | Server (Coordinator) |
| finalizeTally() | Yes | Server (Coordinator) |
| voterID generation | None | Browser |
| Proof generation | None | Browser |

**User gas cost = 0**

In the standard client flow, the participant wallet signs a message but never submits an on-chain transaction. `updateRoot`, `submitVote` and lifecycle transactions are sent and paid for by coordinator/owner wallets.

---

# 15. Contracts

| Contract | Role |
|----------|------|
| VotingContract | submitVote, updateRoot, nullifier management (per voteId) |
| VoteVerifier | vote.circom proof verification (auto-generated by snarkjs) |
| TallyContract | finalizeTally, result storage (per voteId), VotingContract state check |
| TallyVerifier | tally.circom proof verification (auto-generated by snarkjs) |

### VotingContract

```solidity
// Immutables
IVerifier public immutable verifier;
uint256 public immutable chainId;

// State mappings (all per voteId)
mapping(uint256 => bytes32) public merkleRoots;
mapping(uint256 => mapping(bytes32 => bool)) public validRoots;
mapping(uint256 => mapping(bytes32 => bool)) public nullifiers;
mapping(uint256 => bool) public validVoteIds;
mapping(uint256 => bool) public votingClosed;
mapping(uint256 => bool) public dummyRegistered;
uint256 public latestVoteId;

// Access control
address public owner;
mapping(address => bool) public coordinators;
```

**Functions**: `createVoteId`, `updateRoot`, `closeVoting`, `registerDummyVotes`, `submitVote`, `addCoordinator`, `removeCoordinator`

**View functions**: `currentRoot`, `isValidRoot`, `isNullifierUsed`, `isValidVoteId`, `isVotingClosed`, `isDummyRegistered`

**Events** (7): `VoteSubmitted`, `MerkleRootUpdated`, `VoteIdCreated`, `CoordinatorAdded`, `CoordinatorRemoved`, `VotingClosed`, `DummyVotesRegistered`

**Errors** (13): `InvalidProof`, `NullifierAlreadyUsed`, `InvalidChainId`, `InvalidMerkleRoot`, `InvalidVoteId`, `VoteIdAlreadyExists`, `OnlyOwner`, `OnlyCoordinator`, `ZeroAddress`, `VotingAlreadyClosed`, `VotingNotClosed`, `DummyAlreadyRegistered`, `CannotRemoveOwner`

**submitVote checks** (in order):
0. Caller is an authorized coordinator (`onlyCoordinator` modifier)
1. chainId match
2. voteId valid
3. voting not closed
4. merkleRoot in validRoots[voteId]
5. nullifier not in nullifiers[voteId]
6. Groth16 proof verification
7. Mark nullifier as used
8. Emit VoteSubmitted event

**Authority and state semantics:** the deployment owner is permanently an authorized coordinator (there is no ownership-transfer function and the owner cannot remove itself). Any authorized coordinator can create a voteId, accept an arbitrary root, close voting, register the dummy flag and relay votes. `closeVoting` has no deadline, quorum or minimum-count check, so a coordinator can close a vote early and irreversibly. `updateRoot` does not validate that a root came from the snapshot (and does not reject zero); every accepted historical root remains valid because there is no revocation function. The verifier address is checked for nonzero at construction, not for code identity or correspondence to the published circuit.

**On-chain vote data:** `submitVote` calldata contains the Groth16 proof and all eight public signals: merkleRoot, voterID, nullifier, encryptedVotesHash, voteId, pubkeyCommitment, chainId and voteHash. It does not contain the participant EOA, plaintext choice or individual ciphertext coordinates. `VoteSubmitted` emits voterID, nullifier, encryptedVotesHash and voteHash.

**Dummy-registration scope:** `registerDummyVotes` accepts any `uint256[]`, including an empty array, after closure. It emits the supplied hashes and sets `dummyRegistered[voteId] = true`; it does not validate count, hash contents, zero-weight encryption or correspondence to the tally batch.

### TallyContract

```solidity
// Immutable references
ITallyVerifier public immutable verifier;
address public immutable votingContract;

// Access control
address public owner;
mapping(address => bool) public coordinators;

// State
mapping(uint256 => uint256) public tallyResultYes;
mapping(uint256 => uint256) public tallyResultNo;
mapping(uint256 => uint256) public tallyResultAbstain;
mapping(uint256 => bool) public tallyFinalized;
uint256 public coordinatorPubkeyX;
uint256 public coordinatorPubkeyY;
```

**finalizeTally checks**:
0. Caller is an authorized coordinator (`onlyCoordinator` modifier)
1. Not already finalized for this caller-supplied voteId
2. VotingContract: `isVotingClosed(voteId)` = true
3. VotingContract: `isDummyRegistered(voteId)` = true (a boolean only; padding contents/count are not checked here)
4. `coordinatorPubkey` signals equal the constructor-configured coordinates
5. Tally proof verification
6. Store `publicSignals[13..15]` verbatim and emit `TallyFinalized`

The contract does not check voteId/deployment binding, a canonical tally range, subgroup-order uniqueness, snapshot total weight or `yes + no + abstain`. It also does not validate that the configured verifier/VotingContract addresses contain the expected code. These are current trust/proof boundaries, not properties supplied by per-voteId storage.

---

# 16. Server Roles (7)

| # | Role | Key Operation |
|---|------|---------------|
| 1 | Snapshot management | Per-voteId EOA → weight registration and lookup |
| 2 | Active vote management | `active_votes` table, closedAt tracking |
| 3 | Leaf admission + Merkle tree management | Admission token issue/verify, `leaf_data` storage, root on-chain update (per voteId) |
| 4 | Merkle proof serving | Return registration-time proof data |
| 5 | Proof reception + gas-subsidized submission | `publicSignals[3]` binding check, submitVote, permits storage |
| 6 | Tally aggregation | encryptedBatchHash + proof → finalizeTally |
| 7 | Coordinator key management | Privkey held server-side, pubkey served to clients |

---

# 17. Security

### 17.1 Applied Security Measures

| Category | Measure | Location |
|----------|---------|----------|
| Eligibility gating | Leaf admission token (HMAC-SHA256, TTL, single-use jti, constant-time compare) + registration cap | `voter.js`, `voter_demo.js` |
| Eligibility gating | `LEAF_TOKEN_SECRET` required at startup (fail-fast) | `voter.js`, `voter_demo.js` |
| Proof–data binding | Server recomputes ciphertext Poseidon hash and matches `publicSignals[3]` before submission | `voter.js`, `voter_demo.js` `/submit-vote` |
| Race condition | Poseidon initialization Promise | `voter.js`, `voter_demo.js` |
| Race condition | voteId-based leaf mutex (`leafLocks`) | `voter.js`, `voter_demo.js` |
| Chain/DB ordering | On-chain first, DB second; not cross-system atomic | `voter.js` `/leaf`, `/submit-vote` |
| SQLite atomicity | Related DB writes wrapped in one local SQLite transaction | `voter.js` `/leaf`, `/submit-vote` |
| Recoverability | Recovery JSONL when DB write fails after on-chain success | `voter.js`, `voter_demo.js` `/submit-vote` |
| Auditability | Leaf registration audit log (JSONL for outcomes that reach the registration handler; malformed requests return earlier) | `voter.js`, `voter_demo.js` `/leaf` |
| Access control | Deployment-wide Basic Auth when `BASIC_AUTH_PASSWORD` is non-empty | `server.js`, `server_demo.js` |
| Access control | `INTERNAL_API_TOKEN` for `/cleanup-locks` | `voter.js`, `voter_demo.js` |
| Input validation | Leaf format (`0x` + 64 hex) | `voter.js`, `voter_demo.js` |
| Input validation | EOA format (`0x` + 40 hex) | `voter.js`, `voter_demo.js` |
| Input validation | encryptedVotes structure (3×2×2 decimal strings) | `voter.js`, `voter_demo.js` |
| Input validation | Ciphertext point validation: canonical range, on-curve, prime-order subgroup, non-identity `C1` (mitigation; regression tests in `test/`) | `src/lib/ciphertextValidation.js` |
| Rate limiting | Keyed by real client IP: `trust proxy = loopback`, `CF-Connecting-IP` honored only when the TCP peer is the local tunnel | `src/lib/clientIp.js`, `server.js`, `server_demo.js` |
| Rate limiting | Global: 100 req/min, applied before authentication | `server.js`, `server_demo.js` |
| Rate limiting | Authentication failures: 10 per 15 min per client (counts 401 responses only) | `server.js`, `server_demo.js` |
| Rate limiting | `/leaf`: 20 req/min | `server.js`, `server_demo.js` |
| Rate limiting | `/submit-vote`: 20 req/min | `server.js`, `server_demo.js` |
| Body size | 1MB limit (`express.json`) | `server.js`, `server_demo.js` |
| Error hygiene | 500 responses carry a generic message; details go to server logs only | `voter.js`, `voter_demo.js` |
| Supply chain | Browser prover loads the pinned local snarkjs build (`/vendor/snarkjs.min.js` from `node_modules`, exact version in `package.json`) instead of a CDN | `server.js`, `server_demo.js`, `public/index*.html` |
| Key protection | Coordinator privkey excluded from tally_input.json | `tally.js`, `tally_demo.js` |
| Key protection | `coordinator_key.json` gitignored | `.gitignore` |
| Duplicate prevention | Nullifier check (DB + on-chain, per voteId) | `voter.js`, `/submit-vote` |
| DB integrity | `encryptedVotesHash` recalculation during tally | `tally.js`, `tally_demo.js` |

Rate-limiter notes: the `RateLimit-*` response headers reflect the last limiter applied to the request (the authentication-failure limiter when Basic Auth is enabled), not the global one. Limiters count a request on arrival and only subtract it afterwards if it succeeded, so a client that has exhausted its failure allowance is rejected for the rest of the window even with correct credentials.

### 17.2 Cryptographic Notes

- **Twisted Edwards curve**: Point negation on BabyJubJub is `(-x, y)`, NOT `(x, -y)`. This affects `bsgs.js` and `elgamal.js` decryption.
- **Deterministic keypair**: All voter secrets derive from a single MetaMask signature via `keccak256`. Same signature always produces the same leaf, preventing accidental duplicate registrations.
- **ElGamal randomness**: Each encryption uses a fresh random `r`. The voter could reveal `r` to prove their vote (not receipt-free — an intentional scope decision).

### 17.3 Proof Scope

This section replaces the former "Known Limitations" list. It is the precise statement of what each proof constrains — the boundary between "cryptographically enforced" and "server-enforced or assumed".

**Vote proof (vote.circom) — proven:**

| Property | Enforced by |
|----------|-------------|
| The leaf is a member of the Merkle tree under a root the contract accepts | Circuit + contract `validRoots` check |
| The leaf internally commits to the voter's BabyJubJub pubkey and to `(weight, secret_weight)` | Circuit |
| `voterID` and `nullifier` are correctly derived **from the supplied secrets**, and each nullifier is spendable only once per voteId | Circuit + contract nullifier mapping |
| The ciphertexts the tally will use are the ones the proof committed to (`encryptedVotesHash = publicSignals[3]`) | Circuit + server-side hash recomputation |
| The submission is authorized by the leaf's key (EdDSA over voteHash, which binds voteId and chainId) | Circuit |

**Vote proof — NOT proven (a malicious client with a modified prover can violate these):**

| Property | Current gap | Planned direction (no date/commitment) |
|----------|-------------|----------------------------------------|
| One vote per voter | `secret_nullifier` is an unconstrained private input — the circuit does not bind it to the leaf or key. A standard client derives it deterministically, but a modified client can choose fresh nullifiers | Vote-circuit revision: derive the nullifier uniquely from leaf-bound key material and vote/deployment domain (v5 direction) |
| Ciphertexts are well-formed ElGamal encryptions | Point validity is not constrained in circuit. The server rejects off-curve, small-subgroup, non-canonical and identity-`C1` points before relaying — an honest-server mitigation only | Constrain ElGamal point construction/equations in the vote circuit (v5 direction) |
| Each plaintext is in `{0, weight}` | Not constrained | Range/choice constraints in the vote-circuit revision (v5 direction) |
| Exactly one choice carries the full weight | Not constrained; splitting, negative/overflow encodings and unused/excess weight are possible | One constrained choice drives all three plaintexts (v5 direction) |
| The committed `weight` equals the snapshot weight for an EOA the caller owns | The server does not verify EOA ownership, and the circuit does not bind `weightCommit` to the snapshot entry | Authenticated once-per-EOA server admission, followed by circuit-level eligibility/weight binding (near-term + v5 directions) |
| One leaf per eligible voter | Total cap + bearer admission token only; neither identity ownership nor one-leaf-per-EOA is enforced | Durable authenticated admission, then cryptographic identity/eligibility binding (near-term + v5 directions) |

**Tally proof (tally.circom) — proven:**

| Property | Enforced by |
|----------|-------------|
| For the private batch of 100 ciphertext sets: the chained Poseidon hash equals `encryptedBatchHash` | Circuit |
| `aggregatedCiphertext` is the homomorphic sum of that batch | Circuit |
| Each `tallyResult` scalar maps to the decrypted aggregate group element under `coordinatorPubkey` | Circuit |

**Tally proof — NOT proven:**

| Property | Current gap | Planned direction (no date/commitment) |
|----------|-------------|----------------------------------------|
| The batch equals the canonical set of on-chain submitted votes | `encryptedBatchHash` is not reconstructed from `VoteSubmitted`/dummy events; the coordinator chooses the private batch | VoteId-specific canonical submitted-set commitment, including canonical dummy handling (v5 direction) |
| The proof/result is bound to a specific voteId and deployment | voteId, chainId and contract identity are absent; per-key storage does not stop proof replay to another eligible voteId/deployment | Add voteId and deployment domain to tally public inputs and contract checks (v6 direction) |
| The published tally is the unique canonical integer in the supported range | The circuit checks group-element equality but no BabyJub subgroup-order/canonical tally bound; the contract stores the three signals without range or sum checks | Strict scalar representation plus per-result/total bounds tied to the vote's weight policy (v6 direction) |
| The coordinator decrypted only the aggregate | Unprovable under single-key ElGamal | Threshold decryption so no single keyholder can decrypt a ballot (v6 direction) |

Consequences, stated plainly: a **malicious voter** with a modified client could vote repeatedly from one leaf or submit valid-point ciphertexts encoding values the vote proof does not constrain. A **malicious coordinator** could admit arbitrary roots, close early, choose a different batch, replay a tally proof to another eligible voteId, publish a non-canonical scalar representative, or decrypt individual ciphertexts. The system demonstrates the honest-participant flow end-to-end and makes computation verifiable only within the group/circuit statement above. The direction is vote-circuit integrity and canonical batch binding (v5), then tally domain/range binding and threshold decryption (v6); these are directions rather than delivery promises.

### 17.4 Trust Assumptions

1. **Single coordinator holds the ElGamal key** — could decrypt individual ciphertexts (norm, not enforcement; threshold ElGamal planned)
2. **Server sees registration sessions and EOA records** — could correlate EOA↔leaf via snapshot data, timing/IP/token issuance and logs (§11)
3. **Relayer submission** — the coordinator can censor votes by refusing to relay them (on-chain evidence of inclusion exists only for votes it submits)
4. **Coordinator lifecycle/root authority** — any authorized coordinator can accept arbitrary roots, close a vote early and irreversibly, and set the dummy-registration flag with unvalidated hashes; accepted historical roots are not revocable
5. **Permanent owner authority** — the deployment owner is an unremovable coordinator and there is no ownership-transfer function
6. **Deployment correspondence** — constructor addresses/coordinates are not checked against published code, curve membership or artifact hashes; correspondence is established by external provenance/rebuild checks
7. **Trusted setup** — both zkeys were produced with a **single phase-2 contribution** by the author (verifiable from the zkey files; see `PROVENANCE.md`). Soundness rests on that contribution's toxic waste being discarded
8. **Not receipt-free** — a voter can prove their vote by recording and revealing ElGamal randomness (intentional scope decision)

### 17.5 Selected Implementation Issues

The items below are an operational subset, not an exhaustive roadmap. The proof/trust gaps that affect security claims are stated in §17.3–§17.4. At the 2026-08-26 publication-preparation snapshot, the local Product database had no open vote.

- Leaf token single-use set is in-memory (a server restart clears used-`jti` records until token expiry; the registration cap still bounds total leaves)
- `leafLocks` has no TTL — locks accumulate if finalize is not called
- No graceful shutdown handlers (SIGTERM/SIGINT); DB connections not explicitly closed on shutdown
- Error response format is not fully standardized
- Snapshot weights are not validated as positive integers within the BSGS-recoverable range (§9 Step 6) at snapshot creation time
- Product can accept more than 100 real permits; `finalize` detects this only after on-chain closure and then cannot tally that voteId
- Fresh clones do not contain the ignored `tally_outputs/product` and `tally_outputs/demo` directories; operators must create them before running the tally scripts

**Resolved in the 2026-08-25 server hardening pass** (previously listed here as deferred): Cloudflare-aware rate limiting keyed by the real client IP; throttling of authentication failures; generic 500 responses instead of echoing internal error strings; snarkjs served from the pinned local build instead of a CDN; the exactly-100-votes finalize case (§8); server-side ciphertext point validation (§7, §17.3 — mitigation only); `package.json` license field corrected to GPL-3.0-only. Verified with a full demo lifecycle on Sepolia after the changes.

**Added 2026-08-27 (voteId reuse guard):** on-chain voteId state is permanent (`validVoteIds`, `votingClosed`, `dummyRegistered`, `validRoots`, `tallyFinalized` are never reset), so after a DB re-initialization an old id could previously be adopted silently by the snapshot scripts and driven to a meaningless finalized tally. Now `createSnapshot*.js` refuse an on-chain voteId unknown to the local DB (explicit `--adopt` attaches OPEN ids only, after reading closed/dummy/finalized state) and check the DB `closedAt` before sending `createVoteId`; `finalize*.js` refuse ids missing from `active_votes`, already-finalized ids, and a closed-on-chain/open-in-DB mismatch (printing the manual recovery SQL); `tally*.js` and `submitTally*.js` refuse already-finalized ids; `scripts/listVoteIds.js` lists every on-chain voteId with its state and `VoteSubmitted` count (read-only, cached under `cache/`).
