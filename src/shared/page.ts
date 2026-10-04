/**
 * Public agent dashboard (GET / from a browser). Pure: PageModel in, HTML document out.
 * Design: dark tinted-neutral finance terminal, BNB yellow as the only accent
 * (primary action, focus, deployed capital). All dynamic text is escaped here.
 */
import type { PageAction, PageAllocation, PageGate, PageLink, PageMetric, PageModel } from "./page-model";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const ICONS = {
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  cross: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  out: '<path d="M6 4h6v6M12 4l-7.5 7.5"/>',
} as const;

function icon(name: keyof typeof ICONS, cls = "icon"): string {
  return `<svg class="${cls}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/** Only http(s) and same-origin paths become links; anything else renders as plain text. */
function link(url: string, inner: string, cls: string, title?: string): string {
  const href = url.trim();
  const external = /^https?:\/\//i.test(href);
  const t = title ? ` title="${esc(title)}"` : "";
  if (!external && !(href.startsWith("/") && !href.startsWith("//"))) return `<span class="${cls}"${t}>${inner}</span>`;
  return `<a class="${cls}" href="${esc(href)}"${t}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}${external ? icon("out", "icon icon--out") : ""}</a>`;
}

function shortHex(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}\u2026${value.slice(-4)}` : value;
}

function addressLink(model: PageModel, address: string): string {
  if (!address) return '<span class="muted">Not set</span>';
  return link(model.explorerAddressBase + address, `<span class="mono">${esc(shortHex(address))}</span>`, "link", address);
}

function txLink(model: PageModel, hash: string): string {
  if (!hash) return '<span class="muted">Not sent</span>';
  return link(model.explorerTxBase + hash, `<span class="mono">${esc(shortHex(hash))}</span>`, "link", hash);
}

/** ISO timestamp as `YYYY-MM-DD HH:MM UTC`; unparseable input is shown as given. */
function utc(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return `<span>${esc(iso || "Unknown")}</span>`;
  const s = d.toISOString();
  return `<time datetime="${esc(s)}">${s.slice(0, 10)} <span class="nowrap">${s.slice(11, 16)} UTC</span></time>`;
}

/** Plain decimal BNB trimmed to 6 decimals for scanning; the exact value stays in the title. */
function bnb(amount: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return esc(amount);
  const frac = (m[2] ?? "").slice(0, 6).replace(/0+$/, "");
  let shown = frac ? `${m[1]}.${frac}` : m[1];
  if (shown === "0" && /[1-9]/.test(m[2] ?? "")) shown = "<0.000001";
  return shown === amount.trim() ? esc(shown) : `<span title="${esc(amount.trim())}">${esc(shown)}</span>`;
}

function chainName(chainId: number): string {
  if (chainId === 97) return "BNB Smart Chain testnet";
  if (chainId === 56) return "BNB Smart Chain";
  return `Chain ${chainId}`;
}

function renderHire(links: PageLink[]): string {
  if (!links.length) return "";
  const buttons = links
    .map((l, i) => {
      const label = /^hire\b/i.test(l.label.trim()) ? l.label : `Hire on ${l.label}`;
      return link(l.url, `<span>${esc(label)}</span>`, i === 0 ? "btn btn--primary" : "btn btn--secondary");
    })
    .join("");
  return `<div class="hire">${buttons}</div>`;
}

function renderIdentity(m: PageModel): string {
  const id = m.agentId
    ? `<span class="mono">#${esc(m.agentId)}</span> <span class="muted">on chain ${esc(m.chainId)}</span>`
    : '<span class="muted">Registration pending</span>';
  return `<aside class="panel identity" aria-labelledby="identity-h">
  <h2 class="panel__title" id="identity-h">Onchain identity</h2>
  <dl class="kv">
    <div><dt>ERC-8004 agent ID</dt><dd>${id}</dd></div>
    <div><dt>Network</dt><dd>${esc(chainName(m.chainId))}</dd></div>
    <div><dt>Owner</dt><dd>${addressLink(m, m.owner)}</dd></div>
    <div><dt>Agent wallet</dt><dd>${addressLink(m, m.agentWallet)}</dd></div>
  </dl>
</aside>`;
}

