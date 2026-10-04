# API Endpoints

| Method/Path | Response |
|---|---|
| `GET /.well-known/agent-card.json` | A2A agent card v0.3.0 (`url` = `/a2a`, skill `venus-bnb-yield`) |
| `GET /.well-known/agent-registration.json` | ERC-8004 registration-v1 file; `registrations` filled once `AGENT_ID` is set |
| `POST /a2a` (also `POST /`) | JSON-RPC 2.0. `message/send` -> `{kind:"message", parts:[text, data]}`; other methods -> `-32601` |
| `GET /status` (also `GET /`) | Report: APY, wallet, supplied, principal, accrued, active hires, next decision, recent actions |
| `GET /health` | `{ok:true}` |
