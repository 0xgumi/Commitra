// Read-only: lists every voteId ever created on the configured VotingContract
// with its current on-chain state and VoteSubmitted count. No transactions,
// no private keys used; RPC URL and keys are never printed.
//
// usage:
//   node scripts/listVoteIds.js demo                 # scan + state table
//   node scripts/listVoteIds.js product
//   node scripts/listVoteIds.js demo check 777       # only: isValidVoteId(777)
//   node scripts/listVoteIds.js demo --out [path]    # also regenerate the used-id ledger
//                                                    # (default cache/voteids_demo.md)
//   node scripts/listVoteIds.js demo --from <block>  # skip deployment-block search
//   node scripts/listVoteIds.js demo --no-cache      # ignore cache/voteids_demo.json
//
// On-chain voteId state is permanent (no reset in the contracts), so a new vote
// must use an id for which isValidVoteId is false. The scan is cached in
// cache/voteids_<env>.json (gitignored); re-runs only fetch new blocks. The
// ledger file (cache/voteids_<env>.md) holds the used ids only — numbers, one
// sorted line, no state — and is regenerated from chain, never edited by hand.
// createSnapshot(_demo).js refreshes it after creating a new voteId.
//
// Free-tier RPC constraints: eth_getLogs max 10,000 blocks per call, per-second
// rate limit (-32005) — so one getLogs per chunk, sequential, with backoff.

const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");

const VOTING_ABI = [
  "event VoteIdCreated(uint256 indexed voteId)",
  "event VoteSubmitted(uint256 indexed voteId, bytes32 indexed voterID, bytes32 indexed nullifier, bytes32 encryptedVotesHash, bytes32 voteHash)",
  "function isValidVoteId(uint256) view returns (bool)",
  "function isVotingClosed(uint256) view returns (bool)",
  "function isDummyRegistered(uint256) view returns (bool)",
  "function latestVoteId() view returns (uint256)"
];
const TALLY_ABI = [
  "function isTallyFinalized(uint256) view returns (bool)",
  "function getTallyResult(uint256) view returns (uint256 yes, uint256 no, uint256 abstain)"
];

const TOPIC_CREATED = ethers.id("VoteIdCreated(uint256)");
const TOPIC_SUBMITTED = ethers.id("VoteSubmitted(uint256,bytes32,bytes32,bytes32,bytes32)");
const STEP = 10_000;
const CACHE_DIR = path.join(__dirname, "..", "cache");

const cacheFile = (env) => path.join(CACHE_DIR, `voteids_${env}.json`);
const ledgerFile = (env) => path.join(CACHE_DIR, `voteids_${env}.md`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e.message || e);
      if (attempt < 7 && /Too Many Requests|-32005|429|missing response|timeout/i.test(msg)) {
        await sleep(700 * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }
}

function readEnv() {
  const { RPC_URL, VOTING_CONTRACT_ADDRESS, TALLY_CONTRACT_ADDRESS } = process.env;
  if (!RPC_URL || !VOTING_CONTRACT_ADDRESS || !TALLY_CONTRACT_ADDRESS) {
    throw new Error("missing RPC_URL / VOTING_CONTRACT_ADDRESS / TALLY_CONTRACT_ADDRESS in the environment");
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1 });
  return {
    provider,
    votingAddress: VOTING_CONTRACT_ADDRESS,
    tallyAddress: TALLY_CONTRACT_ADDRESS,
    voting: new ethers.Contract(VOTING_CONTRACT_ADDRESS, VOTING_ABI, provider),
    tally: new ethers.Contract(TALLY_CONTRACT_ADDRESS, TALLY_ABI, provider)
  };
}

function loadCache(env, address) {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(env), "utf8"));
    if (c.contract && c.contract.toLowerCase() === address.toLowerCase()) return c;
  } catch {}
  return null;
}

function hasCache(env) {
  const address = process.env.VOTING_CONTRACT_ADDRESS;
  return Boolean(address && loadCache(env, address));
}

function saveCache(env, cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile(env), JSON.stringify(cache, null, 2));
}

