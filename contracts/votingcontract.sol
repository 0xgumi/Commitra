// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[8] calldata input
    ) external view returns (bool);
}

contract VotingContract {

    IVerifier public immutable verifier;
    uint256 public immutable chainId;

    // voteId별 merkleRoot
    mapping(uint256 => bytes32) public merkleRoots;
    
    // voteId별 validRoots
    mapping(uint256 => mapping(bytes32 => bool)) public validRoots;

    // voteId별 nullifiers (수정됨)
    mapping(uint256 => mapping(bytes32 => bool)) public nullifiers;

    // 다중 coordinator 지원
    address public owner;
    mapping(address => bool) public coordinators;

    // voteId 유효성
    mapping(uint256 => bool) public validVoteIds;

    // 마지막 생성된 voteId (조회 전용)
    uint256 public latestVoteId;

    // 투표 종료 상태 (voteId별)
    mapping(uint256 => bool) public votingClosed;

    // 더미 등록 여부 (voteId별, 1회만)
    mapping(uint256 => bool) public dummyRegistered;

    // -----------------------------
    // EVENTS
    // -----------------------------
    event VoteSubmitted(
        uint256 indexed voteId,
        bytes32 indexed voterID,
        bytes32 indexed nullifier,
        bytes32 encryptedVotesHash,
        bytes32 voteHash
    );

    event MerkleRootUpdated(uint256 indexed voteId, bytes32 newRoot);
    event VoteIdCreated(uint256 indexed voteId);
    event CoordinatorAdded(address indexed coordinator);
    event CoordinatorRemoved(address indexed coordinator);
    event VotingClosed(uint256 indexed voteId);
    event DummyVotesRegistered(uint256 indexed voteId, uint256[] hashes);

    // -----------------------------
    // ERRORS
    // -----------------------------
    error InvalidProof();
    error NullifierAlreadyUsed();
    error InvalidChainId();
    error InvalidMerkleRoot();
    error InvalidVoteId();
    error VoteIdAlreadyExists();
    error OnlyOwner();
    error OnlyCoordinator();
    error ZeroAddress();
    error VotingAlreadyClosed();
    error VotingNotClosed();
    error DummyAlreadyRegistered();
    error CannotRemoveOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyCoordinator() {
        if (!coordinators[msg.sender]) revert OnlyCoordinator();
        _;
    }

    constructor(address _verifier, address _owner) {
        if (_verifier == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        verifier = IVerifier(_verifier);
        owner = _owner;
        coordinators[_owner] = true;
        chainId = block.chainid;
    }

    // -----------------------------
    // COORDINATOR 관리 (owner만)
    // -----------------------------
    function addCoordinator(address _coordinator) external onlyOwner {
        if (_coordinator == address(0)) revert ZeroAddress();
        coordinators[_coordinator] = true;
        emit CoordinatorAdded(_coordinator);
    }

    function removeCoordinator(address _coordinator) external onlyOwner {
        if (_coordinator == owner) revert CannotRemoveOwner();
        coordinators[_coordinator] = false;
        emit CoordinatorRemoved(_coordinator);
    }

    // -----------------------------
    // VOTE ID 관리
    // -----------------------------
    function createVoteId(uint256 _voteId) external onlyCoordinator {
        if (validVoteIds[_voteId]) revert VoteIdAlreadyExists();
        
        validVoteIds[_voteId] = true;
        latestVoteId = _voteId;
        emit VoteIdCreated(_voteId);
    }

    // -----------------------------
    // 투표 종료
    // -----------------------------
    function closeVoting(uint256 _voteId) external onlyCoordinator {
        if (!validVoteIds[_voteId]) revert InvalidVoteId();
        if (votingClosed[_voteId]) revert VotingAlreadyClosed();
        
        votingClosed[_voteId] = true;
        emit VotingClosed(_voteId);
    }

    // -----------------------------
    // 더미 투표 등록 (투표 종료 후 1회만)
    // -----------------------------
    function registerDummyVotes(uint256 _voteId, uint256[] calldata dummyHashes) external onlyCoordinator {
        if (!validVoteIds[_voteId]) revert InvalidVoteId();
        if (!votingClosed[_voteId]) revert VotingNotClosed();
        if (dummyRegistered[_voteId]) revert DummyAlreadyRegistered();

        dummyRegistered[_voteId] = true;
        emit DummyVotesRegistered(_voteId, dummyHashes);
    }

    // -----------------------------
    // SETTERS
    // -----------------------------
    function updateRoot(uint256 _voteId, bytes32 _root) external onlyCoordinator {
        if (!validVoteIds[_voteId]) revert InvalidVoteId();
        if (votingClosed[_voteId]) revert VotingAlreadyClosed();
        
        merkleRoots[_voteId] = _root;
        validRoots[_voteId][_root] = true;
        emit MerkleRootUpdated(_voteId, _root);
    }

    function currentRoot(uint256 _voteId) external view returns (bytes32) {
        return merkleRoots[_voteId];
    }

    // -----------------------------
    // SUBMIT VOTE
    // -----------------------------
    function submitVote(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[8] calldata publicSignals
    ) external onlyCoordinator {
        // publicSignals 순서 (circom과 동일):
        // [0] merkleRoot
        // [1] voterID
        // [2] nullifier
        // [3] encryptedVotesHash
        // [4] voteId
        // [5] pubkeyCommitment
        // [6] chainId
        // [7] voteHash

        bytes32 _merkleRoot = bytes32(publicSignals[0]);
        bytes32 _nullifier = bytes32(publicSignals[2]);
        uint256 _voteId = publicSignals[4];
        uint256 _chainId = publicSignals[6];

        // 1) ChainId check
        if (_chainId != chainId) revert InvalidChainId();

        // 2) VoteId check
        if (!validVoteIds[_voteId]) revert InvalidVoteId();

        // 3) Voting closed check
        if (votingClosed[_voteId]) revert VotingAlreadyClosed();

        // 4) MerkleRoot check (해당 voteId의 validRoots에 있는지)
        if (!validRoots[_voteId][_merkleRoot]) revert InvalidMerkleRoot();

        // 5) Nullifier check (voteId별)
        if (nullifiers[_voteId][_nullifier]) revert NullifierAlreadyUsed();

        // 6) Verify proof
        bool ok = verifier.verifyProof(pA, pB, pC, publicSignals);
        if (!ok) revert InvalidProof();

        // 7) Mark nullifier as used (voteId별)
        nullifiers[_voteId][_nullifier] = true;

        // 8) Emit event
        emit VoteSubmitted(
            _voteId,
            bytes32(publicSignals[1]),  // voterID
            _nullifier,
            bytes32(publicSignals[3]),   // encryptedVotesHash
            bytes32(publicSignals[7])    // voteHash
        );
    }

    function isNullifierUsed(uint256 _voteId, bytes32 n) external view returns (bool) {
        return nullifiers[_voteId][n];
    }

    function isValidRoot(uint256 _voteId, bytes32 r) external view returns (bool) {
        return validRoots[_voteId][r];
    }

    function isValidVoteId(uint256 _voteId) external view returns (bool) {
        return validVoteIds[_voteId];
    }

    function isVotingClosed(uint256 _voteId) external view returns (bool) {
        return votingClosed[_voteId];
    }

    function isDummyRegistered(uint256 _voteId) external view returns (bool) {
        return dummyRegistered[_voteId];
    }
}