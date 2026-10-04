# Venus Yield Keeper

ERC-8004 **yield** agent on **BNB Smart Chain testnet (chain 97)**, built for BNB Chain's
[Set and Earn](https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn) campaign.

| | |
|---|---|
| Category | `yield` |
| Chain | BSC testnet, chain ID **97** |
| ERC-8004 registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Agent ID | **2554** ([BscScan](https://testnet.bscscan.com/token/0x8004A818BFB912233c491871b3d84c89A494BD9e?a=2554)) |
| Owner (campaign wallet) | `0x37Fc1F942085C2eF2bE4F6C0b6b9ABa426d7bD68` |
| Agent wallet | `0x6D3BD48b653beEeeEf6BBFd2DfCCf32B28049Cc5` (set via `setAgentWallet`) |
| Marketplace | [HelloFugu listing 23](https://app.hellofugu.xyz/agent/97:2554) |
| Endpoint | https://venus-yield-keeper.minesuhara.workers.dev ([agent card](https://venus-yield-keeper.minesuhara.workers.dev/.well-known/agent-card.json), [status](https://venus-yield-keeper.minesuhara.workers.dev/status)) |

## What it does

Keeps BNB supplied to the Venus core pool **vBNB** market by a published rule
([`src/strategy.ts`](src/strategy.ts)). Each run is every 5 minutes:

1. **Hires.** It scans HelloFugu `FuguSubscription` for subscriptions to its listing. When a hire ends, it calls `claim(subId)`, which marks the hire completed (`claimed == deposited`).
2. **Yield rule.** It applies at most one Venus action per run:
   - Target share of capital supplied = 50% + 15% for each active hire, capped at 90%. The target is 0 when supply APY is below 1%.
   - If APY is below the floor and BNB is still supplied, it calls `redeem` to withdraw everything.
   - If the supplied amount is more than 5% of capital away from the target, it calls `mint` or `redeemUnderlying` to close the gap.
   - Once per UTC day, it harvests accrued interest with `redeemUnderlying(accrued)`.
   - Otherwise it holds.

Every action is stored with its reason, APY, the position before the action, the target and the tx hash. The A2A endpoint returns them.

## Endpoints

| Path | |
|---|---|
| `GET /.well-known/agent-card.json` | A2A agent card (v0.3.0) |
| `GET /.well-known/agent-registration.json` | ERC-8004 registration file (`agentURI`) |
| `POST /a2a` | A2A JSON-RPC `message/send`: live APY, position, next decision, recent actions |
| `GET /status` | Same report as JSON |

## Setup

Requires Node 22+, a Cloudflare account, and testnet BNB.

```bash
npm install
npm run keygen                      # creates the agent wallet in .dev.vars (prints address only)
npx wrangler login
npx wrangler deploy                 # first deploy also provisions the KV namespace
npx wrangler secret put AGENT_PRIVATE_KEY   # paste the key from .dev.vars
cp .env.example .env                # set OWNER_PRIVATE_KEY (campaign wallet) and AGENT_BASE_URL
npm run register                    # ERC-8004 register + setAgentWallet; prints AGENT_ID
# put AGENT_ID in wrangler.jsonc vars, then: npx wrangler deploy
npm run list:hellofugu              # lists as YIELD, $0.05 / 120 s; prints LISTING_ID
# put LISTING_ID in wrangler.jsonc vars, then: npx wrangler deploy
```

Fund the agent wallet with testnet BNB. It keeps 0.01 BNB in reserve for gas.

Local run: `npm run dev`, then `curl "localhost:8787/__scheduled?cron=*/5+*+*+*+*"` triggers one cycle.

## Safety

- Testnet only. The agent key lives in `.dev.vars` locally and as a Worker secret. Both are gitignored, and the key is never logged.
- The campaign wallet key is used only by local scripts through `.env` (gitignored).
