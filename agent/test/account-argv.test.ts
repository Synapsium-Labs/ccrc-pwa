// Accounts plan Task A8 (spec §13.2 "Input bounds"): the `account` op's argv builder. It refuses BEFORE any spawn —
// a pure function, so every case here is a value in and a refusal or an argv out; `account-op.test.ts` proves the
// agent spawns nothing on a refusal.
//
// What is pinned:
//  - NO FREE ARGV: a field the sub does not take (`force`, `extra`, anything) is refused, and so is `--force` as the
//    value of every field each sub takes.
//  - The bounds: `../`, a newline, a 65-character label, a 10 kB label, a bad model id, a value outside each enum, an
//    `attemptId` that is not 32 hex characters, and a `limit` that is not digits from 1 to 100000.
//  - Every value is ONE argv word: a valid add builds `--label=<v>`, never `--label` `<v>`.
//  - stdin: 1 to 8 KiB, no NUL, C0 or DEL (`key-charset`).
//  - The builder's control class is the roster's `LABEL_UNSAFE_RE`, literal for literal (D-5622 (2)).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_STDIN_MAX_BYTES, ACCOUNT_SUB_ARGV, buildAccountArgv, isAccountStdin } from '../src/accountop.js';
import { ACCOUNT_SUBS, type AccountSub } from '../../shared/api.js';

const ATTEMPT = 'a'.repeat(16) + '0123456789abcdef';
const LANE = 'lane-a';

/** A valid set of fields for every sub, the base each refusal case breaks one value of. */
const VALID: Record<AccountSub, { laneId: string | null; fields: Record<string, string>; stdin: boolean }> = {
  'add': {
    laneId: LANE, stdin: true,
    fields: {
      provider: 'openrouter', method: 'paste', label: 'Lane A', hue: 'cyan', placement: 'overflow',
      models: 'anthropic/claude-sonnet-4.5,openai/gpt-5', limit: '20', limitReset: 'monthly', expiresIn: '365d', adopt: 'true',
    },
  },
  'auth-start': { laneId: LANE, stdin: false, fields: { method: 'login', attemptId: ATTEMPT } },
  'auth-code': { laneId: LANE, stdin: true, fields: { attemptId: ATTEMPT } },
  'auth-cancel': { laneId: LANE, stdin: false, fields: { attemptId: ATTEMPT } },
  'set': { laneId: LANE, stdin: false, fields: { stated: 'Max plan, work', placement: 'full', limit: '100000', limitReset: 'daily' } },
  'check': { laneId: LANE, stdin: false, fields: {} },
  'enable': { laneId: LANE, stdin: false, fields: {} },
  'disable': { laneId: LANE, stdin: false, fields: {} },
  'credential': { laneId: LANE, stdin: false, fields: { method: 'mint', retire: 'true', liveAck: 'true' } },
  'remove': { laneId: LANE, stdin: false, fields: { mode: 'discard', deleteCodexAuth: 'true' } },
  'roster': { laneId: null, stdin: false, fields: {} },
  'or-management-remove': { laneId: null, stdin: false, fields: {} },
  'or-management-lower': { laneId: null, stdin: false, fields: { ceiling: '50' } },
};

const build = (sub: AccountSub, over: Record<string, unknown> = {}, laneId: unknown = VALID[sub].laneId) =>
  buildAccountArgv(sub, laneId, { ...VALID[sub].fields, ...over }, VALID[sub].stdin);

