import type { ToolKind } from "../types.js";

// Tool names differ by agent and by version; match on a normalised name so
// "MultiEdit", "multi_edit" and "multiedit" land in the same bucket.
const KINDS: Record<string, ToolKind> = {
  read: "read",
  view: "read",
  notebookread: "read",
  grep: "search",
  glob: "search",
  search: "search",
  codesearch: "search",
  ls: "list",
  list: "list",
  edit: "edit",
  multiedit: "edit",
  notebookedit: "edit",
  patch: "edit",
  applypatch: "edit",
  write: "write",
  bash: "run",
  shell: "run",
  runcommand: "run",
  execcommand: "run",
  webfetch: "web",
  websearch: "web",
  fetch: "web",
};

export function normaliseToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export function canonicalTool(name: string): ToolKind {
  // MCP tools are namespaced ("mcp__server__tool"); they are never the agent's own shell or editor.
  if (name.startsWith("mcp__")) return "other";
  return KINDS[normaliseToolName(name)] ?? "other";
}
