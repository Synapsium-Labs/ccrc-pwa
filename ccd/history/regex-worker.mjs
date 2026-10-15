// ccd/history/regex-worker.mjs — the `grep --regex` child (spec 2026-10-05 §8.4, §9.1; W1-B2 Task 14).
//
// The parent (recall.mjs runRegex) admits a pattern through lib's guardRegex, spawns this file with
// `node --no-warnings`, writes one JSON job to its stdin, and kills it at a wall-clock budget (REGEX_BUDGET_MS,
// 5 s chosen). A kill is the parent's exit 2 `regex-timeout`, never "no match". This child:
//  - opens the store through store.mjs's read-only handle (readOnly + query_only) and writes nothing;
//  - steps the in-scope candidate blobs in blob_id order through ONE iterate() of one statement. SQLite steps that
//    cursor lazily, row by row: the spec's "paged iterate()" (§8.4). It never re-runs the statement per page of blobs:
//    a `blob_id > :after … LIMIT` window re-materialises the whole candidate union every page, which is quadratic
//    (measured: 5.3 s of SQL alone for 20,000 in-scope entries, against 181 ms for one iteration). The ordered
//    statement names blob ids only, so its sorter never carries a compressed body; a second statement reads each
//    body by its key;
//  - HOLDS both statements until it exits (§9.1, CT9: Node 22.15.1 finalises an unreferenced statement mid-iterate
//    when the GC runs, M; the floor is 22.16.0, and the hold costs nothing);
//  - matches the pattern against the text plain grep indexes, redacted with the parent's pair index and belt (the
//    job's `belt`, the parent's loaded units, §8.3 layer 4; never printed or logged). A secret known to the store is
//    therefore never a regex hit (§6.2, DM31), and no grep form reaches past the index window: lib's entryIndexText
//    over blobPlainText's text, exactly as B1's indexBlob builds an index text (B1's history-entry-index-text-windowed).
//    For a body, that is its first ENTRY_FTS_BYTES (1 MiB) after redactForIndex; for a sidecar, its first
//    SIDECAR_FTS_BYTES (512 KiB, DM29), redacted inside blobPlainText before that cut (B1's sidecarIndexText)
//    (spec §8.4, rev 3.5). A sidecar whose raw_len passes SIDECAR_WHOLE_MAX is not decompressed,
//    so it is not scanned (D-4713 (history-read-skips-oversize-sidecar)), nor is a body past BLOB_DECODE_MAX (B1's
//    history-permanent-failures-classified);
//  - prints one JSON line per matching blob, {blob_id, match}, then {done, scanned, matched}.
// It reads no environment variable and trusts only its job. Every column it names exists at schema v1, and
// migrations are additive (§6.11), so it needs no version-aware select.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { entryIndexText, makeBelt, makePairIndex } from './lib.mjs';
import { blobPlainText, openReader } from './store.mjs';

/** Every statement this child iterates, or reads through while it iterates, referenced until it exits (CT9). */
const HELD = [];
/** A match is reported cut to this many characters: it only seeds the parent's snippet window. */
const MATCH_MAX = 200;
/** One candidate's compressed body and its recorded size (blobPlainText's decode bound and caps), by its key. */
const BODY_SQL = 'SELECT z, raw_len FROM blobs WHERE blob_id = ?';

/** The in-scope candidate blobs in blob_id order, ids only, each with a stored body (z not pruned): those an in-scope
 *  entry of a listed provenance references (its first body or a variant), and those an in-scope sidecar holds when
 *  `tool` is listed. A prefilter is lib's regexPrefilter: the exact-token MATCH text of a whole-word literal the
 *  pattern must contain (never a prefix query); it narrows the candidates without changing the answer. */
function candidateSql(withPrefilter) {
  return `WITH cand(blob_id) AS (
      SELECT e.blob_id FROM entries e
        WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND e.provenance IN (SELECT value FROM json_each(:provs))
      UNION
      SELECT v.blob_id FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
        WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND e.provenance IN (SELECT value FROM json_each(:provs))
      UNION
      SELECT s.blob_id FROM sidecars s
        WHERE s.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND 'tool' IN (SELECT value FROM json_each(:provs)))
    SELECT c.blob_id AS blob_id, EXISTS (SELECT 1 FROM sidecars s2 WHERE s2.blob_id = c.blob_id) AS is_sidecar
      FROM cand c JOIN blobs b ON b.blob_id = c.blob_id
      WHERE b.z IS NOT NULL${withPrefilter ? '\n        AND c.blob_id IN (SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH :pre)' : ''}
      ORDER BY c.blob_id`;
}

/** Scan one job: every candidate blob, in one lazily stepped iterate(), redacted, then matched. The iterate()'s read
 *  transaction also covers each body read, so a body the candidate row saw stored is still stored; the null check is
 *  belt only. */
export function scanRegexJob(job) {
  const re = new RegExp(job.pattern);
  const idx = makePairIndex(job.pairs, makeBelt(job.belt ?? []));
  const db = openReader(job.dbPath);
  try {
    const stmt = db.prepare(candidateSql(job.prefilter !== null));
    const bodyOf = db.prepare(BODY_SQL);
    HELD.push(stmt, bodyOf);
    const base = {
      tpks: JSON.stringify(job.transcriptPks), provs: JSON.stringify(job.provenance),
      ...(job.prefilter === null ? {} : { pre: job.prefilter }),
    };
    const matches = [];
    let scanned = 0;
    for (const row of stmt.iterate(base)) {
      scanned += 1;
      const body = bodyOf.get(row.blob_id);
      const z = body?.z;
      if (z === undefined || z === null) continue;
      const m = re.exec(entryIndexText(blobPlainText(z, row.is_sidecar === 1, idx, Number(body.raw_len)), idx));
      if (m !== null) matches.push({ blob_id: row.blob_id, match: m[0].slice(0, MATCH_MAX) });
    }
    return { matches, scanned };
  } finally {
    db.close();
  }
}

function main() {
  let job;
  // A malformed job is named in fixed words: V8's JSON error quotes its input, which carries the belt's units.
  try { job = JSON.parse(readFileSync(0, 'utf8')); } catch { throw new Error('the job on stdin is not JSON'); }
  const { matches, scanned } = scanRegexJob(job);
  const out = matches.map((m) => JSON.stringify(m));
  out.push(JSON.stringify({ done: true, scanned, matched: matches.length }));
  process.stdout.write(`${out.join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`history-regex: ${e && e.message ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
