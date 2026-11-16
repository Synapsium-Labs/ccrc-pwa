// D-8090 (ruling D-6908's companion; plan docs/superpowers/plans/2026-11-06-claim-doubt.md): the count of old `dead`
// reads. `status === 'dead'` means only that tmux did not call the pane live, so a tmux failure, a sleeper and a restart
// all read dead; a question of whether a session is there reads `presence` (`rowStanding`, `sessionReading.ts`) instead.
// The reads left in the server tree and in `shared` were judged site by site and accepted. Each is named below, and a
// new one is red until somebody names it.
//
// THE ESCAPE ROUTE. This test can only go red on a change to a compared `status` word, in code. It asks no ledger, no
// `origin/main`, no switch and no operator: the remedy is one edit in this file, in the same PR. Add or move a row
// (a refactor moving a read to another file changes that row's `file`) or delete one (a read that left). Comments do not
// count, and nor does any other edit to a listed file. `deadReadDrift`'s own rows below hold that.
//
// WHAT IT DOES NOT SEE. It compares a number per file, and `site` is prose no test checks against the code. So removing
// one accepted read and adding a different one in the same file stays green: the count stops a file's reads growing, and
// a reviewer stops a swap.
//
// The PWA is out of scope here: its one such compare is `paneGone`, held by `hibernate-census.test.ts`, which also
// keeps a stance per file for everything this count names.
import { describe, expect, it } from 'vitest';
import { censusFiles, stripForCensus, type CensusFile } from '../hibernateCensusScan.js';

const ROOTS = ['server/src/', 'shared/'] as const;
const OLD_DEAD_READ = /\bstatus\s*[!=]==\s*'dead'|'dead'\s*[!=]==\s*[\w.?]*\bstatus\b/g;

interface Accepted { readonly file: string; readonly site: string; readonly why: string }

const ACCEPTED: readonly Accepted[] = [
  { file: 'server/src/watch.ts', site: 'the tick\'s push copy, `projects`',
    why: 'wording only: it asks which projects have a running pane, which is what `status` says' },
  { file: 'server/src/watch.ts', site: 'noteSessions, `alive`',
    why: 'the delegation breaker\'s memory of running panes; its comment counts a restart and doubt as dead on purpose. It also lets adoption forget a retraction the step has read; adoption\'s own liveness and last-alive memory read `adoptionAlive` (`presence`), D-8092' },
  { file: 'server/src/watch.ts', site: 'noteSessions, the death loop',
    why: 'the same memory; it consults `hibernatedAt` itself, so a sleep never feeds the breaker. A death it counts calls `forgetAdoptEvidence`, which forgets a retraction only once the step has read it (D-8092)' },
  { file: 'server/src/watch.ts', site: 'ownersOf',
    why: 'the owner census skips a row with no running pane; accepted by the ruling as it stands, not re-traced here' },
  { file: 'server/src/coord/hibernate.ts', site: 'hibernateSleepInput, `paneDead`',
    why: 'the sleep verdict holds a row whose pane is not running; holding on doubt is the safe direction' },
  { file: 'server/src/fleet.ts', site: 'the frame row\'s `turn` fact',
    why: 'the assembly feeding `readSession`: it is where `status` becomes `presence`, not a reader of it' },
  { file: 'shared/api.ts', site: 'sessionBucket, the archived arm',
    why: 'D-74\'s conjunct: a display bucket, and a live pane is what outranks the archive marker' },
  { file: 'shared/api.ts', site: 'sessionBucket, the dead arm',
    why: 'a display bucket; `presence` and the PWA\'s words tell a sleeper from a death on top of it' },
  { file: 'shared/api.ts', site: 'inArchivedFold',
    why: 'a display fold that consults `hibernatedAt` itself' },
];

/** The reads in each file: code only, under `ROOTS`. */
function scanOldDeadReads(files: readonly CensusFile[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of files) {
    if (!ROOTS.some((r) => f.rel.startsWith(r))) continue;
    const n = (stripForCensus(f.text).match(OLD_DEAD_READ) ?? []).length;
    if (n > 0) out.set(f.rel, n);
  }
  return out;
}

