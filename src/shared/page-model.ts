/** Data contract for the public agent dashboard (GET / with Accept: text/html). */

export interface PageMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface PageGate {
  label: string;
  ok: boolean;
  detail: string;
}

export interface PageAllocation {
  label: string;
  bnb: string;
  /** Share of total, basis points (0-10000). */
  shareBps: number;
}

export interface PageAction {
  at: string;
  kind: string;
  amountBnb: string;
  reason: string;
  txHash: string;
  ok: boolean;
}

export interface PageLink {
  label: string;
  url: string;
}

export interface PageModel {
  name: string;
  tagline: string;
  /** Marketplace category, e.g. "yield" or "treasury". */
  category: string;
  description: string;
  agentId: string | null;
  chainId: number;
  owner: string;
  agentWallet: string;
  endpoint: string;
  /** Where to hire this agent (marketplaces). */
  hireLinks: PageLink[];
  /** Protocol/developer links (agent card, registration file, repo, explorer). */
  techLinks: PageLink[];
  metrics: PageMetric[];
  policy: { title: string; rules: string[] };
  gates: PageGate[];
  allocation: PageAllocation[];
  nextDecision: { kind: string; reason: string };
  actions: PageAction[];
  /** ISO timestamp of the data snapshot. */
  updatedAt: string;
  explorerTxBase: string;
  explorerAddressBase: string;
}
