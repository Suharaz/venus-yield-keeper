/** Creates the agent wallet (wallet B) once. The key stays in .dev.vars (gitignored); only the address is printed. */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { parse } from "dotenv";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const existing = existsSync(".dev.vars") ? parse(readFileSync(".dev.vars")).AGENT_PRIVATE_KEY : undefined;
if (existing) {
  console.log(`Agent wallet already exists: ${privateKeyToAccount(existing as Hex).address}`);
} else {
  const key = generatePrivateKey();
  appendFileSync(".dev.vars", `AGENT_PRIVATE_KEY=${key}\n`);
  console.log(`Agent wallet created: ${privateKeyToAccount(key).address}`);
  console.log("Key saved to .dev.vars. Upload it to the Worker with: npx wrangler secret put AGENT_PRIVATE_KEY");
}
