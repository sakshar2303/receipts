import pc from "picocolors";

export type Colors = ReturnType<typeof pc.createColors>;

/**
 * Colour for a real terminal, or when FORCE_COLOR asks for it (CI logs,
 * screenshots). NO_COLOR always wins.
 */
export function colorsFor(stream: { isTTY?: boolean }, env = process.env): Colors {
  if ("NO_COLOR" in env) return pc.createColors(false);
  const forced =
    env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  return pc.createColors(forced || (stream.isTTY === true && env.TERM !== "dumb"));
}
