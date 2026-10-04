import { parseEther } from "viem";
import type { AgentProfile } from "../shared/cards";
import { shareBps } from "../shared/format";
import { createWorker } from "../shared/worker";
import { report, runCycle, summary, type RouterEnv, type RouterReport } from "./agent";

const profile: AgentProfile = {
  name: "Venus Rate Router",
  tagline: "Rebalances BNB across Venus markets to the best risk-checked rate. Moves only when the edge is real.",
  category: "rebalancing",
  description:
    "Rebalancing agent (category: rebalancing) on BNB Smart Chain testnet. A portfolio rebalancer for BNB across three Venus lending markets " +
    "(Core vBNB, Core vWBNB, Liquid Staked BNB pool vWBNB): it ranks them by live supply APY and rebalances the allocation toward the best yield, " +
    "capping each market at 60% of capital and at one third of its withdrawable cash (kept until it exceeds one half, so one borrower cannot churn it), and respecting supply caps and pauses. " +
    "Hysteresis: a new leader must beat the current one by 3 APY points for 15 minutes before any rebalance (1 point while hired), so rate noise never moves funds. " +
    "Wraps and unwraps BNB as needed; every move is an onchain transaction with its reason recorded. " +
    "Hire it on HelloFugu or Pokter; ask it (A2A message/send) for the allocation, blended APY and its edge over a single market.",
  version: "0.1.0",
  skills: [
    {
      id: "venus-rate-routing",
      name: "Cross-market BNB rate routing",
      description: "Ranks Venus BNB markets by supply APY and rebalances capital toward the best ones under concentration, exit-liquidity and supply-cap limits.",
      tags: ["rebalancing", "yield", "venus", "bnb", "portfolio", "bsc-testnet"],
      examples: ["Where is the BNB allocated and why?", "What is the blended APY versus Venus Core?"],
    },
  ],
  policy: {
    title: "Routing rule (src/router/policy.ts)",
    rules: [
      "Capital = wallet BNB above a 0.01 BNB gas reserve + WBNB + BNB supplied to the three Venus markets.",
      "A market is eligible when mint is open and APY is at least 1%.",
      "Per-market cap = min(60% of capital, exit-liquidity limit, supply-cap room). Exit limit: add only up to cash / 3; keep a placed position while it fits in cash / 2, so one borrow or repay does not churn funds.",
      "Fill markets best APY first up to their cap; the rest stays liquid.",
      "Re-rank only when a new leader beats the current one by 3 APY points for 15 min (1 point while hired); re-rank at once if the leader becomes ineligible.",
      "Each cycle takes one step: withdraw excess, convert BNB/WBNB, approve, or deposit.",
    ],
  },
  iconSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#1E2230"/><stop offset="1" stop-color="#0E1016"/></linearGradient></defs>' +
    '<rect width="64" height="64" rx="14" fill="url(#g)"/>' +
    '<circle cx="16" cy="32" r="5" fill="#F0B90B"/>' +
    '<circle cx="48" cy="17" r="4.5" fill="none" stroke="#F0B90B" stroke-width="3"/>' +
    '<circle cx="48" cy="32" r="4.5" fill="#F0B90B"/>' +
    '<circle cx="48" cy="47" r="4.5" fill="none" stroke="#F0B90B" stroke-width="3"/>' +
    '<path d="M21 32h22M21 30c9-10 14-13 22-13M21 34c9 10 14 13 22 13" stroke="#F0B90B" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
};

export default createWorker<RouterEnv, RouterReport>({
  profile,
  runCycle,
  report,
  summary,
  sections(r) {
    const capital = parseEther(r.capitalBnb);
    const deployed = r.venues.reduce((s, v) => s + parseEther(v.positionBnb), 0n);
    const leader = r.ranking.map((id) => r.venues.find((v) => v.id === id)!).find((v) => v.eligible);
    return {
      metrics: [
        { label: "Blended APY", value: r.blendedApy, hint: `${r.edgeVsCore} vs Venus Core vBNB` },
        { label: "Capital routed", value: `${Number(r.capitalBnb).toFixed(5)} BNB`, hint: `${Number(r.liquidBnb).toFixed(5)} BNB liquid` },
        { label: "Leading market", value: leader ? leader.apy : "none", hint: leader?.label ?? "no eligible market" },
        { label: "Interest accrued", value: `${Number(r.accruedInterestBnb).toFixed(8)} BNB`, hint: "compounds in place" },
        { label: "Re-rank watch", value: r.candidate ? "confirming" : "stable", hint: r.candidate ? `${r.candidate.leader} since ${r.candidate.since.slice(11, 16)} UTC` : "no challenger above hurdle" },
        { label: "Active hires", value: String(r.activeHires), hint: `${r.hiresTracked} tracked` },
      ],
      allocation: [
        ...r.venues.map((v) => ({ label: `${v.label} (${v.apy})`, bnb: v.positionBnb, shareBps: shareBps(parseEther(v.positionBnb), capital) })),
        { label: "Liquid (BNB above gas reserve + WBNB)", bnb: (Number(r.capitalBnb) - Number(deployed) / 1e18).toFixed(18), shareBps: shareBps(capital - deployed, capital) },
      ],
      gates: r.venues.map((v) => ({
        label: v.label,
        ok: !v.mintPaused && !v.redeemPaused,
        detail: `APY ${v.apy}, target ${Number(v.targetBnb).toFixed(5)} BNB, exit cash ${Number(v.cashBnb).toFixed(3)} BNB${v.mintPaused ? ", mint paused" : ""}${v.redeemPaused ? ", redeem paused" : ""}`,
      })),
    };
  },
});
