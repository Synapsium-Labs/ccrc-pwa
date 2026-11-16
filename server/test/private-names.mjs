// The private-name matcher's local face (D-8181): the CLI and the scan, with their `fs` and `child_process` reads.
// The matcher itself (tokenizer, hasher, `PRIVATE_NAMES`, the exemptions) lives in `shared/private-names.mjs`, so
// `server/src` can import it; this file re-exports it, so `topology-clean.test.ts`, `private-names.test.ts`,
// `license.test.ts` and the sweep's local scan import what they always did. Read the matcher's header there.
//
// CLI (local, run from anywhere inside the clone):
//   node server/test/private-names.mjs hash --list <path>   the committed entries literal, `pub` rows only, and its digest
//   node server/test/private-names.mjs scan --list <path>   every hit of every row, tracked text files and paths
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANARY, MODES, entriesOf, entryOf, hitsIn, maskText, pairHits } from '../../shared/private-names.mjs';

export * from '../../shared/private-names.mjs';

// ─── the local CLI ──────────────────────────────────────────────────────────

/** The operator's local list: `mode \t token \t stand-in \t class \t visibility`,
 *  `#` comments. Read only by the CLI, never by a test. */
function readList(file) {
  const rows = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const [mode, token, , , visibility] = line.split('\t');
    if (!MODES.includes(/** @type {Mode} */ (mode))) throw new Error(`list row ${i + 1}: bad mode`);
    for (const entry of entriesOf(token, /** @type {Mode} */ (mode))) {
      rows.push({ row: i + 1, entry, visibility: (visibility ?? '').trim() });
    }
  });
  return rows;
}

/** The order and identity of a committed entry: all four fields. */
export const entryKey = (en) => `${en.h} ${en.f} ${en.n} ${en.mode}`;

/** The digest `PRIVATE_NAMES_DIGEST` records. @param {Entry[]} entries @returns {string} 32 lower-case hex */
export function entriesDigest(entries) {
  return createHash('sha256').update(entries.map(entryKey).join('\n')).digest('hex').slice(0, 32);
}

function cli(argv) {
  const [verb, ...rest] = argv;
  const at = rest.indexOf('--list');
  if (at < 0 || !rest[at + 1]) throw new Error('usage: private-names.mjs hash|scan --list <path>');
  const rows = readList(rest[at + 1]);
  if (verb === 'hash') {
    const pub = new Map();
    for (const r of rows) if (r.visibility === 'pub') pub.set(entryKey(r.entry), r.entry);
    const lit = (en) => `  { h: '${en.h}', f: '${en.f}', n: ${en.n}, mode: '${en.mode}' },`;
    const entries = [entryOf(CANARY, 'part'), ...[...pub.keys()].sort().map((key) => pub.get(key))];
    const out = entries.map(lit);
    out[0] = out[0].replace(/,$/, ', // CANARY');
    out.push(`export const PRIVATE_NAMES_DIGEST = '${entriesDigest(entries)}';`);
    process.stdout.write(`${out.join('\n')}\n`);
    return;
  }
  if (verb === 'scan') {
    const entries = rows.map((r) => r.entry);
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8').split('\0').filter(Boolean);
    const out = [];
    for (const file of files) {
      const shown = maskText(file, entries);
      for (const h of hitsIn(file, file, entries)) out.push(`${shown}:0 #${h} path`);
      let buf;
      try { buf = readFileSync(path.join(root, file)); } catch { continue; }
      if (buf.subarray(0, 8000).includes(0)) continue;
      const lines = buf.toString('utf8').split('\n');
      lines.forEach((line, i) => {
        for (const h of hitsIn(line, file, entries)) out.push(`${shown}:${i + 1} #${h}`);
        if (i + 1 < lines.length) for (const h of pairHits(line, lines[i + 1], file, entries)) out.push(`${shown}:${i + 1} #${h} split`);
      });
    }
    process.stdout.write(out.length ? `${out.join('\n')}\n` : '');
    return;
  }
  throw new Error(`unknown verb ${verb}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2));
}
