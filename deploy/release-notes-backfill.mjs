#!/usr/bin/env node
// release-notes-backfill.mjs — a ONE-OFF for the OPERATOR (D-5548): gives the
// releases cut before the notes step existed a body, each from its own tag
// range, exactly as release-notes.mjs writes one at release time.
//
//   node deploy/release-notes-backfill.mjs [--last N] [--dry-run] [--force] [--repo <dir>]
//
// Run it from a checkout with every tag fetched (`git fetch --tags origin`),
// --dry-run first. --dry-run is LOCAL: it reads git and prints each body; it
// never calls gh. The real run edits each release with
// `gh release edit <tag> --notes-file <file>` — newest first, one at a time —
// and leaves a release whose body is already non-empty alone unless --force,
// so a hand-written note is never overwritten by accident. A failed edit (a
// tag with no release, say) is reported and the rest still run; the exit is 1
// if any failed. The server's catalogue picks the new bodies up on its next
// poll (its upsert rewrites `notes`), so nothing else needs to move.
//
// Commit text and release bodies are DATA here: gh and git are called with
// an argv (execFileSync, never a shell), and a body travels in a file.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseNotesFor, releaseTags } from './release-notes.mjs';

const DEFAULT_LAST = 40;
const gh = 'gh';

function usage() {
  return `usage: node deploy/release-notes-backfill.mjs [--last N] [--dry-run] [--force] [--repo <dir>] — regenerate the notes of the newest N releases (default ${DEFAULT_LAST}) from their tag ranges; --dry-run prints them and calls nothing; the real run is \`gh release edit <tag> --notes-file\`, skipping a release that already has a body unless --force`;
}

/** Newest first, by the numbers. */
function byVersionDesc(a, b) {
  const x = a.slice(1).split('.').map(Number);
  const y = b.slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
}

function main(argv) {
  let last = DEFAULT_LAST;
  let dry = false;
  let force = false;
  let repo = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { process.stdout.write(`${usage()}\n`); return 0; }
    if (a === '--dry-run') { dry = true; continue; }
    if (a === '--force') { force = true; continue; }
    if (a === '--last' && i + 1 < argv.length) {
      const v = argv[i += 1];
      if (!/^[1-9]\d{0,3}$/.test(v)) { process.stderr.write(`release-notes-backfill: --last needs a count from 1 to 9999\n${usage()}\n`); return 2; }
      last = Number(v);
      continue;
    }
    if (a === '--repo' && i + 1 < argv.length) { repo = resolve(argv[i += 1]); continue; }
    process.stderr.write(`release-notes-backfill: unknown or incomplete argument: ${a}\n${usage()}\n`);
    return 2;
  }

  const tags = releaseTags(repo).sort(byVersionDesc).slice(0, last);
  if (dry) {
    for (const tag of tags) {
      const body = releaseNotesFor({ repo, tag });
      process.stdout.write(`== ${tag} (${Buffer.byteLength(body, 'utf8')} bytes)\n${body}\n`);
    }
    process.stdout.write(`dry run: ${tags.length} releases, nothing edited (the real run leaves a release that already has a body alone unless --force)\n`);
    return 0;
  }

  const dir = mkdtempSync(join(tmpdir(), 'ccrc-release-notes-'));
  let edited = 0;
  let kept = 0;
  let failed = 0;
  try {
    for (const tag of tags) {
      if (!force) {
        let body;
        try {
          body = execFileSync(gh, ['release', 'view', tag, '--json', 'body', '--jq', '.body'], { encoding: 'utf8' });
        } catch {
          process.stderr.write(`release-notes-backfill: ${tag}: gh release view failed — skipped\n`);
          failed += 1;
          continue;
        }
        if (body.trim() !== '') {
          process.stdout.write(`${tag}: has a body already — left alone (--force replaces it)\n`);
          kept += 1;
          continue;
        }
      }
      const file = join(dir, `${tag}.txt`);
      writeFileSync(file, releaseNotesFor({ repo, tag }));
      try {
        execFileSync(gh, ['release', 'edit', tag, '--notes-file', file], { stdio: ['ignore', 'ignore', 'pipe'] });
        process.stdout.write(`${tag}: notes written\n`);
        edited += 1;
      } catch {
        process.stderr.write(`release-notes-backfill: ${tag}: gh release edit failed\n`);
        failed += 1;
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write(`${edited} edited, ${kept} left alone, ${failed} failed\n`);
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
