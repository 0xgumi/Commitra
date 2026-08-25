# ZK Voting System — Architecture (Revision 19)

Written: 2026-08-24 | Version: Revision 19 | Status: **v1.5 implementation reference (with v2 server hardening)**

Revision 19 reflects the current codebase: the v1.5 protocol plus the v2 server-side hardening pass (leaf admission tokens, server-side proof-hash verification, transactional persistence, recovery logging). This document covers the **protocol specification** — cryptographic flow, circuit details, contract internals, privacy model, and security posture.

Two things this document is explicit about, throughout:

1. **What the ZK proofs actually prove — and what they do not.** See §17.3 (Proof Scope).
2. **Which privacy properties hold against which observer.** Unlinkability claims in this document are stated **relative to a chain observer** (someone reading the public blockchain). The server/coordinator occupies a strictly stronger position; §11 and §17.4 spell out what it could learn.

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
Phase 1 — Registration (EOA auth → admission token → secrets generation → leaf registration)
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

The Demo is an **honest-client flow demonstration**, not an adversarially secure election. Everything in this document describes the Product flow; Demo differences are limited to eligibility as above.

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

### Step 1 — voteId Selection + EOA Authentication

- User selects active voteId from dropdown
- Signs message via MetaMask: `"zkVote | voteId=1"`
- `seedMaster = keccak256(toUtf8Bytes(signature))` — signature is a hex string; `toUtf8Bytes` encodes it as UTF-8 characters (NOT raw bytes), then hashed
- Server looks up weight by **voteId + EOA** (`POST /weight`)
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
- Server: verifies the admission token, checks the registration cap, saves leaf to DB, rebuilds Merkle tree
- Server: calls on-chain `VotingContract.updateRoot(voteId, root)`
- Server → Browser: `{ root, pathElements, pathIndices, txHash }`
- Browser: waits for on-chain confirmation via txHash

**Leaf admission token** (server hardening, v2):

- Issued by `POST /weight` only after the EOA passes the snapshot check for that voteId
- Format: `base64url(payload).base64url(HMAC-SHA256(payload, LEAF_TOKEN_SECRET))` with payload `{ voteId, jti, exp }`
- TTL: `LEAF_TOKEN_TTL_SEC` (default 600 s); `jti` is single-use (constant-time signature comparison; used-`jti` set held in memory)
- **Deliberately does not encode the EOA or the leaf.** Binding the token to an EOA would store an EOA↔leaf link server-side, which the design avoids. The trade-off is stated honestly: the token proves "some snapshot-listed EOA recently passed the `/weight` check for this voteId", not "this leaf belongs to that EOA". It is an **admission-rate mitigation, not a cryptographic eligibility proof** — circuit-level binding of leaf to snapshot is future work (see §17.3)
- **Registration cap**: new leaves are rejected once the leaf count reaches the snapshot size for the voteId (Demo: hard cap of 80)
- All `/leaf` outcomes (registered / already-registered / rejected + reason) are appended to an audit log (`recovery_logs/leaf_audit_*.jsonl`)
- The server refuses to start if `LEAF_TOKEN_SECRET` is unset (fail-fast)

**Atomicity**: On-chain transaction executes first; DB save (single SQLite transaction) only on success (prevents DB-onchain inconsistency).

**Concurrency**: voteId-based mutex (`leafLocks` Map) prevents duplicate leafIndex assignment from concurrent requests.

### Step 5 — voterID, nullifier Generation (browser)

- `voterID = Poseidon(voteId, pubkeyCommit, secret_voterid)`
- `nullifier = Poseidon(secret_nullifier, voteId)`

**Privacy after this point — stated precisely:** The server stores the leaf **without** the EOA; no persisted record links them, and nothing on-chain ever does. However, the server could correlate EOA↔leaf at registration time through side channels it necessarily observes — the `/weight` (EOA) and `/leaf` (leaf) calls arrive on the same session within the token TTL, with matching timing and source address. The unlinkability guarantee is therefore **against chain observers**; against the server itself it is a data-minimization practice, not a cryptographic guarantee.

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
- **On-chain first, DB second**: ensures atomicity
- **Recovery logging (v2)**: if the DB write fails *after* the on-chain transaction succeeded, the full submission (voteId, nullifier, txHash, ciphertexts, hash) is appended to `recovery_logs/submit_vote_recovery_*.jsonl` and the client receives an explicit error. The on-chain nullifier is already consumed at that point; the recovery log is the manual re-insertion path

---

# 8. Phase 4 — Finalize

`finalize.js` performs the following:

### Step 1 — closeVoting

- Calls on-chain `VotingContract.closeVoting(voteId)`
- Voting is disabled for this voteId afterward

### Step 2 — active_votes Update

- Sets `closedAt` in DB `active_votes` table
- Excluded from `/active-votes` API

### Step 3 — Dummy Vote Generation

