// Exit codes are part of the public contract: hooks and CI scripts branch on them.
export const ExitCode = {
  Ok: 0,
  FailOnMatched: 1,
  Usage: 2,
  InputNotFound: 3,
  Internal: 4,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export const EXIT_CODE_HELP = `Exit codes:
  0  Nothing matched --fail-on
  1  At least one claim matched --fail-on
  2  Usage error
  3  Input not found or unreadable
  4  Internal error`;
