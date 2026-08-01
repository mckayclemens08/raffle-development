import type { Abi } from "viem";
import { formatUnits, parseUnits } from "viem";
import lotteryAbi from "./abi/LotteryTicket.json";
import marketAbi from "./abi/TicketMarket.json";
import erc20Abi from "./abi/ERC20.json";
import complianceAbi from "./abi/ComplianceRegistry.json";

export const LOTTERY_ADDRESS = (process.env.NEXT_PUBLIC_LOTTERY_ADDRESS || "") as `0x${string}`;
export const MARKET_ADDRESS = (process.env.NEXT_PUBLIC_MARKET_ADDRESS || "") as `0x${string}`;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || "") as `0x${string}`;
export const COMPLIANCE_ADDRESS = (process.env.NEXT_PUBLIC_COMPLIANCE_ADDRESS || "") as `0x${string}`;
export const TARGET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

export const LOTTERY_ABI = lotteryAbi as Abi;
export const MARKET_ABI = marketAbi as Abi;
export const ERC20_ABI = erc20Abi as Abi;
export const COMPLIANCE_ABI = complianceAbi as Abi;

export const USDC_DECIMALS = 6;

/// Mirrors LotteryTicket.drawRetryTimeout's default. Only used to label the
/// admin retry button — the contract is the authority and will reject an early
/// retry regardless of what the UI shows.
export const DRAW_RETRY_TIMEOUT_SECONDS = 60 * 60;

export function formatUsdc(value: bigint): string {
  const asNumber = Number(formatUnits(value, USDC_DECIMALS));
  return asNumber.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseUsdc(value: string): bigint {
  return parseUnits(value, USDC_DECIMALS);
}
