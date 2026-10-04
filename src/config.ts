import { parseAbi, type Address } from "viem";

/** BNB Smart Chain testnet. Addresses verified onchain 2026-10-04. */
export const CHAIN_ID = 97;

export const ADDR = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  vBNB: "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c",
  venusComptroller: "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D",
  fuguRegistry: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
  fuguSubscription: "0xfdb083371f44Cf53181350389D3217e51B431776",
} as const satisfies Record<string, Address>;

/** BSC testnet ~0.45 s blocks -> 365 * 86400 / 0.45. Venus core pool rates are per block. */
export const BLOCKS_PER_YEAR = 70_080_000n;

export const vBnbAbi = parseAbi([
  "function mint() payable",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function exchangeRateCurrent() returns (uint256)",
  "function supplyRatePerBlock() view returns (uint256)",
]);

export const comptrollerAbi = parseAbi([
  "function actionPaused(address market, uint8 action) view returns (bool)",
]);

export const fuguSubscriptionAbi = parseAbi([
  "struct Sub { uint256 listingId; address subscriber; address payToken; uint128 deposited; uint128 claimed; uint64 startedAt; uint64 endsAt; bool cancelled; uint16 feeBps; }",
  "function subCount() view returns (uint256)",
  "function getSub(uint256 subId) view returns (Sub)",
  "function claimable(uint256 subId) view returns (uint256)",
  "function claim(uint256 subId)",
]);

export const fuguRegistryAbi = parseAbi([
  "function list(uint256 erc8004AgentId, address agentWallet, uint8 category, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI) returns (uint256 listingId)",
  "function listingByAgentId(uint256 erc8004AgentId) view returns (uint256)",
  "function updateListing(uint256 listingId, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI)",
]);

export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export interface Env {
  STATE: KVNamespace;
  AGENT_PRIVATE_KEY: string;
  RPC_URL: string;
  AGENT_ID: string;
  LISTING_ID: string;
  MIN_APY_BPS: string;
  BASE_TARGET_BPS: string;
  PER_HIRE_BPS: string;
  MAX_TARGET_BPS: string;
  BAND_BPS: string;
  GAS_RESERVE_WEI: string;
  HARVEST_MIN_WEI: string;
}
