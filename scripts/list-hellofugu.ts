/** Lists the agent on HelloFugu (FuguRegistry.list) from the campaign wallet as a YIELD agent. */
import { ADDR, fuguRegistryAbi } from "../src/config";
import { agentAccount, baseUrl, ownerClient, publicClient, required } from "./env";

const YIELD = 2; // FuguRegistry Category enum: 0 REBALANCING, 1 GRID, 2 YIELD, 3 HEALTH_FACTOR
const PRICE_USD8 = 5_000_000n; // $0.05 per period (8-decimal USD), same as most Fugu agents
const PERIOD_SECONDS = 120;

const owner = ownerClient();
const agentId = BigInt(required("AGENT_ID"));
const registry = { address: ADDR.fuguRegistry, abi: fuguRegistryAbi } as const;

let listingId = await publicClient.readContract({ ...registry, functionName: "listingByAgentId", args: [agentId] });
if (listingId === 0n) {
  const hash = await owner.writeContract({
    ...registry,
    functionName: "list",
    args: [agentId, agentAccount().address, YIELD, PRICE_USD8, PERIOD_SECONDS, `${baseUrl()}/.well-known/agent-registration.json`],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  listingId = await publicClient.readContract({ ...registry, functionName: "listingByAgentId", args: [agentId] });
  console.log(`Listed on HelloFugu: listingId ${listingId} tx ${hash}`);
} else {
  console.log(`Already listed: listingId ${listingId}`);
}
console.log(`\nNext: put "LISTING_ID": "${listingId}" in wrangler.jsonc vars and redeploy.`);
console.log(`Hire page: https://app.hellofugu.xyz/agent/97:${agentId}`);
