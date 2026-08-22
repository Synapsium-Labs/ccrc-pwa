/**
 * L1: pure, clock-free where it can be (`nowMs` is an INPUT), `fs`-free,
 * fastify-free. It DECIDES what the sweep should do; `mirror.ts` does it.
 *
 * The ring rule this file must keep: no `./db.js`, no `node:sqlite`, and no
 * `store.db` receiver — `single-definition.test.ts`'s coord-ring scan fails
 * the build on any of the three. The names of the journal's files and its
 * ordering are L0's (`LC_DIR_NAME`, `LC_GEN_PREFIX`, `LC_GEN_SUFFIX`,
 * `LC_ERRORS_NAME`, `looksLikeGenerationFile`, `parseLifecycleGeneration`,
 * `compareGenerations`); this file imports them and declares none of them.
 */

/** What one `readFileFrom` answer means. */
export interface FramedRead {
  /** The COMPLETE lines in this payload, in order. Blank lines are dropped:
   *  `_lc_emit` writes one `printf '%s\n'` per event, so a blank line carries
   *  no event, and its bytes are still stepped over by `nextCursor`. */
  readonly lines: readonly string[];
  /** The BYTE offset just past the last complete line. `Buffer.byteLength`,
   *  never `String.length` — `hookstate.ts:150` takes the same care with its
   *  own cap, and a multibyte `--reason` would otherwise shift every later
   *  cursor by the difference between chars and bytes. */
  readonly nextCursor: number;
  /** The generation got SMALLER than we last measured it: a truncation on an
   *  immutably-named file. The caller records `gap{reason:'shrank'}` and
   *  re-reads from 0; `uid` dedupes what comes back, so only genuinely-lost
   *  bytes are lost. Separate from an empty payload, which is a cursor at EOF
   *  and a positive answer — two conditions a caller handles differently must
   *  not collapse to one value. */
  readonly shrank: boolean;
}

/**
 * FRAMING IS COMPLETE INSIDE ONE CALL (spec D5). `readFileFrom` returns
 * `[cursor, size)` in one shot; a trailing partial line is not consumed and
 * the cursor advances only to the end of the last complete line. There is no
 * cross-call carry buffer anywhere in the mirror, so there is no splice class.
 *
 * `lastSize` is the size the LAST SUCCESSFUL READ reported for this
 * generation, straight off `lifecycle_generations.size`. It is the second half
 * of the shrink test and not decoration: `size < cursor` catches a truncation
 * below the cursor, and `size < lastSize` catches one ABOVE it — a file cut
 * from 4096 to 200 while the cursor sits at 100 is ordinary growth to a
 * cursor-only test, and ingesting its tail as if it were the same file is the
 * silent skip D6 forbids.
 */
export function frameRead(
  cursor: number, data: string, size: number, lastSize: number,
): FramedRead {
  if (size < cursor || size < lastSize) return { lines: [], nextCursor: 0, shrank: true };
  const lastLf = data.lastIndexOf('\n');
  if (lastLf < 0) return { lines: [], nextCursor: cursor, shrank: false };
  const complete = data.slice(0, lastLf + 1);
  return {
    lines: complete.split('\n').slice(0, -1).filter((l) => l !== ''),
    nextCursor: cursor + Buffer.byteLength(complete, 'utf8'),
    shrank: false,
  };
}