describe('the account argv builder: no free argv (spec §13.2)', () => {
  it('every sub builds from its valid fields (the control every refusal below breaks one value of)', () => {
    for (const sub of ACCOUNT_SUBS) expect(build(sub), sub).toMatchObject({ ok: true });
  });

  it('refuses --force in any field: as a field name on every sub, and as the value of every field each sub takes', () => {
    for (const sub of ACCOUNT_SUBS) {
      expect(build(sub, { force: 'true' }), `${sub} force:true`).toEqual({ ok: false, why: 'bad-field' });
      expect(build(sub, { extra: '--force' }), `${sub} extra`).toEqual({ ok: false, why: 'bad-field' });
      for (const key of Object.keys(ACCOUNT_SUB_ARGV[sub].fields)) {
        expect(build(sub, { [key]: '--force' }), `${sub}.${key}`).toEqual({ ok: false, why: 'bad-field' });
      }
    }
    expect(buildAccountArgv('enable', '--force', {}, false)).toEqual({ ok: false, why: 'bad-id' });
  });

  it('refuses ../ in a label, a stated identity, a model id and the lane id', () => {
    expect(build('add', { label: '../x' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { label: 'a/../b' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('set', { stated: '..' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { models: 'openai/../gpt-5' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('check', {}, '..')).toEqual({ ok: false, why: 'bad-id' });
    expect(build('check', {}, '../lane-a')).toEqual({ ok: false, why: 'bad-id' });
  });

  it('refuses a newline, any other C0 byte and DEL in every free-text field', () => {
    for (const bad of ['Lane\nA', 'Lane\rA', 'Lane\u0000A', 'Lane\tA', 'Lane\u007fA']) {
      expect(build('add', { label: bad }), JSON.stringify(bad)).toEqual({ ok: false, why: 'bad-field' });
      expect(build('set', { stated: bad }), JSON.stringify(bad)).toEqual({ ok: false, why: 'bad-field' });
    }
    expect(build('check', {}, 'lane-a\n')).toEqual({ ok: false, why: 'bad-id' });
  });

  it('bounds the label at 64 characters: 64 builds, 65 and 10 kB are refused, and so is an empty one', () => {
    expect(build('add', { label: 'x'.repeat(64) })).toMatchObject({ ok: true });
    expect(build('add', { label: '·'.repeat(64) }), 'counted in characters, not bytes').toMatchObject({ ok: true });
    expect(build('add', { label: 'x'.repeat(65) })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { label: 'x'.repeat(10 * 1024) })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { label: '' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('set', { stated: 'x'.repeat(120) })).toMatchObject({ ok: true });
    expect(build('set', { stated: 'x'.repeat(121) })).toEqual({ ok: false, why: 'bad-field' });
  });

  it('refuses a bad model id, a duplicate, and more than sixteen', () => {
    expect(build('add', { models: 'gpt 5' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { models: '/gpt-5' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { models: 'gpt-5,' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { models: 'gpt-5,gpt-5' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('add', { models: Array.from({ length: 17 }, (_, i) => `m${i}`).join(',') })).toEqual({ ok: false, why: 'bad-field' });
  });

  it('refuses a value outside each enum, in every enum field', () => {
    const enums: Array<[AccountSub, string]> = [
      ['add', 'provider'], ['add', 'method'], ['add', 'hue'], ['add', 'placement'], ['add', 'limitReset'], ['add', 'expiresIn'],
      ['auth-start', 'method'], ['set', 'placement'], ['set', 'limitReset'], ['credential', 'method'], ['remove', 'mode'],
    ];
    for (const [sub, key] of enums) {
      expect(build(sub, { [key]: 'bogus' }), `${sub}.${key}`).toEqual({ ok: false, why: 'bad-field' });
      expect(build(sub, { [key]: VALID[sub].fields[key]!.toUpperCase() }), `${sub}.${key} upper`).toEqual({ ok: false, why: 'bad-field' });
    }
    // `compatible` is CLI-only (its base URL is the CLI's), and `seed` is no method of anything.
    expect(build('add', { provider: 'compatible' })).toEqual({ ok: false, why: 'bad-field' });
    // A flag field takes exactly `true`.
    expect(build('add', { adopt: 'false' })).toEqual({ ok: false, why: 'bad-field' });
    expect(build('remove', { deleteCodexAuth: 'yes' })).toEqual({ ok: false, why: 'bad-field' });
  });

  it('refuses an attemptId that is not 32 lowercase hex characters', () => {
    for (const bad of [ATTEMPT.slice(1), `${ATTEMPT}0`, ATTEMPT.toUpperCase(), `${ATTEMPT.slice(1)}g`, `${ATTEMPT.slice(1)}-`]) {
      for (const sub of ['auth-start', 'auth-code', 'auth-cancel'] as const) {
        expect(build(sub, { attemptId: bad }), `${sub} ${bad}`).toEqual({ ok: false, why: 'bad-field' });
      }
    }
    const { attemptId: _drop, ...noAttempt } = VALID['auth-cancel'].fields;
    expect(buildAccountArgv('auth-cancel', LANE, noAttempt, false), 'attemptId is required').toEqual({ ok: false, why: 'bad-field' });
  });

  it('refuses a limit or ceiling that is not digits from 1 to 100000', () => {
    for (const bad of ['0', '100001', '-1', '1.5', '1e3', ' 20', '020', '20 ', 'twenty', '0x10']) {
      expect(build('add', { limit: bad }), `limit ${bad}`).toEqual({ ok: false, why: 'bad-field' });
      expect(build('set', { limit: bad }), `set limit ${bad}`).toEqual({ ok: false, why: 'bad-field' });
      expect(build('or-management-lower', { ceiling: bad }), `ceiling ${bad}`).toEqual({ ok: false, why: 'bad-field' });
    }
    expect(build('set', { limit: '1' })).toMatchObject({ ok: true });
    expect(build('set', { limit: '100000' })).toMatchObject({ ok: true });
  });

  it('a valid add builds --label=<v> as ONE argv word, never two, and every value rides its own flag word', () => {
    const r = build('add', { label: 'Lane A' });
    expect(r.ok).toBe(true);
    const argv = (r as { argv: readonly string[] }).argv;
    expect(argv).toContain('--label=Lane A');
    expect(argv).not.toContain('--label');
    expect(argv).toEqual([
      'account', 'add', '--id=lane-a', '--provider=openrouter', '--method=paste', '--label=Lane A', '--hue=cyan',
      '--placement=overflow', '--models=anthropic/claude-sonnet-4.5,openai/gpt-5', '--limit=20', '--limit-reset=monthly',
      '--expires-in=365d', '--adopt',
    ]);
    expect(Object.isFrozen(argv)).toBe(true);
  });

  it('the management subs spell the CLI verb, and lower carries the fixed --lower-only (no sub can raise the ceiling)', () => {
    expect(build('or-management-remove')).toEqual({ ok: true, argv: ['account', 'openrouter-management', 'remove'] });
    expect(build('or-management-lower')).toEqual({ ok: true, argv: ['account', 'openrouter-management', 'ceiling', '--usd=50', '--lower-only'] });
    expect(build('roster')).toEqual({ ok: true, argv: ['account', 'roster'] });
  });

  it('a sub that names a lane needs one; a sub that names none refuses one', () => {
    expect(build('check', {}, null)).toEqual({ ok: false, why: 'bad-id' });
    expect(build('roster', {}, LANE)).toEqual({ ok: false, why: 'bad-id' });
    expect(build('check', {}, 'x'.repeat(65))).toEqual({ ok: false, why: 'bad-id' });
    expect(build('check', {}, 7)).toEqual({ ok: false, why: 'bad-id' });
  });

  it('refuses a sub off the union, and fields that are not a plain object of strings', () => {
    for (const sub of ['seed', 'or-management-install', 'openrouter-management', '', 'ADD', 7, null]) {
      expect(buildAccountArgv(sub, LANE, {}, false), String(sub)).toEqual({ ok: false, why: 'bad-sub' });
    }
    for (const fields of [null, [], 'label=x', 7, new Map(), { label: 7 }, { label: ['x'] }]) {
      const r = buildAccountArgv('add', LANE, fields, false);
      expect(r, JSON.stringify(fields)).toEqual({ ok: false, why: 'bad-field' });
    }
  });

  it('stdin is required by auth-code, refused by a sub that reads none', () => {
    expect(buildAccountArgv('auth-code', LANE, { attemptId: ATTEMPT }, false)).toEqual({ ok: false, why: 'bad-field' });
    expect(buildAccountArgv('check', LANE, {}, true)).toEqual({ ok: false, why: 'bad-field' });
    expect(buildAccountArgv('add', LANE, { provider: 'anthropic', method: 'login' }, false)).toMatchObject({ ok: true });
  });

  it('stdin bytes: 1 to 8 KiB, no NUL, C0 or DEL', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(isAccountStdin(enc('sk-' + 'x'.repeat(80)))).toBe(true);
    expect(isAccountStdin(new Uint8Array(ACCOUNT_STDIN_MAX_BYTES).fill(0x41))).toBe(true);
    expect(isAccountStdin(new Uint8Array(ACCOUNT_STDIN_MAX_BYTES + 1).fill(0x41))).toBe(false);
    expect(isAccountStdin(new Uint8Array(0))).toBe(false);
    for (const bad of ['a\u0000b', 'ab\n', 'a\rb', 'a\u007fb', 'a\tb']) expect(isAccountStdin(enc(bad)), JSON.stringify(bad)).toBe(false);
  });
});

describe("the builder's control class is the roster's (D-5622 (2))", () => {
  const SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared');
  const literalIn = (file: string, name: string): string => {
    const m = new RegExp(`^(?:export )?const ${name} = (/.+/[a-z]*);$`, 'm').exec(readFileSync(path.join(SHARED, file), 'utf8'));
    expect(m, `no single-line literal for ${name} in shared/${file}: teach this scan the new spelling`).not.toBeNull();
    return m![1]!;
  };

  it("CONTROL_RE is LABEL_UNSAFE_RE character for character, so the spec's one policy has one meaning", () => {
    expect(literalIn('account-argv.ts', 'CONTROL_RE')).toBe(literalIn('roster.ts', 'LABEL_UNSAFE_RE'));
  });
});
