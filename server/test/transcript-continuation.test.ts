// The older-page continuation's codec (desktop polish wave 171): a value an untrusted client sends back. Every case is
// synthetic; no file is read.
import { describe, expect, it, vi } from 'vitest';
import { CONTINUATION_MAX_CHARS, ContinuationKey, type OpenedContinuation } from '../src/transcript/continuation.js';
import { WITNESS_MAX_BYTES } from '../src/transcript/tail.js';

const IDENT = 'a'.repeat(64);
const PATH = '/fixture/home/.claude-a/projects/-p/0000.jsonl';
const SHA = 'b'.repeat(64);
const facts = {
  session: 'claude-a-project-f', path: PATH, ident: IDENT,
  cursor: { kind: 'line-start' as const, before: 1000 },
  witness: { at: 1000, len: 64, sha256: SHA },
};

const opened = (key: ContinuationKey, token: string): OpenedContinuation => {
  const r = key.open(token);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.value;
};

/** `token` with the hex digit at `i` changed to another hex digit. */
const flip = (token: string, i: number): string => `${token.slice(0, i)}${token[i] === '0' ? '1' : '0'}${token.slice(i + 1)}`;

/** The payload part of a token, re-encoded from a replacement JSON text (MAC left as it was). */
const withPayload = (token: string, json: string): string => {
  const [v, kid, , mac] = token.split('.');
  return `${v}.${kid}.${Buffer.from(json, 'utf8').toString('hex')}.${mac}`;
};

describe('the continuation codec', () => {
  it('round-trips every bound field: the session in clear, the path and identity as keyed tags only', () => {
    const key = new ContinuationKey();
    const token = key.issue(facts);
    expect(opened(key, token)).toEqual({
      session: facts.session, pathTag: key.tag('path', PATH), identTag: key.tag('ident', IDENT),
      cursor: facts.cursor, witness: facts.witness,
    });
    expect(token).not.toContain(IDENT);
    expect(Buffer.from(token.split('.')[2]!, 'hex').toString('utf8')).not.toContain(IDENT);
    expect(Buffer.from(token.split('.')[2]!, 'hex').toString('utf8')).not.toContain(PATH);
  });

  it('is lowercase hex and dots only, so no credential shape the masker replaces can appear in it', () => {
    const token = new ContinuationKey().issue(facts);
    expect(token).toMatch(/^c1\.[0-9a-f]{16}\.[0-9a-f]+\.[0-9a-f]{64}$/);
    expect(token).not.toMatch(/sk-|eyJ/);
    expect(token.length).toBeLessThanOrEqual(CONTINUATION_MAX_CHARS);
  });

  it('a skip-record cursor round-trips', () => {
    const key = new ContinuationKey();
    expect(opened(key, key.issue({ ...facts, cursor: { kind: 'skip-record', before: 7 } })).cursor)
      .toEqual({ kind: 'skip-record', before: 7 });
  });

  it('reissue keeps every bound field and moves only the cursor', () => {
    const key = new ContinuationKey();
    const first = opened(key, key.issue(facts));
    const next = opened(key, key.reissue(first, { kind: 'line-start', before: 10 }));
    expect(next).toEqual({ ...first, cursor: { kind: 'line-start', before: 10 } });
  });

  it('the tags are keyed: another key tags the same path and identity differently', () => {
    const a = new ContinuationKey();
    const b = new ContinuationKey();
    expect(a.tag('path', PATH)).not.toBe(b.tag('path', PATH));
    expect(a.tag('ident', IDENT)).not.toBe(b.tag('ident', IDENT));
    expect(a.tag('path', IDENT)).not.toBe(a.tag('ident', IDENT));   // domain-separated
  });
});

describe('the continuation codec refuses', () => {
  it('a forged token: every hex digit of the payload or the MAC altered is invalid', () => {
    const key = new ContinuationKey();
    const token = key.issue(facts);
    const payloadFrom = 'c1.'.length + 16 + 1;
    for (let i = payloadFrom; i < token.length; i += 1) {
      if (token[i] === '.') continue;
      expect(key.open(flip(token, i))).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('a payload swapped for another under the old MAC is invalid (another session, an earlier cursor)', () => {
    const key = new ContinuationKey();
    const token = key.issue(facts);
    const json = Buffer.from(token.split('.')[2]!, 'hex').toString('utf8');
    expect(key.open(withPayload(token, json.replace(facts.session, 'claude-b-other')))).toEqual({ ok: false, reason: 'invalid' });
    expect(key.open(withPayload(token, json.replace('"l",1000', '"l",999')))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a token from another key (an earlier server process) is expired, not invalid', () => {
    const before = new ContinuationKey();
    const after = new ContinuationKey();
    expect(after.open(before.issue(facts))).toEqual({ ok: false, reason: 'expired' });
  });

  it('the process key is made when the module loads: a fresh load reads the old process\'s tokens as expired', async () => {
    const first = (await import('../src/transcript/continuation.js')).PROCESS_CONTINUATION_KEY;
    const token = first.issue(facts);
    vi.resetModules();
    const second = (await import('../src/transcript/continuation.js')).PROCESS_CONTINUATION_KEY;
    expect(second).not.toBe(first);
    expect(second.open(token)).toEqual({ ok: false, reason: 'expired' });
    expect(first.open(token).ok).toBe(true);
  });

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['another version', 'c2.0123456789abcdef.7b7d.' + '0'.repeat(64)],
    ['uppercase hex', new ContinuationKey().issue(facts).toUpperCase()],
    ['an odd payload length', 'c1.0123456789abcdef.7b7.' + '0'.repeat(64)],
    ['a short MAC', 'c1.0123456789abcdef.7b7d.' + '0'.repeat(63)],
    ['too long', 'c1.0123456789abcdef.' + '00'.repeat(CONTINUATION_MAX_CHARS) + '.' + '0'.repeat(64)],
  ] as const)('a token of the wrong grammar (%s) is invalid', (_label, token) => {
    expect(new ContinuationKey().open(token)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a too-long token is refused before its MAC is computed', () => {
    const key = new ContinuationKey();
    const token = key.issue(facts);
    expect(key.open(token + '0'.repeat(CONTINUATION_MAX_CHARS))).toEqual({ ok: false, reason: 'invalid' });
  });

  it.each([
    ['a witness longer than the bound', { ...facts, witness: { ...facts.witness, len: WITNESS_MAX_BYTES + 1 } }],
    ['an empty witness', { ...facts, witness: { ...facts.witness, len: 0 } }],
    ['a cursor above the witness', { ...facts, cursor: { kind: 'line-start' as const, before: 1001 } }],
    ['a negative cursor', { ...facts, cursor: { kind: 'line-start' as const, before: -1 } }],
    ['a fractional cursor', { ...facts, cursor: { kind: 'line-start' as const, before: 1.5 } }],
    ['a malformed witness hash', { ...facts, witness: { ...facts.witness, sha256: 'z'.repeat(64) } }],
    ['an empty session', { ...facts, session: '' }],
    ['an overlong session', { ...facts, session: 's'.repeat(257) }],
  ] as const)('a correctly signed token with out-of-bounds fields (%s) is invalid', (_label, f) => {
    const key = new ContinuationKey();
    expect(key.open(key.issue(f))).toEqual({ ok: false, reason: 'invalid' });
  });
});
