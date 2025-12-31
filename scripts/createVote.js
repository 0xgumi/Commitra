// scripts/createVote.js
const { ownerVotingContract, votingContract } = require("../src/config/onchain");

async function main() {
  const voteId = process.argv[2];

  if (!voteId) {
    console.error("Usage: node scripts/createVote.js <voteId>");
    console.error("Example: node scripts/createVote.js 1");
    process.exit(1);
  }

  console.log(`=== Create VoteId: ${voteId} ===\n`);

  // 이미 등록되어 있는지 확인
  const isValid = await votingContract.isValidVoteId(voteId);

  if (isValid) {
    console.log(`✓ voteId ${voteId} 이미 존재함, 스킵`);
    process.exit(0);
  }

  console.log(`Creating voteId: ${voteId}`);
  const tx = await ownerVotingContract.createVoteId(voteId);
  await tx.wait();
  console.log(`✓ voteId ${voteId} 생성 완료, tx: ${tx.hash}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
