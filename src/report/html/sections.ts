import { FLAG_INFO } from "../../flags/info.js";
import { VERDICTS, type Verdict } from "../../types.js";
import { evidenceLabel, sortedClaims, VERDICT_LABEL } from "../format.js";
import type { Receipt } from "../schema.js";
import { esc } from "./escape.js";

export const tag = (v: Verdict) =>
  `<span class="tag" data-v="${v}"><span class="glyph" aria-hidden="true"></span>${VERDICT_LABEL[v]}</span>`;

export function verdictStrip(receipt: Receipt): string {
  const counters = VERDICTS.map(
    (v, i) =>
      `<button type="button" class="counter" data-v="${v}" data-filter="${v}" aria-pressed="false" title="Show only ${VERDICT_LABEL[v]} claims (key ${i + 1})">` +
      `<span class="n">${receipt.counts[v]}</span>${tag(v).replace('class="tag"', 'class="tag label"')}</button>`,
  ).join("");
  return `<nav class="strip" aria-label="Filter claims by verdict">${counters}</nav>`;
}

/** The final message as written, with each claim underlined in its verdict colour. */
export function finalMessage(receipt: Receipt): string {
  const text = receipt.finalMessage.text;
  const spans = [...receipt.claims].sort((a, b) => a.span.start - b.span.start);
  let html = "";
  let at = 0;
  for (const c of spans) {
    // Overlapping spans (a pattern and a model claim on the same words) keep the first.
    if (c.span.start < at || c.span.end > text.length) continue;
    html += esc(text.slice(at, c.span.start));
    html += `<mark class="span" data-v="${c.verdict}" data-claim="${c.id}" title="${esc(VERDICT_LABEL[c.verdict])}: ${esc(c.reason)}">${esc(text.slice(c.span.start, c.span.end))}</mark>`;
    at = c.span.end;
  }
  html += esc(text.slice(at));
  return `<section aria-labelledby="h-message"><div class="section-head"><h2 id="h-message">Final message</h2><span class="meta">step ${receipt.finalMessage.stepIndex + 1}</span></div><p class="message">${html}</p></section>`;
}

export function claimList(receipt: Receipt): string {
  const rows = sortedClaims(receipt)
    .map((c) => {
      const chips = c.evidence
        .slice(0, 3)
        .map((e) => `<li class="chip">${esc(evidenceLabel(e))}</li>`)
        .join("");
      const by =
        c.extractedBy === "llm"
          ? `<span class="badge" title="Found by the language model">model</span>`
          : "";
      return (
        `<li class="claim" id="claim-${c.id}" data-id="${c.id}" data-v="${c.verdict}" data-text="${esc(c.text.toLowerCase())}">` +
        `<button type="button" class="claim-head" aria-expanded="false" aria-controls="ev-${c.id}">${tag(c.verdict)}<span class="claim-text">${esc(c.text)}${by}</span></button>` +
        `<p class="reason">${esc(c.reason)}</p>` +
        (chips ? `<ul class="chips" aria-label="Evidence">${chips}</ul>` : "") +
        `<div class="evidence" id="ev-${c.id}" hidden></div></li>`
      );
    })
    .join("");
  const body = receipt.claims.length
    ? `<label class="visually-hidden" for="filter">Filter claims</label><input id="filter" class="filter" type="search" placeholder="Filter claims  ( / )" autocomplete="off"><ul class="claims" id="claims">${rows}</ul><p class="empty" id="no-match" hidden>No claims match this filter.</p>`
    : `<p class="empty">The final message makes no claims Receipts can check.</p>`;
  return `<section aria-labelledby="h-claims"><div class="section-head"><h2 id="h-claims">Claims</h2><span class="meta">${receipt.claims.length} found</span></div>${body}</section>`;
}

