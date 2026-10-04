# System Architecture

```mermaid
flowchart LR
  Cron[Cron */5 min] --> Jobs[syncJobs ERC-8183]
  Jobs -->|getJob/submit| Commerce[ERC-8183 AgenticCommerce]
  Jobs -->|settle| Router[EvaluatorRouter]
  Jobs --> Cycle[agent runCycle]
  Cycle -->|subCount/getSub/claim| Fugu[HelloFugu FuguSubscription]
  Cycle -->|mint/redeemUnderlying/redeem| Venus[Venus vBNB]
  Cycle -->|payout transfer| Payee[Payee wallets]
  Cycle <--> KV[(KV state, jobs, deliverables)]
  Buyer[Pokter / SDK buyer] -->|negotiate, notify_funded| A2A[Worker /a2a]
  Souk[Agent Souk relay] -->|message/send| A2A
  Hirer[HelloFugu hirer] -->|subscribe| Fugu
  Registry[ERC-8004 IdentityRegistry] -.agentURI.-> A2A
```

Two Workers share `src/shared` and differ only in the `AgentModule` (profile, cycle, report, dashboard sections).
KV keys per Worker: `state` (agent cycle: hires, ledger, pending tx, principal, payouts), `jobs` (ERC-8183 cursor and job records), `deliverable:<jobId>` (manifest text).
The cron is the only writer of state and the only sender of transactions; HTTP handlers are read-only (quotes are signatures, not transactions), so nonces never race.
Active hires = unfinished HelloFugu subscriptions + FUNDED/SUBMITTED ERC-8183 jobs.
