// Whitespace removed (L0, imports nothing): the comparison the pane readers and the mail lane share. Claude Code wraps a long line at
// spaces, and a row is read trimmed, so only the non-space characters of a line survive the rendering in order; comparing those
// is comparing what was typed. `server/src/inject/send.ts` (the wrap-tolerant box comparisons) and `server/src/coord/envelope.ts`
// (`resumeRuleOf`) both ask it, so there is one definition.
export const squash = (s: string): string => s.replace(/\s+/g, '');
