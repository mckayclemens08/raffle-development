// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @notice Minimal VRF 2.5 coordinator for tests and local dev.
///
/// @dev Chainlink ships VRFCoordinatorV2_5Mock, but its dependency chain imports
/// OpenZeppelin through a version-pinned path alias that Hardhat's resolver
/// can't follow. Our contract only ever calls `requestRandomWords`, so this
/// implements that one function plus a manual fulfilment trigger.
///
/// Deliberately does NOT mimic subscription funding or callback gas limits, so
/// don't read a passing test here as proof the real coordinator will behave.
/// Tests only, never deploy to a real network.
contract MockVRFCoordinatorV2Plus {
    uint256 public nextRequestId = 1;

    mapping(uint256 => address) public requesterOf;

    event RandomWordsRequested(uint256 indexed requestId, address indexed requester);

    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata /* request */
    ) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requesterOf[requestId] = msg.sender;
        emit RandomWordsRequested(requestId, msg.sender);
    }

    /// @notice Delivers a chosen random word, the way the real coordinator would.
    function fulfillRandomWordsWithOverride(
        uint256 requestId,
        address consumer,
        uint256[] calldata words
    ) external {
        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, words);
    }

    /// @notice Simulates a coordinator that never calls back — used to prove the
    /// retry path in requestDraw actually rescues a stuck round.
    function dropRequest(uint256 requestId) external {
        delete requesterOf[requestId];
    }
}
