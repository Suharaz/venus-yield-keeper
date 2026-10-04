# System Architecture

```mermaid
flowchart LR
  Cron[Cron */5 min] --> Agent[Worker runCycle]
  Agent -->|subCount/getSub/claim| Fugu[HelloFugu FuguSubscription]
  Agent -->|mint/redeemUnderlying/redeem| Venus[Venus vBNB]
  Agent <--> KV[(KV state)]
  Hirer[Hirer wallet] -->|subscribe| Fugu
  Client[A2A client / verifier] -->|message/send| Worker[Worker fetch]
  Worker --> KV
  Registry[ERC-8004 IdentityRegistry] -.agentURI.-> Worker
```

State (KV key `state`): principal, last harvest day, subscription scan cursor, tracked hires, last 100 actions.
One strategy action per cycle; hires are synced first so a new hire raises the target in the same cycle.
