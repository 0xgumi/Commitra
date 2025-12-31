import { ethers } from "ethers";
import { buildEddsa, buildPoseidon, buildBabyjub } from "circomlibjs";

let signer = null;
let voterData = null;
let voteInput = null;
let poseidon = null;
let eddsa = null;
let babyJub = null;
let F = null;
let isGenerating = false;     
let isOnchainConfirmed = false;
let selectedVoteId = null;

function out(msg) {
  document.getElementById("out").textContent += msg + "\n";
}

window.connectWallet = async function () {
  if (!window.ethereum) return out("❌ MetaMask not found");

  await window.ethereum.request({ method: "eth_requestAccounts" });

  const provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  out("✓ Connected: " + await signer.getAddress());

  // Load active votes after wallet connection
  await loadActiveVotes();
};

// =====================================
// Load active votes from server
// =====================================
async function loadActiveVotes() {
  try {
    const resp = await fetch("/voter/active-votes");
    const data = await resp.json();

    if (data.status !== "ok" || !data.votes.length) {
      out("❌ No active votes available");
      return;
    }

    const select = document.getElementById("voteIdSelect");
    select.innerHTML = '<option value="">-- Select a vote --</option>';

    for (const vote of data.votes) {
      const option = document.createElement("option");
      option.value = vote.voteId;
      option.textContent = `#${vote.voteId}: ${vote.title}`;
      select.appendChild(option);
    }

    document.getElementById("voteSelectSection").style.display = "block";
    out("✓ Loaded " + data.votes.length + " active vote(s)");

  } catch (err) {
    console.error(err);
    out("❌ Failed to load active votes");
  }
}

// =====================================
// On vote selected from dropdown
// =====================================
window.onVoteSelected = async function () {
  const select = document.getElementById("voteIdSelect");
  const voteId = select.value;

  // Reset all UI state
  document.getElementById("voteInfo").innerHTML = "";
  document.getElementById("registerSection").style.display = "none";
  document.getElementById("voteButtons").style.display = "none";
  document.getElementById("voteButtons").style.pointerEvents = "auto";
  document.getElementById("voteButtons").style.opacity = "1";
  document.getElementById("submitButton").style.display = "none";
  document.getElementById("submitButton").style.pointerEvents = "auto";
  document.getElementById("submitButton").style.opacity = "1";
  document.getElementById("out").textContent = "";

  // Reset global state
  voterData = null;
  voteInput = null;
  isOnchainConfirmed = false;
  isGenerating = false;

  if (!voteId) {
    selectedVoteId = null;
    return;
  }

  selectedVoteId = parseInt(voteId);

  try {
    const resp = await fetch("/voter/vote-info/" + voteId);
    const data = await resp.json();

    if (data.status !== "ok") {
      out("❌ Failed to load vote info");
      return;
    }

    document.getElementById("voteInfo").innerHTML = 
      `Voters: ${data.voterCount} | Total Weight: ${data.totalWeight}`;

    document.getElementById("registerSection").style.display = "block";
    out("✓ Selected vote #" + voteId + ": " + data.title);

  } catch (err) {
    console.error(err);
    out("❌ Failed to load vote info");
  }
};

