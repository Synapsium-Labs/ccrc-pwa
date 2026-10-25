// `ws-reclaim --stale` — the stale arm of child reclaim (fleet disk retention DR-26, D-6638; spec §2.7.3).
// A kept child (held, or a keep the server alone owned) is reclaimed after seven idle days, and the box's half of
// "idle" is measured here: the newest of the transcript, `.lastend`, `.spawn`, `.woke`, `.supervised` and a live
// pane's activity. Every case builds the real child in a fixture HOME (`makeChild`) with the unit and pane calls
// RECORDED, never made; what is asserted is the ladder's answer and what is left on disk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { createHash } from 'node:crypto';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, plantTmux, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
let c: Child;
beforeEach(() => { h = makePrHarness('ccrc-reclaim-stale-'); c = makeChild(h); });
afterEach(() => { h.cleanup(); });

const reg = (f: string): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.${f}`);
const DAY = 86400;
const now = (): number => Math.floor(Date.now() / 1000);
const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const age = (p: string, days: number): void => { const t = now() - days * DAY; fs.utimesSync(p, t, t); };
/** The child's transcript for its CURRENT uuid, at the address ccd's own `_transcript_path` answers. */
const transcript = (days: number, uuidOverride?: string): string => {
  let p = h.sh(`${CHILD_STUBS} _transcript_path ${CHILD_ID}`).trim();
  if (uuidOverride) p = path.join(path.dirname(p), `${uuidOverride}.jsonl`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{}\n');
  age(p, days);
  return p;
};
const hold = (text: string): string => { fs.writeFileSync(reg('hold'), text); return sha(text); };
/** `--stale <word>` as the ladder reads it (the verb and the audit set the same two names). */
const stale = (word: string, digest = ''): string => `_WS_STALE_WORD=${word}; _WS_STALE_DIGEST=${digest};`;
/** tmux answers `display-message` (the pane's activity) from $HOME/tmux-activity; the model answers the rest. */
const WITH_ACTIVITY = 'eval "$(declare -f tmux | sed \'1s/^tmux/_tmux_model/\')";'
  + ' tmux() { if [[ "$1" == display-message ]]; then cat "$HOME/tmux-activity" 2>/dev/null; else _tmux_model "$@"; fi; };';
const flags = (word: string, digest = ''): string => `--stale ${word}${digest ? ` --hold-digest ${digest}` : ''}`;
const auditOf = (f: string): { verdict: string; token: string } =>
  JSON.parse(h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim ${f}`)) as { verdict: string; token: string };

describe('characterization (green on the code before DR-26)', () => {
  it('a held child refuses `held` and the hold is left standing', () => {
    fs.writeFileSync(reg('hold'), 'waiting on a design call\n');
    const a = evalOf(h);
    expect(a.verdict).toBe('held');
    expect(a.detail).toContain('waiting on a design call');
    expect(fs.existsSync(reg('hold'))).toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).not.toBe('');
  });
});

