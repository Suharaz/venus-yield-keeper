# Deployment Guide

Per agent (`yield` uses `wrangler.jsonc`, `treasury` uses `wrangler.treasury.jsonc`, `router` uses `wrangler.router.jsonc`; scripts take the agent as first arg):

1. `npm install && npm run keygen -- <agent>` (prints the agent wallet address; key in `.dev.vars`).
2. Create the KV namespace and put its id in the wrangler config; `npx wrangler deploy --config <file>`.
3. `npx wrangler secret put AGENT_PRIVATE_KEY --config <file>` (value from `.dev.vars`).
4. `.env`: `OWNER_PRIVATE_KEY` (campaign wallet), `<PREFIX>AGENT_BASE_URL` (Worker URL).
5. `npm run register -- <agent>` -> set `AGENT_ID` in the config vars and `<PREFIX>AGENT_ID` in `.env`.
6. `npm run list:hellofugu -- <agent>` -> set `LISTING_ID`; set `PUBLIC_URL`; redeploy.
7. Fund the agent wallet with testnet BNB AFTER registration (first actions then belong to a linked identity).
8. Marketplaces: Pokter `POST https://pokter.xyz/api/compatibility {chainId:97,tokenId}`; Agent Souk `POST https://api.agentsouk.xyz/api/listings/request {tokenId,contact,note}` and `POST /api/agents/97/<id>/verify`.
9. Verify: dashboard renders, `/status` shows `agentWallet`, Pokter checks all pass.

Deployed without a Wrangler login through the Cloudflare API (multipart `PUT /workers/scripts/<name>` with `kv_namespace`, `plain_text` vars and `secret_text AGENT_PRIVATE_KEY` bindings, then `/schedules` and `/subdomain`). A script PUT replaces all bindings: always resend the secret.
Keep all three Workers running until after 13 Nov 2026 (campaign review window).
