import { ReceiptsError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import { FLAG_INFO } from "../flags/info.js";
import { VERDICT_INFO } from "../report/verdicts.js";
import { FLAG_IDS, VERDICTS, type FlagId, type Verdict } from "../types.js";

/** Plain text for `receipts explain <verdict-or-flag>`. */
export function explain(id: string): string {
  const key = id.trim().toLowerCase().replace(/\s+/g, "-");
  if ((VERDICTS as readonly string[]).includes(key)) {
    const info = VERDICT_INFO[key as Verdict];
    return `${key}\n\n${info.meaning}\n\nExample: ${info.example}\n`;
  }
  if ((FLAG_IDS as readonly string[]).includes(key)) {
    const info = FLAG_INFO[key as FlagId];
    return `${key} (${info.severity})\n${info.title}\n\n${info.explain}\n`;
  }
  throw new ReceiptsError(
    `"${id}" is not a verdict or a flag.\nVerdicts: ${VERDICTS.join(", ")}\nFlags: ${FLAG_IDS.join(", ")}`,
    ExitCode.Usage,
  );
}
