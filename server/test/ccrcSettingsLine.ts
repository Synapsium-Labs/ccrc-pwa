// The one reader, for tests, of ccd/ccrc's `CCRC_SETTINGS=(…)` line (D-6916). The settings census, W24's flip-backups suite and the
// box settings reader's suite each spelled `^CCRC_SETTINGS=\(([^)]*)\)$` themselves; this is the one spelling, so a change of the
// line's shape reds one reader, not three that disagree.

/** The names on the line, in order; `null` when the source has no such line (a caller must red by name, never answer an empty list). */
export function ccrcSettingsNames(ccrcSource: string): string[] | null {
  const m = /^CCRC_SETTINGS=\(([^)]*)\)$/m.exec(ccrcSource);
  return m ? m[1]!.split(' ').filter((w) => w !== '') : null;
}
