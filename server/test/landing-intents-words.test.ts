// Landing order wave 5g (Task 1): the words of a dispatch's landing intents, `shared/landingIntents.ts` (L0).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LANDING_INTENT_KEY_RE, LANDING_INTENTS_MAX, parseLandingIntents } from '../../shared/landingIntents.js';

const refusal = (raw: unknown): string => {
  const r = parseLandingIntents(raw);
  if (r.ok) throw new Error(`accepted ${JSON.stringify(raw)}`);
  return r.detail;
};

describe('the key grammar', () => {
  it.each(['#1', '#123456789', 'D-1', 'D-8080'])('accepts %s', (k) => {
    expect(parseLandingIntents([k])).toEqual({ ok: true, keys: [k] });
  });
  it.each(['#0', '#01', '#1234567890', 'D-0', 'd-1', '#12 ', 'issue:1', ''])('refuses %j and says so', (k) => {
    const d = refusal([k]);
    expect(d.startsWith('intents: ')).toBe(true);
    expect(d).toContain(LANDING_INTENT_KEY_RE.source);
  });
  it('refuses a key that is not a string', () => {
    expect(refusal([7]).startsWith('intents: ')).toBe(true);
    expect(refusal([7])).toMatch(/string/);
  });
});

describe('the list', () => {
  it('reads undefined and [] as no keys', () => {
    expect(parseLandingIntents(undefined)).toEqual({ ok: true, keys: [] });
    expect(parseLandingIntents([])).toEqual({ ok: true, keys: [] });
  });
  it('refuses a non-array', () => {
    expect(refusal('#1')).toMatch(/^intents: .*array/);
  });
  it('accepts the maximum and refuses one more', () => {
    expect(LANDING_INTENTS_MAX).toBe(8);
    const keys = Array.from({ length: 8 }, (_, i) => `#${i + 1}`);
    expect(parseLandingIntents(keys)).toEqual({ ok: true, keys });
    expect(refusal([...keys, '#9'])).toMatch(/^intents: more than 8/);
  });
  it('refuses a repeated key', () => {
    expect(refusal(['#1', 'D-2', '#1'])).toMatch(/^intents: repeated key #1/);
  });
});

describe('the file', () => {
  it('shared/landingIntents.ts imports nothing', () => {
    const text = readFileSync(path.join(__dirname, '..', '..', 'shared', 'landingIntents.ts'), 'utf8');
    expect(text).not.toMatch(/^\s*import\b/m);
    expect(text).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    expect(text).not.toMatch(/node:/);
  });
});