window.generateVoterRecord = async function () {
  try {
    if (!signer) return out("Connect wallet first.");
    if (!selectedVoteId) return out("Please select a vote first.");
    if (isGenerating) return out("Already in progress. Please wait.");

    isGenerating = true;
    isOnchainConfirmed = false;
    document.getElementById("voteButtons").style.display = "none";

    const eoa = await signer.getAddress();
    const voteId = selectedVoteId;

    poseidon = await buildPoseidon();
    eddsa = await buildEddsa();
    babyJub = await buildBabyjub();
    F = poseidon.F;

    //--------------------------------------------------
    // 1. Fetch weight from server (with voteId)
    //--------------------------------------------------
    const weightResp = await fetch("/voter/weight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voteId, eoa })
    });

    const weightData = await weightResp.json();

    if (weightData.error) {
      out("❌ " + weightData.error);
      isGenerating = false;
      return;
    }

    const weight = weightData.weight;
    out("weight = " + weight);

    //--------------------------------------------------
    // 2. EOA signature
    //--------------------------------------------------
    const msg = "zkVote | voteId=" + voteId;
    const sig = await signer.signMessage(msg);
    out("Signature obtained");

    //--------------------------------------------------
    // 3. seedMaster
    //--------------------------------------------------
    const seedMaster = ethers.keccak256(ethers.toUtf8Bytes(sig));

    //--------------------------------------------------
    // 4. Secrets generation
    //--------------------------------------------------
    const secretNullHex = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes("secret_nullifier"),
        ethers.getBytes(seedMaster)
      ])
    );
    const secret_nullifier = BigInt(secretNullHex) % F.p;

    const secretWeightHex = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes("secret_weight"),
        ethers.getBytes(seedMaster)
      ])
    );
    const secret_weight = BigInt(secretWeightHex) % F.p;

    const secretVoterIdHex = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes("voter-id-secret"),
        ethers.getBytes(seedMaster)
      ])
    );
    const secret_voterid = BigInt(secretVoterIdHex) % F.p;

    //--------------------------------------------------
    // 5. BabyJub keypair
    //--------------------------------------------------
    const babyjubSkHex = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes("babyjub_priv"),
        ethers.getBytes(seedMaster)
      ])
    );

    const babyjub_priv_hex = babyjubSkHex.slice(2);
    const babyjub_priv = Buffer.from(babyjub_priv_hex, "hex");

    const pub = eddsa.prv2pub(babyjub_priv);
    const babyjub_pub_x = pub[0];
    const babyjub_pub_y = pub[1];

    //--------------------------------------------------
    // 6. pubkeyCommit / weightCommit / leaf
    //--------------------------------------------------
    const pubkeyCommit = poseidon([babyjub_pub_x, babyjub_pub_y]);
    const pubkeyCommitment = F.toObject(pubkeyCommit);

    const weightCommit = poseidon([BigInt(weight), secret_weight]);

    const leaf = poseidon([pubkeyCommit, weightCommit]);
    const leafHex = "0x" + F.toObject(leaf).toString(16).padStart(64, "0");

    //--------------------------------------------------
    // 7. voterID (decimal string)
    //--------------------------------------------------
    const voterID = F.toObject(
      poseidon([BigInt(voteId), pubkeyCommit, secret_voterid])
    );

    //--------------------------------------------------
    // 8. nullifier
    //--------------------------------------------------
    const nullifier = F.toObject(
      poseidon([secret_nullifier, BigInt(voteId)])
    );

    //--------------------------------------------------
    // 9. Register leaf on server -> receive root, path, indices, txHash
    //--------------------------------------------------
    const leafResp = await fetch("/voter/leaf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voteId, leaf: leafHex })
    });

    const leafInfo = await leafResp.json();

    // Error check
    if (leafInfo.error) {
      out("❌ " + leafInfo.error);
      isGenerating = false;
      return;
    }

    out("✓ Registered, leafIndex: " + leafInfo.leafIndex);

    //--------------------------------------------------
    // 10. On-chain confirmation (wait if txHash exists)
    //--------------------------------------------------
    if (leafInfo.txHash) {
      out("⏳ Waiting for on-chain confirmation...");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.waitForTransaction(leafInfo.txHash);
      out("✓ On-chain root update confirmed");
    }

    isOnchainConfirmed = true;

    //--------------------------------------------------
    // 11. Save voterData (in memory)
    //--------------------------------------------------
    voterData = {
      // public inputs (independent of voteChoice)
      voteId: voteId.toString(),
      voterID: voterID.toString(),
      nullifier: nullifier.toString(),
      pubkeyCommitment: pubkeyCommitment.toString(),
      chainId: "11155111",

      // merkle (received from server)
      merkleRoot: BigInt(leafInfo.root).toString(),
      merklePath: leafInfo.pathElements,
      merkleIndices: leafInfo.pathIndices,

      // private inputs
      babyjub_priv_hex,
      babyjub_pubkey_x: F.toString(babyjub_pub_x),
      babyjub_pubkey_y: F.toString(babyjub_pub_y),
      weight: weight.toString(),
      secret_weight: secret_weight.toString(),
      secret_nullifier: secret_nullifier.toString(),
      secret_voterid: secret_voterid.toString(),

      // leaf (for reference)
      leaf: leafHex
    };

    console.log("voterData:", voterData);
    out("✓ Voter record ready");
    out("Please select your vote: YES(0), NO(1), ABSTAIN(2)");
    if (isOnchainConfirmed) {
      document.getElementById("voteButtons").style.display = "block";
    }
    
    isGenerating = false;

  } catch (err) {
    console.error(err);
    out("ERROR: " + err.message);
    isGenerating = false;
  }
};

