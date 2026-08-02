// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IComplianceRegistry} from "./IComplianceRegistry.sol";

/// @title LotteryTicket
/// @notice Monthly raffle where ticket price rises with demand within a round.
/// Tickets are paid for in a stablecoin (USDC); prices use the token's native
/// decimals (6 for USDC). The winning ticket is chosen via Chainlink VRF 2.5;
/// whoever holds the NFT at draw time (tickets are transferable, see
/// TicketMarket) wins the pool.
///
/// @dev OWNERSHIP is two-step, inherited from Chainlink's ConfirmedOwner via
/// VRFConsumerBaseV2Plus: the deployer starts as owner and hands over with
/// transferOwnership + acceptOwnership, so a fat-fingered address can't brick
/// the contract. Transfer to a multisig (with a timelock on sensitive setters)
/// before handling real money.
///
/// @dev ERC721Enumerable lets the frontend list a wallet's tickets without an indexer.
contract LotteryTicket is ERC721Enumerable, Pausable, ReentrancyGuard, VRFConsumerBaseV2Plus {
    using SafeERC20 for IERC20;

    uint256 public constant PLATFORM_FEE_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Round {
        uint256 startTime;
        uint256 endTime;
        /// @dev The price the *next* ticket in this round costs. Stored and
        /// stepped on each sale rather than recomputed, so percentage growth
        /// costs the same gas at ticket 5 as at ticket 5,000.
        uint256 currentPrice;
        uint256 firstTicketId;
        uint256 ticketsSold;
        uint256 pool;
        uint256 vrfRequestId;
        uint256 winnerTicketId;
        uint64 drawRequestedAt;
        uint64 drawnAt;
        bool drawn;
        bool paid;
        bool swept;
    }

    /// @notice The stablecoin tickets and prizes settle in.
    /// @dev Settable rather than immutable so an issuer freezing this contract,
    /// or deprecating the token, doesn't force a redeploy and a migration of
    /// every ticket and balance. See setPaymentToken for the safety guard.
    IERC20 public paymentToken;
    IComplianceRegistry public complianceRegistry;
    uint256 public basePrice;

    /// @notice How much each sale raises the price, in basis points of the
    /// current price (100 = 1%). Growth compounds, so it is exponential:
    /// at 2% a $1 ticket is $7.24 by the 100th sale and $52 by the 200th.
    uint256 public priceIncrementBps;

    /// @notice Ceiling on the ticket price; 0 disables it. Exponential growth
    /// runs away at high volume, and a lottery whose tickets cost hundreds of
    /// dollars has priced out the people it was built for.
    uint256 public maxTicketPrice;
    uint256 public roundDuration;
    address public feeRecipient;

    /// @notice How long a winner has to claim before the prize can be swept.
    uint256 public claimWindow = 90 days;
    /// @notice How long to wait for a VRF callback before a draw may be retried.
    uint256 public drawRetryTimeout = 1 hours;

    /// @dev Platform fees accrue here rather than being pushed on every claim.
    /// A push would couple the winner's payout to the fee recipient being able
    /// to receive — and USDC can freeze an address, which would otherwise make
    /// claimPrize revert and strand the winner's money.
    uint256 public accruedFees;

    /// @notice Everything the contract currently owes: unsettled prize pools
    /// plus accrued fees.
    /// @dev Tracked internally rather than read from `balanceOf`, because a
    /// raw balance check can be griefed — anyone can send a single token unit
    /// to the contract and permanently block a payment-token migration. Dust
    /// sent here is simply ignored.
    uint256 public totalEscrowed;

    uint256 public currentRound;
    uint256 private _nextTicketId = 1;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => uint256) public requestIdToRound;

    bytes32 public keyHash;
    uint256 public vrfSubscriptionId;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant CALLBACK_GAS_LIMIT = 200_000;

    event RoundStarted(uint256 indexed roundId, uint256 startTime, uint256 endTime);
    event TicketPurchased(uint256 indexed roundId, uint256 indexed ticketId, address indexed buyer, uint256 price);
    event PoolDonated(uint256 indexed roundId, address indexed from, uint256 amount);
    event ComplianceRegistrySet(address indexed registry);
    event PaymentTokenSet(address indexed token);
    event DrawRequested(uint256 indexed roundId, uint256 requestId, bool isRetry);
    event WinnerDrawn(uint256 indexed roundId, uint256 indexed winnerTicketId, address winner);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 payout, uint256 fee);
    event UnclaimedPrizeSwept(uint256 indexed roundId, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor(
        address _vrfCoordinator,
        address _paymentToken,
        address _complianceRegistry,
        bytes32 _keyHash,
        uint256 _vrfSubscriptionId,
        uint256 _basePrice,
        uint256 _priceIncrementBps,
        uint256 _roundDuration,
        address _feeRecipient
    ) ERC721("Decentralized Lottery Ticket", "DLOT") VRFConsumerBaseV2Plus(_vrfCoordinator) {
        require(_paymentToken != address(0), "zero payment token");
        require(_complianceRegistry != address(0), "zero compliance registry");
        require(_feeRecipient != address(0), "zero fee recipient");

        paymentToken = IERC20(_paymentToken);
        complianceRegistry = IComplianceRegistry(_complianceRegistry);
        keyHash = _keyHash;
        vrfSubscriptionId = _vrfSubscriptionId;
        require(_basePrice > 0, "zero base price");
        basePrice = _basePrice;
        priceIncrementBps = _priceIncrementBps;
        roundDuration = _roundDuration;
        feeRecipient = _feeRecipient;

        currentRound = 1;
        rounds[1].startTime = block.timestamp;
        rounds[1].endTime = block.timestamp + _roundDuration;
        rounds[1].firstTicketId = _nextTicketId;
        rounds[1].currentPrice = _basePrice;
        emit RoundStarted(1, block.timestamp, rounds[1].endTime);
    }

    /// @notice What the next ticket in this round costs.
    /// @dev Falls back to basePrice for a round that was never opened, so the
    /// UI shows a sensible figure rather than $0.
    function getCurrentPrice(uint256 roundId) public view returns (uint256) {
        uint256 stored = rounds[roundId].currentPrice;
        return stored == 0 ? basePrice : stored;
    }

    /// @param maxPrice Cap on what the buyer is willing to pay — protects against
    /// the price rising between quoting and the transaction landing.
    function buyTicket(uint256 maxPrice) external nonReentrant whenNotPaused returns (uint256 ticketId) {
        // Also enforced in _update for every transfer; checked here so an
        // unverified buyer gets a clear reason rather than a transfer failure.
        require(complianceRegistry.isAllowed(msg.sender), "compliance: not verified");

        Round storage round = rounds[currentRound];
        require(block.timestamp < round.endTime, "round closed");

        uint256 price = getCurrentPrice(currentRound);
        require(price <= maxPrice, "price exceeds maxPrice");

        ticketId = _nextTicketId++;
        round.ticketsSold += 1;
        round.pool += price;
        totalEscrowed += price;

        // Step the price for the next buyer. Integer division rounds the
        // increment down, so a percentage too small to move the price at this
        // magnitude simply leaves it flat rather than reverting.
        uint256 next = price + ((price * priceIncrementBps) / BPS_DENOMINATOR);
        if (maxTicketPrice != 0 && next > maxTicketPrice) next = maxTicketPrice;
        round.currentPrice = next;

        paymentToken.safeTransferFrom(msg.sender, address(this), price);

        _safeMint(msg.sender, ticketId);
        emit TicketPurchased(currentRound, ticketId, msg.sender, price);
    }

    /// @notice Adds USDC to the current round's prize pool without minting a
    /// ticket. Used by TicketMarket to route a share of resale fees into the
    /// pool; open to anyone (a donation only ever benefits ticket holders).
    /// If the current round is already settled, the amount is treated as
    /// platform revenue so funds can never be stranded in a closed round.
    function donateToPool(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        totalEscrowed += amount;

        Round storage round = rounds[currentRound];
        if (round.drawn) {
            accruedFees += amount;
        } else {
            round.pool += amount;
            emit PoolDonated(currentRound, msg.sender, amount);
        }
    }

    /// @notice Permissionless: anyone can trigger the draw once a round's window
    /// has closed. Retryable — if Chainlink accepts a request but the callback
    /// never lands (subscription out of funds, callback gas too low, coordinator
    /// incident), the round would otherwise be stuck and its pool locked
    /// forever. After `drawRetryTimeout` the request can be reissued.
    /// @dev The request id only exists once the coordinator call returns, so
    /// the state writes cannot precede it. Safe because this is nonReentrant
    /// and the callee is the VRF coordinator we configure, not user input.
    // slither-disable-next-line reentrancy-no-eth
    function requestDraw() external nonReentrant returns (uint256 requestId) {
        Round storage round = rounds[currentRound];
        require(block.timestamp >= round.endTime, "round still open");
        require(round.ticketsSold > 0, "no tickets sold");
        require(!round.drawn, "already drawn");

        bool isRetry = round.vrfRequestId != 0;
        require(
            !isRetry || block.timestamp >= round.drawRequestedAt + drawRetryTimeout,
            "draw pending, retry later"
        );

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: CALLBACK_GAS_LIMIT,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}))
            })
        );

        round.vrfRequestId = requestId;
        round.drawRequestedAt = uint64(block.timestamp);
        requestIdToRound[requestId] = currentRound;
        emit DrawRequested(currentRound, requestId, isRetry);
    }

    /// @dev Never reverts on a duplicate. After a retry the original request may
    /// still be fulfilled later; reverting would make Chainlink's callback fail
    /// and burn the subscription's gas for nothing. First fulfilment wins.
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        uint256 roundId = requestIdToRound[requestId];
        if (roundId == 0) return;

        Round storage round = rounds[roundId];
        if (round.drawn) return;

        uint256 winnerIndex = randomWords[0] % round.ticketsSold;
        round.winnerTicketId = round.firstTicketId + winnerIndex;
        round.drawn = true;
        round.drawnAt = uint64(block.timestamp);

        emit WinnerDrawn(roundId, round.winnerTicketId, ownerOf(round.winnerTicketId));
    }

    /// @notice Not pausable — a player must always be able to take their money
    /// out, even while the rest of the platform is halted.
    function claimPrize(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        require(round.drawn, "not drawn yet");
        require(!round.paid, "already paid");
        require(!round.swept, "claim window closed");

        address winner = ownerOf(round.winnerTicketId);
        require(msg.sender == winner, "not the winning ticket holder");
        // Holders are verified at acquisition, but a verification can lapse or be
        // revoked afterwards. Withhold the payout until they are current again —
        // the funds stay escrowed in the round, they are not lost. `canClaim`
        // rather than `isAllowed` so self-exclusion stops further play without
        // confiscating winnings the player already holds.
        require(complianceRegistry.canClaim(winner), "compliance: winner not verified");

        round.paid = true;

        uint256 fee = (round.pool * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = round.pool - fee;

        accruedFees += fee;
        totalEscrowed -= payout;
        paymentToken.safeTransfer(winner, payout);

        emit PrizeClaimed(roundId, winner, payout, fee);
    }

    /// @notice Sweeps a prize nobody claimed within the window. Permissionless
    /// so the platform can't be held hostage by an inactive operator either.
    function sweepUnclaimed(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        require(round.drawn, "not drawn yet");
        require(!round.paid, "already paid");
        require(!round.swept, "already swept");
        require(block.timestamp >= round.drawnAt + claimWindow, "claim window still open");

        round.swept = true;
        uint256 amount = round.pool;
        accruedFees += amount;

        emit UnclaimedPrizeSwept(roundId, amount);
    }

    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        require(amount > 0, "nothing to withdraw");
        accruedFees = 0;
        totalEscrowed -= amount;
        paymentToken.safeTransfer(feeRecipient, amount);
        emit FeesWithdrawn(feeRecipient, amount);
    }

    /// @notice Opens the next round. Only needs the previous round *drawn*, not
    /// claimed — otherwise one winner who never claims (lost keys, lost interest)
    /// would halt the platform permanently. They can still claim from the old
    /// round for the whole claim window.
    function startNewRound() external onlyOwner {
        Round storage prev = rounds[currentRound];
        require(prev.ticketsSold == 0 || prev.drawn, "previous round not drawn");

        currentRound += 1;
        Round storage round = rounds[currentRound];
        round.startTime = block.timestamp;
        round.endTime = block.timestamp + roundDuration;
        round.firstTicketId = _nextTicketId;
        // Picks up any basePrice change made since the last round — pricing
        // never shifts under players mid-round.
        round.currentPrice = basePrice;

        emit RoundStarted(currentRound, round.startTime, round.endTime);
    }

    // --- owner controls ---------------------------------------------------

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sets the opening price and the per-sale growth rate.
    /// @dev Takes effect from the next round. The open round keeps the price
    /// curve players bought into, which is the honest behaviour.
    function setPricing(uint256 _basePrice, uint256 _priceIncrementBps) external onlyOwner {
        require(_basePrice > 0, "zero base price");
        basePrice = _basePrice;
        priceIncrementBps = _priceIncrementBps;
    }

    /// @param _maxTicketPrice 0 removes the ceiling.
    function setMaxTicketPrice(uint256 _maxTicketPrice) external onlyOwner {
        maxTicketPrice = _maxTicketPrice;
    }

    function setRoundDuration(uint256 _roundDuration) external onlyOwner {
        roundDuration = _roundDuration;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "zero address");
        feeRecipient = _feeRecipient;
    }

    function setVrfConfig(bytes32 _keyHash, uint256 _vrfSubscriptionId) external onlyOwner {
        keyHash = _keyHash;
        vrfSubscriptionId = _vrfSubscriptionId;
    }

    function setComplianceRegistry(address _complianceRegistry) external onlyOwner {
        require(_complianceRegistry != address(0), "zero compliance registry");
        complianceRegistry = IComplianceRegistry(_complianceRegistry);
        emit ComplianceRegistrySet(_complianceRegistry);
    }

    /// @notice Switches the settlement stablecoin.
    ///
    /// @dev Only allowed when this contract holds none of the current token.
    /// A pool is denominated in whatever was paid in, so switching while funds
    /// are escrowed would leave prizes owed in one token and payable in
    /// another. Requiring a zero balance is a single cheap check that proves
    /// nothing can be stranded: every prize claimed or swept, every fee
    /// withdrawn.
    ///
    /// The practical sequence is therefore: pause, let the open round finish
    /// and be claimed (or wait out the claim window and sweep), withdraw fees,
    /// switch, unpause.
    function setPaymentToken(address _paymentToken) external onlyOwner {
        require(_paymentToken != address(0), "zero payment token");
        require(_paymentToken != address(paymentToken), "same payment token");
        require(totalEscrowed == 0, "settle balances first");

        paymentToken = IERC20(_paymentToken);
        emit PaymentTokenSet(_paymentToken);
    }

    function setClaimWindow(uint256 _claimWindow) external onlyOwner {
        require(_claimWindow >= 7 days, "claim window too short");
        claimWindow = _claimWindow;
    }

    function setDrawRetryTimeout(uint256 _drawRetryTimeout) external onlyOwner {
        require(_drawRetryTimeout >= 5 minutes, "retry timeout too short");
        drawRetryTimeout = _drawRetryTimeout;
    }

    // --- internals --------------------------------------------------------

    /// @dev Compliance is enforced at the token level, not just in buyTicket:
    /// a raw ERC721 transferFrom would otherwise move a ticket to an
    /// unverified or blocked address and bypass the gate entirely. Burns
    /// (to == 0) are exempt so tickets are never permanently stuck.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721Enumerable) returns (address) {
        if (to != address(0)) {
            require(complianceRegistry.isAllowed(to), "compliance: recipient not verified");
        }
        return super._update(to, tokenId, auth);
    }
}
