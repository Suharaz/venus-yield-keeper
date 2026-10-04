import { ADDR, CHAIN_ID, type Env } from "./config";

export const AGENT_NAME = "Venus Yield Keeper";
export const CATEGORY = "yield";
const DESCRIPTION =
  "Yield agent (category: yield) on BNB Smart Chain testnet. Keeps BNB supplied to the Venus vBNB lending market " +
  "according to a published rule: target share of capital rises with each active hire, exits when APY falls below a floor, " +
  "and harvests accrued interest once per UTC day. Every action is a Venus mint/redeem transaction with its reason recorded. " +
  "Hire it on HelloFugu; ask it (A2A message/send) for live APY, position and recent actions.";

/** A2A agent card, served at /.well-known/agent-card.json. */
export function agentCard(origin: string) {
  return {
    protocolVersion: "0.3.0",
    name: AGENT_NAME,
    description: DESCRIPTION,
    category: CATEGORY,
    url: `${origin}/a2a`,
    preferredTransport: "JSONRPC",
    supportedInterfaces: [{ url: `${origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "0.3.0" }],
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "venus-bnb-yield",
        name: "Venus BNB yield management",
        description:
          "Supplies BNB to Venus vBNB up to a rule-based target, withdraws on low APY or fewer hires, harvests daily interest.",
        tags: ["yield", "lending", "venus", "bnb", "bsc-testnet"],
        examples: ["What is the current APY and position?", "Show recent actions"],
      },
    ],
  };
}

/** ERC-8004 registration file, served at /.well-known/agent-registration.json and used as agentURI. */
export function registrationFile(origin: string, env: Pick<Env, "AGENT_ID">) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: AGENT_NAME,
    description: DESCRIPTION,
    image: `${origin}/icon.svg`,
    category: CATEGORY,
    services: [
      { name: "A2A", endpoint: `${origin}/.well-known/agent-card.json`, version: "0.3.0" },
      { name: "web", endpoint: `${origin}/status` },
    ],
    x402Support: false,
    active: true,
    registrations: env.AGENT_ID
      ? [{ agentId: Number(env.AGENT_ID), agentRegistry: `eip155:${CHAIN_ID}:${ADDR.identityRegistry}` }]
      : [],
    supportedTrust: ["reputation"],
  };
}

export const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#F0B90B"/>' +
  '<path d="M16 44 L28 30 L36 38 L48 22" stroke="#14151A" stroke-width="5" fill="none" stroke-linecap="round"/></svg>';
