# Product Configuration — Operating Guide

Step-by-step guide for running the closed-snapshot (Product) configuration: a predefined EOA → weight list, port 3000, `src/db/voting.db`.

**External access** (optional): any HTTPS reverse proxy / tunnel in front of port 3000. Access control is HTTP Basic Auth via `BASIC_AUTH_PASSWORD`.

---

## 0. Environment variables

Set in `.env`:

```bash
BASIC_AUTH_PASSWORD=yourpassword
INTERNAL_API_TOKEN=yourtoken
LEAF_TOKEN_SECRET=your_random_secret
# optional (default: 600 seconds = 10 minutes)
# LEAF_TOKEN_TTL_SEC=600
```

- `BASIC_AUTH_PASSWORD`: access password (empty disables Basic Auth)
- `INTERNAL_API_TOKEN`: used by the finalize script to call `/voter/cleanup-locks`
- `LEAF_TOKEN_SECRET`: HMAC key for `leafAdmissionToken` (**required** — server refuses to start without it)
- `LEAF_TOKEN_TTL_SEC`: admission token TTL in seconds (default 600)

Also required (see `docs/BUILD.md`): `RPC_URL`, `OWNER_PRIVATE_KEY`, `COORDINATOR_PRIVATE_KEYS`, `VOTING_CONTRACT_ADDRESS`, `TALLY_CONTRACT_ADDRESS`, `COORDINATOR_PUBKEY`; for tallying, `COORDINATOR_PRIVKEY` in `.env.tally`.

Notes:

- The browser flow (Connect Wallet → Register & Generate Credentials → Submit) handles the admission token automatically: `/weight` returns `leafAdmissionToken`, and the client includes it in `/leaf`
- When calling the API directly (curl etc.), you must include `leafAdmissionToken` in the `/leaf` body yourself

---

## 1. Initialize the database

```bash
rm src/db/voting.db
node src/db/init.js
```

> ⚠️ Deleting the DB does **not** reset on-chain state — voteIds, valid roots, and used nullifiers persist in the contracts. After a DB reset, use fresh voteIds (or fresh contract deployments); reusing an old voteId against a wiped DB will desync server and chain.

## 2. Create snapshots (per voteId)

The snapshot JSON defines the voter list and weights (format: `docs/REVISION19.md` §3):

```bash
node scripts/createSnapshot.js snapshots/vote1.json
```

## 3. Register coordinators on-chain (with the server stopped)

```bash
node scripts/setup.js
```

## 4. Build the client (after changes)

```bash
npm run build
```

## 5. Run the server

```bash
node src/server.js
# → http://localhost:3000
# optional: put your HTTPS tunnel/proxy in front for external access
```

## 6. Close voting + register dummy padding (per voteId)

```bash
node scripts/finalize.js 1
```

## 7. Compute tally + generate proof (per voteId)

```bash
node src/lib/tally.js 1
```

## 8. Submit tally on-chain (per voteId)

```bash
node src/lib/submitTally.js 1
```

---

## Full flow (single vote, voteId=1)

```bash
# one-time setup
rm src/db/voting.db
node src/db/init.js
node scripts/setup.js

# create the vote
node scripts/createSnapshot.js snapshots/vote1.json

# build & run
npm run build
node src/server.js

# (voters vote in the browser...)

# close & tally
node scripts/finalize.js 1
node src/lib/tally.js 1
node src/lib/submitTally.js 1
```
