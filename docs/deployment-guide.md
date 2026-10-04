# Deployment Guide

1. `npm install && npm run keygen` (prints agent wallet address).
2. `npx wrangler login && npx wrangler deploy` (KV namespace auto-provisioned).
3. `npx wrangler secret put AGENT_PRIVATE_KEY` (value from `.dev.vars`).
4. Fund agent wallet with testnet BNB (>= 0.05 tBNB; 0.01 kept for gas).
5. `.env`: `OWNER_PRIVATE_KEY` (campaign wallet), `AGENT_BASE_URL` (Worker URL).
6. `npm run register` -> set `AGENT_ID` in `wrangler.jsonc`, redeploy.
7. `npm run list:hellofugu` -> set `LISTING_ID`, redeploy.
8. Verify: `GET /.well-known/agent-registration.json` shows `registrations[0].agentId`; `GET /status` shows tracked hires.

Keep the Worker running until after 13 Nov 2026 (campaign review window).
