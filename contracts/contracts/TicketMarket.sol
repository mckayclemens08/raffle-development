// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LotteryTicket} from "./LotteryTicket.sol";

/// @title TicketMarket
/// @notice Secondary marketplace for reselling LotteryTicket NFTs before a round
/// is drawn. Sales settle in the same stablecoin (USDC) the raffle uses; listing
/// prices use the token's native decimals (6 for USDC). Of the 3% sale fee, 2%
/// goes to the platform and 1% is routed into the raffle's current prize pool,
/// so secondary volume also grows the jackpot.
contract TicketMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PLATFORM_FEE_BPS = 200; // 2% to the platform
    uint256 public constant POOL_FEE_BPS = 100; // 1% into the prize pool
    uint256 public constant BPS_DENOMINATOR = 10_000;

    LotteryTicket public immutable ticketContract;
    IERC20 public immutable paymentToken;
    address public feeRecipient;

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
        address _feeRecipient
    ) Ownable(initialOwner) {
        require(_paymentToken != address(0), "zero payment token");
        ticketContract = LotteryTicket(_ticketContract);
        paymentToken = IERC20(_paymentToken);
        feeRecipient = _feeRecipient;
    }

    function listTicket(uint256 ticketId, uint256 price) external {
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

    function buyTicket(uint256 ticketId) external nonReentrant {
        Listing storage listing = listings[ticketId];
        require(listing.active, "not listed");
        require(ticketContract.ownerOf(ticketId) == listing.seller, "seller no longer owns ticket");

        address seller = listing.seller;
        uint256 price = listing.price;
        listing.active = false;

        uint256 platformFee = (price * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 poolFee = (price * POOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerProceeds = price - platformFee - poolFee;

        ticketContract.safeTransferFrom(seller, msg.sender, ticketId);

        // Pull the full price once, then distribute: platform fee, pool share
        // (via the raffle's donation hook), and seller proceeds.
        paymentToken.safeTransferFrom(msg.sender, address(this), price);
        paymentToken.safeTransfer(feeRecipient, platformFee);
        if (poolFee > 0) {
            paymentToken.forceApprove(address(ticketContract), poolFee);
            ticketContract.donateToPool(poolFee);
        }
        paymentToken.safeTransfer(seller, sellerProceeds);

        emit TicketSold(ticketId, seller, msg.sender, price, platformFee, poolFee);
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "zero address");
        feeRecipient = _feeRecipient;
    }
}
