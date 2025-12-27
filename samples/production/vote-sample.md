# Production Vote Submission Sample

**Environment:** Production assumptions  
**Network:** Ethereum Sepolia  
**Vote session:** voteId = 11

---

## Transaction

| Field | Value |
|-------|-------|
| Type | Vote submission |
| Status | Success |
| Tx hash | `0x6ecc43b1d3be6a4308cc160d3fe490e7b50dada5b844e9f0f3ffc4636d1bad9d` |
| Block | `9923666` |
| Explorer | [View on Etherscan](<https://sepolia.etherscan.io/tx/0x6ecc43b1d3be6a4308cc160d3fe490e7b50dada5b844e9f0f3ffc4636d1bad9d) |

---

## Contract

| Field | Value |
|-------|-------|
| VotingContract | `0xdd200F4cb1f559D6c3FC76752B9e6221e32254e1` |

---

## What this demonstrates

- Vote validity enforced via on-chain ZK proof verification
- Vote-scoped nullifier prevents double voting
- Voter identity remains unlinkable to the submitted vote
- Encrypted vote content is not revealed

---

## Verification steps

1. Open the transaction in the explorer
2. Confirm status is **Success**
3. Check for `VoteSubmitted` event in logs
4. Verify nullifier is unique for this voteId