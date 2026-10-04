# Code Standards

- TypeScript strict, ESM, `viem` for chain access. No other runtime deps.
- Decision rules stay pure (`src/yield/strategy.ts`, `src/treasury/policy.ts`): no I/O, so each decision is reproducible from logged inputs.
- Amounts are `bigint` wei internally; formatted with `formatEther` only at output.
- Only the cron sends transactions; a sent tx is persisted as `pending` before its receipt is awaited.
- Shared behaviour lives in `src/shared`; an agent is an `AgentModule` (profile, runCycle, report, summary, sections).
- Secrets only via `.dev.vars` / Worker secrets / `.env`; all gitignored. Never log keys.
- Check: `npm run typecheck`.
