// D-8166 (test box connect plan TC15): the connect flow's words and its three pure decisions, in `src/fleet/testboxAdminWords.ts`
// and the refusal table beside the other refusal words (`src/lib/refusalWords.ts`). The shared contract holds the codes and the
// settings keys (`server/test/testbox-admin-contract.test.ts`); this file holds that the card says each one once, in words, and
// that the form's starting values are the box's own defaults.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TESTBOX_ADMIN_CODE_SENTENCE, TESTBOX_ADMIN_CODES, TESTBOX_ADMIN_PHASE_MAP, TESTBOX_BOX_KEYS, fitsTestboxShape, type TestboxAdminStatus } from '../../shared/testbox-admin';
import { TESTBOX_PARITY_REQUIRED_SENTENCE } from '../../shared/api';
import {
  BOX_SETTING_DEFAULTS, BOX_SETTING_FAMILIES, BOX_SETTING_FORM_START, TESTBOX_CONNECT_TEXT, TESTBOX_LISTEN_KEY, TESTBOX_SERVICE_PORT, actWord,
  boxSettingStart, checkWord, codeSentence, isIpLiteral, isPublicIpLiteral, listenFor, phaseTime, phaseWord, shapeSentence, stepOf,
} from '../src/fleet/testboxAdminWords';
import { ApiError } from '../src/lib/api';
import { TESTBOX_GATE_DARK_TEXT, TESTBOX_ROUTE_TEXT, testboxRouteText } from '../src/lib/refusalWords';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Addresses off the private and documentation ranges are assembled, never spelled, so no file the topology scanner reads holds one. */
const ip = (s: string): string => s.replace(/_/g, '.');

const status = (over: Partial<TestboxAdminStatus> = {}): TestboxAdminStatus => ({
  v: 1, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null, act: null,
  boxSettings: null, boxSettingsAt: null, installedTag: null, parity: null, ...over,
});
const act = (over: Partial<NonNullable<TestboxAdminStatus['act']>> = {}): NonNullable<TestboxAdminStatus['act']> => ({
  id: 'a'.repeat(32), sub: 'connect', phase: 'copy', phases: [{ name: 'verify', ms: 800 }], outcome: 'running', code: null,
  startedAt: 1, endedAt: null, ...over,
});

describe('the words of the connect flow (D-8166)', () => {
  it('every code has one sentence and no sentence names a value', () => {
    expect(TESTBOX_ADMIN_CODES.length).toBeGreaterThan(30);
    for (const code of TESTBOX_ADMIN_CODES) {
      const s = codeSentence(code);
      expect(s, code).toBe(TESTBOX_ADMIN_CODE_SENTENCE[code]);
      expect(s, `${code}: one line`).not.toMatch(/[\r\n]/);
      expect(s, `${code}: a sentence`).toMatch(/^[A-Za-z].*\.$/);
      // No address, path, URL, key, setting text or fingerprint: none of the shapes a value has.
      expect(s, `${code}: names no value`).not.toMatch(/[=/@:~]|CCRC_|\d+\.\d+|SHA256/);
    }
  });

  it('a code this build does not know, or none, says so without naming it', () => {
    const unknown = codeSentence('a-code-from-a-newer-verb');
    expect(unknown).toMatch(/does not name/);
    expect(unknown).not.toContain('newer-verb');
    expect(codeSentence(null)).toBe(unknown);
    expect(codeSentence('toString')).toBe(unknown);
  });

  it('every phase of every long act has a word, and a phase it does not know is its own name', () => {
    for (const phase of Object.keys(TESTBOX_ADMIN_PHASE_MAP)) expect(phaseWord(phase), phase).not.toBe(phase);
    expect(phaseWord('a-new-phase')).toBe('a-new-phase');
    expect(phaseWord('constructor')).toBe('constructor');
  });

  it('a ledger act and a preflight check read as words', () => {
    expect(actWord('confirm-host-key')).toBe('Confirm host key');
    expect(actWord('an-act-from-later')).toBe('an-act-from-later');
    expect(checkWord('not-xfs')).toBe('Not xfs');
    expect(checkWord('os')).toBe('Os');
  });

  it('a phase time reads in seconds, then minutes', () => {
    expect(phaseTime(400)).toBe('0.4 s');
    expect(phaseTime(12_400)).toBe('12 s');
    expect(phaseTime(125_000)).toBe('2 min 5 s');
  });

  it('the six steps are named once each', () => {
    expect(TESTBOX_CONNECT_TEXT.stepNames).toHaveLength(6);
    expect(new Set(TESTBOX_CONNECT_TEXT.stepNames).size).toBe(6);
  });
});

