# BNB Agent Fleet: Venus Yield Keeper + Runway Treasurer

Two ERC-8004 agents on **BNB Smart Chain testnet (chain 97)**, built for BNB Chain's
[Set and Earn](https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn) campaign.
Each runs as a Cloudflare Worker with a 5-minute cron, acts only through its own agent wallet,
and records every onchain action with the reason it was taken.

| | Venus Yield Keeper | Runway Treasurer |
|---|---|---|
| Category | `yield` | `treasury` |
| Chain | BSC testnet, chain ID **97** | BSC testnet, chain ID **97** |
| ERC-8004 registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | same |
| Agent ID | **2554** ([BscScan](https://testnet.bscscan.com/token/0x8004A818BFB912233c491871b3d84c89A494BD9e?a=2554)) | **2555** ([BscScan](https://testnet.bscscan.com/token/0x8004A818BFB912233c491871b3d84c89A494BD9e?a=2555)) |
| Owner (campaign wallet) | `0x37Fc1F942085C2eF2bE4F6C0b6b9ABa426d7bD68` | same |
| Agent wallet (`setAgentWallet`) | `0x6D3BD48b653beEeeEf6BBFd2DfCCf32B28049Cc5` | `0x96E4a83512fBcDbC62375c862F021d63f398C241` |
| HelloFugu | [listing 23](https://app.hellofugu.xyz/agent/97:2554), YIELD, $0.05 / 15 min | [listing 24](https://app.hellofugu.xyz/agent/97:2555), TREASURY, $0.05 / 15 min |
| Pokter (ERC-8183) | [hire](https://pokter.xyz/hire/97/2554), signed quote 0.10 $U | [hire](https://pokter.xyz/hire/97/2555), signed quote 0.10 $U |
| Agent Souk | listing requested, delivery probe passed | listing requested, delivery probe passed |
| Dashboard | https://venus-yield-keeper.minesuhara.workers.dev | https://runway-treasurer.minesuhara.workers.dev |

## What they do

**Venus Yield Keeper** ([`src/yield/strategy.ts`](src/yield/strategy.ts)) keeps BNB supplied to the Venus core pool vBNB market:
- Target supplied share = 50% + 15% per active hire, capped at 90%; 0 when supply APY is below 1%.
- Off target by more than 5% of capital: `mint` or `redeemUnderlying` the difference. APY below floor: `redeem` everything.
- Once per UTC day: harvest accrued interest with `redeemUnderlying(accrued)`.

**Runway Treasurer** ([`src/treasury/policy.ts`](src/treasury/policy.ts)) is the treasury of the fleet:
- Pays each payee its daily BNB amount exactly once per UTC day (payout key `YYYY-MM-DD:index`, stored only after a confirmed receipt; a tx is declared dropped only when the node no longer knows it and its nonce is unused, so a restart never pays twice). Today's payee: the Venus Yield Keeper wallet, 0.002 BNB/day gas budget.
- Liquid reserve target = 0.01 BNB floor + 7 days of payouts + 0.01 BNB per active hire.
- Liquid more than 20% below target (or short for today's payout): redeem the deficit from Venus. More than 20% above: sweep the surplus into Venus vBNB. APY below 1%: bring everything back liquid.

**Hires** count from two places: HelloFugu subscriptions (`FuguSubscription`; completed by the agent with `claim(subId)` when they end) and ERC-8183 jobs (Pokter, BNB Agent SDK). Every active hire raises the yield target or the treasury reserve, so each hire produces category actions when it starts and ends.

**ERC-8183 provider** ([`src/shared/erc8183.ts`](src/shared/erc8183.ts)): A2A skills `negotiate` / `negotiate-erc8183-job` return a quote signed (EIP-191) by the agent wallet; `notify_funded` validates the job. The cron finds FUNDED jobs for the agent wallet, stores the deliverable manifest (canonical JSON) in KV, serves it at `/deliverables/:jobId`, calls `submit(jobId, keccak256(manifest), {deliverable_url})`, and after the 900 s dispute window calls `router.settle(jobId)` to release payment.

## Endpoints (both Workers)

| Path | |
|---|---|
| `GET /` | Live dashboard (HTML for browsers, JSON report otherwise) |
| `GET /.well-known/agent-card.json` | A2A agent card (v0.3.0) |
| `GET /.well-known/agent-registration.json` | ERC-8004 registration file (`agentURI`) |
| `POST /a2a` | A2A JSON-RPC `message/send`: live report, or ERC-8183 `negotiate` / `notify_funded` data parts |
| `GET /status` | Report as JSON |
| `GET /jobs` | ERC-8183 jobs seen by the agent |
| `GET /deliverables/:jobId` | Deliverable manifest, byte-for-byte as hashed onchain |

## Layout

```
src/shared/   chain + Venus reads, HelloFugu hires, ERC-8183 provider, cards, Worker factory, dashboard
src/yield/    Venus Yield Keeper: strategy, agent cycle, profile      (wrangler.jsonc)
src/treasury/ Runway Treasurer: policy, agent cycle, profile          (wrangler.treasury.jsonc)
scripts/      keygen, register (ERC-8004 + setAgentWallet), list:hellofugu
```

## Setup

Requires Node 22+, a Cloudflare account, and testnet BNB. Scripts take the agent as first argument (`yield` default, or `treasury`).

```bash
npm install
npm run keygen -- treasury            # agent wallet key into .dev.vars (TREASURY_AGENT_PRIVATE_KEY); prints address only
npx wrangler deploy --config wrangler.treasury.jsonc
npx wrangler secret put AGENT_PRIVATE_KEY --config wrangler.treasury.jsonc   # paste the key from .dev.vars
cp .env.example .env                  # OWNER_PRIVATE_KEY (campaign wallet), <PREFIX>AGENT_BASE_URL
npm run register -- treasury          # ERC-8004 register + setAgentWallet; prints AGENT_ID
npm run list:hellofugu -- treasury    # lists in the agent's category, $0.05 / 15 min; prints LISTING_ID
# put AGENT_ID / LISTING_ID in the wrangler config vars and deploy again
```

Fund each agent wallet with testnet BNB (0.01 BNB stays as the gas floor). Local run: `npm run dev`, then
`curl "localhost:8787/__scheduled?cron=*/5+*+*+*+*"` triggers one cycle.

## Safety

- Testnet only. Agent keys live in `.dev.vars` locally and as Worker secrets. Both are gitignored and never logged.
- The campaign wallet key is used only by local scripts through `.env` (gitignored).
- ERC-8183 jobs are delivered only when the job description names this agent (Pokter envelope) or carries a quote signed by this agent wallet.
