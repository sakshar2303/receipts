import type { FinalMessage, Step } from "../types.js";

/**
 * Orders steps by time and renumbers them. Sub-agent steps live in separate
 * records, and the timeline (staleness in particular) needs one true order.
 * The sort is stable, so steps with equal timestamps keep their read order.
 */
export function orderSteps(steps: Step[]): Step[] {
  const ordered = [...steps].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return ordered.map((step, index) => ({ ...step, index }));
}

/** The last assistant text the user saw: sub-agent text never reaches the user directly. */
export function findFinalMessage(steps: readonly Step[]): FinalMessage | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step && !step.isSidechain && step.text.trim() !== "") {
      return { text: step.text.trim(), stepIndex: step.index };
    }
  }
  return null;
}