- Queries current permit count
- If < 100, generates dummies (r=1, weight=0, all 3 choices encrypt to zero)
- Calls on-chain `registerDummyVotes(voteId, dummyHashes)`
- Inserts dummy permits into DB

**The tally circuit is compiled for n=100, so exactly 100 permits are always required.**

`registerDummyVotes` is called even when exactly 100 real votes need no padding (with an empty batch), because `finalizeTally` requires the on-chain `dummyRegistered` flag. More than 100 permits is a fail-fast error — the tally circuit cannot process it.

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
- VotingContract state checks: `isVotingClosed`, `isDummyRegistered`
- `coordinatorPubkey` match verification
- Tally proof verification
- Final result recorded on-chain (per voteId)

**Scope note**: `encryptedBatchHash` is a public input of the tally proof, but the contract does **not** reconstruct it from the `VoteSubmitted` / `DummyVotesRegistered` events and compare. The proof therefore binds the result to *a* batch, not to *the* canonical on-chain submitted set. See §17.3.

---

# 10. tally.circom (ZK Proof)

tally.circom proves:

1. `encryptedBatchHash` = Poseidon chain of all `encryptedVotesHashes`
2. `aggregatedCiphertext` = homomorphic sum of all `encryptedVotes`
3. `tallyResult` = correct decryption of `aggregatedCiphertext`
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

**Note**: voteId is not included in the tally circuit's public signals, so the proof itself does not bind the result to a specific vote (the contract's per-voteId storage does, but a proof generated for one batch is not circuit-bound to a voteId). Fixing this requires a tally circuit revision (planned, v6).

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
| weight | Private | ZK-proven (via weightCommit; see §17.3 for scope) |
| secret_weight | Private | For weightCommit generation |
| secret_nullifier | Private | For nullifier generation |
| secret_voterid | Private | For voterID generation |
| babyjub_priv | Private | For EdDSA signing |
| EOA | Never on-chain | Not stored with the leaf; server-side link is severed **in storage** after registration |

### What the server could still learn

- **EOA↔leaf correlation at registration time**: `/weight` (EOA) and `/leaf` (leaf) arrive on the same session within the token TTL. The server does not persist this correlation, but a logging or a malicious server could. This is a data-minimization practice, not a cryptographic guarantee.
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
- `leaf_data` does not store EOA — no persisted EOA↔leaf link (see §11 for the runtime caveat)
- Same EOA can vote in different voteIds (nullifier is voteId-specific)
- `root_history` has `UNIQUE(voteId, root)` — required for `INSERT OR IGNORE` in voter.js
- Product uses `src/db/voting.db`, Demo uses `src/db/voting_demo.db`

**Append-only operational logs** (filesystem, not DB): `recovery_logs/submit_vote_recovery_*.jsonl` (on-chain-succeeded-but-DB-failed submissions), `recovery_logs/leaf_audit_*.jsonl` (all leaf registration attempts and outcomes).

---

# 13. API Endpoints

All endpoints below are under the `/voter` prefix, except `/health` which is registered at the app root level.

| Method | Endpoint | Description | Validation |
|--------|----------|-------------|------------|
| GET | /active-votes | List active (unclosed) votes | — |
| GET | /vote-info/:voteId | Vote details (voterCount, totalWeight) | — |
| POST | /weight | `{ voteId, eoa }` → weight + `leafAdmissionToken` | EOA format (`0x` + 40 hex); snapshot membership |
| POST | /leaf | `{ voteId, leaf, leafAdmissionToken }` → Merkle proof registration/return | Leaf format (`0x` + 64 hex); admission token (HMAC, TTL, single-use); registration cap |
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
| Leaf registration | None (DB only) | Server |
| updateRoot() | Yes | Server (Coordinator) |
| submitVote() | Yes (ZK verify) | Server (Coordinator) |
| closeVoting() | Yes | Server (Coordinator) |
| registerDummyVotes() | Yes | Server (Coordinator) |
| finalizeTally() | Yes | Server (Coordinator) |
| voterID generation | None | Browser |
| Proof generation | None | Browser |

**User gas cost = 0**

The voter's EOA never submits an on-chain transaction. All gas is paid by the coordinator wallets.

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
1. chainId match
2. voteId valid
3. voting not closed
4. merkleRoot in validRoots[voteId]
5. nullifier not in nullifiers[voteId]
6. Groth16 proof verification
7. Mark nullifier as used
8. Emit VoteSubmitted event

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
1. Not already finalized for this voteId
2. VotingContract: `isVotingClosed(voteId)` = true
3. VotingContract: `isDummyRegistered(voteId)` = true
4. `coordinatorPubkey` matches stored values
5. Tally proof verification
6. Store results and emit `TallyFinalized` event

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
| Atomicity | On-chain first, DB second | `voter.js` `/leaf`, `/submit-vote` |
| Atomicity | DB writes wrapped in single SQLite transactions | `voter.js` `/leaf`, `/submit-vote` |
| Recoverability | Recovery JSONL when DB write fails after on-chain success | `voter.js`, `voter_demo.js` `/submit-vote` |
| Auditability | Leaf registration audit log (JSONL, all outcomes) | `voter.js`, `voter_demo.js` `/leaf` |
| Access control | Basic Auth (password from .env) | `server.js`, `server_demo.js` |
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

