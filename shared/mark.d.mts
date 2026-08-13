/**
 * Stamps `body` as ccrc-generated: inserts a `# ccrc:generated 1
 * sha256=<hex>` line as line 2 when `body` starts with a shebang, or as
 * line 1 otherwise, so the shebang always stays physically first. The hash
 * covers `body` with the marker line excluded — see `shared/mark.mjs` for
 * the shared stripping helper `verifyMarker` uses to recompute it.
 */
export function markGenerated(body: string): string;

/**
 * `'ccrc-unmodified'` — the text is exactly what `markGenerated` produced.
 * `'ccrc-edited'` — a marker is present but its hash no longer matches: the
 * text changed after ccrc wrote it. `'foreign'` — no marker is present at
 * all: `markGenerated` never produced this text.
 */
export type MarkerStatus = 'ccrc-unmodified' | 'ccrc-edited' | 'foreign';

/**
 * Classifies `text` against its own embedded marker. See `shared/mark.mjs`
 * for the exact algorithm — this module has no filesystem access and takes
 * no path; only the text is ever inspected.
 */
export function verifyMarker(text: string): MarkerStatus;