function renderMetrics(metrics: PageMetric[]): string {
  if (!metrics.length) return "";
  const cells = metrics
    .map(
      (x) => `<div class="metric">
      <dt>${esc(x.label)}</dt>
      <dd class="metric__value">${esc(x.value)}</dd>${x.hint ? `\n      <dd class="metric__hint">${esc(x.hint)}</dd>` : ""}
    </div>`,
    )
    .join("\n    ");
  return `<section class="block" aria-label="Key metrics">
  <dl class="metrics">
    ${cells}
  </dl>
</section>`;
}

function renderAllocation(rows: PageAllocation[]): string {
  const clamp = (bps: number) => Math.max(0, Math.min(10000, Number.isFinite(bps) ? bps : 0));
  const pct = (bps: number) => `${(clamp(bps) / 100).toFixed(clamp(bps) % 100 === 0 ? 0 : 1)}%`;
  let body: string;
  if (!rows.length) {
    body = `<div class="alloc__bar alloc__bar--empty" aria-hidden="true"></div>
  <p class="empty">No capital allocated yet. Shares appear here after the first supply.</p>`;
  } else {
    const label = rows.map((r) => `${r.label} ${pct(r.shareBps)}`).join(", ");
    const segs = rows
      .map((r, i) => `<span class="seg seg--${i % 4}" style="width:${(clamp(r.shareBps) / 100).toFixed(2)}%"></span>`)
      .join("");
    const legend = rows
      .map(
        (r, i) => `<li>
      <span class="swatch seg--${i % 4}" aria-hidden="true"></span>
      <span class="alloc__label">${esc(r.label)}</span>
      <span class="num">${bnb(r.bnb)} <span class="unit">BNB</span></span>
      <span class="num alloc__pct">${pct(r.shareBps)}</span>
    </li>`,
      )
      .join("\n    ");
    body = `<div class="alloc__bar" role="img" aria-label="${esc(`Capital split: ${label}`)}">${segs}</div>
  <ul class="alloc__legend">
    ${legend}
  </ul>`;
  }
  return `<section class="panel alloc" aria-labelledby="alloc-h">
  <h2 class="panel__title" id="alloc-h">Capital allocation</h2>
  ${body}
</section>`;
}

function renderDecision(m: PageModel): string {
  const kind = m.nextDecision.kind || "hold";
  return `<section class="panel decision" aria-labelledby="decision-h">
  <h2 class="panel__title" id="decision-h">Next decision</h2>
  <p class="decision__kind">${esc(kind[0].toUpperCase() + kind.slice(1))}</p>
  <p class="decision__reason">${esc(m.nextDecision.reason || "No change needed this cycle.")}</p>
</section>`;
}

function renderGates(gates: PageGate[]): string {
  if (!gates.length) return "";
  const passing = gates.filter((g) => g.ok).length;
  const allOk = passing === gates.length;
  const summary = allOk ? `All ${gates.length} pass` : `${passing} of ${gates.length} pass`;
  const items = gates
    .map(
      (g) => `<li class="gate ${g.ok ? "is-ok" : "is-fail"}">
      <span class="gate__icon">${icon(g.ok ? "check" : "cross")}</span>
      <div class="gate__text"><p class="gate__label">${esc(g.label)}</p><p class="gate__detail">${esc(g.detail)}</p></div>
      <span class="state">${g.ok ? "Pass" : "Fail"}</span>
    </li>`,
    )
    .join("\n    ");
  return `<section class="panel" aria-labelledby="gates-h">
  <div class="panel__head"><h2 class="panel__title" id="gates-h">Risk gates</h2><span class="tag ${allOk ? "tag--ok" : "tag--fail"}">${summary}</span></div>
  <ul class="gates">
    ${items}
  </ul>
</section>`;
}

