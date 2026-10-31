import type { Receipt } from "../schema.js";

/**
 * The report's behaviour. This function is inlined into the page with
 * toString(), so it must be self-contained: no imports at run time, nothing
 * from the enclosing module. Everything it builds goes through textContent,
 * never innerHTML, so transcript text cannot become markup.
 */
export function clientApp(): void {
  type Claim = Receipt["claims"][number];
  type Line = Receipt["changes"]["files"][number]["hunks"][number]["lines"][number];
  const VERDICTS = ["verified", "contradicted", "stale", "unverified", "needs-review"];
  const dataEl = document.getElementById("receipt-data");
  const { receipt, markdown } = JSON.parse(dataEl?.textContent ?? "{}") as {
    receipt: Receipt;
    markdown: string;
  };
  const state = { filter: "", query: "", selected: 0, open: new Set<number>() };
  const claimsById = new Map(receipt.claims.map((c) => [c.id, c]));
  const tools = new Map<
    string,
    { step: Receipt["steps"][number]; tool: Receipt["steps"][number]["tools"][number] }
  >();
  for (const step of receipt.steps)
    for (const tool of step.tools) tools.set(tool.id, { step, tool });
  const all = (sel: string, root: ParentNode = document) =>
    Array.from(root.querySelectorAll<HTMLElement>(sel));
  const one = (sel: string) => document.querySelector<HTMLElement>(sel);
  const filterInput = document.querySelector<HTMLInputElement>("#filter");

  function h(
    tag: string,
    attrs: Record<string, string> = {},
    ...children: (Node | string | null)[]
  ): HTMLElement {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const c of children)
      if (c !== null) el.append(typeof c === "string" ? document.createTextNode(c) : c);
    return el;
  }
  const stepLabel = (i: number) => `Step ${i + 1}`;

  // Diffs, rendered only when opened so a long report stays fast.
  function diffTable(lines: Line[], header?: string): HTMLElement {
    const body = h("tbody");
    if (header) body.append(h("tr", { class: "hunk" }, h("td", { colspan: "4" }, header)));
    for (const l of lines) {
      const sign = l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ";
      body.append(
        h(
          "tr",
          { class: l.kind },
          h("td", { class: "ln" }, l.oldLine === null ? "" : String(l.oldLine)),
          h("td", { class: "ln" }, l.newLine === null ? "" : String(l.newLine)),
          h("td", { class: "sign" }, sign),
          h("td", {}, l.text),
        ),
      );
    }
    return h("table", { class: "diff" }, body);
  }

  function fileDiff(path: string, limit = Infinity): HTMLElement {
    const file = receipt.changes.files.find((f) => f.path === path);
    if (!file) return h("p", { class: "empty" }, "This file is not in the change set.");
    if (file.binary)
      return h("p", { class: "empty" }, "Binary file; there is no text diff to show.");
    const wrap = h("div");
    let shown = 0;
    for (const hunk of file.hunks) {
      if (shown >= limit) break;
      const lines = hunk.lines.slice(0, limit - shown);
      shown += lines.length;
      wrap.append(diffTable(lines, hunk.header));
    }
    if (file.hunks.length === 0)
      wrap.append(h("p", { class: "empty" }, "No line changes were recorded for this file."));
    if (file.truncated || shown >= limit)
      wrap.append(h("p", { class: "empty" }, "The diff is cut short here."));
    return wrap;
  }

  // Evidence panel for one claim.
  const HIGHLIGHT = /fail|error|✖|passed|passing|failing|exit code|exited|no tests/i;
  function evidenceItem(e: Claim["evidence"][number]): HTMLElement {
    if (e.kind === "diff") {
      return h(
        "div",
        {},
        h(
          "div",
          { class: "ev-head" },
          h("strong", { class: "mono" }, e.path),
          h("span", {}, `${e.status} · +${e.added} −${e.removed}`),
        ),
        fileDiff(e.path, 40),
      );
    }
    const found = tools.get(e.toolId);
    const head = h(
      "div",
      { class: "ev-head" },
      h("strong", {}, stepLabel(e.stepIndex)),
      h("span", {}, found ? found.tool.name : ""),
    );
    if (e.isSidechain) head.append(h("span", { class: "badge" }, "from sub-agent"));
    const jump = h(
      "button",
      { type: "button", class: "link", "data-jump": String(e.stepIndex) },
      "Show in timeline",
    );
    if (e.kind === "edit")
      return h("div", {}, head, h("p", { class: "mono" }, `${e.path} changed`), jump);

    head.append(
      h("span", { class: "mono" }, e.exitCode === null ? "no exit code" : `exit ${e.exitCode}`),
    );
    const out = found?.tool.output ?? "";
    const pre = h("pre", { class: "out" });
    for (const line of out.split("\n")) {
      pre.append(HIGHLIGHT.test(line) ? h("span", { class: "hl" }, line) : line, "\n");
    }
    return h(
      "div",
      {},
      head,
      h(
        "pre",
        { class: "cmd" },
        `$ ${e.command.length > 2000 ? `${e.command.slice(0, 2000)}…` : e.command}`,
      ),
      e.segment && e.segment !== e.command
        ? h("p", { class: "reason" }, `Judged on: ${e.segment}`)
        : null,
      found?.tool.note ? h("p", { class: "reason" }, `Note: ${found.tool.note}`) : null,
      out ? pre : h("p", { class: "empty" }, "No output was recorded for this command."),
      jump,
    );
  }

  function renderEvidence(claim: Claim, panel: HTMLElement): void {
    if (panel.dataset.ready) return;
    panel.dataset.ready = "1";
    if (claim.evidence.length === 0)
      panel.append(
        h("p", { class: "empty" }, "No evidence was found in the transcript or the diff."),
      );
    for (const e of claim.evidence) panel.append(evidenceItem(e));
  }

  // Steps a claim's evidence points at, for the timeline.
  function evidenceSteps(claim: Claim | undefined): Set<number> {
    const steps = new Set<number>();
    for (const e of claim?.evidence ?? []) {
      if (e.kind === "diff") {
        for (const s of receipt.steps)
          if (s.tools.some((t) => t.paths.includes(e.path))) steps.add(s.index);
      } else steps.add(e.stepIndex);
    }
    return steps;
  }

  function markTimeline(steps: Set<number>): void {
    for (const el of all("[data-step]"))
      el.classList.toggle("is-hot", steps.has(Number(el.dataset.step)));
  }

  function readStep(i: number): string {
    const step = receipt.steps.find((s) => s.index === i);
    if (!step) return "";
    const parts = step.tools.map((t) => {
      if (t.command !== null)
        return `${t.name}: ${t.command.split("\n")[0] ?? ""}${t.exitCode === null ? "" : ` (exit ${t.exitCode})`}`;
      return t.paths.length ? `${t.name}: ${t.paths.join(", ")}` : t.name;
    });
    const text = parts.length ? parts.join("; ") : step.text.split("\n")[0] || "text only";
    return `${stepLabel(i)}${step.isSidechain ? " · sub-agent" : ""} · ${text.length > 200 ? `${text.slice(0, 199)}…` : text}`;
  }

  // Claims: filter, select, open.
  const rows = all(".claim");
  const visible = () => rows.filter((r) => !r.hidden);

  function applyFilter(): void {
    for (const row of rows) {
      const okVerdict = !state.filter || row.dataset.v === state.filter;
      const okText = !state.query || (row.dataset.text ?? "").includes(state.query);
      row.hidden = !(okVerdict && okText);
    }
    for (const b of all("[data-filter]"))
      b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
    const none = one("#no-match");
    if (none) none.hidden = visible().length > 0;
    writeHash();
  }

  function select(id: number, opts: { scroll?: boolean } = {}): void {
    state.selected = id;
    for (const row of rows) row.classList.toggle("is-selected", Number(row.dataset.id) === id);
    for (const m of all("mark.span")) m.classList.toggle("is-hot", Number(m.dataset.claim) === id);
    markTimeline(evidenceSteps(claimsById.get(id)));
    if (opts.scroll) document.getElementById(`claim-${id}`)?.scrollIntoView({ block: "nearest" });
    writeHash();
  }

  function setOpen(id: number, open: boolean): void {
    const row = document.getElementById(`claim-${id}`);
    const panel = document.getElementById(`ev-${id}`);
    const claim = claimsById.get(id);
    if (!row || !panel || !claim) return;
    if (open) renderEvidence(claim, panel);
    panel.hidden = !open;
    row.querySelector(".claim-head")?.setAttribute("aria-expanded", String(open));
    if (open) state.open.add(id);
    else state.open.delete(id);
    writeHash();
  }

  // Lazy rows in the flags and files tables.
  function toggleDetail(button: HTMLElement, fill: (cell: HTMLElement) => void): void {
    const row = document.getElementById(button.getAttribute("aria-controls") ?? "");
    const cell = row?.querySelector<HTMLElement>("td");
    if (!row || !cell) return;
    const open = button.getAttribute("aria-expanded") !== "true";
    if (open && !cell.dataset.ready) {
      cell.dataset.ready = "1";
      fill(cell);
    }
    row.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  // URL hash: #claim=3&filter=stale&open=3,5
  let restoring = false;
  function writeHash(): void {
    if (restoring) return;
    const p = new URLSearchParams();
    if (state.selected) p.set("claim", String(state.selected));
    if (state.filter) p.set("filter", state.filter);
    if (state.open.size) p.set("open", [...state.open].join(","));
    const hash = p.toString();
    history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  }
  function readHash(): void {
    const p = new URLSearchParams(location.hash.slice(1));
    restoring = true;
    const filter = p.get("filter") ?? "";
    state.filter = VERDICTS.includes(filter) ? filter : "";
    applyFilter();
    const wanted = new Set(
      (p.get("open") ?? "")
        .split(",")
        .map(Number)
        .filter((n) => claimsById.has(n)),
    );
    for (const id of [...state.open]) if (!wanted.has(id)) setOpen(id, false);
    for (const id of wanted) setOpen(id, true);
    const claim = Number(p.get("claim"));
    if (claimsById.has(claim)) select(claim, { scroll: true });
    restoring = false;
  }

  // Theme: follows the system until the reader picks one; the choice is remembered.
  const themeButton = one("#theme");
  const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  function effectiveTheme(): string {
    return document.documentElement.dataset.theme ?? (systemDark() ? "dark" : "light");
  }
  function showTheme(): void {
    if (themeButton)
      themeButton.textContent = effectiveTheme() === "dark" ? "Light theme" : "Dark theme";
  }
  try {
    const saved = localStorage.getItem("receipts-theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch {
    // Storage can be blocked for file:// pages; the system theme still applies.
  }
  showTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", showTheme);
  themeButton?.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("receipts-theme", next);
    } catch {
      // Not remembered, but still applied.
    }
    showTheme();
  });

  // Copy Markdown and Download JSON.
  const copyButton = one("#copy-md");
  copyButton?.addEventListener("click", () => {
    const done = () => {
      copyButton.textContent = "Copied";
      setTimeout(() => (copyButton.textContent = "Copy Markdown"), 1600);
    };
    // file:// pages can block the clipboard; say so rather than pretend.
    const blocked = () => {
      copyButton.textContent = "Copy blocked by the browser";
      setTimeout(() => (copyButton.textContent = "Copy Markdown"), 2400);
    };
    navigator.clipboard.writeText(markdown).then(done, blocked);
  });
  one("#download-json")?.addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
    );
    const a = h("a", { href: url, download: "report.json" });
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  });

  // Keyboard popover.
  const keysButton = one("#keys");
  const keysPop = one("#keys-pop");
  function showKeys(open: boolean): void {
    if (!keysPop || !keysButton) return;
    keysPop.hidden = !open;
    keysButton.setAttribute("aria-expanded", String(open));
  }
  keysButton?.addEventListener("click", () => {
    showKeys(keysPop?.hidden === true);
  });

  // One click handler for everything clickable.
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const filter = target.closest<HTMLElement>("[data-filter]");
    if (filter) {
      state.filter = state.filter === filter.dataset.filter ? "" : (filter.dataset.filter ?? "");
      applyFilter();
      return;
    }
    const head = target.closest<HTMLElement>(".claim-head");
    const row = head?.closest<HTMLElement>(".claim");
    if (row) {
      const id = Number(row.dataset.id);
      select(id);
      setOpen(id, head?.getAttribute("aria-expanded") !== "true");
      return;
    }
    const span = target.closest<HTMLElement>("mark.span");
    if (span) {
      const id = Number(span.dataset.claim);
      state.filter = "";
      state.query = "";
      const input = filterInput;
      if (input) input.value = "";
      applyFilter();
      setOpen(id, true);
      select(id, { scroll: true });
      return;
    }
    const jump = target.closest<HTMLElement>("[data-jump]");
    if (jump) {
      const i = Number(jump.dataset.jump);
      markTimeline(new Set([i]));
      const readout = one("#readout");
      if (readout) readout.textContent = readStep(i);
      one("#ticks")?.scrollIntoView({ block: "center" });
      return;
    }
    const flagButton = target.closest<HTMLElement>("[data-flag]");
    if (flagButton) {
      const flag = receipt.flags[Number(flagButton.dataset.flag)];
      toggleDetail(flagButton, (cell) => {
        let path = "";
        let batch: Line[] = [];
        const flush = () => {
          if (batch.length) cell.append(diffTable(batch, path));
        };
        for (const item of flag?.lines ?? []) {
          if (item.path !== path) {
            flush();
            path = item.path;
            batch = [];
          }
          batch.push(item.line);
        }
        flush();
      });
      return;
    }
    const fileButton = target.closest<HTMLElement>("[data-file]");
    if (fileButton) {
      const file = receipt.changes.files[Number(fileButton.dataset.file)];
      toggleDetail(fileButton, (cell) => {
        if (file) cell.append(fileDiff(file.path));
      });
      return;
    }
    if (keysPop && keysPop.hidden !== true && !target.closest("#keys-pop") && target !== keysButton)
      showKeys(false);
  });

  // Hover links the message and the list.
  function hover(id: number, on: boolean): void {
    document.getElementById(`claim-${id}`)?.classList.toggle("is-hot", on);
    for (const m of all(`mark.span[data-claim="${id}"]`))
      m.classList.toggle("is-hot", on || id === state.selected);
  }
  for (const m of all("mark.span")) {
    m.addEventListener("mouseenter", () => {
      hover(Number(m.dataset.claim), true);
    });
    m.addEventListener("mouseleave", () => {
      hover(Number(m.dataset.claim), false);
    });
  }
  for (const row of rows) {
    row.addEventListener("mouseenter", () => {
      hover(Number(row.dataset.id), true);
    });
    row.addEventListener("mouseleave", () => {
      hover(Number(row.dataset.id), false);
    });
  }

  // Timeline readout on hover.
  const ticks = one("#ticks");
  ticks?.addEventListener("mousemove", (event) => {
    const box = ticks.getBoundingClientRect();
    const n = receipt.steps.length;
    const i = Math.min(
      n - 1,
      Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * n)),
    );
    const step = receipt.steps[i];
    const readout = one("#readout");
    if (step && readout) readout.textContent = readStep(step.index);
  });

  // Search box.
  const input = filterInput;
  input?.addEventListener("input", () => {
    state.query = input.value.trim().toLowerCase();
    applyFilter();
  });

  // Keyboard: j/k, Enter, /, 1-5, Esc.
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    if (event.key === "Escape") {
      state.filter = "";
      state.query = "";
      if (input) input.value = "";
      state.selected = 0;
      for (const row of rows) row.classList.remove("is-selected");
      for (const m of all("mark.span")) m.classList.remove("is-hot");
      markTimeline(new Set());
      showKeys(false);
      if (typing) target.blur();
      applyFilter();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "/") {
      event.preventDefault();
      input?.focus();
    } else if (event.key === "j" || event.key === "k") {
      const list = visible();
      if (list.length === 0) return;
      const at = list.findIndex((r) => Number(r.dataset.id) === state.selected);
      const next =
        event.key === "j" ? Math.min(list.length - 1, at + 1) : Math.max(0, at === -1 ? 0 : at - 1);
      const row = list[next];
      if (row) {
        select(Number(row.dataset.id), { scroll: true });
        row.querySelector<HTMLElement>(".claim-head")?.focus({ preventScroll: true });
      }
    } else if (event.key === "Enter" && state.selected && target.tagName !== "BUTTON") {
      setOpen(state.selected, !state.open.has(state.selected));
    } else if (/^[1-5]$/.test(event.key)) {
      const v = VERDICTS[Number(event.key) - 1] ?? "";
      state.filter = state.filter === v ? "" : v;
      applyFilter();
    }
  });

  readHash();
  // A link pasted into the same tab, or back and forward, changes only the hash.
  window.addEventListener("hashchange", readHash);
}
