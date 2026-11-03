// A shared reader, for tests, of ccd/ccrc's `CCRC_SETTINGS=(…)` line (D-6916). The settings census and W24's flip-backups suite import
// it, so a change of the line's shape reds them together. It is not the only spelling: `ccrc-settings-verb`, `ccrc-settings-lib`,
// `graph-knobs` and `testbox-knobs` still carry their own copy (ARCH-06); merging them is not this wave's (review 1396 F12).

/** The names on the line, in order; `null` when the source has no such line (a caller must red by name, never answer an empty list). */
export function ccrcSettingsNames(ccrcSource: string): string[] | null {
  const m = /^CCRC_SETTINGS=\(([^)]*)\)$/m.exec(ccrcSource);
  return m ? m[1]!.split(' ').filter((w) => w !== '') : null;
}