/** Every step as a thin tick; markers for test runs above, edits below. */
export function timeline(receipt: Receipt): string {
  const n = Math.max(1, receipt.steps.length);
  const pos = (i: number) => (((i + 0.5) / n) * 100).toFixed(3);
  const ticks: string[] = [];
  const marks: string[] = [];
  const edits: string[] = [];
  for (const step of receipt.steps) {
    const kinds = new Set(step.tools.map((t) => t.canonical));
    const kind = kinds.has("run")
      ? "run"
      : kinds.has("edit")
        ? "edit"
        : kinds.has("write")
          ? "write"
          : "other";
    ticks.push(
      `<span class="tick k-${kind}${step.isSidechain ? " side" : ""}" data-step="${step.index}"></span>`,
    );
    const test = step.tools.flatMap((t) => t.checks).find((c) => c.kind === "test");
    if (
      test &&
      (test.outcome === "pass" || test.outcome === "fail" || test.outcome === "no-tests")
    ) {
      const v = test.outcome === "pass" ? "verified" : "contradicted";
      marks.push(
        `<span class="mark" data-v="${v}" data-step="${step.index}" style="left:${pos(step.index)}%"></span>`,
      );
    }
    if (step.tools.some((t) => t.paths.length > 0)) {
      edits.push(
        `<span class="mark edit" data-step="${step.index}" style="left:${pos(step.index)}%"></span>`,
      );
    }
  }
  return `<section aria-labelledby="h-timeline"><div class="section-head"><h2 id="h-timeline">Timeline</h2><span class="meta">${receipt.steps.length} steps</span></div>
<div class="timeline"><div class="lane" aria-hidden="true">${marks.join("")}</div><div class="ticks" id="ticks" role="img" aria-label="${receipt.steps.length} steps; hover to read one">${ticks.join("")}</div><div class="lane" aria-hidden="true">${edits.join("")}</div>
<p class="readout" id="readout" aria-live="polite">Hover the timeline to read a step. Select a claim to mark its evidence.</p>
<ul class="legend"><li><span style="background:var(--verified);border-radius:50%"></span>tests passed</li><li><span style="background:var(--contradicted)"></span>tests failed</li><li><span style="background:var(--ink)"></span>file edited</li><li><span style="background:var(--muted)"></span>command run</li></ul></div></section>`;
}

export function flagTable(receipt: Receipt): string {
  if (receipt.flags.length === 0) {
    return `<section aria-labelledby="h-flags"><div class="section-head"><h2 id="h-flags">Flags</h2></div><p class="empty">No flags. The diff didn't touch tests, secrets or sensitive paths, and no risky command ran.</p></section>`;
  }
  const rows = receipt.flags
    .map((f, i) => {
      const expandable = f.lines.length > 0;
      const title = expandable
        ? `<button type="button" class="toggle" aria-expanded="false" aria-controls="flag-${i}" data-flag="${i}">${esc(f.title)}</button>`
        : esc(f.title);
      return (
        `<tr><td><span class="sev sev-${f.severity}">${f.severity}</span></td><td>${title}<div class="mono reason">${esc(f.id)}${f.heuristic ? " · heuristic" : ""}</div></td><td>${esc(f.detail)}<div class="reason">${esc(FLAG_INFO[f.id].explain.split(". ")[0] ?? "")}.</div></td><td class="path hide-sm">${esc(f.files.slice(0, 3).join("\n"))}</td></tr>` +
        (expandable ? `<tr class="detail" id="flag-${i}" hidden><td colspan="4"></td></tr>` : "")
      );
    })
    .join("");
  return `<section aria-labelledby="h-flags"><div class="section-head"><h2 id="h-flags">Flags</h2><span class="meta">${receipt.flags.length}</span></div><table class="ledger"><thead><tr><th scope="col">Severity</th><th scope="col">Flag</th><th scope="col">Detail</th><th scope="col" class="hide-sm">Files</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

export function fileTable(receipt: Receipt): string {
  const { files } = receipt.changes;
  if (files.length === 0) {
    return `<section aria-labelledby="h-files"><div class="section-head"><h2 id="h-files">Changed files</h2><span class="meta">${esc(receipt.changes.label)}</span></div><p class="empty">No file changes were found for this session.</p></section>`;
  }
  const rows = files
    .map(
      (f, i) =>
        `<tr><td class="path"><button type="button" class="toggle" aria-expanded="false" aria-controls="file-${i}" data-file="${i}">${esc(f.path)}</button>${f.status === "renamed" ? `<div class="reason">from ${esc(f.oldPath)}</div>` : ""}</td><td class="hide-sm">${f.status}${f.binary ? " · binary" : ""}</td><td class="num">+${f.added}</td><td class="num">−${f.removed}</td><td class="hide-sm">${f.mentioned ? "yes" : "no"}</td><td class="mono hide-sm">${esc(f.flags.join(", "))}</td></tr><tr class="detail" id="file-${i}" hidden><td colspan="6"></td></tr>`,
    )
    .join("");
  return `<section aria-labelledby="h-files"><div class="section-head"><h2 id="h-files">Changed files</h2><span class="meta">${esc(receipt.changes.label)} · ${files.length}</span></div><table class="ledger"><thead><tr><th scope="col">File</th><th scope="col" class="hide-sm">Status</th><th scope="col" class="num">Added</th><th scope="col" class="num">Removed</th><th scope="col" class="hide-sm">Mentioned</th><th scope="col" class="hide-sm">Flags</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}
