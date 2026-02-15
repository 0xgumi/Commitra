// src/config/onchain.js
require('dotenv').config({ quiet: true });
const { ethers } = require("ethers");

// Config from environment variables
const config = {
  rpcUrl: process.env.RPC_URL,
  ownerPrivateKey: process.env.OWNER_PRIVATE_KEY,
  coordinatorPrivateKeys: JSON.parse(process.env.COORDINATOR_PRIVATE_KEYS || "[]"),
  votingContractAddress: process.env.VOTING_CONTRACT_ADDRESS,
  tallyContractAddress: process.env.TALLY_CONTRACT_ADDRESS
};

const VOTING_CONTRACT_ABI = [
  "function updateRoot(uint256 voteId, bytes32 newRoot) external",
  "function currentRoot(uint256 voteId) external view returns (bytes32)",
  "function createVoteId(uint256 _voteId) external",
  "function submitVote(uint[2] calldata pA, uint[2][2] calldata pB, uint[2] calldata pC, uint[8] calldata publicSignals) external",
  "function isNullifierUsed(uint256 voteId, bytes32 n) external view returns (bool)",
  "function isValidRoot(uint256 voteId, bytes32 r) external view returns (bool)",
  "function isValidVoteId(uint256 _voteId) external view returns (bool)",
  "function addCoordinator(address _coordinator) external",
  "function coordinators(address) external view returns (bool)",
  "function closeVoting(uint256 _voteId) external",
  "function registerDummyVotes(uint256 _voteId, uint256[] calldata dummyHashes) external",
  "function isVotingClosed(uint256 _voteId) external view returns (bool)",
  "function isDummyRegistered(uint256 _voteId) external view returns (bool)",
  "function latestVoteId() external view returns (uint256)"
];

const TALLY_CONTRACT_ABI = [
  "function finalizeTally(uint256 voteId, uint[2] pA, uint[2][2] pB, uint[2] pC, uint[18] publicSignals) external",
  "function getTallyResult(uint256 voteId) external view returns (uint256 yes, uint256 no, uint256 abstain)",
  "function isTallyFinalized(uint256 voteId) external view returns (bool)",
  "function addCoordinator(address _coordinator) external",
  "function coordinators(address) external view returns (bool)"
];

const provider = new ethers.JsonRpcProvider(config.rpcUrl);

// Owner wallet (for coordinator management)
const ownerWallet = new ethers.Wallet(config.ownerPrivateKey, provider);

// Multiple coordinator wallets
const wallets = config.coordinatorPrivateKeys.map(pk => new ethers.Wallet(pk, provider));

// Multiple contract instances
const votingContracts = wallets.map(w => 
  new ethers.Contract(config.votingContractAddress, VOTING_CONTRACT_ABI, w)
);

const tallyContracts = wallets.map(w =>
  new ethers.Contract(config.tallyContractAddress, TALLY_CONTRACT_ABI, w)
);

// Owner contracts (for addCoordinator, etc.)
const ownerVotingContract = new ethers.Contract(
  config.votingContractAddress, 
  VOTING_CONTRACT_ABI, 
  ownerWallet
);

const ownerTallyContract = new ethers.Contract(
  config.tallyContractAddress,
  TALLY_CONTRACT_ABI,
  ownerWallet
);

// Round-robin index
let currentIndex = 0;

function getNextVotingContract() {
  const contract = votingContracts[currentIndex];
  currentIndex = (currentIndex + 1) % votingContracts.length;
  return contract;
}

function getNextTallyContract() {
  const contract = tallyContracts[currentIndex];
  currentIndex = (currentIndex + 1) % tallyContracts.length;
  return contract;
}

// Read-only (any wallet)
const votingContract = votingContracts[0];
const tallyContract = tallyContracts[0];

module.exports = {
  provider,
  wallets,
  ownerWallet,
  ownerVotingContract,
  ownerTallyContract,
  votingContract,
  tallyContract,
  getNextVotingContract,
  getNextTallyContract,
  VOTING_CONTRACT_ADDRESS: config.votingContractAddress,
  TALLY_CONTRACT_ADDRESS: config.tallyContractAddress
};