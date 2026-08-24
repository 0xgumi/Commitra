pragma circom 2.1.4;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/babyjub.circom";
include "node_modules/circomlib/circuits/escalarmulany.circom";
include "node_modules/circomlib/circuits/escalarmulfix.circom";
include "node_modules/circomlib/circuits/bitify.circom";

template TallyVotes(nVoters) {
    // ===== Public Inputs =====
    signal input encryptedBatchHash;
    signal input aggregatedCiphertext[3][2][2];
    signal input tallyResult[3];
    signal input coordinatorPubkey[2];

    // ===== Private Inputs =====
    signal input encryptedVotes[nVoters][3][2][2];
    signal input coordinatorPrivkey;

    // ===== 1. Pubkey-Privkey 일치 검증 =====
    component privToPub = BabyPbk();
    privToPub.in <== coordinatorPrivkey;
    coordinatorPubkey[0] === privToPub.Ax;
    coordinatorPubkey[1] === privToPub.Ay;

    // ===== 2. privkey를 bits로 변환 (한 번만) =====
    component privToBits = Num2Bits(254);
    privToBits.in <== coordinatorPrivkey;

    // ===== 3. encryptedVotes → encryptedVotesHash 재계산 =====
    signal encryptedVotesHashes[nVoters];
    component encHashers[nVoters];
    
    for (var i = 0; i < nVoters; i++) {
        encHashers[i] = Poseidon(12);
        var idx = 0;
        for (var choice = 0; choice < 3; choice++) {
            for (var c = 0; c < 2; c++) {
                for (var coord = 0; coord < 2; coord++) {
                    encHashers[i].inputs[idx] <== encryptedVotes[i][choice][c][coord];
                    idx++;
                }
            }
        }
        encryptedVotesHashes[i] <== encHashers[i].out;
    }

    // ===== 4. encryptedBatchHash 검증 =====
    signal batchHashChain[nVoters];
    component chainHashers[nVoters - 1];
    
    batchHashChain[0] <== encryptedVotesHashes[0];
    
    for (var i = 1; i < nVoters; i++) {
        chainHashers[i - 1] = Poseidon(2);
        chainHashers[i - 1].inputs[0] <== batchHashChain[i - 1];
        chainHashers[i - 1].inputs[1] <== encryptedVotesHashes[i];
        batchHashChain[i] <== chainHashers[i - 1].out;
    }
    
    encryptedBatchHash === batchHashChain[nVoters - 1];

    // ===== 5. 동형 덧셈 검증 =====
    component pointAdders[3][2][nVoters - 1];
    signal sumPoints[3][2][nVoters][2];

    for (var choice = 0; choice < 3; choice++) {
        for (var c = 0; c < 2; c++) {
            sumPoints[choice][c][0][0] <== encryptedVotes[0][choice][c][0];
            sumPoints[choice][c][0][1] <== encryptedVotes[0][choice][c][1];

            for (var i = 1; i < nVoters; i++) {
                pointAdders[choice][c][i - 1] = BabyAdd();
                pointAdders[choice][c][i - 1].x1 <== sumPoints[choice][c][i - 1][0];
                pointAdders[choice][c][i - 1].y1 <== sumPoints[choice][c][i - 1][1];
                pointAdders[choice][c][i - 1].x2 <== encryptedVotes[i][choice][c][0];
                pointAdders[choice][c][i - 1].y2 <== encryptedVotes[i][choice][c][1];
                sumPoints[choice][c][i][0] <== pointAdders[choice][c][i - 1].xout;
                sumPoints[choice][c][i][1] <== pointAdders[choice][c][i - 1].yout;
            }

            aggregatedCiphertext[choice][c][0] === sumPoints[choice][c][nVoters - 1][0];
            aggregatedCiphertext[choice][c][1] === sumPoints[choice][c][nVoters - 1][1];
        }
    }

    // ===== 6. 복호화 검증 =====
    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    component scalarMul[3];
    component subtractPoint[3];
    component resultToPoint[3];
    component resultToBits[3];
    signal negX[3];

    for (var choice = 0; choice < 3; choice++) {
        // privkey × C1
        scalarMul[choice] = EscalarMulAny(254);
        scalarMul[choice].p[0] <== aggregatedCiphertext[choice][0][0];
        scalarMul[choice].p[1] <== aggregatedCiphertext[choice][0][1];
        
        for (var j = 0; j < 254; j++) {
            scalarMul[choice].e[j] <== privToBits.out[j];
        }

        // -(privkey × C1).x
        negX[choice] <== 0 - scalarMul[choice].out[0];

        // C2 - privkey × C1 = M
        subtractPoint[choice] = BabyAdd();
        subtractPoint[choice].x1 <== aggregatedCiphertext[choice][1][0];
        subtractPoint[choice].y1 <== aggregatedCiphertext[choice][1][1];
        subtractPoint[choice].x2 <== negX[choice];
        subtractPoint[choice].y2 <== scalarMul[choice].out[1];

        // tallyResult × G
        resultToBits[choice] = Num2Bits(254);
        resultToBits[choice].in <== tallyResult[choice];

        resultToPoint[choice] = EscalarMulFix(254, BASE8);
        for (var j = 0; j < 254; j++) {
            resultToPoint[choice].e[j] <== resultToBits[choice].out[j];
        }

        // M === tallyResult × G
        subtractPoint[choice].xout === resultToPoint[choice].out[0];
        subtractPoint[choice].yout === resultToPoint[choice].out[1];
    }
}

component main {public [encryptedBatchHash, aggregatedCiphertext, tallyResult, coordinatorPubkey]} = TallyVotes(100);