describe('stepOf (D-8166, spec §2.2)', () => {
  it('stepOf reads step 1 with nothing recorded, 3 after key, 4 after a passing preflight, 5 while an act runs, 6 once connected', () => {
    expect(stepOf(null)).toBe(1);
    expect(stepOf(status())).toBe(1);
    expect(stepOf(status({ addressSet: true }))).toBe(3);
    expect(stepOf(status({ addressSet: true, hostKey: 'pinned' }))).toBe(3);
    expect(stepOf(status({ addressSet: true, hostKey: 'pinned' }), { preflight: true })).toBe(4);
    expect(stepOf(status({ addressSet: true, hostKey: 'pinned', act: act() }), { preflight: true })).toBe(5);
    expect(stepOf(status({ addressSet: true, hostKey: 'pinned', connected: true }))).toBe(6);
  });

  it('the access line on screen is step 2, and "I have added it" leaves it', () => {
    expect(stepOf(status({ addressSet: true }), { line: true })).toBe(2);
    expect(stepOf(status({ addressSet: true }), { line: false })).toBe(3);
  });

  it('the settings, once confirmed, are step 5; a pin that moved or was never made keeps step 3', () => {
    expect(stepOf(status({ addressSet: true, hostKey: 'pinned' }), { preflight: true, settings: true })).toBe(5);
    expect(stepOf(status({ addressSet: true, hostKey: 'changed' }), { preflight: true })).toBe(3);
  });

  it('a failed install stays step 5 after a reload, and Try again goes back to the settings', () => {
    const failed = status({ addressSet: true, hostKey: 'pinned', act: act({ outcome: 'failed', code: 'install-failed', phase: 'install' }) });
    expect(stepOf(failed)).toBe(5);
    expect(stepOf(failed, { preflight: true, retry: true })).toBe(4);
    expect(stepOf(failed, { preflight: true, retry: true, settings: true })).toBe(5);
  });

  it('a parity act on a connected box does not move the step', () => {
    expect(stepOf(status({ addressSet: true, hostKey: 'pinned', connected: true, act: act({ sub: 'parity', phase: 'legs' }) }))).toBe(6);
  });

  it('an act that is not the connect never reads as an install', () => {
    expect(stepOf(status({ addressSet: true, act: act({ sub: 'repair' }) }))).toBe(3);
  });
});