| Property | Current status |
|----------|----------------|
| One vote per voter | Not constrained. `secret_nullifier` is an unconstrained private input — the circuit does not bind it to the leaf or the voter's key. A standard client derives it deterministically (honest re-votes are rejected), but a modified client can pick a fresh `secret_nullifier` per submission and vote repeatedly from the same leaf |
| Ciphertexts are well-formed ElGamal encryptions (valid curve points, prime-order subgroup, non-identity C1) | Not constrained in circuit. The server rejects off-curve, small-subgroup, non-canonical and identity-`C1` points before relaying (§7) — a mitigation that depends on the server being honest, not a proof |
| Each plaintext is in `{0, weight}` | Not constrained |
| Exactly one choice carries the full weight (no weight splitting, no negative/overflow encodings) | Not constrained |
| The committed `weight` equals the snapshot weight for an eligible EOA | Not circuit-bound. The leaf admission token gates *who can register a leaf* (server-enforced), but nothing cryptographically ties `weightCommit` to the snapshot entry |
| One leaf per eligible voter | Server-enforced via cap + token; not cryptographically bound to identity |

**Tally proof (tally.circom) — proven:**

| Property | Enforced by |
|----------|-------------|
| For the private batch of 100 ciphertext sets: the chained Poseidon hash equals `encryptedBatchHash` | Circuit |
| `aggregatedCiphertext` is the homomorphic sum of that batch | Circuit |
| `tallyResult` is the correct decryption of the aggregate under `coordinatorPubkey` | Circuit |

**Tally proof — NOT proven:**

| Property | Current status |
|----------|----------------|
| The batch equals the canonical set of on-chain submitted votes | `encryptedBatchHash` is not reconstructed on-chain from `VoteSubmitted` events; the coordinator chooses the batch |
| The result is bound to a specific voteId inside the proof | voteId absent from tally public signals (contract storage provides per-voteId separation only) |
| The coordinator decrypted only the aggregate | Unprovable under single-key ElGamal; trust assumption (§17.4) |

Consequences, stated plainly: a **malicious voter** with a modified client could vote multiple times from one leaf (fresh nullifiers), or submit ciphertexts that pass the vote proof yet corrupt the aggregate (out-of-range plaintexts; invalid points are now rejected by the server, which only helps while the server is honest); a **malicious coordinator** could tally a different batch than the submitted set, and could decrypt individual ciphertexts. The system as implemented demonstrates the honest-participant flow end-to-end and makes coordinator *computation* verifiable within the scope above — it does not yet remove these trust assumptions. Circuit-level fixes (ciphertext well-formedness, snapshot binding, batch binding, threshold decryption) are the planned v5/v6 upgrades and each requires a new trusted setup ceremony.

### 17.4 Trust Assumptions

1. **Single coordinator holds the ElGamal key** — could decrypt individual ciphertexts (norm, not enforcement; threshold ElGamal planned)
2. **Server sees registration sessions** — could correlate EOA↔leaf via timing/IP/token issuance despite not persisting the link (§11)
3. **Relayer submission** — the coordinator can censor votes by refusing to relay them (on-chain evidence of inclusion exists only for votes it submits)
4. **Trusted setup** — both zkeys were produced with a **single phase-2 contribution** by the author (verifiable from the zkey files; see `PROVENANCE.md`). Soundness rests on that contribution's toxic waste being discarded
5. **Not receipt-free** — a voter can prove their vote by revealing ElGamal randomness (intentional scope decision)

### 17.5 Known Implementation Issues (tracked)

None affects the honesty of the claims above, and the Product deployment carries no live votes. Listed for completeness:

- Leaf token single-use set is in-memory (a server restart clears used-`jti` records until token expiry; the registration cap still bounds total leaves)
- `leafLocks` has no TTL — locks accumulate if finalize is not called
- No graceful shutdown handlers (SIGTERM/SIGINT); DB connections not explicitly closed on shutdown
- Error response format is not fully standardized
- Snapshot weights are not validated as positive integers within the BSGS-recoverable range (§9 Step 6) at snapshot creation time

**Resolved in the 2026-08-25 server hardening pass** (previously listed here as deferred): Cloudflare-aware rate limiting keyed by the real client IP; throttling of authentication failures; generic 500 responses instead of echoing internal error strings; snarkjs served from the pinned local build instead of a CDN; the exactly-100-votes finalize case (§8); server-side ciphertext point validation (§7, §17.3 — mitigation only); `package.json` license field corrected to GPL-3.0-only. Verified with a full demo lifecycle on Sepolia after the changes.
