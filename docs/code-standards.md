# Code Standards

- TypeScript strict, ESM, `viem` for chain access. No other runtime deps.
- `src/strategy.ts` stays pure (no I/O) so each decision is reproducible from logged inputs.
- Amounts are `bigint` wei internally; formatted with `formatEther` only at output.
- Secrets only via `.dev.vars` / Worker secrets / `.env`; all gitignored. Never log keys.
- Check: `npm run typecheck`.