function renderPolicy(policy: PageModel["policy"]): string {
  const rules = policy.rules.length
    ? `<ol class="rules">${policy.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>`
    : '<p class="empty">No policy rules published.</p>';
  return `<section class="panel policy" aria-labelledby="policy-h">
  <div class="policy__intro">
    <h2 class="panel__title" id="policy-h">Policy</h2>
    ${policy.title ? `<p class="policy__title">${esc(policy.title)}</p>` : ""}
  </div>
  ${rules}
</section>`;
}

function renderLedger(m: PageModel): string {
  const n = m.actions.length;
  const rows = m.actions
    .map((a: PageAction) => `<tr class="${a.ok ? "is-ok" : "is-fail"}">
        <td class="c-time">${utc(a.at)}</td>
        <td class="c-kind"><span class="kind">${esc(a.kind)}</span></td>
        <td class="c-amount num">${bnb(a.amountBnb)} <span class="unit unit--inline">BNB</span></td>
        <td class="c-reason">${esc(a.reason)}</td>
        <td class="c-tx">${txLink(m, a.txHash)}</td>
        <td class="c-status"><span class="state">${icon(a.ok ? "check" : "cross")}${a.ok ? "Success" : "Failed"}</span></td>
      </tr>`)
    .join("\n      ");
  const body = n
    ? `<table class="ledger" aria-labelledby="ledger-h">
      <thead><tr>
        <th scope="col">Time (UTC)</th><th scope="col">Action</th><th scope="col" class="num">Amount (BNB)</th>
        <th scope="col">Reason</th><th scope="col">Transaction</th><th scope="col">Status</th>
      </tr></thead>
      <tbody>
      ${rows}
      </tbody>
    </table>`
    : `<div class="ledger__empty"><p class="empty__title">No onchain actions yet</p><p class="empty">Each supply, withdrawal or harvest appears here with its reason and transaction link.</p></div>`;
  return `<section class="block" id="ledger" aria-labelledby="ledger-h">
  <div class="block__head">
    <h2 class="block__title" id="ledger-h">Action ledger</h2>
    <p class="muted">${n ? `${n === 1 ? "1 action" : `${n} actions`}, newest first` : "Every action is an onchain transaction"}</p>
  </div>
  <div class="panel panel--flush">
    ${body}
  </div>
</section>`;
}

function renderFooter(m: PageModel): string {
  const links = m.techLinks.map((l) => `<li>${link(l.url, esc(l.label), "link")}</li>`).join("");
  return `<footer class="footer">
  <div class="wrap footer__inner">
    ${links ? `<nav aria-label="Protocol links"><ul class="footer__links">${links}</ul></nav>` : ""}
    <p class="muted">Endpoint <span class="mono break">${esc(m.endpoint)}</span></p>
    <p class="muted">Snapshot ${utc(m.updatedAt)}. This page refreshes every 60 seconds.</p>
  </div>
</footer>`;
}

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#17150f"/><path d="M16 6l10 10-10 10L6 16z" fill="#f0b90b"/></svg>',
  );

