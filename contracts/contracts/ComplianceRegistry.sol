// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IComplianceRegistry} from "./IComplianceRegistry.sol";

/// @title ComplianceRegistry
/// @notice On-chain record of which addresses have cleared off-chain KYC and
/// which jurisdiction they cleared it from. The raffle and marketplace read
/// this to gate participation.
///
/// @dev PRIVACY: no personal data is ever stored here. Identity verification
/// happens off-chain at a KYC provider; this contract keeps only the wallet
/// address, an ISO 3166-1 alpha-2 country code, timestamps, and an opaque
/// `providerRef` hash pointing back at the provider's record. Names, document
/// images and dates of birth must never be written to a public chain.
///
/// @dev TRUST MODEL: `verifier` addresses are backend signers that attest to
/// completed verifications. They can allowlist and revoke, so their keys are
/// as sensitive as the owner key. The owner manages verifiers and the blocked
/// jurisdiction list.
contract ComplianceRegistry is IComplianceRegistry, Ownable2Step {
    enum Status {
        None, // never verified
        Verified, // cleared and currently valid
        Expired, // cleared, but re-verification is due
        Revoked, // manually withdrawn by a verifier
        BlockedJurisdiction, // cleared, but their country is not permitted
        SelfExcluded // cleared, but the player has excluded themselves
    }

    struct Record {
        bytes2 country; // ISO 3166-1 alpha-2, e.g. 0x5553 == "US"
        uint64 verifiedAt;
        uint64 expiresAt; // 0 == never expires
        bool revoked;
        bytes32 providerRef; // opaque pointer to the provider's record — not PII
    }

    mapping(address => Record) private _records;
    mapping(address => bool) public isVerifier;
    mapping(bytes2 => bool) public isBlockedCountry;

    /// @notice Unix second until which a player has excluded themselves from
    /// play. `type(uint64).max` means permanent.
    /// @dev Deliberately one-way: a player can start or extend an exclusion but
    /// nobody — not the player, not the operator — can shorten one. An
    /// exclusion a support agent could lift on request is not an exclusion.
    mapping(address => uint64) public selfExcludedUntil;

    event VerifierSet(address indexed verifier, bool allowed);
    event SelfExcluded(address indexed user, uint64 until);
    event VerificationSet(
        address indexed user,
        bytes2 country,
        uint64 expiresAt,
        bytes32 providerRef
    );
    event VerificationRevoked(address indexed user, address indexed verifier);
    event BlockedCountrySet(bytes2 country, bool blocked);

    modifier onlyVerifier() {
        require(isVerifier[msg.sender], "not a verifier");
        _;
    }

    constructor(address initialOwner, address initialVerifier) Ownable(initialOwner) {
        if (initialVerifier != address(0)) {
            isVerifier[initialVerifier] = true;
            emit VerifierSet(initialVerifier, true);
        }
    }

    // --- verifier actions -------------------------------------------------

    /// @notice Records a completed off-chain verification.
    /// @param expiresAt Unix seconds after which re-verification is required; 0 for never.
    function setVerification(
        address user,
        bytes2 country,
        uint64 expiresAt,
        bytes32 providerRef
    ) external onlyVerifier {
        require(user != address(0), "zero address");
        require(country != bytes2(0), "country required");
        require(expiresAt == 0 || expiresAt > block.timestamp, "already expired");

        _records[user] = Record({
            country: country,
            verifiedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false,
            providerRef: providerRef
        });

        emit VerificationSet(user, country, expiresAt, providerRef);
    }

    /// @notice Withdraws a verification (fraud, sanctions hit, provider recall).
    function revoke(address user) external onlyVerifier {
        require(_records[user].verifiedAt != 0, "not verified");
        _records[user].revoked = true;
        emit VerificationRevoked(user, msg.sender);
    }

    // --- player actions ---------------------------------------------------

    /// @notice Excludes the caller from play until `until` (or forever with
    /// `type(uint64).max`). Callable by the player only, and can never be
    /// shortened — extending is allowed, cancelling is not.
    function selfExclude(uint64 until) external {
        require(until > block.timestamp, "must be in the future");
        require(until > selfExcludedUntil[msg.sender], "cannot shorten exclusion");
        selfExcludedUntil[msg.sender] = until;
        emit SelfExcluded(msg.sender, until);
    }

    function isSelfExcluded(address user) public view returns (bool) {
        return selfExcludedUntil[user] > block.timestamp;
    }

    // --- owner actions ----------------------------------------------------

    function setVerifier(address verifier, bool allowed) external onlyOwner {
        require(verifier != address(0), "zero address");
        isVerifier[verifier] = allowed;
        emit VerifierSet(verifier, allowed);
    }

    /// @notice Blocks or unblocks a jurisdiction. Applies immediately to
    /// everyone already verified from that country.
    function setBlockedCountry(bytes2 country, bool blocked) external onlyOwner {
        require(country != bytes2(0), "country required");
        isBlockedCountry[country] = blocked;
        emit BlockedCountrySet(country, blocked);
    }

    // --- views ------------------------------------------------------------

    /// @dev Order matters. Self-exclusion is checked last among the blocking
    /// reasons so that a harder disqualification (revoked, blocked country,
    /// lapsed verification) always wins — those must also stop a payout,
    /// whereas self-exclusion must not.
    function statusOf(address user) public view returns (Status) {
        Record memory record = _records[user];
        if (record.verifiedAt == 0) return Status.None;
        if (record.revoked) return Status.Revoked;
        if (isBlockedCountry[record.country]) return Status.BlockedJurisdiction;
        if (record.expiresAt != 0 && block.timestamp >= record.expiresAt) return Status.Expired;
        if (isSelfExcluded(user)) return Status.SelfExcluded;
        return Status.Verified;
    }

    /// @notice May this address take part — buy, receive or trade a ticket?
    function isAllowed(address user) external view override returns (bool) {
        return statusOf(user) == Status.Verified;
    }

    /// @notice May this address be paid a prize it already holds?
    /// @dev Self-exclusion stops someone gambling; it must never be a reason to
    /// withhold money they have already won. Every other blocking status still
    /// withholds, because paying an unverified or barred person is the thing
    /// the rules actually prohibit.
    function canClaim(address user) external view returns (bool) {
        Status status = statusOf(user);
        return status == Status.Verified || status == Status.SelfExcluded;
    }

    function recordOf(address user) external view returns (Record memory) {
        return _records[user];
    }
}
