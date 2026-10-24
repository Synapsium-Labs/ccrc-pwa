// Path identity W2 (path-identity spec 2026-10-12 §2.9's carried residuals, and the W1a carry of the learning audit):
// the collector's learning audit asks the temp-root id predicate itself, and six comments say what W1a, W1b and W2 built.
// - `learnCollect` composed `ws-audit --collect` for any id it was handed and relied on the lane's population gate
//   alone (`collector-learning-audit-relies-on-the-population-gate`), while the act asks `isTmpRootId` at its step 1.
//   W2 widened that population (an id a compare-and-drop aside is for), so the learning audit asks the predicate first
//   and answers a DISTINCT arm, `id-refused`, never `not-asked`: `watch.ts` clears every pair on a `not-asked`.
// - `isRegistryId`'s leading-dash bullet and `collect-l0.test.ts`'s comment speak of a ccd older than W1b
//   (`comments-say-ccd-scans-the-session-value`); `childReclaimLeafKept`'s docstring calls ccd's predicate dot-and-dash
//   (`server-docstrings-call-ccds-predicate-dot-only`); the store's docstring above the `reclaim:` reader says what
//   `POST /api/runs` checks since W1a (`session-shape-prose-predates-the-id-gate`).
// - `collect-id-pins.test.ts`'s header and `id-argv-census.test.ts`'s `collector-population` docstring no longer call
//   the population gate the learning audit's only id check (`learning-audit-gate-prose-in-two-test-comments`, R42).
// FIXTURE HOME ONLY: the executor's rig (`collectTempRootFixture.ts`) runs a scripted ccd behind the agent's real exec
// whitelist, under `mkTmp`, and records every argv at `runCcd`. Nothing reaches a box.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTmpRootId } from '../../shared/api.js';
import { ACTOR_FLAGS_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { collectTempRoot, learnCollect } from '../src/coord/collectTempRoot.js';
import { auditDoc, rig } from './collectTempRootFixture.js';
import { EDGE_ACCEPTED_IDS, REFUSED_IDS } from './registryIdCases.js';
import { sourceOfSymbol } from './scan/symbols.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
/** Comment text as prose: each line's comment leader dropped, then whitespace flattened, so a phrase is matched across a
 *  wrap. */
const prose = (s: string): string => s.replace(/^[ \t]*(?:\/\*\*|\/\/|\*\/|\*)[ \t]?/gm, '').replace(/\s+/g, ' ');
/** W1b's conditional residual's regex (`path-identity-w1b-prose.test.ts`'s `dotOnly`), copied, never imported. */
const DOT_ONLY = /`_ws_tmproot_id_ok`[\s\S]{0,80}?no leading[\s*]*`\.`(?![\s*]*(?:or|and)[\s*]+(?:a[\s*]+)?(?:leading[\s*]+)?`-`)/;
/** The docstring directly above `head` in `file`: from the nearest `/**` before it to it; '' when either is missing. */
const docAbove = (file: string, head: string): string => {
  const s = read(file);
  const end = s.indexOf(`\n${head}`);
  const start = end < 0 ? -1 : s.lastIndexOf('/**', end);
  return start < 0 ? '' : s.slice(start, end);
};
/** The `//` lines directly above `collect-l0.test.ts`'s dash-leading rows (above their `it.each(`); '' when not found. */
const l0Comment = (): string => {
  const lines = read('server/test/collect-l0.test.ts').split('\n');
  const title = lines.findIndex((l) => l.includes("'a dash-leading id %j is refused"));
  if (title < 2) return '';
  const out: string[] = [];
  for (let i = title - 2; i >= 0 && /^\s*\/\//.test(lines[i]); i -= 1) out.unshift(lines[i]);
  return out.join('\n');
};

/** An id the predicate accepts, other than the fixture's own. */
const REEF = 'demo-quiet-reef';
/** Every id the predicate refuses that a case can hand the audit: the shared list, plus `-x`, `..` and 256 characters. */
const REFUSED: readonly string[] = [...new Set(['.hidden', '-x', '..', 'x'.repeat(256), ...REFUSED_IDS])];
const label = (id: string): string => (id.length > 40 ? `${id.length} characters` : JSON.stringify(id));

describe('learnCollect asks the temp-root id predicate before any argv (collector-learning-audit-relies-on-the-population-gate)', () => {
  it.each(REFUSED.map((id) => [label(id), id] as const))('%s: id-refused, and nothing is composed', async (_what, id) => {
    expect(isTmpRootId(id), 'CONTROL: the predicate refuses this id').toBe(false);
    const r = rig();
    expect(await learnCollect(r.deps, id)).toEqual({ kind: 'id-refused' });
    expect(r.attempts, 'no argv was composed').toEqual([]);
  });

  it.each(REFUSED.map((id) => [label(id), id] as const))("the act's step 1 refuses the same id, its twin: %s", async (_what, id) => {
    const r = rig();
    expect(await collectTempRoot(r.deps, r.job(id))).toMatchObject({ kind: 'not-asked', step: 1, why: 'id-refused' });
    expect(r.attempts).toEqual([]);
  });

  it.each(EDGE_ACCEPTED_IDS.map((id) => [label(id), id] as const))('%s: an id the predicate accepts is still asked, one argv', async (_what, id) => {
    expect(isTmpRootId(id), 'CONTROL: the predicate accepts this id').toBe(true);
    const r = rig();
    expect((await learnCollect(r.deps, id)).kind).toBe('answered');
    expect(r.attempts).toEqual([['ws-audit', '--session', id, '--collect']]);
  });

  it('an ordinary id on a box that advertises the capability is answered: exactly one argv, the audit’s', async () => {
    const r = rig();
    r.answerAudit(() => ({ ran: true, code: 0, stdout: auditDoc({ id: REEF, witness: r.witness }), stderr: '' }));
    expect(await learnCollect(r.deps, REEF)).toMatchObject({ kind: 'answered', audit: { value: { kind: 'collectable' } } });
    expect(r.attempts).toEqual([['ws-audit', '--session', REEF, '--collect']]);
  });

  it.each<[string, readonly string[] | null]>([
    ['no collect-v1', ['ws-audit', 'ws-collect', RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP]],
    ['no caps list at all', null],
  ])('%s, with an id the predicate accepts: not-asked caps, unchanged, and nothing is composed', async (_what, caps) => {
    const r = rig({ caps });
    expect(await learnCollect(r.deps, REEF)).toEqual({ kind: 'not-asked', why: 'caps' });
    expect(r.attempts).toEqual([]);
  });
});

describe('the comments say what W1a and W1b built (the R36 carries)', () => {
  it('CONTROL: DOT_ONLY sees a dot-only clause and not a dot-and-dash one', () => {
    expect(DOT_ONLY.test("ccd's `_ws_tmproot_id_ok`, a session id's shape and no leading `.`. Without")).toBe(true);
    expect(DOT_ONLY.test("ccd's `_ws_tmproot_id_ok`, a session id's shape with no leading `.` or `-`. Without")).toBe(false);
  });

  it("neither shared/api.ts nor childReclaimSweep.ts calls ccd's predicate dot-only (server-docstrings-call-ccds-predicate-dot-only)", () => {
    expect(DOT_ONLY.test(read('shared/api.ts')), 'shared/api.ts').toBe(false);
    expect(DOT_ONLY.test(read('server/src/childReclaimSweep.ts')), 'server/src/childReclaimSweep.ts').toBe(false);
  });

  it("childReclaimLeafKept's docstring names both clauses of ccd's predicate", () => {
    const doc = prose(docAbove('server/src/childReclaimSweep.ts', 'export function childReclaimLeafKept('));
    expect(doc.length, 'the docstring could not be sliced').toBeGreaterThan(200);
    expect(doc).toContain("ccd's `_ws_tmproot_id_ok`, a session id's shape with no leading `.` or `-`");
  });

  it("isRegistryId's leading-dash bullet speaks of a ccd older than W1b (comments-say-ccd-scans-the-session-value)", () => {
    const doc = prose(docAbove('shared/api.ts', 'export function isRegistryId('));
    expect(doc.length, 'the docstring could not be sliced').toBeGreaterThan(200);
    expect(doc).toContain('older than path-identity W1b');
    expect(doc).toContain("the server's half of the same refusal");
    expect(doc).not.toContain("ccd's verbs read their decision flags from any");
  });

  it("collect-l0.test.ts's comment above the dash-leading rows speaks of a ccd older than W1b", () => {
    const c = prose(l0Comment());
    expect(c.length, 'the comment could not be found').toBeGreaterThan(40);
    expect(c).toContain('older than path-identity W1b');
    expect(c).not.toContain("ccd's destructive verbs read their decision flags from any position");
  });

  it("the store's docstring above the reclaim: reader says what POST /api/runs checks since W1a (session-shape-prose-predates-the-id-gate)", () => {
    const doc = prose(docAbove('server/src/coord/store.ts', 'function childReclaimDisplacedCandidates('));
    expect(doc.length, 'the docstring could not be sliced').toBeGreaterThan(200);
    expect(doc).toContain('Before path-identity W1a, `POST /api/runs` checked a claimant only with');
    expect(doc).toContain('it now refuses one `isRegistryId`');
    expect(doc).not.toContain('`POST /api/runs` checks it only with');
  });

  it("two test comments say the learning audit asks the predicate itself (learning-audit-gate-prose-in-two-test-comments)", () => {
    const pins = read('server/test/collect-id-pins.test.ts');
    const census = read('server/test/id-argv-census.test.ts');
    const header = pins.indexOf('\nimport ') < 0 ? '' : pins.slice(0, pins.indexOf('\nimport '));
    expect(pins, 'collect-id-pins.test.ts').not.toContain('asks no predicate of its own');
    expect(prose(header), 'collect-id-pins.test.ts').toContain('since path-identity W2 asks the predicate itself too');
    expect(census, 'id-argv-census.test.ts').not.toContain("the learning audit's only id check");
    expect(census, 'id-argv-census.test.ts').toContain("with the record half below, the gate before the learning audit's own. */");
  });

  it("watch.ts's collectLearn returns on id-refused before its not-asked arm clears every pair (P2)", () => {
    const body = sourceOfSymbol('server/src/watch.ts', 'FleetWatcher.collectLearn');
    expect(body.length, 'collectLearn could not be sliced').toBeGreaterThan(200);
    const notAsked = body.indexOf("if (answer.kind === 'not-asked') { this.collectClearPairs(); return; }");
    const refused = body.indexOf("if (answer.kind === 'id-refused') return;");
    expect(notAsked, 'the not-asked arm stands').toBeGreaterThan(-1);
    expect(refused, 'the id-refused arm stands').toBeGreaterThan(-1);
    expect(refused, 'the id-refused arm comes first').toBeLessThan(notAsked);
  });
});
