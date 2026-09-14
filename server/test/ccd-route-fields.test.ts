import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-fields-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-a';
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`); };
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const get = (field: string): string => h.sh(`_route_get ${ID} ${field}; echo "|rc=$?"`);

describe('the routing record (routing spec 2026-09-14 §5.1)', () => {
  it('_route_any: no field → 1; any one field → 0', () => {
    seed();
    expect(h.sh(`_route_any ${ID} && echo yes || echo no`)).toBe('no');
    h.sh(`_reg_set ${ID} compact 40`);
    expect(h.sh(`_route_any ${ID} && echo yes || echo no`)).toBe('yes');
  });

  it('_route_get: absent → empty, rc 0; a vocabulary value → itself', () => {
    seed();
    expect(get('class')).toBe('|rc=0');
    // absent must NOT be treated as an unrecognised value: no journal line, no floor marker
    expect(swapLog()).toBe('');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.routenoteclass`))).toBe(false);
    h.sh(`_reg_set ${ID} class opus`);
    expect(get('class')).toBe('opus|rc=0');
  });

  it.each([
    ['class', 'fable', true], ['class', 'default', true], ['class', 'gemini', false], ['class', 'Opus', false],
    ['effort', 'ultracode', true], ['effort', 'auto', true], ['effort', 'max', true], ['effort', 'extreme', false],
    ['subagent', 'haiku', true], ['subagent', 'sonnet', true], ['subagent', 'opus', false], ['subagent', 'fable', false],
    ['workflow', 'on', true], ['workflow', 'off', true], ['workflow', 'yes', false],
    ['compact', '10', true], ['compact', '50', true], ['compact', '100', true], ['compact', '9', false], ['compact', '101', false], ['compact', '50%', false],
    ['degraded', 'opus', true], ['degraded', 'default', false],
    ['inert', 'effort,workflow', true], ['inert', 'effort', true], ['inert', 'ultracode', false], ['inert', 'effort workflow', false],
    ['colour', 'blue', false],
  ])('_route_valid %s=%s → %s', (field, value, ok) => {
    expect(h.sh(`_route_valid ${field} '${value}' && echo yes || echo no`)).toBe(ok ? 'yes' : 'no');
  });

  it('the closed-vocabulary table has a mechanism: an unknown field is refused by the default arm', () => {
    // the control for the table above — if `_route_valid`'s `*)` arm ever returned 0, every "false" row would still be red here
    expect(h.sh(`_route_valid nosuchfield anything && echo yes || echo no`)).toBe('no');
  });

  it('an unrecognised value reads as ABSENT and leaves a note naming the field and the byte count, never the bytes', () => {
    seed();
    h.sh(`_reg_set ${ID} class 'gemini'`);
    expect(get('class')).toBe('|rc=0');
    const log = swapLog();
    expect(log).toMatch(/route-reject demo-a: field class holds an unrecognised value \(6 bytes\) — treated as absent/);
    expect(log).not.toContain('gemini');
  });

  it('the count the note calls BYTES is bytes, not characters (controller ruling S1-R2)', () => {
    seed();
    // `gémini` is 6 characters and 7 bytes; `${#v}` under a UTF-8 locale would
    // say 6, and the word in the line is "bytes".
    h.sh(`_reg_set ${ID} class 'gémini'`);
    expect(get('class')).toBe('|rc=0');
    expect(swapLog()).toMatch(/field class holds an unrecognised value \(7 bytes\)/);
    expect(swapLog()).not.toContain('gémini');
  });

  it('the note is floored PER FIELD: two invalid fields read alternately write one line each per floor window', () => {
    seed();
    h.sh(`_reg_set ${ID} class gemini; _reg_set ${ID} effort extreme`);
    h.sh(`for i in 1 2 3; do _route_get ${ID} class; _route_get ${ID} effort; done`);
    expect(swapLog().match(/route-reject demo-a: field class/g)).toHaveLength(1);
    expect(swapLog().match(/route-reject demo-a: field effort/g)).toHaveLength(1);
    // the floor is time, not count: an old stamp lets that field speak again, and only that field
    h.sh(`_reg_set ${ID} routenoteclass 1; _route_get ${ID} class; _route_get ${ID} effort`);
    expect(swapLog().match(/route-reject demo-a: field class/g)).toHaveLength(2);
    expect(swapLog().match(/route-reject demo-a: field effort/g)).toHaveLength(1);
    // the floor markers are dotless registry fields, so _reg_purge reaps them with the row
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-a.routenoteclass'))).toBe(true);
    h.sh(`_reg_purge ${ID}`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-a.routenoteclass'))).toBe(false);
  });

  it('subagent is validated against the PROJECTED list; a projection that predates it is UNMEASURED, never a bad value', () => {
    seed();
    h.sh(`_reg_set ${ID} subagent sonnet`);
    expect(get('subagent')).toBe('sonnet|rc=0');
    const sh = path.join(h.home, '.ccrc', 'accounts.sh');
    fs.writeFileSync(sh, fs.readFileSync(sh, 'utf8').split('\n').filter((l) => !l.startsWith('CCRC_SUBAGENT_CLASSES=')).join('\n'));
    // THE THIRD ANSWER. rc 2 says the VOCABULARY was unavailable — this call
    // measured nothing about `sonnet`, which is a perfectly good value.
    expect(h.sh(`_route_valid subagent sonnet; echo "rc=$?"`)).toBe('rc=2');
    expect(h.sh(`_route_valid subagent nonsense; echo "rc=$?"`)).toBe('rc=2');
    // and it still FAILS CLOSED: nothing unchecked reaches an argv or a keystroke
    expect(get('subagent')).toBe('|rc=0');
    const log = swapLog();
    expect(log).toMatch(/route-unmeasured demo-a: field subagent could not be checked .*re-run ccrc install/);
    // neither the bytes NOR a count of them: a byte count is a claim about a
    // value somebody looked at, and nobody looked at this one
    expect(log).not.toMatch(/route-reject demo-a: field subagent/);
    expect(log).not.toContain('bytes');
    expect(log).not.toContain('sonnet');
    // its own floor marker, dotless so `_reg_purge` reaps it with the row
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.routeunmeassubagent`))).toBe(true);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.routenotesubagent`))).toBe(false);
  });

  it('the two refusals do not share a floor marker: each speaks once per window, whichever came first', () => {
    seed();
    h.sh(`_reg_set ${ID} subagent sonnet; _reg_set ${ID} class gemini`);
    const sh = path.join(h.home, '.ccrc', 'accounts.sh');
    fs.writeFileSync(sh, fs.readFileSync(sh, 'utf8').split('\n').filter((l) => !l.startsWith('CCRC_SUBAGENT_CLASSES=')).join('\n'));
    h.sh(`for i in 1 2 3; do _route_get ${ID} subagent; _route_get ${ID} class; done`);
    expect(swapLog().match(/route-unmeasured demo-a: field subagent/g)).toHaveLength(1);
    expect(swapLog().match(/route-reject demo-a: field class/g)).toHaveLength(1);
  });

  it('_route_peek is PURE: the same three conditions, and no journal line or floor marker for any of them (fix round 2, M2)', () => {
    seed();
    h.sh(`_reg_set ${ID} class opus`);
    expect(h.sh(`_route_peek ${ID} class; echo "|rc=$?"`)).toBe('opus|rc=0');
    h.sh(`_reg_set ${ID} class gemini`);
    expect(h.sh(`_route_peek ${ID} class; echo "|rc=$?"`)).toBe('|rc=0');
    expect(swapLog()).toBe('');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.routenoteclass`))).toBe(false);
  });

  it('_route_effort_for refuses the haiku+effort PAIR with its own note — the value was valid, the pair is not — and passes it on any other class', () => {
    seed();
    h.sh(`_reg_set ${ID} effort high`);
    expect(h.sh(`_route_effort_for ${ID} haiku; echo "|rc=$?"`)).toBe('|rc=0');
    expect(swapLog()).toMatch(/route-refuse demo-a: class haiku takes no effort level — the effort field is ignored/);
    expect(swapLog()).not.toMatch(/route-reject demo-a: field effort/);
    h.sh(`_route_effort_for ${ID} haiku`);
    expect(swapLog().match(/route-refuse demo-a/g)).toHaveLength(1);   // floored through routenotepair
    expect(h.sh(`_route_effort_for ${ID} opus`)).toBe('high');
    expect(h.sh(`_route_effort_for ${ID} ''`)).toBe('high');
  });

  it('_route_effort_for haiku+auto: auto is the absent-equivalent — no note, empty output (controller ruling S1-R5)', () => {
    seed();
    h.sh(`_reg_set ${ID} effort auto`);
    expect(h.sh(`_route_effort_for ${ID} haiku; echo "|rc=$?"`)).toBe('|rc=0');
    expect(swapLog()).toBe('');
  });

  it('ROUTE_FIELDS is the seven-field record, in the spec\'s order', () => {
    expect(h.sh('printf "%s " "${ROUTE_FIELDS[@]}"').trim()).toBe('class effort subagent workflow compact degraded inert');
  });
});
