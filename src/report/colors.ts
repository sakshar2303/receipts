import pc from "picocolors";

export type Colors = ReturnType<typeof pc.createColors>;

/** Colour only for a real terminal, and never when NO_COLOR is set. */
export function colorsFor(stream: { isTTY?: boolean }, env = process.env): Colors {
  const enabled = stream.isTTY === true && !("NO_COLOR" in env) && env.TERM !== "dumb";
  return pc.createColors(enabled);
}