async function findDeployBlock(provider, address, latest) {
  // Binary search on getCode: no code before deployment
  let lo = 0, hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await withRetry(() => provider.getCode(address, mid));
    await sleep(250);
    if (code === "0x") lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Scans VoteIdCreated + VoteSubmitted from the deployment block (or the cached
// position) and returns the updated cache. Reads the environment as already
// loaded by the caller; prints progress to stdout when `log` is true.
async function scanUsedVoteIds({ env, from = null, noCache = false, log = true } = {}) {
  const { provider, votingAddress } = readEnv();
  const latest = await withRetry(() => provider.getBlockNumber());
  const cache = (!noCache && loadCache(env, votingAddress)) || {
    contract: votingAddress,
    deployBlock: null,
    lastScannedBlock: null,
    created: {},
    submitted: {}
  };

  if (cache.deployBlock === null) {
    cache.deployBlock = from !== null ? Number(from) : await findDeployBlock(provider, votingAddress, latest);
  }
  const scanFrom = cache.lastScannedBlock === null ? cache.deployBlock : cache.lastScannedBlock + 1;
  if (log) {
    console.log(`deployment block: ${cache.deployBlock}  latest: ${latest}  scanning ${scanFrom}..${latest} (${Math.max(0, latest - scanFrom + 1)} blocks${cache.lastScannedBlock !== null ? ", cached up to " + cache.lastScannedBlock : ""})`);
  }

  // One getLogs per chunk: both event types via an OR filter on topic0
  const ranges = [];
  for (let start = scanFrom; start <= latest; start += STEP) ranges.push([start, Math.min(start + STEP - 1, latest)]);
  let newEvents = 0;
  for (let i = 0; i < ranges.length; i++) {
    const [fromBlock, toBlock] = ranges[i];
    const logs = await withRetry(() => provider.getLogs({
      address: votingAddress,
      fromBlock,
      toBlock,
      topics: [[TOPIC_CREATED, TOPIC_SUBMITTED]]
    }));
    for (const entry of logs) {
      const id = BigInt(entry.topics[1]).toString();
      if (entry.topics[0] === TOPIC_CREATED) {
        if (!(id in cache.created)) cache.created[id] = entry.blockNumber;
      } else {
        cache.submitted[id] = (cache.submitted[id] || 0) + 1;
      }
      newEvents++;
    }
    cache.lastScannedBlock = toBlock;
    saveCache(env, cache);
    await sleep(300);
    if (log && (i % 20 === 0 || i === ranges.length - 1)) {
      process.stdout.write(`  scanned ${i + 1}/${ranges.length} chunks, ${newEvents} new events\r`);
    }
  }
  if (log && ranges.length) process.stdout.write("\n");

  return { cache, latest };
}

// Writes the used-id ledger: numbers only, ascending, one line.
function writeUsedVoteIdLedger(cache, env, outPath = ledgerFile(env)) {
  const ids = Object.keys(cache.created).map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const body = [
    `# used voteIds — ${env} VotingContract ${cache.contract}`,
    `# scanned to block ${cache.lastScannedBlock} at ${new Date().toISOString()}`,
    ids.join(", ")
  ].join("\n") + "\n";
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body);
  return { path: outPath, count: ids.length };
}

// Entry point for createSnapshot(_demo).js: incremental scan + ledger rewrite.
async function refreshUsedVoteIdLedger(env, { log = false } = {}) {
  const { cache } = await scanUsedVoteIds({ env, log });
  return writeUsedVoteIdLedger(cache, env);
}

async function printStateTable(env, cache) {
  const { voting, tally } = readEnv();
  const ids = Object.keys(cache.created);
  const latestId = await withRetry(() => voting.latestVoteId());
  console.log(`distinct voteIds: ${ids.length}  latestVoteId(): ${latestId}\n`);

  const rows = [];
  for (const id of ids) {
    const closed = await withRetry(() => voting.isVotingClosed(id)); await sleep(200);
    const dummy = await withRetry(() => voting.isDummyRegistered(id)); await sleep(200);
    const finalized = await withRetry(() => tally.isTallyFinalized(id)); await sleep(200);
    let result = "";
    if (finalized) {
      const r = await withRetry(() => tally.getTallyResult(id)); await sleep(200);
      result = `${r.yes}/${r.no}/${r.abstain}`;
    }
    const state = finalized ? "FINALIZED" : closed ? (dummy ? "closed+dummy" : "closed") : "OPEN";
    rows.push({ voteId: id, createdBlock: cache.created[id], votes: cache.submitted[id] || 0, state, result });
  }
  rows.sort((a, b) => a.createdBlock - b.createdBlock);
  console.table(rows);
  const open = rows.filter((r) => r.state === "OPEN").map((r) => r.voteId);
  console.log(open.length ? `OPEN (never closed) voteIds: ${open.join(", ")}` : "No open voteIds.");
  console.log(`cache: ${path.relative(process.cwd(), cacheFile(env))}`);
}

async function main() {
  const env = process.argv[2];
  if (env !== "demo" && env !== "product") {
    console.error("Usage: node scripts/listVoteIds.js <demo|product> [check <voteId>] [--out [path]] [--from <block>] [--no-cache]");
    process.exit(1);
  }
  const envFile = env === "demo" ? ".env.demo" : ".env";
  require("dotenv").config({ path: path.join(__dirname, "..", envFile), quiet: true });
  const { voting, votingAddress, tallyAddress } = readEnv();

  console.log(`env: ${env}  voting: ${votingAddress}  tally: ${tallyAddress}`);

  if (process.argv[3] === "check") {
    const id = BigInt(process.argv[4]);
    const valid = await withRetry(() => voting.isValidVoteId(id));
    console.log(`isValidVoteId(${id}) = ${valid}  ->  ${valid ? "ALREADY USED on-chain, pick another" : "free"}`);
    return;
  }

  const fromArg = process.argv.indexOf("--from");
  const outArg = process.argv.indexOf("--out");
  const outPath = outArg > 0
    ? (process.argv[outArg + 1] && !process.argv[outArg + 1].startsWith("--") ? path.resolve(process.argv[outArg + 1]) : ledgerFile(env))
    : null;

  const { cache } = await scanUsedVoteIds({
    env,
    from: fromArg > 0 ? process.argv[fromArg + 1] : null,
    noCache: process.argv.includes("--no-cache"),
    log: true
  });
  await printStateTable(env, cache);

  if (outPath) {
    const ledger = writeUsedVoteIdLedger(cache, env, outPath);
    console.log(`ledger: ${path.relative(process.cwd(), ledger.path)} (${ledger.count} used ids)`);
  }
}

module.exports = { scanUsedVoteIds, writeUsedVoteIdLedger, refreshUsedVoteIdLedger, hasCache, ledgerFile };

if (require.main === module) {
  main().catch((e) => { console.error("error:", e.message); process.exit(1); });
}