describe('--stale held', () => {
  it('passes a hold whose content hashes to the digest, idle eight days: a token, then the normal pin and tail', () => {
    const digest = hold('waiting on a design call\n');
    transcript(8);
    const a = evalOf(h, { pre: stale('held', digest) });
    expect(a.verdict, a.detail).toBe('reclaimable');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    const r = childReclaimVerb(h, a.token, { extra: flags('held', digest) });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree is gone').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch is gone').toBe('');
    const attic = h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`);
    expect(attic.split('\n').filter(Boolean).length, 'the pin kept the work').toBeGreaterThan(0);
  }, 90_000);

  it('a changed hold refuses `held`', () => {
    const digest = hold('first reason\n');
    transcript(8);
    hold('a different reason\n');
    const a = evalOf(h, { pre: stale('held', digest) });
    expect(a.verdict).toBe('held');
    expect(a.token).toBe('');
  });

  it('a hold that cannot be read as a file refuses `held`', () => {
    fs.mkdirSync(reg('hold'));
    transcript(8);
    expect(evalOf(h, { pre: stale('held', sha('')) }).verdict).toBe('held');
  });

  it('the token changes when the hold changes', () => {
    transcript(8);
    const d1 = hold('reason one\n');
    const t1 = evalOf(h, { pre: stale('held', d1) }).token;
    const d2 = hold('reason two\n');
    const t2 = evalOf(h, { pre: stale('held', d2) }).token;
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t2).toMatch(/^[0-9a-f]{64}$/);
    expect(t2).not.toBe(t1);
  });

  it('a token minted over the old hold is refused once the hold changes under it', () => {
    transcript(8);
    const d1 = hold('reason one\n');
    const t1 = evalOf(h, { pre: stale('held', d1) }).token;
    hold('reason two\n');
    const r = childReclaimVerb(h, t1, { extra: flags('held', d1) });
    expect(JSON.parse(r.stdout).refused).toBe('held');
    expect(fs.existsSync(c.wt)).toBe(true);
  });

  it('a hold under any other stale word still refuses `held`', () => {
    hold('waiting\n');
    transcript(8);
    for (const w of ['run-absent', 'review', 'terminal']) expect(evalOf(h, { pre: stale(w) }).verdict, w).toBe('held');
    const digest = sha('waiting\n');
    for (const w of ['run-absent', 'review', 'terminal']) {
      expect(evalOf(h, { pre: stale(w, digest) }).verdict, `${w} with a matching digest in hand`).toBe('held');
    }
  });
});

describe('the idle rung', () => {
  it('a transcript touched yesterday refuses `not-idle`', () => {
    const digest = hold('x\n');
    transcript(1);
    const a = evalOf(h, { pre: stale('held', digest) });
    expect(a.verdict).toBe('not-idle');
    expect(a.token).toBe('');
  });

  it('a live pane active two days ago refuses `not-idle`, however old the transcript', () => {
    transcript(9);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    fs.writeFileSync(path.join(h.home, 'tmux-activity'), `${now() - 2 * DAY}\n`);
    expect(evalOf(h, { pre: `${WITH_ACTIVITY} ${stale('terminal')}` }).verdict).toBe('not-idle');
  });

  it('a live pane quiet for nine days passes with the transcript', () => {
    transcript(9);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    fs.writeFileSync(path.join(h.home, 'tmux-activity'), `${now() - 9 * DAY}\n`);
    expect(evalOf(h, { pre: `${WITH_ACTIVITY} ${stale('terminal')}` }).verdict).toBe('reclaimable');
  });

  it('a live pane that will not say when it was active is unmeasured, never idle', () => {
    transcript(9);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    expect(evalOf(h, { pre: `${WITH_ACTIVITY} ${stale('terminal')}` }).verdict).toBe('unmeasured');
  });

  it('each box record counts: a fresh `.lastend`, `.spawn`, `.woke` or `.supervised` refuses `not-idle`', () => {
    transcript(9);
    for (const f of ['lastend', 'spawn', 'woke', 'supervised']) {
      fs.writeFileSync(reg(f), '1 test\n');
      age(reg(f), 1);
      expect(evalOf(h, { pre: stale('terminal') }).verdict, f).toBe('not-idle');
      fs.rmSync(reg(f));
    }
  });

  it('no evidence at all is unmeasured, not idle', () => {
    const a = evalOf(h, { pre: stale('terminal') });
    expect(a.verdict).toBe('unmeasured');
    expect(a.token).toBe('');
  });

  it("reads the CURRENT uuid's transcript, not another conversation's old file", () => {
    transcript(1);
    transcript(30, '00000000-0000-4000-8000-000000000000');
    expect(evalOf(h, { pre: stale('terminal') }).verdict).toBe('not-idle');
  });

  it('under seven days is not idle; over seven is', () => {
    const p = transcript(6.9);
    expect(evalOf(h, { pre: stale('run-absent') }).verdict).toBe('not-idle');
    age(p, 8);
    expect(evalOf(h, { pre: stale('run-absent') }).verdict).toBe('reclaimable');
  });
});

describe('without --stale, everything is as today', () => {
  it('a plain reclaim keeps its token whatever the transcript says, and a stale word changes the token', () => {
    const plain = evalOf(h);
    expect(plain.verdict).toBe('reclaimable');
    transcript(9);
    expect(evalOf(h).token, 'the transcript is not a plain reclaim input').toBe(plain.token);
    expect(evalOf(h, { pre: stale('terminal') }).token).not.toBe(plain.token);
  });

  it('an old transcript does not release a hold when no stale word is given', () => {
    hold('waiting\n');
    transcript(30);
    expect(evalOf(h).verdict).toBe('held');
  });
});

describe('the flags', () => {
  it('the audit takes --stale and --hold-digest and prints the token the ladder mints', () => {
    const digest = hold('a reason\n');
    transcript(8);
    const viaAudit = auditOf(flags('held', digest));
    expect(viaAudit.verdict).toBe('reclaimable');
    expect(viaAudit.token).toBe(evalOf(h, { pre: stale('held', digest) }).token);
  });

  it('malformed flags die with a usage line and touch nothing', () => {
    hold('r\n');
    transcript(8);
    const bad = ['--stale held', '--stale held --hold-digest nothex', '--stale bogus', `--hold-digest ${sha('r\n')}`,
      `--stale terminal --hold-digest ${sha('r\n')}`, '--stale'];
    for (const f of bad) {
      const r = childReclaimVerb(h, 'a'.repeat(64), { extra: f });
      expect(r.code, f).not.toBe(0);
      expect(r.stderr, f).toContain('usage: ccd ws-reclaim');
      const au = h.run(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim ${f}`);
      expect(au.code, f).not.toBe(0);
      expect(au.stderr, f).toContain('usage: ccd ws-audit');
    }
    expect(fs.existsSync(c.wt)).toBe(true);
  });

  it('an exported environment cannot arm the arm', () => {
    hold('r\n');
    transcript(30);
    const out = h.sh(`${CHILD_STUBS} export _WS_STALE_WORD=held _WS_STALE_DIGEST=${sha('r\n')}; cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    expect((JSON.parse(out) as { verdict: string }).verdict).toBe('held');
  });

  it('the capability is announced', () => {
    expect(h.sh(`${CHILD_STUBS} cmd_caps`)).toContain('reclaim-stale-v1');
  });
});

describe('a stale reclaim that stopped after its pin', () => {
  it('resumes under the same flags with the hold still standing, and refuses without them', () => {
    const digest = hold('reason\n');
    transcript(8);
    h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; ${stale('held', digest)} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
      + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`
      + ` && _reg_set ${CHILD_ID} reaping reclaim:worktree`);
    const bare = h.sh(`_ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null; printf '%s' "$REAP_VERDICT"`);
    expect(bare, 'a resume without the flags is the plain resume').toBe('held');
    const tok = h.sh(`${stale('held', digest)} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} worktree >/dev/null; printf '%s' "$REAP_TOKEN"`);
    const r = childReclaimVerb(h, tok, { extra: flags('held', digest) });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
  }, 90_000);
});
