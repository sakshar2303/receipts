import type { Receipt } from "../schema.js";
import { clientApp } from "./client.js";
import { esc, scriptJson } from "./escape.js";
import {
  claimList,
  fileTable,
  finalMessage,
  flagTable,
  timeline,
  verdictStrip,
} from "./sections.js";
import { STYLES } from "./styles.js";

const SOURCE_LABEL = { "claude-code": "Claude Code", opencode: "OpenCode" } as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * One self-contained page: inline CSS, inline script, the receipt as JSON. No
 * fonts, images or scripts are fetched, so it works from file:// and offline.
 */
export function renderHtml(receipt: Receipt, markdown: string): string {
  const { session, changes } = receipt;
  const eyebrow = [
    "Receipt",
    SOURCE_LABEL[session.source],
    session.model,
    formatDate(session.startedAt),
    session.repo,
  ]
    .filter(Boolean)
    .map((s) => `<span>${esc(s)}</span>`)
    .join("");
  const notices = receipt.notices.length
    ? `<ul class="notices">${receipt.notices.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
    : "";
  // Honest about what left the machine: a hosted model saw the final message.
  const model = receipt.llm.model;
  const privacy =
    model && !model.startsWith("ollama:")
      ? `Generated locally. Only the final message was sent to ${esc(model)}, a free hosted model.`
      : "Generated locally. Nothing left your machine.";
  const llm = model
    ? `Claims found by patterns and ${esc(model)}.`
    : "Claims found by patterns only; no language model was used.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Receipt: ${esc(session.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="masthead">
  <div class="wrap masthead-row">
    <div>
      <p class="eyebrow">${eyebrow}</p>
      <h1>${esc(session.title)}</h1>
      <p class="refs">${esc(changes.label)}${session.turns ? ` · turns ${esc(session.turns)}` : ""} · ${session.stepCount} steps</p>
    </div>
    <div class="actions">
      <button type="button" class="btn" id="copy-md">Copy Markdown</button>
      <button type="button" class="btn" id="download-json">Download JSON</button>
      <button type="button" class="btn" id="theme" aria-label="Switch colour theme">Theme</button>
      <button type="button" class="btn" id="keys" aria-expanded="false" aria-controls="keys-pop">Keyboard</button>
      <div class="popover" id="keys-pop" role="dialog" aria-label="Keyboard shortcuts" hidden>
        <dl>
          <dt>j / k</dt><dd>next or previous claim</dd>
          <dt>Enter</dt><dd>show or hide its evidence</dd>
          <dt>/</dt><dd>filter claims</dd>
          <dt>1 to 5</dt><dd>show one verdict</dd>
          <dt>Esc</dt><dd>clear filters and selection</dd>
        </dl>
      </div>
    </div>
  </div>
  <div class="wrap"><div class="perforation" aria-hidden="true"></div></div>
</header>
<main class="wrap">
  ${verdictStrip(receipt)}
  <p class="summary">${esc(receipt.summary)}</p>
  ${notices}
  <div class="panes">
    ${finalMessage(receipt)}
    ${claimList(receipt)}
  </div>
  ${timeline(receipt)}
  ${flagTable(receipt)}
  ${fileTable(receipt)}
</main>
<footer>
  <div class="wrap">
    <p>Receipts ${esc(receipt.receiptsVersion)} · report schema ${esc(receipt.schemaVersion)} · ${esc(formatDate(receipt.generatedAt))}</p>
    <p>${privacy} ${llm}</p>
  </div>
</footer>
<script type="application/json" id="receipt-data">${scriptJson({ receipt, markdown })}</script>
<script>(${clientApp.toString()})();</script>
</body>
</html>
`;
}
