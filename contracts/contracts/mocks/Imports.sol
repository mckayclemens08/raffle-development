// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Pulls the Chainlink VRF mock coordinator into the compilation set so
// Hardhat generates artifacts/typings for it, for use in tests only.
import {VRFCoordinatorV2Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";
