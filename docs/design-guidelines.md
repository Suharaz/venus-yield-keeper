# Design Guidelines

## Dashboard (`src/shared/page.ts`)
- Product register, dark onchain-terminal look: tinted dark neutrals (hue 85), BNB yellow `#F0B90B` only for the primary hire button, focus ring, deployed-capital segment and next-decision callout.
- IBM Plex Sans for UI, system mono for hashes, addresses and action kinds. Green/red only for state, always with icon + text.
- Sections: hero + onchain identity, metrics, capital allocation bar, next decision, risk gates, policy, action ledger (tx links), tech links.
- Pure render from `PageModel`; every dynamic string escaped; only http(s) links; no JS; refreshes every 60 s; responsive 375/768/1440.

## Machine-facing outputs
- Agent card and registration file: stable field names, category stated in `category`, description and skill tags. Descriptions use classifier keywords (yield, APY, vault) so Pokter/Souk place the agent.
- A2A reply: one human-readable text part plus a `data` part with the full report; ERC-8183 skills reply with one `data` part.
- Every onchain action carries a plain-language `reason`.
