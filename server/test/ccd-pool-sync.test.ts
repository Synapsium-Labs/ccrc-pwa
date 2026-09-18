import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness } from './ccdWsHelpers.js';
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
function setServerUrl(url: string): void {
  writeFileSync(path.join(h.home, '.ccrc', 'agent.env'), `CCRC_SERVER_URL=${url}\n`, 'utf8');
}
const curlArgv = (): string => readFileSync(path.join(h.home, 'curl.argv'), 'utf8');
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
  //
  // Fix round 2 (measured, not assumed): on the POOL side this payload
  // happens to render as TWO WELL-FORMED `acct` lines, not one malformed
  // one — `p = "pool-a\nacct evil-account pool-b"` against id `"acct-a"`
  // renders `"acct acct-a pool-a\nacct evil-account pool-b"`, which the
  // document join then splits into `"acct acct-a pool-a"` (real) and
  // `"acct evil-account pool-b"` (forged), BOTH grammar-valid — so this is
  // the case the whole-document per-line pass (T3-R1) structurally cannot
  // see, and only `NAME.fullmatch(p)` refuses it. Confirmed directly:
  // deleting `NAME.fullmatch` from the compound condition (keeping
  // `isinstance(p, str)`) reds THIS test with no new test needed — the
  // payload the coordinator specified for a "pool mirror" of the id-side
  // two-well-formed-lines case turned out to be byte-identical to this
  // pre-existing test's own body, so nothing new was added here; this
  // comment and the mutation-table entry now say why it is load-bearing.
  // (Contrast the id-side case below, which is a genuinely different
  // shape — see its own comment for why a new test WAS needed there.)
  it('refuses when a pool value tries to inject a fabricated acct row via an embedded newline (renders as two well-formed lines — the per-line pass cannot see this, only the NAME field check can)', () => {
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

  // Fix round 2 (coordinator's own correction to a round-1 hypothesis, measured
  // not assumed): a payload that renders as TWO WELL-FORMED lines is exactly
  // what the whole-document per-line pass CANNOT see, because both halves pass
  // `LINE.fullmatch` on their own. `k = "acct-a pool-b\nacct evil-account"`
  // paired with `pools: ["pool-a"]` renders one `lines[]` element,
  // `"acct acct-a pool-b\nacct evil-account pool-a"`, which the document join
  // then splits (via its OWN embedded newline) into `"acct acct-a pool-b"` and
  // `"acct evil-account pool-a"` — both syntactically perfect `acct <id> <pool>`
  // rows, the second one a FORGED row for an account the control plane never
  // named. Only the per-field `ID.fullmatch(k)` check catches this, by
  // refusing the space+newline in `k` before it is ever rendered — the
  // per-line pass never gets the chance to see the split. Measured directly
  // (see the mutation table's rows for `ID.fullmatch` deleted entirely, not
  // merely weakened to `.match`, which this case does NOT distinguish from
  // `.fullmatch` — the interior SPACE fails the character class regardless of
  // anchoring, so only removing the check outright reproduces the forgery).
  it('refuses when an account id renders as two well-formed acct lines via an embedded newline (the per-line pass cannot see this — only the ID field check can)', () => {
    const bin = stubCurl('{"epoch":6,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a pool-b\\nacct evil-account":{"pools":["pool-a"]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  // The mirror on the pool side needs no new test: the coordinator's own
  // literal payload for it (`p = "pool-a\nacct evil-account pool-b"` against
  // a plain id) is byte-identical to the pre-existing
  // 'refuses when a pool value tries to inject a fabricated acct row via an
  // embedded newline' test above — see that test's now-updated comment and
  // title for the same "renders as two well-formed lines" reasoning, and the
  // mutation table for the `NAME.fullmatch` deletion that reds it directly.

  // T1-R3: the reader is line-oriented and cannot tell a complete final row
  // from a torn one — a document truncated right after its last `acct` line
  // must not answer `named <pool>` for that account. (T3-R2: this briefly
  // read `git show HEAD:ccd/ccd` instead of the live file while Task 1's
  // concurrent edits to ccd/ccd were still flapping mid-round; reverted now
  // that Task 1 is complete and the tree is quiet — in CI the checkout is
  // always clean, so HEAD and the working tree agree anyway, and pointing
  // at HEAD instead of the live file only ever changed anything on a dirty
  // local tree, which is exactly when a real regression needs catching.)
  it('cross-check: the shipped reader refuses a document with no `end` terminator', () => {
    const h2 = makeCcdHarness('pool-sync-reader-x');
    try {
      const reg = path.join(h2.home, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      writeFileSync(path.join(reg, 'pool-epoch'),
        'epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n', 'utf8');
      const out = h2.sh('_acct_pool_state acct-a');
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

  // C1 (fix round 1, Critical): `ccrc install --role fleet` writes either
  // `ws://`/`wss://` or `http://`/`https://`, and the installer's own prompt
  // offers `ws://…` first — without the swap curl refuses the protocol
  // outright and every sync after that is a silent no-op. One case per
  // scheme, per the review: both must reach curl's argv as http(s).
  it('normalizes ws:// to http:// before it ever reaches curl', () => {
    setServerUrl('ws://example.invalid');
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(bin).rc).toBe(0);
    expect(curlArgv()).toContain('http://example.invalid/api/pools/epoch');
    expect(curlArgv()).not.toContain('ws://');
  });

  it('normalizes wss:// to https:// before it ever reaches curl', () => {
    setServerUrl('wss://example.invalid');
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(bin).rc).toBe(0);
    expect(curlArgv()).toContain('https://example.invalid/api/pools/epoch');
    expect(curlArgv()).not.toContain('wss://');
  });

  it('trims a trailing slash so the route is /api/pools/epoch, not /api//pools/epoch', () => {
    setServerUrl('https://example.invalid/');
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(bin).rc).toBe(0);
    expect(curlArgv()).toContain('https://example.invalid/api/pools/epoch');
    expect(curlArgv()).not.toContain('//api');
  });

  // T3-R1 (fix round 1, C2-C4 — one mechanism, not three patches): render
  // first, THEN validate the whole rendered document against the grammar,
  // before anything touches the filesystem. Each case below reproduces a
  // measured pre-fix failure: a good in-lease document destroyed and
  // replaced with one the reader calls `malformed`.
  it('refuses (writes nothing) when epoch is negative', () => {
    const before = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(before).rc).toBe(0);
    const baseline = doc();
    const bin = stubCurl('{"epoch":-1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(bin).rc).not.toBe(0);
    expect(doc(), 'a rejected negative epoch must leave the prior document untouched').toBe(baseline);
  });

  it('refuses (writes nothing) when epoch is a float, rather than silently truncating it', () => {
    const before = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(before).rc).toBe(0);
    const baseline = doc();
    const bin = stubCurl('{"epoch":43.5,"issuedAt":1,"leaseUntil":9999999999,"accounts":{}}');
    expect(run(bin).rc).not.toBe(0);
    expect(doc()).toBe(baseline);
  });

  it('refuses (writes nothing) when pools is a string, rather than iterating its characters', () => {
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":"p"}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  it('refuses (writes nothing) when pools is an object rather than a list', () => {
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":{"pool-a":1}}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  // Fix round 2: closes the round-1-disclosed gap — a syntactically valid
  // LIST carrying a non-string element, which `isinstance(pools, list)`
  // alone does not catch (the list check only rejects a non-list `pools`;
  // "pools":"p" and "pools":{...} both fail it before this element-level
  // check is ever reached, which is why round 1 found no test isolating
  // `isinstance(p, str)` on its own).
  it('refuses (writes nothing) when pools is a valid list carrying a non-string element', () => {
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":9999999999,"accounts":{"acct-a":{"pools":[123]}}}');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  // The byte-cap case: 1500 accounts with long-but-legal ids render a
  // document at or over the reader's strict `-n 65536` bound. Built as JSON
  // in Node (not hand-typed) so the size is a property of the loop, not a
  // guess; a plain-file curl stub avoids embedding ~100 KB in a shell
  // single-quoted literal.
  it('refuses (writes nothing) when the rendered document would be at or over the reader\'s 65536-byte cap', () => {
    const accounts: Record<string, { pools: string[] }> = {};
    for (let n = 0; n < 1500; n++) {
      const id = `acct-${String(n).padStart(4, '0')}-${'x'.repeat(40)}`;
      accounts[id] = { pools: ['pool-a'] };
    }
    const body = JSON.stringify({ epoch: 1, issuedAt: 1, leaseUntil: 9999999999, accounts });
    const bin = path.join(h.home, 'bin');
    mkdirSync(bin, { recursive: true });
    const bodyFile = path.join(h.home, 'oversized-body.json');
    writeFileSync(bodyFile, body, 'utf8');
    writeFileSync(path.join(bin, 'curl'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "$HOME/curl.argv"\ncat > "$HOME/curl.stdin"\ncat "$HOME/oversized-body.json"\nprintf '\\n200'\n`,
      'utf8');
    chmodSync(path.join(bin, 'curl'), 0o755);
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });
});
