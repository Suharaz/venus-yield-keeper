import { parseAbi, type Address } from "viem";

/** BNB Smart Chain testnet. Addresses verified onchain 2026-10-04. */
export const CHAIN_ID = 97;

export const ADDR = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  vBNB: "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c",
  venusComptroller: "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D",
  fuguRegistry: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
  fuguSubscription: "0xfdb083371f44Cf53181350389D3217e51B431776",
  wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
  vWBNBCore: "0xd9E77847ec815E56ae2B9E69596C69b6972b0B1C",
  /** Venus isolated pool "Liquid Staked BNB" (PoolRegistry 0xC85491616Fa949E048F3aAc39fbf5b0703800667). */
  lstComptroller: "0x596B11acAACF03217287939f88d63b51d3771704",
  vWBNBLst: "0x231dED0Dfc99634e52EE1a1329586bc970d773b3",
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

/** Venus market for an ERC-20 underlying (core pool returns error codes, isolated pools revert). */
export const vErc20Abi = parseAbi([
  "function mint(uint256 mintAmount) returns (uint256)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function exchangeRateCurrent() returns (uint256)",
  "function supplyRatePerBlock() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

export const wbnbAbi = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const comptrollerAbi = parseAbi([
  "function actionPaused(address market, uint8 action) view returns (bool)",
  "function supplyCaps(address market) view returns (uint256)",
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

/** Bindings every agent Worker has. Agent-specific parameters extend this. */
export interface BaseEnv {
  STATE: KVNamespace;
  AGENT_PRIVATE_KEY: string;
  RPC_URL: string;
  /** ERC-8004 agentId; empty until registered. */
  AGENT_ID: string;
  /** HelloFugu listing id; empty until listed. */
  LISTING_ID: string;
  /** Public https origin of this Worker (cron has no request URL; used for deliverable links). */
  PUBLIC_URL: string;
}

export const EXPLORER = "https://testnet.bscscan.com";
export const REPO_URL = "https://github.com/Suharaz/venus-yield-keeper";
