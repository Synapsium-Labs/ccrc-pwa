/**
 * The project-directory name Claude Code files a transcript under: its cwd
 * with every separator-ish character mapped to `-`.
 *
 * ON WINDOWS THE RULE HAS TWO MORE CHARACTERS, AND THE INPUT A SECOND SPELLING.
 * Claude Code there munges its NATIVE cwd, so both `\` and the drive colon
 * become `-` — measured on this box: `C:\Users\<user>\worktrees\project-a\quiet-basin`
 * is filed under `C--Users-u-worktrees-project-a-quiet-basin`. And the path
 * this server is usually handed is ccd's, which runs under MSYS2 and records
 * `/c/Users/<user>/…`. The POSIX rule turns that into `-c-Users-u-…`, a
 * directory Claude Code never writes, so the exact rung of transcript
 * resolution missed for EVERY session on the box; the chat still opened only
 * because a later rung searches by uuid.
 *
 * So on win32 an MSYS drive prefix (`/c/`) is first read as the drive it names
 * (`C:\`) — uppercased, the spelling Windows and Claude Code both report — and
 * then `:` and `\` join `/ . _` as `-`. Every other platform is byte-identical
 * to the one-line rule this replaced: `/c/foo` is an ordinary path there, and
 * reading it as a drive would be inventing one.
 */
export const mungePath = (p: string, platform: NodeJS.Platform = process.platform): string => {
  if (platform !== 'win32') return p.replace(/[/._]/g, '-');
  const native = p.replace(/^\/([a-zA-Z])(?=\/|$)/, (_m, d: string) => `${d.toUpperCase()}:`);
  return native.replace(/[:\\/._]/g, '-');
};
