import type { EditEvent, Session } from "../types.js";

/** Every file change the agent made, in step order. Sub-agent edits are included and labelled. */
export function buildEditTimeline(session: Session): EditEvent[] {
  const events: EditEvent[] = [];
  for (const step of session.steps) {
    for (const call of step.tools) {
      for (const edit of call.edits) {
        events.push({
          stepIndex: step.index,
          toolId: call.id,
          path: edit.path,
          kind: edit.kind,
          added: edit.added,
          removed: edit.removed,
          isSidechain: step.isSidechain,
        });
      }
    }
  }
  return events;
}

const GIT_COMMIT =
  /(?:^|[\s;&|(])git\s+(?:-[Cc]\s+\S+\s+|--?[\w-]+(?:=\S+)?\s+)*commit(?=$|[\s;&|)])/;

/** True when the agent ran a successful `git commit`, which moves HEAD past the work. */
export function agentCommitted(session: Session): boolean {
  return session.steps.some((step) =>
    step.tools.some(
      (call) =>
        call.canonical === "run" &&
        call.exitCode === 0 &&
        GIT_COMMIT.test(typeof call.input.command === "string" ? call.input.command : ""),
    ),
  );
}
