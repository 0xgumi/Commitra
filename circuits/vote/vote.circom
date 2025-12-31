pragma circom 2.1.4;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/eddsaposeidon.circom";
include "node_modules/circomlib/circuits/babyjub.circom";

//
// Merkle Proof (unchanged)
//
template MerkleProof(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;
    
    signal hashVal[depth + 1];
    signal left[depth];
    signal right[depth];
    component h[depth];
    signal s[depth];
    
    hashVal[0] <== leaf;
    
    for (var i = 0; i < depth; i++) {
        s[i] <== pathIndices[i];
        s[i] * (s[i] - 1) === 0;

        left[i]  <== hashVal[i] + s[i] * (pathElements[i] - hashVal[i]);
        right[i] <== pathElements[i] + s[i] * (hashVal[i] - pathElements[i]);

        h[i] = Poseidon(2);
        h[i].inputs[0] <== left[i];
        h[i].inputs[1] <== right[i];

        hashVal[i + 1] <== h[i].out;
    }
    
    root <== hashVal[depth];
}

//
// Vote Circuit
//
template Vote(depth) {

    // ----------------------------------------------------------
    // Public Inputs (8개)
    // ----------------------------------------------------------
    signal input merkleRoot;
    signal input voterID;
    signal input nullifier;
    signal input encryptedVotesHash;
    signal input voteId;
    signal input pubkeyCommitment;
    signal input chainId;
    signal input voteHash;               // ★ 추가됨

    // ----------------------------------------------------------
    // Private Inputs
    // ----------------------------------------------------------
    signal input babyjub_pubkey_x;
    signal input babyjub_pubkey_y;

    signal input weight;
    signal input secret_weight;          // blinding → secret_weight

    signal input merklePath[depth];
    signal input merkleIndices[depth];

    signal input secret_nullifier;       // secret → secret_nullifier
    signal input secret_voterid;         // ★ 추가됨: voterID 검증용

    signal input R8x;
    signal input R8y;
    signal input S;

    signal input encryptedVotes[3][2][2];

    // ----------------------------------------------------------
    // Verify pubkeyCommit = Poseidon(pubkey)
    // ----------------------------------------------------------
    component pubkeyHash = Poseidon(2);
    pubkeyHash.inputs[0] <== babyjub_pubkey_x;
    pubkeyHash.inputs[1] <== babyjub_pubkey_y;
    pubkeyHash.out === pubkeyCommitment;

    // ----------------------------------------------------------
    // Verify weightCommit = Poseidon(weight, secret_weight)
    // ----------------------------------------------------------
    component weightHash = Poseidon(2);
    weightHash.inputs[0] <== weight;
    weightHash.inputs[1] <== secret_weight;

    // ----------------------------------------------------------
    // Compute leaf = Poseidon(pubkeyCommit, weightCommit)
    // ----------------------------------------------------------
    component leafHash = Poseidon(2);
    leafHash.inputs[0] <== pubkeyCommitment;
    leafHash.inputs[1] <== weightHash.out;

    // ----------------------------------------------------------
    // Merkle Proof Verification
    // ----------------------------------------------------------
    component merkle = MerkleProof(depth);
    merkle.leaf <== leafHash.out;

    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== merklePath[i];
        merkle.pathIndices[i] <== merkleIndices[i];
    }

    merkle.root === merkleRoot;

    // ----------------------------------------------------------
    // encryptedVotesHash = Poseidon(12)
    // ----------------------------------------------------------
    component votesHasher = Poseidon(12);

    var k = 0;
    for (var i = 0; i < 3; i++) {          // vote options
        for (var j = 0; j < 2; j++) {      // C1, C2
            for (var m = 0; m < 2; m++) {  // x, y
                votesHasher.inputs[k] <== encryptedVotes[i][j][m];
                k++;
            }
        }
    }

    votesHasher.out === encryptedVotesHash;

    // ----------------------------------------------------------
    // Compute voterID_check = Poseidon(voteId, pubkeyCommit, secret_voterid)
    // ----------------------------------------------------------
    component voteridHasher = Poseidon(3);
    voteridHasher.inputs[0] <== voteId;
    voteridHasher.inputs[1] <== pubkeyCommitment;
    voteridHasher.inputs[2] <== secret_voterid;

    voteridHasher.out === voterID;

    // ----------------------------------------------------------
    // Compute voteHash_check = Poseidon(5)
    // ----------------------------------------------------------
    component voteHasher = Poseidon(5);
    voteHasher.inputs[0] <== encryptedVotesHash;
    voteHasher.inputs[1] <== voteId;
    voteHasher.inputs[2] <== voterID;
    voteHasher.inputs[3] <== chainId;
    voteHasher.inputs[4] <== nullifier;

    voteHasher.out === voteHash;         // ★ 추가된 검증

    // ----------------------------------------------------------
    // Verify EdDSA signature
    // ----------------------------------------------------------
    component eddsaVerify = EdDSAPoseidonVerifier();
    eddsaVerify.enabled <== 1;
    eddsaVerify.Ax <== babyjub_pubkey_x;
    eddsaVerify.Ay <== babyjub_pubkey_y;
    eddsaVerify.R8x <== R8x;
    eddsaVerify.R8y <== R8y;
    eddsaVerify.S <== S;
    eddsaVerify.M <== voteHash;          // voteHash가 서명 메시지

    // ----------------------------------------------------------
    // Nullifier = Poseidon(secret_nullifier, voteId)
    // ----------------------------------------------------------
    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== secret_nullifier;
    nullifierHash.inputs[1] <== voteId;

    nullifierHash.out === nullifier;
}

component main {
    public [
        merkleRoot,
        voterID,
        nullifier,
        encryptedVotesHash,
        voteId,
        pubkeyCommitment,
        chainId,
        voteHash
    ]
} = Vote(15);
