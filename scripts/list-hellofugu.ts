/** Lists the agent on HelloFugu (FuguRegistry.list) as a YIELD agent, or updates price/period if already listed. */
import { ADDR, fuguRegistryAbi } from "../src/config";
import { agentAccount, baseUrl, ownerClient, publicClient, required } from "./env";

const YIELD = 2; // FuguRegistry Category enum: 0 REBALANCING, 1 GRID, 2 YIELD, 3 HEALTH_FACTOR
const PRICE_USD8 = 5_000_000n; // $0.05 per period (8-decimal USD), same as most Fugu agents
// 15 min: longer than the 5-min cron, so every hire is seen active (supply) and then ended (withdraw).
const PERIOD_SECONDS = 900;

const owner = ownerClient();
const agentId = BigInt(required("AGENT_ID"));
const registry = { address: ADDR.fuguRegistry, abi: fuguRegistryAbi } as const;

const metadataURI = `${baseUrl()}/.well-known/agent-registration.json`;
let listingId = await publicClient.readContract({ ...registry, functionName: "listingByAgentId", args: [agentId] });
if (listingId === 0n) {
  const hash = await owner.writeContract({
    ...registry,
    functionName: "list",
    args: [agentId, agentAccount().address, YIELD, PRICE_USD8, PERIOD_SECONDS, metadataURI],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  listingId = await publicClient.readContract({ ...registry, functionName: "listingByAgentId", args: [agentId] });
  console.log(`Listed on HelloFugu: listingId ${listingId} tx ${hash}`);
} else {
  const hash = await owner.writeContract({
    ...registry,
    functionName: "updateListing",
    args: [listingId, PRICE_USD8, PERIOD_SECONDS, metadataURI],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Updated listing ${listingId}: $${Number(PRICE_USD8) / 1e8} per ${PERIOD_SECONDS}s, tx ${hash}`);
}
console.log(`\nNext: put "LISTING_ID": "${listingId}" in wrangler.jsonc vars and redeploy.`);
console.log(`Hire page: https://app.hellofugu.xyz/agent/97:${agentId}`);
