# Build & Reproduction

How to build the client, run the server, recompile the circuits, and check the published artifacts against the deployed system.

Run every command in this document from the repository root. The dotenv file names and the build/output paths below are resolved relative to the current working directory.

---

## Toolchain

| Tool | Version |
|------|---------|
| Node.js | 18 (`.nvmrc`) |
| circom | 2.1.4 (circuit pragma) |
| snarkjs | 0.6.11 (`package.json`) |
| circomlib | 2.0.5 (npm dependency, GPL-3.0) |

```bash
npm ci
npm test          # regression tests (ciphertext point validation)
```

`npm ci` runs dependency install scripts. `better-sqlite3` uses a prebuilt binary when available and otherwise falls back to `node-gyp`; `blake-hash` has no `darwin-arm64` prebuild and compiles with `node-gyp` on Apple Silicon; `esbuild` runs its postinstall binary check. A working C/C++ toolchain may therefore be required. npm may also report vulnerabilities in transitive dependencies; the install summary alone does not identify them as direct-dependency findings.

---

## Frontend

```bash
npm run build        # Product bundle  → public/dist/bundle.js
npm run build:demo   # Demo bundle     → public/dist/bundle_demo.js
npm run build:all    # Product, then Demo
```

Vite configs: `vite.config.mjs`, `vite.config.demo.mjs`. Both use `public/dist` as `outDir` with `emptyOutDir: false`, so Vite may warn that `publicDir` and `outDir` overlap; this is expected here. Alongside the two bundles, the build copies `index*.html`, `vote.wasm`, and `vote_final.zkey` from `public/` into `public/dist/`. The browser loads the source artifacts from `public/`; verify them against [`PROVENANCE.md`](PROVENANCE.md) hashes.

---

## Server

```bash
node src/db/init.js       # initialize SQLite DB (Product; init_demo.js for Demo)
node src/server.js        # Product server, port 3000 (server_demo.js → port 4000)
```

Required environment (`.env` / `.env.demo` — names only, set your own values): `RPC_URL`, `OWNER_PRIVATE_KEY`, `COORDINATOR_PRIVATE_KEYS`, `VOTING_CONTRACT_ADDRESS`, `TALLY_CONTRACT_ADDRESS`, `COORDINATOR_PUBKEY`, `LEAF_TOKEN_SECRET`, `INTERNAL_API_TOKEN`, `BASIC_AUTH_PASSWORD` (optional).

`LEAF_TOKEN_TTL_SEC` is optional and defaults to 600 seconds.

Tally entrypoints layer environment files without overwriting values loaded earlier. Product loads `.env.tally` first and then obtains remaining RPC/contract/wallet configuration from `.env` through `onchain.js`. Demo loads `.env.demo.tally`, then `.env.demo`, then imports `onchain.js`; the final default `.env` load leaves the already-set Demo values unchanged. The dedicated tally files contain `COORDINATOR_PUBKEY` and `COORDINATOR_PRIVKEY`; the matching server file supplies the remaining variables, including `RPC_URL` and `TALLY_CONTRACT_ADDRESS`.

Before the first tally in a fresh clone, create the ignored output directories:

```bash
mkdir -p tally_outputs/product tally_outputs/demo
```

Download `tally_final.zkey` from the repository's GitHub Release, verify it against the SHA-256 value in [`PROVENANCE.md`](PROVENANCE.md), and place it at `circuits/tally/tally_final.zkey` (gitignored). `src/lib/tally.js` and `src/lib/tally_demo.js` read that exact path.

Full lifecycle operation (snapshot → votes → finalize → tally → submit): step-by-step guides in [`../usage/`](../usage/).

---

## Circuits

Recompile (from the repository root — the `-l .` flag is required because the circuits' `include` paths are `node_modules/circomlib/...`, resolved relative to the link path, not the circuit file's directory):

```bash
mkdir -p build/vote build/tally
circom circuits/vote/vote.circom  --r1cs --wasm -l . -o build/vote
circom circuits/tally/tally.circom --r1cs --wasm -l . -o build/tally
```

Notes:

- The `include` paths resolve against `node_modules/circomlib` (installed by `npm ci`)
- Byte-identical `.wasm` output requires the same circom version (2.1.4); with a different version, compare circuits at the constraint level instead
- Tally circuit is compiled for a fixed batch of `nVoters = 100` (~101k constraints, 2^19 powers-of-tau)

**Proving keys are not reproducible** — they contain contribution randomness. Do not expect to regenerate `vote_final.zkey` / `tally_final.zkey`; verify them against the hashes and the contribution record instead ([`PROVENANCE.md`](PROVENANCE.md)).

---

## Checking the deployed verifiers

To confirm the on-chain verifiers correspond to these circuits and zkeys:

```bash
mkdir -p build/verification
npx snarkjs zkey export verificationkey public/vote_final.zkey build/verification/vote_vkey.json
npx snarkjs zkey export solidityverifier public/vote_final.zkey build/verification/voteVerifier.sol
npx snarkjs zkey export verificationkey circuits/tally/tally_final.zkey build/verification/tally_vkey.json
npx snarkjs zkey export solidityverifier circuits/tally/tally_final.zkey build/verification/tallyVerifier.sol
```

Compare the generated verifier against [`../contracts/voteVerifier.sol`](../contracts/voteVerifier.sol) / [`../contracts/tallyVerifier.sol`](../contracts/tallyVerifier.sol), and against the bytecode deployed at the verifier addresses (readable via each main contract's `verifier()` view; addresses in the [README](../README.md#deployments-ethereum-sepolia)).

Note: a regenerated verifier may differ from the committed file in the `pragma solidity` line (snarkjs stamps the version for its own release), so compare the verification-key constants and logic — or the compiled bytecode — rather than expecting a byte-identical `.sol` file.

---

## What "reproduced" means here

Rebuilding gives you: the same circuits (constraint-identical), the same verifier contracts, and a working local deployment of the full flow. It does not give you the same proving keys (single-contribution setup — see [`PROVENANCE.md`](PROVENANCE.md)) and it does not change any trust assumption documented in [`threat-model.md`](threat-model.md).
