// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LotteryTicket} from "./LotteryTicket.sol";
import {IComplianceRegistry} from "./IComplianceRegistry.sol";

/// @title TicketMarket
/// @notice Secondary marketplace for reselling LotteryTicket NFTs before a round
/// is drawn. Sales settle in the same stablecoin (USDC) the raffle uses; listing
/// prices use the token's native decimals (6 for USDC). Of the 3% sale fee, 2%
/// goes to the platform and 1% is routed into the raffle's current prize pool,
/// so secondary volume also grows the jackpot.
contract TicketMarket is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PLATFORM_FEE_BPS = 200; // 2% to the platform
    uint256 public constant POOL_FEE_BPS = 100; // 1% into the prize pool
    uint256 public constant BPS_DENOMINATOR = 10_000;

    LotteryTicket public immutable ticketContract;
    /// @dev Settable for the same reason as the raffle's: a frozen or retired
    /// stablecoin shouldn't force a redeploy. Must be kept in step with the
    /// raffle's token, since a sale routes 1% into its prize pool.
    IERC20 public paymentToken;
    IComplianceRegistry public complianceRegistry;
    address public feeRecipient;

    /// @dev Accrued rather than pushed on every sale, so a fee recipient that
    /// can't receive (USDC can freeze an address) never blocks a trade between
    /// two unrelated players.
    uint256 public accruedFees;

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    event TicketListed(uint256 indexed ticketId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed ticketId, address indexed seller);
    event TicketSold(
        uint256 indexed ticketId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 platformFee,
        uint256 poolFee
    );

    constructor(
        address initialOwner,
        address _ticketContract,
        address _paymentToken,
        address _complianceRegistry,
        address _feeRecipient
    ) Ownable(initialOwner) {
        require(_paymentToken != address(0), "zero payment token");
        require(_complianceRegistry != address(0), "zero compliance registry");
        require(_feeRecipient != address(0), "zero fee recipient");
        ticketContract = LotteryTicket(_ticketContract);
        paymentToken = IERC20(_paymentToken);
        complianceRegistry = IComplianceRegistry(_complianceRegistry);
        feeRecipient = _feeRecipient;
    }

    function listTicket(uint256 ticketId, uint256 price) external whenNotPaused {
        require(complianceRegistry.isAllowed(msg.sender), "compliance: not verified");
        require(price > 0, "price must be > 0");
        require(ticketContract.ownerOf(ticketId) == msg.sender, "not ticket owner");
        require(
            ticketContract.getApproved(ticketId) == address(this) ||
                ticketContract.isApprovedForAll(msg.sender, address(this)),
            "market not approved"
        );

        listings[ticketId] = Listing({seller: msg.sender, price: price, active: true});
        emit TicketListed(ticketId, msg.sender, price);
    }

    function cancelListing(uint256 ticketId) external {
        Listing storage listing = listings[ticketId];
        require(listing.active, "not listed");
        require(listing.seller == msg.sender, "not seller");

        listing.active = false;
        emit ListingCancelled(ticketId, msg.sender);
    }

    function buyTicket(uint256 ticketId) external nonReentrant whenNotPaused {
        require(complianceRegistry.isAllowed(msg.sender), "compliance: not verified");

        Listing storage listing = listings[ticketId];
        require(listing.active, "not listed");
        require(ticketContract.ownerOf(ticketId) == listing.seller, "seller no longer owns ticket");

        address seller = listing.seller;
        uint256 price = listing.price;
        listing.active = false;

        uint256 platformFee = (price * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 poolFee = (price * POOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerProceeds = price - platformFee - poolFee;

        // Accounting before any external call (checks-effects-interactions).
        accruedFees += platformFee;

        ticketContract.safeTransferFrom(seller, msg.sender, ticketId);

        // Pull the full price once, then distribute: pool share (via the
        // raffle's donation hook) and seller proceeds. The platform fee stays
        // in this contract until withdrawn.
        paymentToken.safeTransferFrom(msg.sender, address(this), price);
        if (poolFee > 0) {
            paymentToken.forceApprove(address(ticketContract), poolFee);
            ticketContract.donateToPool(poolFee);
        }
        paymentToken.safeTransfer(seller, sellerProceeds);

        emit TicketSold(ticketId, seller, msg.sender, price, platformFee, poolFee);
    }

    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        require(amount > 0, "nothing to withdraw");
        accruedFees = 0;
        paymentToken.safeTransfer(feeRecipient, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "zero address");
        feeRecipient = _feeRecipient;
    }

    function setComplianceRegistry(address _complianceRegistry) external onlyOwner {
        require(_complianceRegistry != address(0), "zero compliance registry");
        complianceRegistry = IComplianceRegistry(_complianceRegistry);
    }

    /// @notice Switches the settlement stablecoin. Must match the raffle's, or
    /// the 1% pool share can't be routed into it.
    /// @dev Guarded on a zero balance for the same reason as the raffle: any
    /// accrued fee is denominated in the token it was collected in, so it must
    /// be withdrawn before the token changes.
    function setPaymentToken(address _paymentToken) external onlyOwner {
        require(_paymentToken != address(0), "zero payment token");
        require(_paymentToken != address(paymentToken), "same payment token");
        // Internal accounting, not balanceOf: a raw balance check could be
        // blocked forever by anyone dusting the contract with the old token.
        require(accruedFees == 0, "withdraw fees first");
        require(
            _paymentToken == address(ticketContract.paymentToken()),
            "must match raffle payment token"
        );

        paymentToken = IERC20(_paymentToken);
    }
}