const CSS = `
:root{
  --hue:85;
  --bg:oklch(15.5% 0.006 var(--hue));
  --surface:oklch(19% 0.007 var(--hue));
  --surface-sunken:oklch(13.5% 0.005 var(--hue));
  --border:oklch(28% 0.009 var(--hue));
  --border-strong:oklch(38% 0.012 var(--hue));
  --text:oklch(95% 0.006 var(--hue));
  --text-muted:oklch(77% 0.01 var(--hue));
  --text-subtle:oklch(68% 0.012 var(--hue));
  --accent:#f0b90b;
  --accent-hover:oklch(87% 0.15 92);
  --accent-soft:oklch(23% 0.035 var(--hue));
  --accent-line:oklch(42% 0.08 var(--hue));
  --on-accent:oklch(17% 0.02 var(--hue));
  --focus-ring:var(--accent);
  --success:oklch(79% 0.14 155);
  --success-soft:oklch(24% 0.045 155);
  --danger:oklch(73% 0.16 25);
  --danger-soft:oklch(25% 0.06 25);
  --seg-1:oklch(74% 0.02 var(--hue));
  --seg-2:oklch(56% 0.016 var(--hue));
  --seg-3:oklch(42% 0.012 var(--hue));
  --font-sans:"IBM Plex Sans",-apple-system,"Segoe UI",system-ui,sans-serif;
  --font-mono:ui-monospace,"SF Mono",Consolas,"Cascadia Mono","Liberation Mono",monospace;
  --text-xs:0.75rem;--text-sm:0.8125rem;--text-base:0.875rem;--text-md:1rem;
  --text-lg:1.125rem;--text-xl:1.375rem;--text-2xl:1.75rem;--text-3xl:2.25rem;
  --leading-tight:1.2;--leading-normal:1.55;
  --weight-regular:400;--weight-medium:500;--weight-semibold:600;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;
  --space-6:24px;--space-7:32px;--space-8:48px;--space-9:64px;
  --radius-sm:4px;--radius-md:6px;--radius-lg:8px;--radius-full:999px;
  --control-h:44px;--bar-h:14px;--content-max:1200px;--gutter:var(--space-4);
  --dur-fast:120ms;--dur:180ms;--ease-out:cubic-bezier(0.25,1,0.5,1);
}
@media (min-width:768px){:root{--gutter:var(--space-6)}}
@media (min-width:1024px){:root{--gutter:var(--space-7)}}
@media (prefers-reduced-motion:reduce){:root{--dur-fast:0ms;--dur:0ms}}
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:dark;background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;font:var(--weight-regular) var(--text-base)/var(--leading-normal) var(--font-sans);color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased;letter-spacing:0.005em}
h1,h2,p,ul,ol,dl,dd{margin:0}
ul,ol{padding:0;list-style:none}
h1,h2{text-wrap:balance}
p{text-wrap:pretty}
a{color:inherit}
:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.mono{font-family:var(--font-mono);font-size:1em;letter-spacing:0}
.num{font-variant-numeric:tabular-nums}
.muted{color:var(--text-muted)}
.nowrap{white-space:nowrap}
.break{overflow-wrap:anywhere}
.icon{flex:none;width:1em;height:1em}
.wrap{width:100%;max-width:var(--content-max);margin-inline:auto;padding-inline:var(--gutter)}
.skip{position:absolute;left:var(--space-4);top:calc(-1 * var(--space-9));z-index:10;display:inline-flex;align-items:center;min-height:var(--control-h);padding-inline:var(--space-4);background:var(--accent);color:var(--on-accent);font-weight:var(--weight-semibold);border-radius:var(--radius-md);text-decoration:none}
.skip:focus{top:var(--space-2)}

.topbar{border-bottom:1px solid var(--border)}
.topbar__inner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-2) var(--space-5);padding-block:var(--space-3)}
.brand{display:flex;align-items:center;gap:var(--space-2);font-weight:var(--weight-semibold)}
.brand svg{width:20px;height:20px}
.topbar__meta{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-4);color:var(--text-muted);font-size:var(--text-sm)}
@media (max-width:599px){.topbar__net{display:none}}

.hero{display:grid;gap:var(--space-7);padding-block:var(--space-7) var(--space-8)}
.hero+.block{margin-top:0}
.chips{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-4)}
.chip{display:inline-flex;align-items:center;min-height:28px;padding-inline:var(--space-3);border:1px solid var(--border-strong);border-radius:var(--radius-full);font-size:var(--text-sm);color:var(--text-muted)}
.chip--cat{border-color:var(--accent-line);color:var(--text)}
.hero h1{font-size:var(--text-2xl);line-height:var(--leading-tight);font-weight:var(--weight-semibold);letter-spacing:-0.02em}
.lead{margin-top:var(--space-3);font-size:var(--text-lg);line-height:1.45;color:var(--text);max-width:52ch}
.desc{margin-top:var(--space-4);font-size:var(--text-md);color:var(--text-muted);max-width:64ch}
.hire{display:flex;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-6)}
.hire .btn{flex:1 1 auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:var(--control-h);padding-inline:var(--space-5);border-radius:var(--radius-md);font-weight:var(--weight-semibold);font-size:var(--text-base);text-decoration:none;transition:transform var(--dur-fast) var(--ease-out),background-color var(--dur) var(--ease-out),border-color var(--dur) var(--ease-out)}
.btn:hover{transform:translateY(-1px)}
.btn:active{transform:translateY(1px)}
.btn--primary{background:var(--accent);color:var(--on-accent)}
.btn--primary:hover{background:var(--accent-hover)}
.btn--secondary{border:1px solid var(--border-strong);color:var(--text)}
.btn--secondary:hover{border-color:var(--text-subtle);background:var(--surface)}
.btn .icon--out{opacity:0.75}

.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-5)}
.panel--flush{padding:0}
.panel__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-2) var(--space-3);margin-bottom:var(--space-4)}
.panel__title{font-size:var(--text-md);font-weight:var(--weight-semibold);line-height:var(--leading-tight)}
.panel__title:not(:last-child){margin-bottom:var(--space-4)}
.panel__head .panel__title{margin-bottom:0}

.kv{display:grid;gap:0}
.kv>div{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0 var(--space-4);min-height:var(--control-h);border-top:1px solid var(--border)}
.kv>div:first-child{border-top:0}
.kv dt{color:var(--text-muted)}
.kv dd{text-align:right}

.link{display:inline-flex;align-items:center;gap:var(--space-1);text-decoration:underline;text-decoration-color:var(--border-strong);text-underline-offset:3px;transition:color var(--dur) var(--ease-out),text-decoration-color var(--dur) var(--ease-out)}
.link:hover{color:var(--accent);text-decoration-color:currentColor}
.link .icon--out{width:12px;height:12px;color:var(--text-subtle);transition:transform var(--dur-fast) var(--ease-out)}
.link:hover .icon--out{color:currentColor;transform:translate(1px,-1px)}

.block{margin-top:var(--space-8)}
.block:first-child{margin-top:0}
.block__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--space-1) var(--space-4);margin-bottom:var(--space-4)}
.block__title{font-size:var(--text-lg);font-weight:var(--weight-semibold)}

.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3)}
.metric:last-child:nth-child(odd){grid-column:1/-1}
@media (min-width:600px){
  .metrics{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
  .metric:last-child:nth-child(odd){grid-column:auto}
}
.metric{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-4)}
.metric dt{color:var(--text-muted);font-size:var(--text-sm)}
.metric__value{margin-top:var(--space-2);font-size:var(--text-xl);font-weight:var(--weight-semibold);line-height:var(--leading-tight);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.metric__hint{margin-top:var(--space-1);font-size:var(--text-xs);color:var(--text-muted)}

.grid2{display:grid;gap:var(--space-4);margin-top:var(--space-4)}

.alloc__bar{display:flex;gap:2px;height:var(--bar-h);border-radius:var(--radius-sm);background:var(--surface-sunken);box-shadow:inset 0 0 0 1px var(--border)}
.alloc__bar--empty{margin-bottom:var(--space-4)}
.seg{display:block;height:100%;min-width:0}
.seg:first-child{border-radius:var(--radius-sm) 0 0 var(--radius-sm)}
.seg:last-child{border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.seg:only-child{border-radius:var(--radius-sm)}
.seg--0{background:var(--accent)}
.seg--1{background:var(--seg-1)}
.seg--2{background:var(--seg-2)}
.seg--3{background:var(--seg-3)}
.alloc__legend{margin-top:var(--space-4)}
.alloc__legend li{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:var(--space-3);min-height:40px;border-top:1px solid var(--border)}
.alloc__legend li:first-child{border-top:0}
.swatch{width:10px;height:10px;border-radius:2px}
.alloc__label{min-width:0;overflow-wrap:anywhere}
.alloc__pct{min-width:6ch;text-align:right;color:var(--text-muted)}
.unit{color:var(--text-muted);font-size:var(--text-xs)}

.decision{background:var(--accent-soft);border-color:var(--accent-line)}
.decision__kind{font-size:var(--text-xl);font-weight:var(--weight-semibold);line-height:var(--leading-tight)}
.decision__reason{margin-top:var(--space-2);color:var(--text-muted);max-width:60ch;overflow-wrap:anywhere}

.tag{display:inline-flex;align-items:center;gap:var(--space-1);padding:2px var(--space-2);border-radius:var(--radius-sm);font-size:var(--text-xs);font-weight:var(--weight-medium)}
.tag--ok{background:var(--success-soft);color:var(--success)}
.tag--fail{background:var(--danger-soft);color:var(--danger)}
.gates li{display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:var(--space-3);padding-block:var(--space-3);border-top:1px solid var(--border)}
.gates li:first-child{border-top:0;padding-top:0}
.gates li:last-child{padding-bottom:0}
.gate__icon{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:var(--radius-full);font-size:var(--text-base)}
.gate.is-ok .gate__icon{background:var(--success-soft);color:var(--success)}
.gate.is-fail .gate__icon{background:var(--danger-soft);color:var(--danger)}
.gate__text{min-width:0}
.gate__label{font-weight:var(--weight-medium)}
.gate__detail{margin-top:2px;color:var(--text-muted);font-size:var(--text-sm);overflow-wrap:anywhere}
.state{display:inline-flex;align-items:center;gap:var(--space-1);font-size:var(--text-sm);font-weight:var(--weight-medium);white-space:nowrap}
.is-ok .state{color:var(--success)}
.is-fail .state{color:var(--danger)}
.gates .state{padding-top:2px}

.policy__intro{margin-bottom:var(--space-4)}
.policy__title{color:var(--text-muted);max-width:60ch}
.rules{counter-reset:rule;max-width:75ch}
.rules li{counter-increment:rule;display:grid;grid-template-columns:2.25rem 1fr;gap:var(--space-2);padding-block:var(--space-2);border-top:1px solid var(--border)}
.rules li:first-child{border-top:0;padding-top:0}
.rules li::before{content:counter(rule,decimal-leading-zero);font-family:var(--font-mono);font-size:var(--text-sm);color:var(--text-subtle);padding-top:1px}

.ledger{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
.ledger th{text-align:left;font-weight:var(--weight-medium);color:var(--text-muted);font-size:var(--text-xs);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border-strong);white-space:nowrap}
.ledger td{padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);vertical-align:baseline}
.ledger tbody tr:last-child td{border-bottom:0}
.ledger tbody tr:hover{background:var(--surface-sunken)}
.ledger .num{text-align:right}
.c-time,.c-amount,.c-tx,.c-status,.c-kind{white-space:nowrap}
.c-time{color:var(--text-muted)}
.c-reason{min-width:16rem;overflow-wrap:anywhere}
.kind{display:inline-block;padding:1px var(--space-2);border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:var(--text-xs);color:var(--text)}
.unit--inline{display:none}
.ledger__empty{padding:var(--space-7) var(--space-6)}
.empty__title{font-weight:var(--weight-medium);margin-bottom:var(--space-1)}
.empty{color:var(--text-muted);max-width:60ch}

.footer{margin-top:var(--space-9);border-top:1px solid var(--border)}
.footer__inner{display:grid;gap:var(--space-2);padding-block:var(--space-6) var(--space-7);font-size:var(--text-sm)}
.footer__links{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-5);margin-bottom:var(--space-2)}

@media (max-width:767px){
  .link{min-height:var(--control-h)}
}
@media (max-width:1023px){
  .ledger thead{display:none}
  .ledger,.ledger tbody{display:block}
  .ledger tr{display:grid;grid-template-columns:1fr auto;grid-template-areas:"time status" "kind amount" "reason reason" "tx tx";align-items:center;gap:var(--space-2) var(--space-3);padding:var(--space-4);border-bottom:1px solid var(--border)}
  .ledger tbody tr:last-child{border-bottom:0}
  .ledger td{display:block;padding:0;border:0}
  .ledger .c-time{grid-area:time}
  .ledger .c-status{grid-area:status;text-align:right}
  .ledger .c-kind{grid-area:kind}
  .ledger .c-amount{grid-area:amount;font-size:var(--text-base);font-weight:var(--weight-medium)}
  .ledger .c-reason{grid-area:reason;min-width:0;color:var(--text)}
  .ledger .c-tx{grid-area:tx}
  .unit--inline{display:inline}
}
@media (min-width:600px) and (max-width:1023px){
  .ledger tr{grid-template-columns:11rem auto 1fr auto;grid-template-areas:"time kind amount status" "reason reason reason tx";gap:var(--space-2) var(--space-5);padding-inline:var(--space-6)}
  .ledger .c-tx{text-align:right}
}
@media (min-width:768px){
  .hire .btn{flex:0 0 auto}
  .hero h1{font-size:var(--text-3xl)}
  .panel{padding:var(--space-6)}
  .panel--flush{padding:0}
  .grid2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid2.grid2--single{grid-template-columns:minmax(0,1fr)}
}
@media (min-width:1024px){
  .hero{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:var(--space-8);align-items:start;padding-block:var(--space-8)}
  .grid2{grid-template-columns:minmax(0,7fr) minmax(0,5fr)}
  .grid2--single .policy{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:var(--space-8)}
  .grid2--single .policy__intro{margin-bottom:0}
}
`;

