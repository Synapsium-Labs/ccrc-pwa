import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, ghContainedEnv } from './ccdWsHelpers.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const h = makeCcdHarness('pool-sync');
afterEach(() => h.cleanup());

/** Plant a fake curl that answers `body` with `status`, and record its argv.
 *  The brief's own version of this stub captured stdin but NOT argv, despite
 *  this same comment already promising "and record its argv" — a real gap:
 *  it meant the `-K -` -> `-H "x-ccrc-mail-token: $tok"` mutation (mutation
 *  table row 4) stayed GREEN, because the stub's unconditional
 *  `cat > "$HOME/curl.stdin"` captures whatever is piped in regardless of
 *  which flag the invoking script actually used to consume it — real curl
 *  would ignore that pipe without `-K -`, but the stub can't tell the
 *  difference, so "the token reached stdin" was true under BOTH the correct
 *  script and the argv-leaking mutant. Closed by also writing `"$@"` here, so
 *  a test can assert the negative (never in argv), not merely the positive
 *  (reaches stdin) — which is the whole claim "never let the box token reach
 *  argv or the environment" needs proven, not half of it. */
function stubCurl(body: string, status = '200'): string {
  const bin = path.join(h.home, 'bin');
  mkdirSync(bin, { recursive: true });
  const p = path.join(bin, 'curl');
  writeFileSync(p,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "$HOME/curl.argv"\ncat > "$HOME/curl.stdin"\nprintf '%s\\n%s' '${body}' '${status}'\n`,
    'utf8');
  chmodSync(p, 0o755);
  return bin;
}
function seedConfig(): void {
  mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(h.home, '.ccrc', 'agent.env'), 'CCRC_SERVER_URL=https://example.invalid\n', 'utf8');
  mkdirSync(path.join(h.home, '.cc-secrets'), { recursive: true });
  writeFileSync(path.join(h.home, '.cc-secrets', 'ccrc-mail.token'), 'tok-abc\n', 'utf8');
  mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
}
const run = (bin: string): { rc: number; out: string } => {
  try {
    const out = execFileSync('bash', [path.resolve('../ccd/ccd-pool-sync')], {
      encoding: 'utf8', env: { ...process.env, HOME: h.home, PATH: `${bin}:${process.env.PATH}` },
    });
    return { rc: 0, out };
  } catch (e: any) { return { rc: e.status ?? -1, out: String(e.stdout ?? '') }; }
};
const doc = (): string => readFileSync(path.join(h.home, '.cc-sessions', 'pool-epoch'), 'utf8');

describe('ccd-pool-sync', () => {
  beforeEach(seedConfig);

  it('writes the projection from a 200', () => {
    const bin = stubCurl('{"epoch":43,"issuedAt":1000,"leaseUntil":1900,"accounts":{"acct-a":{"pools":["pool-a"]}}}');
    expect(run(bin).rc).toBe(0);
    // Ruling T1-R3 (mid-flight): the projection gains a terminator line, the
    // last line exactly `end` — see the block below for why.
    expect(doc()).toBe('epoch 43\nissued 1000\nlease 1900\nacct acct-a pool-a\nend\n');
  });

  it('writes an epoch line and NO acct lines when nothing is tagged — synced-but-empty is not absence', () => {
    const bin = stubCurl('{"epoch":7,"issuedAt":1000,"leaseUntil":1900,"accounts":{}}');
    expect(run(bin).rc).toBe(0);
    // Zero `acct` lines is still legal (T1-R3): the minimum document is
    // epoch/issued/lease/end, four lines.
    expect(doc()).toBe('epoch 7\nissued 1000\nlease 1900\nend\n');
  });

  // T1-R3: the reader is line-oriented and cannot tell a complete final row
  // from a torn one. Measured on the round-2 reader: a document truncated
  // right after its last `acct` line answers `named <pool>` — a POSITIVE
  // verdict naming a pool that appears nowhere in a torn file. A terminator
  // closes that because truncation removes the LAST line by construction, so
  // this pins the terminator's presence directly, independent of the rest of
  // a document's exact content.
  it('the rendered document always ends with the `end` terminator, tagged or not', () => {
    const tagged = stubCurl('{"epoch":2,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":["pool-a"]}}}');
    expect(run(tagged).rc).toBe(0);
    expect(doc().endsWith('end\n')).toBe(true);
    const empty = stubCurl('{"epoch":3,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(empty).rc).toBe(0);
    expect(doc().endsWith('end\n')).toBe(true);
  });

  // The smaller fix bundled with T1-R3: `_acct_pool_state` answers `malformed`
  // for a duplicate `acct` id even when the two rows agree, so this writer
  // must never render two rows for one account — it must refuse loudly
  // instead, so the diagnostic lands here rather than at 20 undecidable fleet
  // nodes. Not reachable through the server today (wave 1 is one pool per
  // account, enforced server-side); guarded anyway.
  it('refuses (writes nothing) when an account carries more than one pool', () => {
    const before = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(before).rc).toBe(0);
    const baseline = doc();
    const bin = stubCurl('{"epoch":2,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":["pool-a","pool-b"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(doc(), 'a rejected multi-pool answer must leave the prior document untouched').toBe(baseline);
  });

  // Pins mutation-table row 3 ("drop the NAME.match(p) check"): a pool name
  // off `_acct_pool_state`'s own grammar (`^[a-z][a-z0-9-]{0,31}$`) must never
  // reach the file — `Bad_Name` fails on both the uppercase letters and the
  // underscore.
  it('refuses (writes nothing) when a pool name is off-grammar', () => {
    const bin = stubCurl('{"epoch":5,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":["Bad_Name"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  // STRUCTURAL injection, not merely a bad character class: the projection
  // is line-oriented with no escaping, so `"\n".join(lines)` trusts every
  // rendered id/pool to already BE one safe line. `Bad_Name` above proves the
  // grammar rejects an off-CLASS value; these prove it also closes the two
  // ways a value could corrupt the document's STRUCTURE rather than merely
  // fail its own character test — a distinction a future maintainer deciding
  // whether the check is still load-bearing cannot see from `Bad_Name` alone.
  it('refuses when a pool value tries to inject a fabricated acct row via an embedded newline', () => {
    const bin = stubCurl('{"epoch":6,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":["pool-a\\nacct evil-account pool-b"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  it('refuses when a pool value carries an embedded space (a fabricated extra field)', () => {
    const bin = stubCurl('{"epoch":6,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":["pool-a pool-b"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  // The narrower, more surprising shape the two cases above do NOT exercise:
  // Python's `$` (no re.MULTILINE) matches not only true end-of-string but
  // also the position immediately before a SINGLE trailing newline — measured
  // directly: `re.match(r"^[a-z][a-z0-9-]{0,31}$", "pool-a\n")` answers True.
  // A value of exactly "<valid-chars>\n" is what that quirk lets through
  // `.match()`; `.fullmatch()` is what closes it. This is the case that pins
  // the fix rather than merely the class of bug — the two cases above would
  // stay green even under the OLD `.match()` form, because a full fabricated
  // row or an embedded space both fail the character class outright either
  // way (verified: measured, not assumed, before adding this file's fix).
  it('refuses a pool value that is otherwise valid but for one trailing newline', () => {
    const bin = stubCurl('{"epoch":6,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":["pool-a\\n"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  // The same exposure on the account id side — `k` is spliced into the same
  // `"acct %s %s" % (k, p)` format string and rendered through the same
  // unescaped join.
  it('refuses when an account id tries to inject a fabricated acct row via an embedded newline', () => {
    const bin = stubCurl('{"epoch":6,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a\\nacct evil-account pool-b":{"pools":["pool-a"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  it('refuses an account id that is otherwise valid but for one trailing newline', () => {
    const bin = stubCurl('{"epoch":6,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a\\n":{"pools":["pool-a"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  // Task 1 round 3 (T1-R3): probe `_acct_pool_state` directly against a
  // document shaped exactly like the pre-T1-R3 grammar (no `end` line) — the
  // shape a truncation collapses to. Written to the CONTRACT ("your test
  // should be written to the contract, not to today's reader"), not to the
  // live file: `ccd/ccd` is another task's file, mid-edit, UNCOMMITTED, in
  // this same shared worktree, and its working-tree content is not a stable
  // oracle — measured flapping in BOTH directions within minutes while this
  // task ran (reader answered `named pool-a` with `git diff ccd/ccd` empty;
  // then refused once Task 1's terminator check appeared live; then answered
  // `named pool-a` again moments later while `git diff ccd/ccd` showed Task 1
  // mid-REWRITE of the same function, the check temporarily gone). A test
  // that sources the LIVE path would be exactly as unstable, in whichever
  // direction the other task's editor happens to be mid-save. A git commit
  // is atomic; a working tree under concurrent edit is not — so this sources
  // `git show HEAD:ccd/ccd`, the last STABLE, committed snapshot, instead of
  // the live file at `../ccd/ccd`. When this comment was written that was
  // 38dfc652 ("fix round 2"), which did not yet carry the terminator check,
  // so this read as a deterministic, reproducible pending-dependency signal
  // rather than a coin flip on another session's save timing — no `it.fails`
  // needed; the same plain assertion would start passing on its own the
  // moment Task 1 committed. UPDATE, same task, minutes later: Task 1
  // committed round 3 as 3fe63055 ("real seen-flags, a document terminator,
  // and unreadable for an absent id") and the working tree is clean again —
  // this now passes for real, against the same HEAD every other test in this
  // repo would see. Left as a plain assertion rather than reworded to drop
  // the "pending" framing, since the comment's history is the evidence this
  // pin actually tracks its dependency rather than merely asserting it does.
  it('cross-check: HEAD\'s committed ccd/ccd refuses a document with no `end` terminator (pending Task 1 round 3\'s commit — see comment for why HEAD, not the live file)', () => {
    const h2 = makeCcdHarness('pool-sync-reader-x');
    try {
      const reg = path.join(h2.home, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      writeFileSync(path.join(reg, 'pool-epoch'),
        'epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n', 'utf8');
      // maxBuffer explicit: ccd/ccd is 13k+ lines and trips execFileSync's
      // default (1 MiB) ENOBUFS — measured, not assumed.
      const committedCcd = execFileSync('git', ['show', 'HEAD:ccd/ccd'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const snapshot = path.join(h2.home, 'ccd-head-snapshot');
      writeFileSync(snapshot, committedCcd, 'utf8');
      const out = execFileSync('bash', ['-c', `source "${snapshot}"; _acct_pool_state acct-a`], {
        encoding: 'utf8', cwd: h2.home,
        env: ghContainedEnv(h2.home, { ...process.env, HOME: h2.home }, { systemd: true, tmux: true }),
      }).trim();
      expect(out).not.toMatch(/^named /);
    } finally {
      h2.cleanup();
    }
  });

  it('sends the token on STDIN, never in argv', () => {
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":2,"accounts":{}}');
    run(bin);
    expect(readFileSync(path.join(h.home, 'curl.stdin'), 'utf8')).toContain('tok-abc');
    // The other half of the claim: pins mutation-table row 4
    // (`-K -` -> `-H "x-ccrc-mail-token: $tok"`) for real — the stdin
    // assertion above alone cannot, since the stub's own capture is
    // unconditional (see stubCurl's comment).
    expect(readFileSync(path.join(h.home, 'curl.argv'), 'utf8')).not.toContain('tok-abc');
  });

  it('writes NOTHING on a non-200 — a stale document beats no document', () => {
    const bin = stubCurl('nope', '503');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  it('leaves an EXISTING document untouched on a non-200', () => {
    writeFileSync(path.join(h.home, '.cc-sessions', 'pool-epoch'), 'epoch 1\nissued 1\nlease 2\n', 'utf8');
    const bin = stubCurl('nope', '500');
    run(bin);
    expect(doc()).toBe('epoch 1\nissued 1\nlease 2\n');
  });

  // Added beyond the brief's Step 1 set (see task-3-report.md): the two cases
  // above both stub a non-JSON body ('nope') for their non-200 status, so the
  // status check and the python-side JSON validation are never pulled apart —
  // deleting the `[ "$status" = 200 ]` guard alone stayed GREEN against them
  // (measured, mutation table row 1). This is the case that isolates it: a
  // WELL-FORMED document riding a non-200 status must still be refused, or a
  // server that fails open (500 with a stale-but-valid body, or any
  // intermediary that echoes a 200 payload under a different code) would get
  // installed as if it were current.
  it('writes NOTHING on a non-200 even when the body is a well-formed document', () => {
    const bin = stubCurl('{"epoch":9,"issuedAt":1,"leaseUntil":2,"accounts":{}}', '500');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  it('refuses when no server URL is configured', () => {
    writeFileSync(path.join(h.home, '.ccrc', 'agent.env'), '\n', 'utf8');
    const bin = stubCurl('{}');
    expect(run(bin).rc).not.toBe(0);
  });

  it('leaves no tmp behind on the success path', () => {
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":2,"accounts":{}}');
    run(bin);
    const reg = path.join(h.home, '.cc-sessions');
    const strays = execFileSync('bash', ['-c', `ls -a ${reg} | grep -c 'pool-epoch\\.' || true`], { encoding: 'utf8' }).trim();
    expect(strays).toBe('0');
  });
});
