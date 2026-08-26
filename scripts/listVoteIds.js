// Read-only: lists every voteId ever created on the configured VotingContract
// with its current on-chain state and VoteSubmitted count. No transactions,
// no private keys used; RPC URL and keys are never printed.
//
// usage:
//   node scripts/listVoteIds.js demo                 # scan + state table
//   node scripts/listVoteIds.js product
//   node scripts/listVoteIds.js demo check 777       # only: isValidVoteId(777)
//   node scripts/listVoteIds.js demo --from <block>  # skip deployment-block search
//   node scripts/listVoteIds.js demo --no-cache      # ignore cache/voteids_demo.json
//
// On-chain voteId state is permanent (no reset in the contracts), so a new vote
// must use an id for which isValidVoteId is false. The scan is cached in
// cache/voteids_<env>.json (gitignored); re-runs only fetch new blocks.
//
// Free-tier RPC constraints: eth_getLogs max 10,000 blocks per call, per-second
// rate limit (-32005) — so one getLogs per chunk, sequential, with backoff.

const path = require("path");
const fs = require("fs");

const env = process.argv[2];
if (env !== "demo" && env !== "product") {
  console.error("Usage: node scripts/listVoteIds.js <demo|product> [check <voteId>] [--from <block>] [--no-cache]");
  process.exit(1);
}
const envFile = env === "demo" ? ".env.demo" : ".env";
require("dotenv").config({ path: path.join(__dirname, "..", envFile), quiet: true });
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
const CACHE_FILE = path.join(CACHE_DIR, `voteids_${env}.json`);

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

function loadCache(address) {
  if (process.argv.includes("--no-cache")) return null;
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (c.contract && c.contract.toLowerCase() === address.toLowerCase()) return c;
  } catch {}
  return null;
}

function saveCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
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

async function main() {
  const { RPC_URL, VOTING_CONTRACT_ADDRESS, TALLY_CONTRACT_ADDRESS } = process.env;
  if (!RPC_URL || !VOTING_CONTRACT_ADDRESS || !TALLY_CONTRACT_ADDRESS) {
    throw new Error(`missing RPC_URL / VOTING_CONTRACT_ADDRESS / TALLY_CONTRACT_ADDRESS in ${envFile}`);
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1 });
  const voting = new ethers.Contract(VOTING_CONTRACT_ADDRESS, VOTING_ABI, provider);
  const tally = new ethers.Contract(TALLY_CONTRACT_ADDRESS, TALLY_ABI, provider);

  console.log(`env: ${env}  voting: ${VOTING_CONTRACT_ADDRESS}  tally: ${TALLY_CONTRACT_ADDRESS}`);

  if (process.argv[3] === "check") {
    const id = BigInt(process.argv[4]);
    const valid = await withRetry(() => voting.isValidVoteId(id));
    console.log(`isValidVoteId(${id}) = ${valid}  ->  ${valid ? "ALREADY USED on-chain, pick another" : "free"}`);
    return;
  }

  const latest = await withRetry(() => provider.getBlockNumber());
  const cache = loadCache(VOTING_CONTRACT_ADDRESS) || {
    contract: VOTING_CONTRACT_ADDRESS,
    deployBlock: null,
    lastScannedBlock: null,
    created: {},
    submitted: {}
  };

  const fromArg = process.argv.indexOf("--from");
  if (cache.deployBlock === null) {
    cache.deployBlock = fromArg > 0 ? Number(process.argv[fromArg + 1]) : await findDeployBlock(provider, VOTING_CONTRACT_ADDRESS, latest);
  }
  const scanFrom = cache.lastScannedBlock === null ? cache.deployBlock : cache.lastScannedBlock + 1;
  console.log(`deployment block: ${cache.deployBlock}  latest: ${latest}  scanning ${scanFrom}..${latest} (${Math.max(0, latest - scanFrom + 1)} blocks${cache.lastScannedBlock !== null ? ", cached up to " + cache.lastScannedBlock : ""})`);

  // One getLogs per chunk: both event types via an OR filter on topic0
  const ranges = [];
  for (let from = scanFrom; from <= latest; from += STEP) ranges.push([from, Math.min(from + STEP - 1, latest)]);
  let newEvents = 0;
  for (let i = 0; i < ranges.length; i++) {
    const [fromBlock, toBlock] = ranges[i];
    const logs = await withRetry(() => provider.getLogs({
      address: VOTING_CONTRACT_ADDRESS,
      fromBlock,
      toBlock,
      topics: [[TOPIC_CREATED, TOPIC_SUBMITTED]]
    }));
    for (const log of logs) {
      const id = BigInt(log.topics[1]).toString();
      if (log.topics[0] === TOPIC_CREATED) {
        if (!(id in cache.created)) cache.created[id] = log.blockNumber;
      } else {
        cache.submitted[id] = (cache.submitted[id] || 0) + 1;
      }
      newEvents++;
    }
    cache.lastScannedBlock = toBlock;
    saveCache(cache);
    await sleep(300);
    if (i % 20 === 0 || i === ranges.length - 1) {
      process.stdout.write(`  scanned ${i + 1}/${ranges.length} chunks, ${newEvents} new events\r`);
    }
  }
  if (ranges.length) process.stdout.write("\n");

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
  console.log(`cache: ${path.relative(process.cwd(), CACHE_FILE)}`);
}

main().catch((e) => { console.error("error:", e.message); process.exit(1); });
