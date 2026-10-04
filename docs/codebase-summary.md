# Codebase Summary

| Path | Role |
|---|---|
| `src/shared/worker.ts` | `createWorker(AgentModule)`: HTTP routes (cards, A2A, status, dashboard, deliverables, jobs) and cron (`syncJobs` then the agent cycle) |
| `src/shared/erc8183.ts` | ERC-8183 provider: signed `negotiate` quotes, `checkJob`, `syncJobs` (deliver via `submit`, `router.settle` after dispute window), canonical JSON |
| `src/shared/hires.ts` | HelloFugu hire sync + `claim`, `ActionRecord` ledger, `activeHireCount` |
| `src/shared/chain.ts` | viem clients, `readVenus` (APY, liquid, supplied via `exchangeRateCurrent`, pause flags) |
| `src/shared/cards.ts` | `AgentProfile`, A2A agent card (+ ERC-8183 skills), ERC-8004 registration file |
| `src/shared/page.ts`, `page-model.ts` | Pure HTML dashboard `renderPage(PageModel)` |
| `src/shared/config.ts` | Testnet addresses, ABIs, `BaseEnv`, explorer/repo URLs |
| `src/yield/` | Venus Yield Keeper: `strategy.ts` (pure `decide`), `agent.ts` (cycle, report), `index.ts` (profile, dashboard sections) |
| `src/treasury/` | Runway Treasurer: `policy.ts` (pure `decideTreasury`), `agent.ts` (nonce-guarded cycle, report), `index.ts` (profile, sections) |
| `scripts/env.ts` | Agent selector (`yield` / `treasury` first arg), per-agent variable prefix, owner/agent clients |
| `scripts/keygen.ts`, `register.ts`, `list-hellofugu.ts` | Wallet creation, ERC-8004 `register` + `setAgentWallet` (EIP-712), `FuguRegistry.list`/`updateListing` |
