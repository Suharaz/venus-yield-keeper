# Project Overview / PDR

## Goal
Qualify the campaign wallet for BNB Chain "Set and Earn" (1 Oct - 5 Nov 2026, 12:00 UTC) build requirement with real agents:
Venus Yield Keeper (`yield`, agentId 2554), Runway Treasurer (`treasury`, agentId 2555) and Venus Rate Router (`rebalancing`, agentId 2556), all owned by the campaign wallet.

## Requirements (from campaign rules)
- ERC-8004 identity on chain 97, owned by the campaign wallet, listed on a shortlisted marketplace (HelloFugu; also Pokter, Agent Souk).
- Resolvable agent card at its registered domain stating purpose and category.
- Live: answers when invoked (A2A `message/send`), professional public dashboard at the endpoint.
- >= 3 completed hires from 3 independent wallets (not owned or funded by the owner) for at least one agent.
- >= 5 onchain actions on >= 3 UTC days, consistent with the category (yield: Venus supply/withdraw/harvest; treasury: payouts, reserve top-ups, surplus sweeps; rebalancing: cross-market Venus deposits/withdrawals with WBNB wrap/unwrap).
- Public repo showing registry ID and chain.

## Hire channels
- HelloFugu `FuguSubscription` (tBNB), completed by the agent's `claim`.
- ERC-8183 jobs in $U (Pokter, BNB Agent SDK), delivered with `submit` and settled with `router.settle`.
- Agent Souk (sUSD via Souk relay, delivery over A2A).

## Non-goals
Mainnet funds; agent-side x402 (Souk is the x402 merchant; our endpoint must never answer 402).
