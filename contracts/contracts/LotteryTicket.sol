// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerBaseV2} from "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import {VRFCoordinatorV2Interface} from "@chainlink/contracts/src/v0.8/vrf/interfaces/VRFCoordinatorV2Interface.sol";

/// @title LotteryTicket
/// @notice Monthly raffle where ticket price rises with demand within a round.
/// Tickets are paid for in a stablecoin (USDC); prices use the token's native
/// decimals (6 for USDC). Winning ticket is chosen via Chainlink VRF; whoever
/// holds the NFT at draw time (tickets are transferable, see TicketMarket)
/// wins the pool.
/// @dev ERC721Enumerable lets the frontend list a wallet's tickets without an indexer.
contract LotteryTicket is ERC721Enumerable, Ownable, ReentrancyGuard, VRFConsumerBaseV2 {
    using SafeERC20 for IERC20;

    uint256 public constant PLATFORM_FEE_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Round {
        uint256 startTime;
        uint256 endTime;
        uint256 firstTicketId;
        uint256 ticketsSold;
        uint256 pool;
        uint256 vrfRequestId;
        uint256 winnerTicketId;
        bool drawn;
        bool paid;
    }

    IERC20 public immutable paymentToken;
    uint256 public basePrice;
    uint256 public priceIncrement;
    uint256 public roundDuration;
    address public feeRecipient;

    uint256 public currentRound;
    uint256 private _nextTicketId = 1;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => uint256) public requestIdToRound;

    VRFCoordinatorV2Interface public immutable vrfCoordinator;
    bytes32 public keyHash;
    uint64 public vrfSubscriptionId;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant CALLBACK_GAS_LIMIT = 200_000;

    event RoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime);
    event TicketPurchased(uint256 indexed roundId, uint256 indexed ticketId, address indexed buyer, uint256 price);
    event DrawRequested(uint256 indexed roundId, uint256 requestId);
    event WinnerDrawn(uint256 indexed roundId, uint256 indexed winnerTicketId, address winner);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 payout, uint256 fee);

    constructor(
        address initialOwner,
        address _vrfCoordinator,
        address _paymentToken,
        bytes32 _keyHash,
        uint64 _vrfSubscriptionId,
        uint256 _basePrice,
        uint256 _priceIncrement,
        uint256 _roundDuration,
        address _feeRecipient
    )
        ERC721("Decentralized Lottery Ticket", "DLOT")
        Ownable(initialOwner)
        VRFConsumerBaseV2(_vrfCoordinator)
    {
        require(_paymentToken != address(0), "zero payment token");
        paymentToken = IERC20(_paymentToken);
        vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinator);
        keyHash = _keyHash;
        vrfSubscriptionId = _vrfSubscriptionId;
        basePrice = _basePrice;
        priceIncrement = _priceIncrement;
        roundDuration = _roundDuration;
        feeRecipient = _feeRecipient;

        currentRound = 1;
        rounds[1].startTime = block.timestamp;
        rounds[1].endTime = block.timestamp + _roundDuration;
        rounds[1].firstTicketId = _nextTicketId;
        emit RoundStarted(1, block.timestamp, rounds[1].endTime);
    }

    /// @notice Price rises linearly with tickets already sold in the round.
    function getCurrentPrice(uint256 roundId) public view returns (uint256) {
        return basePrice + (rounds[roundId].ticketsSold * priceIncrement);
    }

    /// @param maxPrice Cap on what the buyer is willing to pay — protects against
    /// the price rising between quoting and the transaction landing.
    function buyTicket(uint256 maxPrice) external nonReentrant returns (uint256 ticketId) {
        Round storage round = rounds[currentRound];
        require(block.timestamp < round.endTime, "round closed");

        uint256 price = getCurrentPrice(currentRound);
        require(price <= maxPrice, "price exceeds maxPrice");

        ticketId = _nextTicketId++;
        round.ticketsSold += 1;
        round.pool += price;

        paymentToken.safeTransferFrom(msg.sender, address(this), price);

        _safeMint(msg.sender, ticketId);
        emit TicketPurchased(currentRound, ticketId, msg.sender, price);
    }

    /// @notice Permissionless: anyone can trigger the draw once a round's window has closed.
    function requestDraw() external returns (uint256 requestId) {
        Round storage round = rounds[currentRound];
        require(block.timestamp >= round.endTime, "round still open");
        require(round.ticketsSold > 0, "no tickets sold");
        require(round.vrfRequestId == 0, "draw already requested");

        requestId = vrfCoordinator.requestRandomWords(
            keyHash,
            vrfSubscriptionId,
            REQUEST_CONFIRMATIONS,
            CALLBACK_GAS_LIMIT,
            1
        );

        round.vrfRequestId = requestId;
        requestIdToRound[requestId] = currentRound;
        emit DrawRequested(currentRound, requestId);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        uint256 roundId = requestIdToRound[requestId];
        Round storage round = rounds[roundId];
        require(!round.drawn, "already drawn");

        uint256 winnerIndex = randomWords[0] % round.ticketsSold;
        round.winnerTicketId = round.firstTicketId + winnerIndex;
        round.drawn = true;

        emit WinnerDrawn(roundId, round.winnerTicketId, ownerOf(round.winnerTicketId));
    }

    function claimPrize(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        require(round.drawn, "not drawn yet");
        require(!round.paid, "already paid");

        address winner = ownerOf(round.winnerTicketId);
        require(msg.sender == winner, "not the winning ticket holder");

        round.paid = true;

        uint256 fee = (round.pool * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = round.pool - fee;

        paymentToken.safeTransfer(feeRecipient, fee);
        paymentToken.safeTransfer(winner, payout);

        emit PrizeClaimed(roundId, winner, payout, fee);
    }

    /// @notice Opens the next round. Requires the previous round to be fully settled.
    function startNewRound() external onlyOwner {
        Round storage prev = rounds[currentRound];
        require(prev.ticketsSold == 0 || prev.paid, "previous round unsettled");

        currentRound += 1;
        Round storage round = rounds[currentRound];
        round.startTime = block.timestamp;
        round.endTime = block.timestamp + roundDuration;
        round.firstTicketId = _nextTicketId;

        emit RoundStarted(currentRound, round.startTime, round.endTime);
    }

    function setPricing(uint256 _basePrice, uint256 _priceIncrement) external onlyOwner {
        basePrice = _basePrice;
        priceIncrement = _priceIncrement;
    }

    function setRoundDuration(uint256 _roundDuration) external onlyOwner {
        roundDuration = _roundDuration;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "zero address");
        feeRecipient = _feeRecipient;
    }

    function setVrfConfig(bytes32 _keyHash, uint64 _vrfSubscriptionId) external onlyOwner {
        keyHash = _keyHash;
        vrfSubscriptionId = _vrfSubscriptionId;
    }
}
