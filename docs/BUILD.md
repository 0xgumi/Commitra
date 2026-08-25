# Build & Reproduction

How to build the client, run the server, recompile the circuits, and check the published artifacts against the deployed system.

---

## Toolchain

| Tool | Version |
|------|---------|
| Node.js | 18 (`.nvmrc`) |
| circom | 2.1.4 (circuit pragma) |
| snarkjs | 0.6.x (`package.json`) |
| circomlib | 2.0.5 (npm dependency, GPL-3.0) |

```bash
npm install
npm test          # regression tests (ciphertext point validation)
```

---

## Frontend

```bash
npm run build        # Product bundle  → public/dist/bundle.js
npm run build:demo   # Demo bundle     → public/dist/bundle_demo.js
```

Vite configs: `vite.config.mjs`, `vite.config.demo.mjs`. The client loads `public/vote.wasm` and `public/vote_final.zkey` for browser-side proving — verify them against [`PROVENANCE.md`](PROVENANCE.md) hashes.

---

## Server

```bash
node src/db/init.js       # initialize SQLite DB (Product; init_demo.js for Demo)
node src/server.js        # Product server, port 3000 (server_demo.js → port 4000)
```

Required environment (`.env` / `.env.demo` — names only, set your own values): `RPC_URL`, `OWNER_PRIVATE_KEY`, `COORDINATOR_PRIVATE_KEYS`, `VOTING_CONTRACT_ADDRESS`, `TALLY_CONTRACT_ADDRESS`, `COORDINATOR_PUBKEY`, `LEAF_TOKEN_SECRET`, `INTERNAL_API_TOKEN`, `BASIC_AUTH_PASSWORD` (optional). Tallying additionally needs `COORDINATOR_PRIVKEY` in `.env.tally`.

Full lifecycle operation (snapshot → votes → finalize → tally → submit): step-by-step guides in [`../usage/`](../usage/).

---

## Circuits

Recompile (from the repository root — the `-l .` flag is required because the circuits' `include` paths are `node_modules/circomlib/...`, resolved relative to the link path, not the circuit file's directory):

```bash
circom circuits/vote/vote.circom  --r1cs --wasm -l . -o build/vote
circom circuits/tally/tally.circom --r1cs --wasm -l . -o build/tally
```

Notes:

- The `include` paths resolve against `node_modules/circomlib` (installed by `npm install`)
- Byte-identical `.wasm` output requires the same circom version (2.1.4); with a different version, compare circuits at the constraint level instead
- Tally circuit is compiled for a fixed batch of `nVoters = 100` (~101k constraints, 2^19 powers-of-tau)

**Proving keys are not reproducible** — they contain contribution randomness. Do not expect to regenerate `vote_final.zkey` / `tally_final.zkey`; verify them against the hashes and the contribution record instead ([`PROVENANCE.md`](PROVENANCE.md)).

---

## Checking the deployed verifiers

To confirm the on-chain verifiers correspond to these circuits and zkeys:

```bash
snarkjs zkey export verificationkey vote_final.zkey vote_vkey.json
snarkjs zkey export solidityverifier vote_final.zkey voteVerifier.sol
# likewise for tally_final.zkey
```

Compare the generated verifier against [`../contracts/voteVerifier.sol`](../contracts/voteVerifier.sol) / [`../contracts/tallyVerifier.sol`](../contracts/tallyVerifier.sol), and against the bytecode deployed at the verifier addresses (readable via each main contract's `verifier()` view; addresses in the [README](../README.md#deployments-ethereum-sepolia)).

Note: a regenerated verifier may differ from the committed file in the `pragma solidity` line (snarkjs stamps the version for its own release), so compare the verification-key constants and logic — or the compiled bytecode — rather than expecting a byte-identical `.sol` file.

---

## What "reproduced" means here

Rebuilding gives you: the same circuits (constraint-identical), the same verifier contracts, and a working local deployment of the full flow. It does not give you the same proving keys (single-contribution setup — see [`PROVENANCE.md`](PROVENANCE.md)) and it does not change any trust assumption documented in [`threat-model.md`](threat-model.md).
