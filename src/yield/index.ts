import { formatEther, parseEther } from "viem";
import type { AgentProfile } from "../shared/cards";
import { shareBps } from "../shared/format";
import { createWorker } from "../shared/worker";
import { report, runCycle, summary, type YieldEnv, type YieldReport } from "./agent";

const profile: AgentProfile = {
  name: "Venus Yield Keeper",
  tagline: "Rule-based BNB yield on Venus. Every move onchain, every reason on record.",
  category: "yield",
  description:
    "Yield agent (category: yield) on BNB Smart Chain testnet. Keeps BNB supplied to the Venus vBNB lending market " +
    "according to a published rule: target share of capital rises with each active hire, exits when APY falls below a floor, " +
    "and harvests accrued interest once per UTC day. Every action is a Venus mint/redeem transaction with its reason recorded. " +
    "Hire it on HelloFugu or Pokter; ask it (A2A message/send) for live APY, position and recent actions.",
  version: "0.2.0",
  skills: [
    {
      id: "venus-bnb-yield",
      name: "Venus BNB yield management",
      description: "Supplies BNB to Venus vBNB up to a rule-based target, withdraws on low APY or fewer hires, harvests daily interest.",
      tags: ["yield", "lending", "venus", "bnb", "bsc-testnet"],
      examples: ["What is the current APY and position?", "Show recent actions"],
    },
  ],
  policy: {
    title: "Yield rule (src/yield/strategy.ts)",
    rules: [
      "Capital = wallet BNB above a 0.01 BNB gas reserve + BNB supplied to Venus.",
      "Target supplied share = 50% + 15% per active hire, capped at 90%.",
      "Supply APY below 1%: withdraw everything and wait.",
      "Supplied off target by more than 5% of capital: supply or withdraw the difference.",
      "Once per UTC day: harvest accrued interest back to the wallet.",
      "At most one action per 5-minute cycle; a sent tx is recorded before its receipt.",
    ],
  },
  iconSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#F8D33A"/><stop offset="1" stop-color="#E3A008"/></linearGradient></defs>' +
    '<rect width="64" height="64" rx="14" fill="url(#g)"/>' +
    '<path d="M14 46h36" stroke="#14151A" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M15 41l11-11 8 7 15-17" stroke="#14151A" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="49" cy="20" r="4.5" fill="#14151A"/></svg>',
};

export default createWorker<YieldEnv, YieldReport>({
  profile,
  runCycle,
  report,
  summary,
  sections(r) {
    const wallet = parseEther(r.walletBnb);
    const supplied = parseEther(r.suppliedBnb);
    const total = wallet + supplied;
    return {
      metrics: [
        { label: "Venus supply APY", value: r.apy, hint: "vBNB, annualised per-block rate" },
        { label: "Supplied to Venus", value: `${Number(r.suppliedBnb).toFixed(5)} BNB` },
        { label: "Interest accrued", value: `${Number(r.accruedInterestBnb).toFixed(8)} BNB`, hint: "harvested once per UTC day" },
        { label: "Target share", value: r.targetShare, hint: `${r.activeHires} active hire(s)` },
        { label: "Liquid wallet", value: `${Number(r.walletBnb).toFixed(5)} BNB` },
        { label: "Hires tracked", value: String(r.hiresTracked) },
      ],
      allocation: [
        { label: "Supplied to Venus vBNB", bnb: formatEther(supplied), shareBps: shareBps(supplied, total) },
        { label: "Liquid in agent wallet", bnb: formatEther(wallet), shareBps: shareBps(wallet, total) },
      ],
      gates: [
        { label: "Venus mint", ok: !r.mintPaused, detail: r.mintPaused ? "paused by Venus: no supply" : "open" },
        { label: "Venus redeem", ok: !r.redeemPaused, detail: r.redeemPaused ? "paused by Venus: no withdraw" : "open" },
        { label: "Pending transaction", ok: r.pendingTx === null, detail: r.pendingTx ? `waiting for ${r.pendingTx}` : "none" },
      ],
    };
  },
});
