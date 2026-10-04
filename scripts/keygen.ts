/** Creates an agent wallet once (`npm run keygen -- treasury`). The key stays in .dev.vars (gitignored); only the address is printed. */
import { appendFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { agentConfig, agentVar } from "./env";

const name = `${agentConfig.prefix}AGENT_PRIVATE_KEY`;
const existing = agentVar("AGENT_PRIVATE_KEY", true);
if (existing) {
  console.log(`Agent wallet already exists: ${privateKeyToAccount(existing as Hex).address}`);
} else {
  const key = generatePrivateKey();
  appendFileSync(".dev.vars", `${name}=${key}\n`);
  console.log(`Agent wallet created: ${privateKeyToAccount(key).address}`);
  console.log(`Key saved to .dev.vars as ${name}. Upload it to the Worker as the AGENT_PRIVATE_KEY secret.`);
}
