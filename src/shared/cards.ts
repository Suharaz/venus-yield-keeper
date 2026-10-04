import { ADDR, CHAIN_ID, type BaseEnv } from "./config";

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
}

/** Static identity of one agent: what marketplaces, the agent card and the dashboard show. */
export interface AgentProfile {
  name: string;
  /** One line shown under the name. */
  tagline: string;
  /** Marketplace category, lower case ("yield", "treasury"). */
  category: string;
  description: string;
  version: string;
  skills: A2ASkill[];
  /** Plain-language rules the agent follows; shown on the dashboard. */
  policy: { title: string; rules: string[] };
  iconSvg: string;
}

/** ERC-8183 job skills (Pokter / BNB Agent SDK buyers). Marketplaces hide these plumbing ids from display. */
const COMMERCE_SKILLS: A2ASkill[] = [
  {
    id: "negotiate",
    name: "negotiate",
    description: "ERC-8183 price quote: returns signed terms (price in $U) for a job, signed by the agent wallet.",
    tags: ["erc8183", "quote"],
    examples: ['{"skill":"negotiate","task_description":"...","terms":{"deliverables":"...","quality_standards":"..."}}'],
  },
  {
    id: "negotiate-erc8183-job",
    name: "negotiate-erc8183-job",
    description: "Same as negotiate (BNB Agent SDK skill id).",
    tags: ["erc8183", "quote"],
    examples: ['{"skill":"negotiate-erc8183-job","task_description":"..."}'],
  },
  {
    id: "notify_funded",
    name: "notify_funded",
    description: "Tell the agent an ERC-8183 job is funded; it validates the job, delivers a manifest onchain and settles after the dispute window.",
    tags: ["erc8183", "delivery"],
    examples: ['{"skill":"notify_funded","job_id":1401}'],
  },
];

/** A2A agent card, served at /.well-known/agent-card.json. */
export function agentCard(p: AgentProfile, origin: string) {
  return {
    protocolVersion: "0.3.0",
    name: p.name,
    description: p.description,
    category: p.category,
    url: `${origin}/a2a`,
    preferredTransport: "JSONRPC",
    supportedInterfaces: [{ url: `${origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "0.3.0" }],
    iconUrl: `${origin}/icon.svg`,
    documentationUrl: origin,
    version: p.version,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [...p.skills, ...COMMERCE_SKILLS],
  };
}

/** ERC-8004 registration file, served at /.well-known/agent-registration.json and used as agentURI. */
export function registrationFile(p: AgentProfile, origin: string, env: Pick<BaseEnv, "AGENT_ID">) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: p.name,
    description: p.description,
    image: `${origin}/icon.svg`,
    category: p.category,
    services: [
      { name: "A2A", endpoint: `${origin}/.well-known/agent-card.json`, version: "0.3.0" },
      { name: "web", endpoint: origin },
    ],
    x402Support: false,
    active: true,
    registrations: env.AGENT_ID
      ? [{ agentId: Number(env.AGENT_ID), agentRegistry: `eip155:${CHAIN_ID}:${ADDR.identityRegistry}` }]
      : [],
    supportedTrust: ["reputation"],
  };
}
