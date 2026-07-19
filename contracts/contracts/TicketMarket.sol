// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TicketMarket
/// @notice Secondary marketplace for reselling LotteryTicket NFTs before a round is drawn.
contract TicketMarket is Ownable, ReentrancyGuard {
    uint256 public constant PLATFORM_FEE_BPS = 200; // 2%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IERC721 public immutable ticketContract;
    address public feeRecipient;

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    event TicketListed(uint256 indexed ticketId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed ticketId, address indexed seller);
    event TicketSold(uint256 indexed ticketId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);

    constructor(address initialOwner, address _ticketContract, address _feeRecipient) Ownable(initialOwner) {
        ticketContract = IERC721(_ticketContract);
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

    function buyTicket(uint256 ticketId) external payable nonReentrant {
        Listing storage listing = listings[ticketId];
        require(listing.active, "not listed");
        require(msg.value == listing.price, "incorrect payment");
        require(ticketContract.ownerOf(ticketId) == listing.seller, "seller no longer owns ticket");

        address seller = listing.seller;
        uint256 price = listing.price;
        listing.active = false;

        uint256 fee = (price * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerProceeds = price - fee;

        ticketContract.safeTransferFrom(seller, msg.sender, ticketId);

        (bool feeSent, ) = feeRecipient.call{value: fee}("");
        require(feeSent, "fee transfer failed");
        (bool sellerSent, ) = seller.call{value: sellerProceeds}("");
        require(sellerSent, "seller transfer failed");

        emit TicketSold(ticketId, seller, msg.sender, price, fee);
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "zero address");
        feeRecipient = _feeRecipient;
    }
}