/** Render the full HTML dashboard for one agent. */
export function renderPage(model: PageModel): string {
  const m = model;
  const category = m.category ? `${m.category[0].toUpperCase()}${m.category.slice(1)} agent` : "Agent";
  const idChip = m.agentId ? `<span class="chip mono">ERC-8004 #${esc(m.agentId)}</span>` : "";
  const gates = renderGates(m.gates);
  const metaDesc = m.tagline || m.description;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#17150f">
<title>${esc(m.name)} | Live agent dashboard</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#ledger">Skip to action ledger</a>
<header class="topbar">
  <div class="wrap topbar__inner">
    <p class="brand"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 4l12 12-12 12L4 16z" fill="var(--accent)"/></svg><span>ERC-8004 agent</span></p>
    <p class="topbar__meta"><span class="topbar__net">${esc(chainName(m.chainId))}</span><span>Updated ${utc(m.updatedAt)}</span></p>
  </div>
</header>
<main class="wrap">
  <section class="hero" aria-labelledby="agent-name">
    <div>
      <p class="chips"><span class="chip chip--cat">${esc(category)}</span>${idChip}</p>
      <h1 id="agent-name">${esc(m.name)}</h1>
      ${m.tagline ? `<p class="lead">${esc(m.tagline)}</p>` : ""}
      ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ""}
      ${renderHire(m.hireLinks)}
    </div>
    ${renderIdentity(m)}
  </section>
  ${renderMetrics(m.metrics)}
  <div class="grid2">
    ${renderAllocation(m.allocation)}
    ${renderDecision(m)}
  </div>
  <div class="grid2${gates ? "" : " grid2--single"}">
    ${gates}
    ${renderPolicy(m.policy)}
  </div>
  ${renderLedger(m)}
</main>
${renderFooter(m)}
</body>
</html>`;
}
