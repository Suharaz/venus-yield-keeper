/**
 * 1. register(agentURI) on the ERC-8004 IdentityRegistry (BSC testnet) from the campaign wallet.
 * 2. setAgentWallet(agentId, agent wallet) with the agent wallet's EIP-712 consent signature.
 * Re-running with AGENT_ID set skips step 1.
 */
import { parseEventLogs } from "viem";
import { ADDR, CHAIN_ID, identityRegistryAbi } from "../src/config";
import { agentAccount, baseUrl, ownerClient, publicClient } from "./env";

const owner = ownerClient();
const agent = agentAccount();
const registry = { address: ADDR.identityRegistry, abi: identityRegistryAbi } as const;
const agentURI = `${baseUrl()}/.well-known/agent-registration.json`;

const card = await fetch(agentURI);
if (!card.ok) throw new Error(`${agentURI} returned ${card.status}: deploy the Worker first`);

let agentId: bigint;
if (process.env.AGENT_ID) {
  agentId = BigInt(process.env.AGENT_ID);
  console.log(`Using existing agentId ${agentId}`);
} else {
  const hash = await owner.writeContract({ ...registry, functionName: "register", args: [agentURI] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [registered] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: receipt.logs });
  agentId = registered.args.agentId;
  console.log(`Registered agentId ${agentId} owner ${owner.account.address} tx ${hash}`);
}

const current = await publicClient.readContract({ ...registry, functionName: "getAgentWallet", args: [agentId] });
if (current.toLowerCase() === agent.address.toLowerCase()) {
  console.log(`agentWallet already ${agent.address}`);
} else {
  const block = await publicClient.getBlock();
  const deadline = block.timestamp + 240n; // contract allows at most 5 minutes ahead
  const signature = await agent.signTypedData({
    domain: { name: "ERC8004IdentityRegistry", version: "1", chainId: CHAIN_ID, verifyingContract: ADDR.identityRegistry },
    types: {
      AgentWalletSet: [
        { name: "agentId", type: "uint256" },
        { name: "newWallet", type: "address" },
        { name: "owner", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "AgentWalletSet",
    message: { agentId, newWallet: agent.address, owner: owner.account.address, deadline },
  });
  const hash = await owner.writeContract({ ...registry, functionName: "setAgentWallet", args: [agentId, agent.address, deadline, signature] });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`agentWallet set to ${agent.address} tx ${hash}`);
}

console.log(`\nNext: put "AGENT_ID": "${agentId}" in wrangler.jsonc vars, redeploy, then run npm run list:hellofugu`);
console.log(`Explorer: https://testnet.bscscan.com/token/${ADDR.identityRegistry}?a=${agentId}`);
