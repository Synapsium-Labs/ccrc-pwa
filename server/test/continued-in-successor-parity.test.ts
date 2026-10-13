// TWO AUTHORITIES, ONE ANSWER ABOUT WHERE A SUCCESSOR MAY LIVE (D-4949).
//
// A `continued-in` marker names a successor UUID, not a path, so each reader
// has to decide where to look for it. `ccd` (`_follow_continued_in` ->
// `_ci_transcript_path`) looks only under the session's OWN config dir, at
// its own workdir's project dir. The server's walk (`resolveTranscript`) used
// to look everywhere the ladder looks — the uuid glob over every project dir,
// then every other account's config dir — so a marker naming a uuid that
// lived anywhere else was followed by the server and never by `ccd`: the
// stream showed one transcript, the registry kept another, and `ccrc
// doctor`'s `transcripts` check WARNed about the session for ever with a
// remedy that could not fix it (#189 review, F4, reproduced with
// `foreign-glob`). The server now looks only beside the predecessor.
//
// This file drives BOTH readers over the SAME fixture HOME and asserts they
// land on the same uuid — `ccd` through its real `_sync_uuid` ticks, the
// server through `resolveTranscript` with the other account offered as rung
// 6's input, which is the widest search the live stream ever asks for.
//
// HONEST LIMIT, stated rather than pinned: `ccd` also accepts the successor
// under the OTHER spelling of a symlinked workdir, and the server's sibling
// rule does not. No fixture here plants that shape, because the two would
// disagree on it — by design, transiently: the server names the successor it
// declined (`declinedTo`), keeps looking, and treats `ccd`'s registry move
// onto it as a continuation (`registryCaughtUp`), so the stream converges on
// the authority's answer without a false reset.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { localIO } from '../src/io.js';
import { resolveTranscript } from '../src/transcript/resolve.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ci-successor-parity'); });
afterEach(() => { h.cleanup(); });

const A = 'a'.repeat(36), B = 'b'.repeat(36);
const W = 'claude';               // a home-able wrapper from the fixture roster
const ID = 'demo-still-pond';
const WORKDIR = '/w';

const marker = (from: string, to: string): string =>
  `${JSON.stringify({ type: 'continued-in', sessionId: from, continuedInSessionId: to })}\n`;
const turnLine = (text: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

/** The session's own config dir, asked of ccd rather than re-derived here. */
const ownCfg = (): string => h.sh(`_cfg_dir ${W}`);

/** The project dir Claude Code writes under for `WORKDIR`, asked of ccd —
 *  `_munge_wd` is the one spelling of that rule on its side. */
const projectDir = (cfg: string): string =>
  path.join(cfg, 'projects', h.sh(`_munge_wd "$(_ws_realpath "${WORKDIR}")"`));

/** Plant a transcript, aged, so ccd's quiescence gate reads it on the second
 *  tick without the test sleeping. */
function plant(dir: string, uuid: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${uuid}.jsonl`);
  writeFileSync(f, body, 'utf8');
  const old = Date.now() / 1000 - 600;
  utimesSync(f, old, old);
  return f;
}

/** Both authorities' answers over the same disk. ccd's ticks run in ONE shell
 *  process, as `ccd supervise` does — its quiescence memo lives in shell
 *  variables. Three ticks: the first records the stamp, the second reads and
 *  hops, the third would read the successor (and finds nothing more). */
async function answers(otherCfg: string): Promise<{ ccd: string | null; server: string; declinedTo?: string }> {
  h.sh(`_reg_set ${ID} wrapper ${W}; _reg_set ${ID} workdir ${WORKDIR}; _reg_set ${ID} uuid ${A}`);
  h.sh(Array.from({ length: 3 }, () => `_sync_uuid ${ID}`).join('; '));
  const r = await resolveTranscript(localIO, {
    configDir: ownCfg(), dir: WORKDIR, registryWorkdir: WORKDIR, uuid: A,
    foreign: [{ account: 'lane-b', configDir: otherCfg }],
  });
  if (r.kind !== 'found') throw new Error(`the server found no transcript at all: ${JSON.stringify(r)}`);
  return { ccd: h.reg(ID, 'uuid'), server: r.uuid, ...(r.declinedTo === undefined ? {} : { declinedTo: r.declinedTo }) };
}

describe('continued-in successor: ccd and the server agree on where it may live (D-4949)', () => {
  it('a successor BESIDE its predecessor is followed by both', async () => {
    const own = projectDir(ownCfg());
    plant(own, A, turnLine('one') + marker(A, B));
    plant(own, B, turnLine('two'));
    const got = await answers(path.join(h.home, '.claude-lane-b'));
    expect(got).toEqual({ ccd: B, server: B });
  });

  it('a successor only in ANOTHER project dir of the same account is followed by neither', async () => {
    const cfg = ownCfg();
    plant(projectDir(cfg), A, turnLine('one') + marker(A, B));
    plant(path.join(cfg, 'projects', '-another-project'), B, turnLine('not this session'));
    const got = await answers(path.join(h.home, '.claude-lane-b'));
    expect(got).toEqual({ ccd: A, server: A, declinedTo: B });
  });

  it('a successor only under ANOTHER ACCOUNT is followed by neither — not even at the same project dir', async () => {
    plant(projectDir(ownCfg()), A, turnLine('one') + marker(A, B));
    const other = path.join(h.home, '.claude-lane-b');
    plant(projectDir(other), B, turnLine('another account, same project'));
    plant(path.join(other, 'projects', '-another-project'), B, turnLine('another account, another project'));
    const got = await answers(other);
    expect(got).toEqual({ ccd: A, server: A, declinedTo: B });
  });
});
