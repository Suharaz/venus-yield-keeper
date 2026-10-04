# Codebase Summary

| Path | Role |
|---|---|
| `src/index.ts` | Worker entry: HTTP routes (agent card, registration file, A2A, status) and cron handler |
| `src/agent.ts` | Cycle: HelloFugu hire sync + claim, Venus market read, decision execution, KV state |
| `src/strategy.ts` | Pure yield rule (`decide`) |
| `src/cards.ts` | A2A agent card, ERC-8004 registration file, icon |
| `src/config.ts` | Testnet addresses, ABIs, `Env` |
| `scripts/keygen.ts` | Creates agent wallet into `.dev.vars` |
| `scripts/register.ts` | ERC-8004 `register` + `setAgentWallet` (EIP-712) |
| `scripts/list-hellofugu.ts` | `FuguRegistry.list` as YIELD |
