# Changelog

## 0.3.1 - 2026-10-04
- Router exit-liquidity cap gets a hysteresis band (`KEEP_CASH_MULTIPLE` 2): new money up to market cash / 3, a placed position kept while it fits in cash / 2. Before, one borrow/repay swing in the thin Liquid Staked BNB pool could trigger ~5 txs (withdraw, unwrap, deposit, then back). Policy tests in `src/router/policy.test.ts` (`npm test`).

## 0.3.0 - 2026-10-04
- Third agent: Venus Rate Router (ERC-8004 #2556, HelloFugu REBALANCING listing 25, Pokter Rebalancing, Souk requested). Routes BNB across Venus Core vBNB, Core vWBNB and the Liquid Staked BNB pool vWBNB by supply APY with per-market caps (60% of capital, cash / 3, supply cap) and hysteresis (3 APY points for 15 min, 1 point while hired).

## 0.2.1 - 2026-10-04
- KV documents (`state`, `jobs`) are written only when they changed (`src/shared/kv-doc.ts`). Hold cycles now cost no KV write; before, two Workers on a 5-min cron wrote ~1152 times/day, above the Workers Free cap of 1000 writes/day, which would have stopped cycles and risked losing a pending payout record.

## 0.2.0 - 2026-10-04
- Second agent: Runway Treasurer (ERC-8004 #2555, HelloFugu TREASURY listing 24): daily payouts paid exactly once (payout key + nonce-guarded drop detection), liquid reserve sized from payouts and active hires, idle surplus swept into Venus vBNB.
- Repo split into `src/shared`, `src/yield`, `src/treasury`; one Worker factory (`createWorker`) for both; scripts take the agent as first arg.
- ERC-8183 provider for Pokter / BNB Agent SDK buyers: signed `negotiate` quotes, `notify_funded`, cron delivery (`submit` with a KV-stored canonical manifest at `/deliverables/:jobId`) and `router.settle` after the dispute window. Funded jobs count as active hires.
- Live HTML dashboard at `GET /` (identity, metrics, allocation, risk gates, policy, action ledger with tx links).
- Marketplaces: Pokter enrolled (all checks pass, quote 0.10 $U); Agent Souk listing requested, delivery probes passed.

## 0.1.2 - 2026-10-04
- HelloFugu listing 23 period 120 s -> 900 s ($0.05 per 15 min) so every hire spans at least two 5-min cycles: supply when seen active, withdraw after it ends. `list:hellofugu` now updates price/period on an existing listing.

## 0.1.1 - 2026-10-04
- Position value uses `exchangeRateCurrent` via eth_call: `exchangeRateStored` on testnet vBNB had not accrued for ~211k blocks, so harvest would never trigger.
- Sent Venus txs are saved as `pending` before waiting for the receipt and settled next cycle if the wait fails; state is persisted even when a cycle throws.

## 0.1.0 - 2026-10-04
- Initial agent: Venus vBNB yield rule, daily harvest, HelloFugu hire sync and claim, A2A endpoint, ERC-8004 registration and HelloFugu listing scripts.
