import type { Abi } from "viem";
import lotteryAbi from "./abi/LotteryTicket.json";
import marketAbi from "./abi/TicketMarket.json";

export const LOTTERY_ADDRESS = (process.env.NEXT_PUBLIC_LOTTERY_ADDRESS || "") as `0x${string}`;
export const MARKET_ADDRESS = (process.env.NEXT_PUBLIC_MARKET_ADDRESS || "") as `0x${string}`;
export const TARGET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

export const LOTTERY_ABI = lotteryAbi as Abi;
export const MARKET_ABI = marketAbi as Abi;
