# Demo video: shot list and script

A 75 to 90 second screen recording for the README, saved as `docs/demo.mp4` with a poster
frame at `docs/assets/demo-poster.png`. Everything on screen is the bundled demo session, a
synthetic CSV-parser task, so no real path, name or session appears.

## Before recording

- Screen at 1440 x 900. Browser zoom 100%, light theme, no bookmarks bar, no other tabs.
- A fresh terminal window: 16 px font, prompt set to `$ ` (`PS1='$ '` in bash,
  `PROMPT='$ '` in zsh), working in an empty folder such as `/tmp/receipts-demo`.
- Run the `npx` command once beforehand, so the recording does not wait for the download.
- Do not run `receipts sessions` or `check latest` on camera: they list real sessions.
- Turn off notifications.

## Shots

| Time      | On screen                                                                                                                                        | Narration                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:08 | Terminal. Type `npx github:sakshar2303/receipts check demo --open` and press Enter.                                                              | "Coding agents end with a confident summary. Receipts checks that summary against what actually ran."                          |
| 0:08–0:18 | The terminal summary prints. Hold on the count row: 2 contradicted, 2 stale, 1 unverified, 2 needs review, 2 verified.                           | "Nine claims in this agent's final message. Two are proven. Two are false, and two were true once but not any more."           |
| 0:18–0:30 | The report opens in the browser. Click the contradicted claim "the build succeeds". The evidence panel shows step 14, `npm run build`, exit 2.   | "The agent said the build succeeds. The last build exited 2. One click shows the step and the output."                         |
| 0:30–0:45 | Click the stale claim "All tests pass". Point at the timeline: the green test run at step 8, then the edits at steps 10 to 12.                   | "All tests pass was true at step 8. Then the agent edited the test file and never ran the tests again. That is a stale claim." |
| 0:45–0:55 | Scroll to Flags. Open the `test-skipped` row so the hunk shows `it(` becoming `it.skip(`.                                                        | "Flags catch what the agent did not mention. Here it skipped a test."                                                          |
| 0:55–1:05 | Press `j` and `k` to move between claims, `2` to filter to contradicted, `Esc` to clear. Click Theme for the dark theme.                         | "It works from the keyboard, it is one self-contained file, and nothing leaves your machine."                                  |
| 1:05–1:18 | Back to the terminal. Run `npx github:sakshar2303/receipts check demo --fail-on contradicted,stale --quiet; echo "exit $?"`. It prints `exit 1`. | "In a pre-push hook or CI, `--fail-on` turns a false claim into a failed check."                                               |
| 1:18–1:28 | Show `skills/receipts/SKILL.md` in the editor for two seconds, then cut to a card with the line below and the repository URL.                    | "And an agent can run it on its own draft before it says it is done. Your agent says it's done. Check the receipts."           |

## After recording

- Trim to under 90 seconds, export H.264 MP4 at 1440 x 900 or 1280 x 800, under 15 MB.
- Use the frame at 0:22 (the contradicted build claim with its evidence open) as the poster.