//-------------------------------------------------------
// Calculate remaining values after voteChoice selection
//-------------------------------------------------------
window.selectVoteChoice = async function (voteChoice) {
  try {
    if (!voterData) return out("Please generate voter record first.");
    if (!isOnchainConfirmed) return out("Please wait for on-chain confirmation.");

    out("Selected vote: " + ["YES", "NO", "ABSTAIN"][voteChoice]);

    // Disable YES/NO/ABSTAIN buttons
    document.getElementById("voteButtons").style.pointerEvents = "none";
    document.getElementById("voteButtons").style.opacity = "0.5";

    //--------------------------------------------------
    // 1. Load coordinator_key (from server)
    //--------------------------------------------------
    const coordResp = await fetch("/voter/coordinator-key");
    const coordKey = await coordResp.json();
    
    const coordinatorPubkey = [
      babyJub.F.e(coordKey.pubkey[0]),
      babyJub.F.e(coordKey.pubkey[1])
    ];
    out("✓ Coordinator key loaded");

    //--------------------------------------------------
    // 2. ElGamal encryption
    //--------------------------------------------------
    const weight = BigInt(voterData.weight);

    async function elgamalEncrypt(message, pubkey) {
      const r = BigInt("0x" + [...crypto.getRandomValues(new Uint8Array(32))]
        .map(b => b.toString(16).padStart(2, "0")).join("")) % babyJub.subOrder;
      
      const C1 = babyJub.mulPointEscalar(babyJub.Base8, r);
      const sharedSecret = babyJub.mulPointEscalar(pubkey, r);
      const mPoint = babyJub.mulPointEscalar(babyJub.Base8, message);
      const C2 = babyJub.addPoint(mPoint, sharedSecret);
      
      return { C1, C2 };
    }

    const encYes = voteChoice === 0
      ? await elgamalEncrypt(weight, coordinatorPubkey)
      : await elgamalEncrypt(0n, coordinatorPubkey);

    const encNo = voteChoice === 1
      ? await elgamalEncrypt(weight, coordinatorPubkey)
      : await elgamalEncrypt(0n, coordinatorPubkey);

    const encAbstain = voteChoice === 2
      ? await elgamalEncrypt(weight, coordinatorPubkey)
      : await elgamalEncrypt(0n, coordinatorPubkey);

    out("✓ Votes encrypted");

    //--------------------------------------------------
    // 3. Create encryptedVotes array
    //--------------------------------------------------
    const encryptedVotes = [
      [
        [F.toString(encYes.C1[0]), F.toString(encYes.C1[1])],
        [F.toString(encYes.C2[0]), F.toString(encYes.C2[1])]
      ],
      [
        [F.toString(encNo.C1[0]), F.toString(encNo.C1[1])],
        [F.toString(encNo.C2[0]), F.toString(encNo.C2[1])]
      ],
      [
        [F.toString(encAbstain.C1[0]), F.toString(encAbstain.C1[1])],
        [F.toString(encAbstain.C2[0]), F.toString(encAbstain.C2[1])]
      ]
    ];

    //--------------------------------------------------
    // 4. Calculate encryptedVotesHash
    //--------------------------------------------------
    const encryptedVotesHash = F.toObject(
      poseidon([
        encYes.C1[0], encYes.C1[1],
        encYes.C2[0], encYes.C2[1],
        encNo.C1[0], encNo.C1[1],
        encNo.C2[0], encNo.C2[1],
        encAbstain.C1[0], encAbstain.C1[1],
        encAbstain.C2[0], encAbstain.C2[1]
      ])
    );

    //--------------------------------------------------
    // 5. Calculate voteHash
    //--------------------------------------------------
    const voteHashF = poseidon([
      F.e(encryptedVotesHash),
      F.e(BigInt(voterData.voteId)),
      F.e(BigInt(voterData.voterID)),
      F.e(BigInt(voterData.chainId)),
      F.e(BigInt(voterData.nullifier))
    ]);
    const voteHash = F.toObject(voteHashF);

    //--------------------------------------------------
    // 6. Generate EdDSA signature
    //--------------------------------------------------
    const babyjub_priv = Buffer.from(voterData.babyjub_priv_hex, "hex");
    const signature = eddsa.signPoseidon(babyjub_priv, voteHashF);

    const babyjub_pub_x = babyJub.F.e(voterData.babyjub_pubkey_x);
    const babyjub_pub_y = babyJub.F.e(voterData.babyjub_pubkey_y);

    const isValid = eddsa.verifyPoseidon(voteHashF, signature, [babyjub_pub_x, babyjub_pub_y]);
    if (!isValid) throw new Error("Signature verification failed!");

    out("✓ Signature created and verified");

    //--------------------------------------------------
    // 7. Complete vote_input (save to global variable)
    //--------------------------------------------------
    voteInput = {
      // public inputs
      merkleRoot: voterData.merkleRoot,
      voterID: voterData.voterID,
      nullifier: voterData.nullifier,
      encryptedVotesHash: encryptedVotesHash.toString(),
      voteId: voterData.voteId,
      pubkeyCommitment: voterData.pubkeyCommitment,
      chainId: voterData.chainId,
      voteHash: voteHash.toString(),

      // private inputs
      babyjub_pubkey_x: voterData.babyjub_pubkey_x,
      babyjub_pubkey_y: voterData.babyjub_pubkey_y,
      weight: voterData.weight,
      secret_weight: voterData.secret_weight,
      merklePath: voterData.merklePath,
      merkleIndices: voterData.merkleIndices,
      secret_nullifier: voterData.secret_nullifier,
      secret_voterid: voterData.secret_voterid,
      R8x: F.toString(signature.R8[0]),
      R8y: F.toString(signature.R8[1]),
      S: signature.S.toString(),
      encryptedVotes
    };

    console.log("vote_input:", voteInput);
    out("✓ Vote input generated (check console)");
    out("Please click the Submit Vote button.");

    // Show submit vote button
    document.getElementById("submitButton").style.display = "block";

  } catch (err) {
    console.error(err);
    out("ERROR: " + err.message);
  }
};

