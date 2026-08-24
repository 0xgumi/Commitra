# Demo Configuration — Operating Guide

Step-by-step guide for running the open (Demo) configuration: auto-registration with random weights, port 4000, `src/db/voting_demo.db`.

Demo characteristics:

- New EOAs are auto-registered on first weight request (random weight 1–100)
- Hard cap of 80 voters per voteId
- The UI hides voter count / total weight
- Separate database: `voting_demo.db`

**External access** (optional): any HTTPS reverse proxy / tunnel in front of port 4000. Access control is HTTP Basic Auth via `BASIC_AUTH_PASSWORD` in `.env.demo`.

---

## 0. Environment variables

Set in `.env.demo` (same variables as Product — see `USAGE_PRODUCT.md` §0 and `docs/BUILD.md`):

```bash
BASIC_AUTH_PASSWORD=yourpassword
INTERNAL_API_TOKEN=yourtoken
LEAF_TOKEN_SECRET=your_random_secret
# optional (default: 600 seconds = 10 minutes)
# LEAF_TOKEN_TTL_SEC=600
```

For tallying, `COORDINATOR_PRIVKEY` goes in `.env.demo.tally`.

## 0-1. How the leaf admission token works

The Demo also refuses new `/leaf` registrations without a token:

1. `/weight` returns `weight` together with `leafAdmissionToken`
2. The browser client automatically includes the token in the `/leaf` request
3. The server verifies signature, expiry, voteId match, and single-use
4. The token is consumed only on successful new registration

On expiry or verification failure, `/leaf` is rejected; the user can press **Register & Generate Credentials** again to retry with a fresh token. The visible UI flow is unchanged.

---

## 1. Initialize the database

```bash
rm src/db/voting_demo.db
node src/db/init_demo.js
```

> ⚠️ Deleting the DB does **not** reset on-chain state — voteIds, valid roots, and used nullifiers persist in the contracts. After a DB reset, use fresh voteIds (or fresh contract deployments); reusing an old voteId against a wiped DB will desync server and chain.

## 2. Create votes (per voteId)

No voter list — just voteId and title (voters auto-register):

```bash
node scripts/createSnapshot_demo.js 1 "Demo Vote #1"
```

## 3. Register coordinators on-chain (with the server stopped)

```bash
node scripts/setup_demo.js
```

## 4. Build the client (after changes)

```bash
npm run build:demo
```

## 5. Run the server

```bash
node src/server_demo.js
# → http://localhost:4000
# optional: put your HTTPS tunnel/proxy in front for external access
```

## 6. Close voting + register dummy padding (per voteId)

```bash
node scripts/finalize_demo.js 1
```

## 7. Compute tally + generate proof (per voteId)

```bash
node src/lib/tally_demo.js 1
```

## 8. Submit tally on-chain (per voteId)

```bash
node src/lib/submitTally_demo.js 1
```

---

## Full flow (single vote, voteId=1)

```bash
# one-time setup
rm src/db/voting_demo.db
node src/db/init_demo.js
node scripts/setup_demo.js

# create the vote (empty snapshot)
node scripts/createSnapshot_demo.js 1 "Demo Vote #1"

# build & run
npm run build:demo
node src/server_demo.js

# (participants connect with MetaMask, auto-register, vote...)

# close & tally
node scripts/finalize_demo.js 1
node src/lib/tally_demo.js 1
node src/lib/submitTally_demo.js 1
```

---

## Running Product and Demo simultaneously

```bash
# terminal 1: Product server (port 3000)
npm run build
node src/server.js

# terminal 2: Demo server (port 4000)
npm run build:demo
node src/server_demo.js
```

Build both at once:

```bash
npm run build:all
```

---

## Direct API testing

Outside the browser (curl etc.), pass the admission token yourself:

1. Call `/weight`, extract `leafAdmissionToken` from the response
2. Call `/leaf` with `voteId`, `leaf`, and `leafAdmissionToken` in the body
