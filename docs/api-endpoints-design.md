# API Endpoints (all Workers)

| Method/Path | Response |
|---|---|
| `GET /` | HTML dashboard when `Accept` has `text/html`, else the JSON report |
| `GET /.well-known/agent-card.json` | A2A agent card v0.3.0 (`url` = `/a2a`); agent skills + `negotiate`, `negotiate-erc8183-job`, `notify_funded` |
| `GET /.well-known/agent-registration.json` | ERC-8004 registration-v1 file; `registrations` filled once `AGENT_ID` is set |
| `POST /a2a` (also `POST /`) | JSON-RPC 2.0 `message/send`. Data part `{skill:"negotiate"}` -> signed quote envelope; `{skill:"notify_funded", job_id}` -> `{status:"accepted"|"rejected", jobId, reason?}`; anything else -> `[text summary, data report]`. Other methods -> `-32601` |
| `GET /status` | JSON report (yield: APY, supplied, accrued, target; treasury: liquid, supplied, reserve target, runway, payees; router: capital, blended APY, edge vs Core vBNB, per-market position/target/cash, committed ranking, re-rank candidate and history) + hires, next decision, recent actions |
| `GET /jobs` | ERC-8183 job book `{lastJobId, jobs}` |
| `GET /deliverables/:jobId` | Stored manifest text (keccak256 equals the onchain deliverable) |
| `GET /icon.svg`, `GET /health` | Icon; `{ok:true}` |