/** Every file whose reads differ from its accepted rows, with the remedy. Empty is green. */
function deadReadDrift(scan: ReadonlyMap<string, number>, accepted: readonly Accepted[]): string[] {
  const named = new Map<string, number>();
  for (const a of accepted) named.set(a.file, (named.get(a.file) ?? 0) + 1);
  const out: string[] = [];
  for (const file of [...new Set([...scan.keys(), ...named.keys()])].sort()) {
    const has = scan.get(file) ?? 0;
    const rows = named.get(file) ?? 0;
    if (has > rows) out.push(`${file}: ${has} old dead reads, ${rows} accepted. Read \`presence\` through \`rowStanding\`, or add a row to ACCEPTED saying why \`status\` is the right question there`);
    if (has < rows) out.push(`${file}: ${has} old dead reads, ${rows} accepted. A read left or moved: delete its row, or change its \`file\``);
  }
  return out;
}

const file = (rel: string, text: string): CensusFile => ({ rel, text });
const row = (f: string): Accepted => ({ file: f, site: 'a site', why: 'a reason' });

describe('the old dead reads are counted, and each one is named (D-8090)', () => {
  it('the server tree and shared hold exactly the accepted reads', () => {
    expect(deadReadDrift(scanOldDeadReads(censusFiles()), ACCEPTED)).toEqual([]);
  });

  it('every accepted read says where and why', () => {
    for (const a of ACCEPTED) {
      expect(a.site.length, a.file).toBeGreaterThan(0);
      expect(a.why.length, a.site).toBeGreaterThan(0);
    }
    expect(new Set(ACCEPTED.map((a) => `${a.file} ${a.site}`)).size).toBe(ACCEPTED.length);
  });

  // Names only, so a rename of the code cannot red it. What the two readers answer is held on real frame rows, in
  // `session-ladders-characterization.test.ts`.
  it('neither moved reader is accepted: no row names claimProbe or the delegation frame (D-6908)', () => {
    expect(scanOldDeadReads(censusFiles()).get('server/src/coord/delegation-projection.ts')).toBeUndefined();
    expect(ACCEPTED.filter((a) => a.file.endsWith('delegation-projection.ts') || /claimProbe|livenessOf/.test(a.site))).toEqual([]);
  });
});

describe('the count stops new reads and blocks nothing else (the escape route, D-8090)', () => {
  const OLD = "if (s.status === 'dead') return 1;";

  it('a new read is red, in a listed file, in a new file, in shared, and in the reversed spelling', () => {
    for (const [rel, text] of [['server/src/a.ts', `${OLD}\n${OLD}`], ['server/src/new.ts', OLD], ['shared/x.mjs', OLD],
      ['server/src/a.ts', `${OLD}\nif ('dead' !== s.status) return 2;`]] as const) {
      const got = deadReadDrift(scanOldDeadReads([file(rel, text)]), [row('server/src/a.ts')]);
      expect(got.join('\n')).toContain(rel);
    }
  });

  it('ESCAPE: the same read with a row is green, so one edit in this file clears it', () => {
    const scan = scanOldDeadReads([file('server/src/new.ts', OLD)]);
    expect(deadReadDrift(scan, [])).toHaveLength(1);
    expect(deadReadDrift(scan, [row('server/src/new.ts')])).toEqual([]);
  });

  it('ESCAPE: a read moved by a refactor is cleared by changing its row\'s file', () => {
    const scan = scanOldDeadReads([file('server/src/lane.ts', OLD)]);
    expect(deadReadDrift(scan, [row('server/src/watch.ts')])).toHaveLength(2);
    expect(deadReadDrift(scan, [row('server/src/lane.ts')])).toEqual([]);
  });

  it('a read removed is cleared by deleting its row, and the message says so', () => {
    expect(deadReadDrift(new Map(), [row('server/src/a.ts')]).join()).toContain('delete its row');
    expect(deadReadDrift(new Map(), [])).toEqual([]);
  });

  it('unrelated work never reds it: comments, other words and other trees are not reads', () => {
    const scan = scanOldDeadReads([
      file('server/src/a.ts', `${OLD}\n// s.status === 'dead'\n/* s.status !== 'dead' */\nconst more = 1;`),
      file('server/src/b.ts', "if (v.state === 'dead' || s.presence === 'dead' || s.bucket === 'dead') return;"),
      file('pwa/src/c.ts', OLD),
    ]);
    expect(deadReadDrift(scan, [row('server/src/a.ts')])).toEqual([]);
  });
});
