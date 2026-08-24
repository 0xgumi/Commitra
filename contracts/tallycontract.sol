// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITallyVerifier {
    function verifyProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[18] calldata pubSignals
    ) external view returns (bool);
}

interface IVotingContract {
    function isVotingClosed(uint256 voteId) external view returns (bool);
    function isDummyRegistered(uint256 voteId) external view returns (bool);
}

contract TallyContract {
    ITallyVerifier public immutable verifier;
    address public immutable votingContract;
    
    address public owner;
    mapping(address => bool) public coordinators;
    
    // coordinator pubkey (암호화 검증용)
    uint256 public coordinatorPubkeyX;
    uint256 public coordinatorPubkeyY;
    
    // 투표 결과 (voteId별)
    mapping(uint256 => uint256) public tallyResultYes;
    mapping(uint256 => uint256) public tallyResultNo;
    mapping(uint256 => uint256) public tallyResultAbstain;
    
    // finalized 상태 (voteId별)
    mapping(uint256 => bool) public tallyFinalized;
    
    // -----------------------------
    // EVENTS
    // -----------------------------
    event TallyFinalized(
        uint256 indexed voteId,
        address indexed votingContract,
        uint256 yes,
        uint256 no,
        uint256 abstain,
        uint256 encryptedBatchHash
    );
    
    event CoordinatorAdded(address indexed coordinator);
    event CoordinatorRemoved(address indexed coordinator);
    
    // -----------------------------
    // ERRORS
    // -----------------------------
    error OnlyOwner();
    error OnlyCoordinator();
    error ZeroAddress();
    error TallyAlreadyFinalized();
    error TallyNotFinalized();
    error InvalidPubkeyX();
    error InvalidPubkeyY();
    error InvalidTallyProof();
    error CannotRemoveOwner();
    error VotingNotClosed();
    error DummyNotRegistered();
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    modifier onlyCoordinator() {
        if (!coordinators[msg.sender]) revert OnlyCoordinator();
        _;
    }
    
    constructor(
        address _verifier,
        address _votingContract,
        address _owner,
        uint256 _pubkeyX,
        uint256 _pubkeyY
    ) {
        if (_verifier == address(0)) revert ZeroAddress();
        if (_votingContract == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        
        verifier = ITallyVerifier(_verifier);
        votingContract = _votingContract;
        owner = _owner;
        coordinators[_owner] = true;
        coordinatorPubkeyX = _pubkeyX;
        coordinatorPubkeyY = _pubkeyY;
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
    // FINALIZE TALLY
    // -----------------------------
    function finalizeTally(
        uint256 voteId,
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[18] calldata publicSignals
    ) external onlyCoordinator {
        if (tallyFinalized[voteId]) revert TallyAlreadyFinalized();
        
        // VotingContract 상태 확인
        if (!IVotingContract(votingContract).isVotingClosed(voteId)) revert VotingNotClosed();
        if (!IVotingContract(votingContract).isDummyRegistered(voteId)) revert DummyNotRegistered();
        
        // publicSignals 구조:
        // [0]: encryptedBatchHash
        // [1-12]: aggregatedCiphertext[3][2][2]
        // [13-15]: tallyResult[3]
        // [16-17]: coordinatorPubkey[2]
        
        // coordinator pubkey 일치 확인
        if (publicSignals[16] != coordinatorPubkeyX) revert InvalidPubkeyX();
        if (publicSignals[17] != coordinatorPubkeyY) revert InvalidPubkeyY();
        
        // proof 검증
        if (!verifier.verifyProof(pA, pB, pC, publicSignals)) revert InvalidTallyProof();
        
        // 결과 저장 (voteId별)
        tallyResultYes[voteId] = publicSignals[13];
        tallyResultNo[voteId] = publicSignals[14];
        tallyResultAbstain[voteId] = publicSignals[15];
        tallyFinalized[voteId] = true;
        
        emit TallyFinalized(
            voteId,
            votingContract,
            tallyResultYes[voteId],
            tallyResultNo[voteId],
            tallyResultAbstain[voteId],
            publicSignals[0]
        );
    }
    
    // -----------------------------
    // GETTERS
    // -----------------------------
    function getTallyResult(uint256 voteId) external view returns (uint256 yes, uint256 no, uint256 abstain) {
        if (!tallyFinalized[voteId]) revert TallyNotFinalized();
        return (tallyResultYes[voteId], tallyResultNo[voteId], tallyResultAbstain[voteId]);
    }
    
    function isTallyFinalized(uint256 voteId) external view returns (bool) {
        return tallyFinalized[voteId];
    }
}