//-------------------------------------------------------
// Submit vote (groth16 prove)
//-------------------------------------------------------
window.submitVote = async function () {
  try {
    if (!voteInput) return out("Please select a vote first.");

    // Disable submit vote button
    document.getElementById("submitButton").style.pointerEvents = "none";
    document.getElementById("submitButton").style.opacity = "0.5";

    out("⏳ Generating ZK Proof... (takes about 30 seconds)");

    const wasmPath = "/vote.wasm";
    const zkeyPath = "/vote_final.zkey";

    const { proof, publicSignals } = await window.snarkjs.groth16.fullProve(
      voteInput,
      wasmPath,
      zkeyPath
    );

    out("✓ ZK Proof generated");

    // Extract pa, pb, pc
    const pa = [proof.pi_a[0], proof.pi_a[1]];
    const pb = [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]]
    ];
    const pc = [proof.pi_c[0], proof.pi_c[1]];

    console.log("pa:", pa);
    console.log("pb (swapped):", pb);
    console.log("pc:", pc);
    console.log("publicSignals:", publicSignals);

    out("✓ Proof ready");

    // Submit to server
    const submitResp = await fetch("/voter/submit-vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pa,
        pb,
        pc,
        publicSignals,
        encryptedVotes: voteInput.encryptedVotes
      })
    });

    const result = await submitResp.json();
    console.log("Server response:", result);

    if (result.status === "ok") {
      out("✓ Vote submitted successfully! txHash: " + result.txHash);
      // Hide buttons after successful submission
      document.getElementById("submitButton").style.display = "none";
      document.getElementById("voteButtons").style.display = "none";
    } else {
      out("❌ Vote submission failed: " + result.error);
      // Re-enable button on failure
      document.getElementById("submitButton").style.pointerEvents = "auto";
      document.getElementById("submitButton").style.opacity = "1";
    }

  } catch (err) {
    console.error(err);
    out("ERROR: " + err.message);
    // Re-enable button on error
    document.getElementById("submitButton").style.pointerEvents = "auto";
    document.getElementById("submitButton").style.opacity = "1";
  }
};

window.getVoterData = function () {
  return voterData;
};

window.getVoteInput = function () {
  return voteInput;
};