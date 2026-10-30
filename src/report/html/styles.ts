// The report's look: an auditor's ledger. Calm type, hairline rules, a strict
// 4/8 px spacing scale, and colour only where it carries a verdict.
export const STYLES = String.raw`
:root {
  color-scheme: light;
  --bg: #fbfaf7;
  --surface: #f3f1ec;
  --ink: #161514;
  --muted: #6b665d;
  --rule: #e3ded3;
  --verified: #2f6b3b;
  --contradicted: #b3261e;
  --stale: #875c00;
  --unverified: #5b6472;
  --review: #5a4a9e;
  --add-bg: #e8f1e8;
  --del-bg: #f8e6e4;
  --focus: #161514;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --serif: "Iowan Old Style", "Charter", "Bitstream Charter", Georgia, "Times New Roman", serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #121211; --surface: #1b1a18; --ink: #e9e6df; --muted: #a19b90; --rule: #2b2925;
    --verified: #79b886; --contradicted: #ef8a83; --stale: #e0b552; --unverified: #a3acb9;
    --review: #a99be6; --add-bg: #1c2a1e; --del-bg: #2e1c1a; --focus: #e9e6df;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #121211; --surface: #1b1a18; --ink: #e9e6df; --muted: #a19b90; --rule: #2b2925;
  --verified: #79b886; --contradicted: #ef8a83; --stale: #e0b552; --unverified: #a3acb9;
  --review: #a99be6; --add-bg: #1c2a1e; --del-bg: #2e1c1a; --focus: #e9e6df;
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.6 var(--sans); font-variant-numeric: tabular-nums;
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 32px; }
h1, h2 { font-family: var(--serif); font-weight: 600; letter-spacing: -0.005em; }
h2 { font-size: 18px; margin: 0 0 16px; }
code, pre, .mono { font-family: var(--mono); font-size: 13px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
[hidden] { display: none !important; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Masthead */
.masthead { padding-top: 40px; }
.masthead-row { display: flex; gap: 24px; align-items: flex-start; justify-content: space-between; }
.eyebrow { font-size: 12px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 8px; }
.eyebrow span + span::before { content: "·"; margin: 0 8px; }
h1 { font-size: 32px; line-height: 1.2; margin: 0 0 8px; overflow-wrap: anywhere; }
.refs { font-family: var(--mono); font-size: 13px; color: var(--muted); margin: 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; position: relative; }
.btn {
  border: 1px solid var(--rule); background: var(--bg); border-radius: 4px;
  padding: 4px 12px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.btn:hover { border-color: var(--muted); }
.btn[aria-pressed="true"] { border-color: var(--ink); }
/* A row of punched holes under the header, like the torn top of a receipt. */
.perforation {
  height: 8px; margin-top: 32px; border-top: 1px dashed var(--rule);
  background-image: radial-gradient(circle at 4px 0, var(--rule) 1.5px, transparent 2px);
  background-size: 12px 8px; background-repeat: repeat-x;
}
.popover {
  position: absolute; right: 0; top: 36px; z-index: 5; width: 280px;
  background: var(--bg); border: 1px solid var(--rule); border-radius: 4px; padding: 16px;
  font-size: 13px; text-align: left;
}
.popover dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0; }
.popover dt { font-family: var(--mono); }
.popover dd { margin: 0; color: var(--muted); }

/* Verdict strip */
.strip { display: grid; grid-template-columns: repeat(5, 1fr); border-bottom: 1px solid var(--rule); margin-top: 24px; }
.counter {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left;
  background: none; border: 0; border-right: 1px solid var(--rule); padding: 16px; cursor: pointer;
}
.counter:last-child { border-right: 0; }
.counter .n { font-family: var(--mono); font-size: 32px; line-height: 1; }
.counter:hover .label, .counter[aria-pressed="true"] .label { color: var(--ink); }
.counter[aria-pressed="true"] { box-shadow: inset 0 -2px 0 currentColor; }
.counter .label { font-size: 12px; color: var(--muted); }
.counter .glyph { color: var(--v); }
.counter[data-v] .n { color: var(--v); }
.summary { font-family: var(--serif); font-size: 18px; line-height: 1.5; margin: 24px 0 8px; max-width: 72ch; }
.notices { margin: 8px 0 0; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
.notices li { border-left: 2px solid var(--rule); padding-left: 12px; margin-top: 8px; }

/* Verdict tags: a word in small caps plus a shape, never colour alone. */
[data-v="verified"] { --v: var(--verified); }
[data-v="contradicted"] { --v: var(--contradicted); }
[data-v="stale"] { --v: var(--stale); }
[data-v="unverified"] { --v: var(--unverified); }
[data-v="needs-review"] { --v: var(--review); }
.tag {
  display: inline-flex; align-items: center; gap: 8px; color: var(--v);
  font-size: 12px; font-variant: small-caps; text-transform: lowercase; letter-spacing: 0.08em; white-space: nowrap;
}
.glyph { display: inline-block; flex: none; width: 10px; height: 10px; background: currentColor; }
[data-v="verified"] .glyph { border-radius: 50%; }
[data-v="contradicted"] .glyph {
  clip-path: polygon(20% 0, 50% 30%, 80% 0, 100% 20%, 70% 50%, 100% 80%, 80% 100%, 50% 70%, 20% 100%, 0 80%, 30% 50%, 0 20%);
}
[data-v="stale"] .glyph { height: 5px; border-radius: 5px 5px 0 0; margin-bottom: 5px; }
[data-v="unverified"] .glyph { background: none; border: 1.5px solid currentColor; border-radius: 50%; }
[data-v="needs-review"] .glyph { clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }

/* Two panes */
.panes { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 40px; margin-top: 40px; }
section { margin-top: 48px; }
.panes section { margin-top: 0; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--rule); margin-bottom: 16px; }
.section-head h2 { margin-bottom: 8px; }
.section-head .meta { font-size: 12px; color: var(--muted); }
.message { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; margin: 0; }
.span { background: none; color: inherit; text-decoration: underline 2px var(--v); text-underline-offset: 3px; cursor: pointer; border-radius: 2px; }
.span.is-hot { background: var(--surface); }
.filter { width: 100%; border: 1px solid var(--rule); border-radius: 4px; background: var(--bg); padding: 4px 8px; font-size: 13px; margin-bottom: 8px; }
.claims { list-style: none; margin: 0; padding: 0; }
.claim { border-bottom: 1px solid var(--rule); padding: 12px 0; }
.claim-head { display: grid; grid-template-columns: 120px 1fr; gap: 16px; width: 100%; background: none; border: 0; padding: 0; text-align: left; cursor: pointer; align-items: baseline; }
.claim-text { font-size: 15px; overflow-wrap: anywhere; }
.claim .reason, .claim .chips { margin: 4px 0 0 136px; }
.reason { font-size: 13px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; list-style: none; }
.chip { font-family: var(--mono); font-size: 12px; color: var(--muted); border: 1px solid var(--rule); border-radius: 4px; padding: 0 8px; }
.claim.is-selected { box-shadow: inset 2px 0 0 var(--ink); padding-left: 12px; }
.claim.is-hot .claim-text { text-decoration: underline 1px var(--v); }
.badge { font-size: 12px; color: var(--muted); border: 1px solid var(--rule); border-radius: 4px; padding: 0 4px; margin-left: 8px; }
.empty { color: var(--muted); font-size: 13px; }

/* Evidence */
.evidence { margin: 12px 0 0 136px; border-top: 1px dashed var(--rule); padding-top: 12px; display: grid; gap: 16px; }
.ev-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; font-size: 13px; }
.ev-head strong { font-weight: 600; }
.cmd { background: var(--surface); border-radius: 4px; padding: 8px 12px; margin-top: 8px; }
.out { border: 1px solid var(--rule); border-radius: 4px; padding: 8px 12px; margin-top: 8px; max-height: 320px; overflow: auto; font-size: 12px; color: var(--muted); }
.out .hl { color: var(--ink); background: var(--surface); }
.link { background: none; border: 0; padding: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; font-size: 13px; color: var(--ink); }

/* Diffs */
.diff { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; margin-top: 8px; }
.diff td { padding: 0 8px; vertical-align: top; white-space: pre-wrap; word-break: break-word; }
.diff .ln { width: 1%; color: var(--muted); text-align: right; user-select: none; white-space: nowrap; }
.diff .sign { width: 1%; user-select: none; color: var(--muted); }
.diff tr.add td { background: var(--add-bg); }
.diff tr.del td { background: var(--del-bg); }
.diff tr.hunk td { color: var(--muted); padding-top: 8px; }

/* Timeline */
.timeline { position: relative; padding: 16px 0 24px; }
.lane { position: relative; height: 12px; }
/* Each step owns an equal slot; the tick is a thin line centred in it, so a
   short session does not turn into blocks and markers line up with ticks. */
.ticks { display: flex; align-items: flex-end; height: 32px; cursor: crosshair; border-bottom: 1px solid var(--rule); }
.tick { flex: 1 1 0; min-width: 1px; height: 12px; display: flex; justify-content: center; }
.tick::before { content: ""; width: min(100%, 3px); height: 100%; background: var(--rule); }
.tick.k-run { height: 24px; }
.tick.k-run::before { background: var(--muted); }
.tick.k-edit, .tick.k-write { height: 18px; }
.tick.k-edit::before, .tick.k-write::before { background: var(--ink); }
.tick.side::before { opacity: 0.55; }
.tick.is-hot { height: 32px; }
.tick.is-hot::before { background: var(--ink); width: min(100%, 5px); }
.mark { position: absolute; top: 2px; width: 8px; height: 8px; margin-left: -4px; }
.mark[data-v] { background: var(--v); border-radius: 50%; }
.mark[data-v="contradicted"] { border-radius: 0; clip-path: polygon(20% 0, 50% 30%, 80% 0, 100% 20%, 70% 50%, 100% 80%, 80% 100%, 50% 70%, 20% 100%, 0 80%, 30% 50%, 0 20%); }
.mark.edit { background: var(--ink); border-radius: 0; width: 4px; margin-left: -2px; }
.mark.is-hot { outline: 2px solid var(--ink); outline-offset: 2px; }
.readout { font-family: var(--mono); font-size: 12px; color: var(--muted); min-height: 20px; margin-top: 8px; overflow-wrap: anywhere; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--muted); margin: 8px 0 0; padding: 0; list-style: none; }
.legend span { display: inline-block; width: 8px; height: 8px; margin-right: 8px; vertical-align: 0; }

/* Tables */
table.ledger { width: 100%; border-collapse: collapse; font-size: 13px; }
/* Child selectors only: diffs nest tables inside ledger cells. */
.ledger > thead > tr > th { text-align: left; font-weight: 600; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 8px; }
.ledger > tbody > tr > td { border-bottom: 1px solid var(--rule); padding: 8px; vertical-align: top; }
.ledger .num { text-align: right; font-family: var(--mono); white-space: nowrap; }
.ledger .path { font-family: var(--mono); overflow-wrap: break-word; }
.ledger > tbody > tr.detail > td { padding: 0 8px 16px; }
.toggle { background: none; border: 0; padding: 0; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.toggle::before { content: "+"; display: inline-block; width: 16px; font-family: var(--mono); color: var(--muted); }
.toggle[aria-expanded="true"]::before { content: "\2212"; }
.sev { font-variant: small-caps; text-transform: lowercase; letter-spacing: 0.08em; font-size: 12px; }
.sev-high { color: var(--contradicted); }
.sev-medium { color: var(--stale); }
.sev-low { color: var(--unverified); }

footer { border-top: 1px solid var(--rule); margin-top: 64px; padding: 24px 0 48px; font-size: 12px; color: var(--muted); }
footer p { margin: 0; }

/* On wide screens the message stays in view while the claim list scrolls. */
@media (min-width: 1100px) {
  .panes > section:first-child { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; }
}
@media (max-width: 1099px) {
  .panes { grid-template-columns: minmax(0, 1fr); gap: 32px; }
}
@media (max-width: 759px) {
  .wrap { padding: 0 16px; }
  .masthead { padding-top: 24px; }
  .masthead-row { flex-direction: column; }
  .actions { justify-content: flex-start; }
  .popover { left: 0; right: auto; }
  h1 { font-size: 24px; }
  /* Five narrow columns cannot hold "contradicted"; on a phone the strip becomes a ledger. */
  .strip { grid-template-columns: minmax(0, 1fr); border-bottom: 0; border-top: 1px solid var(--rule); }
  .counter { flex-direction: row; align-items: center; gap: 16px; padding: 8px 0; border-right: 0; border-bottom: 1px solid var(--rule); }
  .counter .n { font-size: 24px; min-width: 2ch; text-align: right; }
  .counter[aria-pressed="true"] { box-shadow: inset 2px 0 0 currentColor; padding-left: 8px; }
  .claim-head { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .claim .reason, .claim .chips, .evidence { margin-left: 0; }
  .ledger .hide-sm { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;