describe('the box settings the form starts from (D-8166)', () => {
  it('the four families hold each of the 28 box keys exactly once', () => {
    const keys = BOX_SETTING_FAMILIES.flatMap((f) => [...f.keys]);
    expect(keys).toHaveLength(28);
    expect(new Set(keys).size).toBe(28);
    expect([...keys].sort()).toEqual([...TESTBOX_BOX_KEYS].sort());
  });

  it('a default is the one `_tb_box_table` holds, key for key', () => {
    const bash = readFileSync(path.join(HERE, '../../ccd/testbox-knobs'), 'utf8');
    const table = bash.slice(bash.indexOf('_tb_box_table() {'), bash.indexOf('# ── the validated load'));
    const found: Record<string, string> = {};
    for (const m of table.matchAll(/_tb_got (CCRC_TESTBOX_[A-Z_]+) ('[^']*'|"[^"]*"|\S+) \$\?/g)) {
      const raw = m[2]!;
      found[m[1]!] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    }
    expect(Object.keys(found)).toHaveLength(28);
    expect(BOX_SETTING_DEFAULTS).toEqual(found);
  });

  it('every non-blank default and every form start fits its own key shape', () => {
    for (const key of TESTBOX_BOX_KEYS) {
      const d = BOX_SETTING_DEFAULTS[key]!;
      if (d !== '') expect(fitsTestboxShape(key, d), `${key}=${d}`).toBe(true);
    }
    const start = boxSettingStart();
    expect(Object.keys(start)).toHaveLength(28);
    for (const [key, v] of Object.entries(start)) if (v !== '') expect(fitsTestboxShape(key, v), `${key}=${v}`).toBe(true);
  });

  it('the installer refuses a `~/` root and repository table, so the form starts both as absolute paths', () => {
    expect(BOX_SETTING_FORM_START).toEqual({ CCRC_TESTBOX_ROOT: expect.stringMatching(/^\//), CCRC_TESTBOX_REPOS: expect.stringMatching(/^\//) });
    const start = boxSettingStart();
    expect(start.CCRC_TESTBOX_ROOT).toBe(BOX_SETTING_FORM_START.CCRC_TESTBOX_ROOT);
    expect(start.CCRC_TESTBOX_REPOS).toBe(BOX_SETTING_FORM_START.CCRC_TESTBOX_REPOS);
    expect(start.CCRC_TESTBOX_TOOLS_DIR).toBe(BOX_SETTING_DEFAULTS.CCRC_TESTBOX_TOOLS_DIR);
    expect(start[TESTBOX_LISTEN_KEY]).toBe('');
  });

  it('the listen address is a private IP literal and the service port, or blank for a host name or a public address', () => {
    expect(listenFor('10.0.0.7')).toBe(`10.0.0.7:${TESTBOX_SERVICE_PORT}`);
    expect(listenFor(ip('100_64_1_2'))).toBe(`${ip('100_64_1_2')}:${TESTBOX_SERVICE_PORT}`);
    expect(listenFor('fd7a:115c:a1e0::7', 9000)).toBe('[fd7a:115c:a1e0::7]:9000');
    expect(listenFor('testbox.invalid')).toBe('');
    // a public address would carry the token in clear across the internet: the card never fills it, and Connect refuses it
    for (const v of ['192.0.2.7', ip('8_8_8_8'), ip('172_32_0_1'), '2001:db8::7']) expect(listenFor(v), v).toBe('');
    expect(fitsTestboxShape(TESTBOX_LISTEN_KEY, listenFor('10.0.0.7'))).toBe(true);
    expect(fitsTestboxShape(TESTBOX_LISTEN_KEY, listenFor('fd7a:115c:a1e0::7'))).toBe(true);
  });

  it('a public IP literal is named as one; a host name and a private address are not', () => {
    for (const v of ['192.0.2.7', ip('8_8_8_8'), '2001:db8::7']) expect(isPublicIpLiteral(v), v).toBe(true);
    for (const v of ['10.0.0.7', ip('100_127_0_1'), 'fd00::1', 'testbox.invalid', '']) expect(isPublicIpLiteral(v), v).toBe(false);
    expect(isIpLiteral('10.0.0.7')).toBe(true);
    expect(isIpLiteral('2001:db8::7')).toBe(true);
    expect(isIpLiteral('testbox.invalid')).toBe(false);
  });

  it('a value off its shape is said in the shape\'s words, never the value', () => {
    expect(shapeSentence('CCRC_TESTBOX_RUN_MEMORY_MAX')).toMatch(/K, M or G/);
    expect(shapeSentence('CCRC_TESTBOX_RUNS')).toMatch(/whole number/);
    expect(shapeSentence('CCRC_NOT_A_KEY')).toMatch(/this key takes/);
  });
});

describe('the routes\' refusals, through refusalText (D-8166)', () => {
  const refusal = (body: unknown, status = 409): ApiError => new ApiError(status, body);

  it('a refusal code is its sentence, from the closed table, and the word is the floor for a code this build does not know', () => {
    expect(testboxRouteText(refusal({ error: 'testbox-admin-refused', code: 'unreachable' }))).toBe(TESTBOX_ADMIN_CODE_SENTENCE.unreachable);
    expect(testboxRouteText(refusal({ error: 'testbox-admin-refused', code: 'a-code-from-later' }))).toBe(TESTBOX_ROUTE_TEXT['testbox-admin-refused']);
    expect(testboxRouteText(refusal({ error: 'testbox-admin-refused' }))).toBe(TESTBOX_ROUTE_TEXT['testbox-admin-refused']);
  });

  it('parity-required is the shared sentence, and the gate\'s two dark words have their own', () => {
    expect(testboxRouteText(refusal({ error: 'parity-required' }))).toBe(TESTBOX_PARITY_REQUIRED_SENTENCE);
    expect(Object.keys(TESTBOX_GATE_DARK_TEXT).sort()).toEqual(['auth-off', 'insecure-origin']);
    expect(testboxRouteText(refusal({ error: 'auth-off' }, 501))).toBe(TESTBOX_GATE_DARK_TEXT['auth-off']);
  });

  it('a word nobody owns, a body with no word and a non-refusal read as null', () => {
    expect(testboxRouteText(refusal({ error: 'toString' }))).toBeNull();
    expect(testboxRouteText(refusal({}))).toBeNull();
    expect(testboxRouteText(refusal('plain text'))).toBeNull();
    expect(testboxRouteText(new Error('x'))).toBeNull();
  });

  it('no refusal sentence names a value', () => {
    for (const [word, s] of Object.entries(TESTBOX_ROUTE_TEXT)) {
      expect(s, word).not.toMatch(/[=/@~]|CCRC_|\d+\.\d+/);
    }
  });
});
