// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal read interface the raffle and marketplace depend on, so
/// either can point at a replacement registry without a code change.
interface IComplianceRegistry {
    /// @notice May this address take part — buy, receive or trade a ticket?
    function isAllowed(address user) external view returns (bool);

    /// @notice May this address be paid a prize it already holds? Looser than
    /// `isAllowed`, because a self-excluded player must still be able to
    /// collect winnings from before they excluded themselves.
    function canClaim(address user) external view returns (bool);
}
