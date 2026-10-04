# Changelog

## 0.1.2 - 2026-10-04
- HelloFugu listing 23 period 120 s -> 900 s ($0.05 per 15 min) so every hire spans at least two 5-min cycles: supply when seen active, withdraw after it ends. `list:hellofugu` now updates price/period on an existing listing.

## 0.1.1 - 2026-10-04
- Position value uses `exchangeRateCurrent` via eth_call: `exchangeRateStored` on testnet vBNB had not accrued for ~211k blocks, so harvest would never trigger.
- Sent Venus txs are saved as `pending` before waiting for the receipt and settled next cycle if the wait fails; state is persisted even when a cycle throws.

## 0.1.0 - 2026-10-04
- Initial agent: Venus vBNB yield rule, daily harvest, HelloFugu hire sync and claim, A2A endpoint, ERC-8004 registration and HelloFugu listing scripts.
