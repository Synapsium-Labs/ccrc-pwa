// The account's organization label (plan 2026-11-16-account-organization.md Task A1, issue #2909): an optional roster
// field shaped like `pool`, set by the operator, never the organization's id (slugs `org-is-an-operator-label`,
// `org-label-refuses-id-shapes`). Both parsers decide it alike, `accounts.sh` carries it as `_ccrc_org`, and the wire
// carries it only when set.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoster, RosterError, ORG_ID_SHAPES, orgLabelVerdict, ORG_CLEAR_WORD } from '../../shared/roster.js';
import { rosterFromJson, orgLabelVerdict as mirrorVerdict } from '../../shared/roster-json.mjs';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { rosterFactsWireOf, factsChangeWidens } from '../../shared/rosterFacts.js';
import { mkTmp } from './tmpHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const rosterWith = (over: Record<string, unknown>, more: Record<string, unknown>[] = []) => ({
  version: 1,
  accounts: [
    { id: 'lane-a', label: 'lane-a', configDirSuffix: '.claude', exec: { kind: 'upstream' },
      homeAble: true, hue: 'cyan', telemetry: 'anthropic', ...over },
    ...more,
  ],
});

/** Values every reader refuses, each with the verdict the shared decider gives it. */
const REFUSED: readonly [string, unknown, 'looks-like-an-id' | 'off-shape' | 'not-a-string'][] = [
  ['a written null', null, 'not-a-string'],
  ['a number', 7, 'not-a-string'],
  ['an uppercase label', 'Org-A', 'off-shape'],
  ['a label with a shell metacharacter', 'org$(id)', 'off-shape'],
  ['a label over 32 characters', `o${'x'.repeat(32)}`, 'off-shape'],
  ['an empty label', '', 'off-shape'],
  ['the clear word', 'none', 'off-shape'],
  ['a hyphenated UUID', '0f8e2c1a-1b2c-4d3e-8f90-123456789abc', 'looks-like-an-id'],
  ['an uppercase hyphenated UUID', '0F8E2C1A-1B2C-4D3E-8F90-123456789ABC', 'looks-like-an-id'],
  ['32 hex digits starting with a letter, which the pool shape alone admits', 'abcdef0123456789abcdef0123456789', 'looks-like-an-id'],
  ['32 hex digits starting with a digit', '0123456789abcdef0123456789abcdef', 'looks-like-an-id'],
];

describe('the organization label: one verdict, in both languages', () => {
  it.each(REFUSED)('%s is refused with its own word by the decider and its mirror', (_why, v, word) => {
    const expected = word === 'not-a-string' ? undefined : word;
    if (typeof v === 'string') {
      expect(orgLabelVerdict(v)).toBe(expected);
      expect(mirrorVerdict(v)).toBe(expected);
    }
  });

  it.each(['org-a', 'org-b', 'a', 'acme-eu-2', 'abcdef0123456789abcdef012345678'])('%s is a label', (v) => {
    expect(orgLabelVerdict(v)).toBe('ok');
    expect(mirrorVerdict(v)).toBe('ok');
  });

  it('the clear word is `none`, refused as a label so the verb can read it as "clear"', () => {
    expect(ORG_CLEAR_WORD).toBe('none');
  });

  /** The mirror cannot import TypeScript, so it spells the id shapes again; held equal by text and by object. */
  it('the mirror spells ORG_ID_SHAPES exactly as shared/roster.ts does', () => {
    const shapes = (f: string): string[] => {
      const m = readFileSync(path.join(root, f), 'utf8').match(/^export const ORG_ID_SHAPES[^=]*= \[(.+)\];$/m);
      if (m === null) throw new Error(`no single-line ORG_ID_SHAPES declaration in ${f}: this scan measured nothing`);
      return m[1]!.split(/,\s*(?=\/)/).map((s) => s.trim());
    };
    expect(shapes('shared/roster-json.mjs')).toEqual(shapes('shared/roster.ts'));
    expect(shapes('shared/roster.ts')).toEqual(ORG_ID_SHAPES.map((re) => `/${re.source}/${re.flags}`));
  });
});

describe('the organization label in the roster: both parsers decide alike', () => {
  it.each(REFUSED)('%s is refused by both, naming the field', (_why, v) => {
    for (const parse of [parseRoster, rosterFromJson] as const) {
      let caught: unknown;
      try { parse(rosterWith({ org: v })); } catch (e) { caught = e; }
      expect((caught as { remedy?: string } | undefined)?.remedy, parse.name).toContain('"org"');
    }
  });

  it('parseRoster names an id-shaped value as one, with the word org-looks-like-an-id', () => {
    let caught: unknown;
    try { parseRoster(rosterWith({ org: '0123456789abcdef0123456789abcdef' })); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(RosterError);
    expect((caught as RosterError).message).toContain('org-looks-like-an-id');
  });

  it.each([
    ['an absent org', {}, null],
    ['a label', { org: 'org-a' }, 'org-a'],
  ] as const)('%s is accepted by both, with the same value', (_why, over, org) => {
    expect(parseRoster(rosterWith(over)).byId.get('lane-a')!.org).toBe(org);
    expect(rosterFromJson(rosterWith(over)).accounts[0]!.org).toBe(org);
  });
});

describe('generateAccountsSh: the organization projection', () => {
  const labelled = parseRoster(rosterWith({ org: 'org-a' }, [
    { id: 'lane-a-b', label: 'AB', configDirSuffix: '.ab', exec: { kind: 'generated' }, homeAble: true, hue: 'violet',
      telemetry: 'anthropic', org: 'org-b' },
    { id: 'lane-c', label: 'C', configDirSuffix: '.c', exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
  ]));
  const bare = parseRoster(rosterWith({}));
  const home = (body: string, prefix: string): string => {
    const h = mkTmp(prefix);
    mkdirSync(path.join(h, '.ccrc'), { recursive: true });
    writeFileSync(path.join(h, '.ccrc', 'accounts.sh'), body);
    return h;
  };
  const sh = (h: string, snippet: string): string =>
    execFileSync('bash', ['-c', `source "$HOME/.ccrc/accounts.sh"; ${snippet}`],
      { cwd: h, env: { ...process.env, HOME: h }, encoding: 'utf8' }).trim();
  const arms = (body: string): string[][] => {
    const block = body.slice(body.indexOf('_ccrc_org() {'));
    return [...block.slice(0, block.indexOf('esac')).matchAll(/^ {4}([a-z0-9-]+)\) echo ([a-z0-9-]+) ;;$/gm)]
      .map((m) => [m[1]!, m[2]!]);
  };

  it('emits _ccrc_org even with no labelled account, answering silence at rc 0', () => {
    const h = home(generateAccountsSh(bare), 'roster-org-none-');
    expect(sh(h, 'declare -F _ccrc_org >/dev/null && echo yes')).toBe('yes');
    expect(sh(h, "_ccrc_org 'lane-a' ; echo \"rc=$?\"")).toBe('rc=0');
    expect(arms(generateAccountsSh(bare))).toEqual([]);
  });

  it('emits one arm per labelled account, in byIdLengthDesc order, after _ccrc_pool', () => {
    const body = generateAccountsSh(labelled);
    expect(arms(body)).toEqual([['lane-a-b', 'org-b'], ['lane-a', 'org-a']]);
    expect(body.indexOf('_ccrc_org() {')).toBeGreaterThan(body.indexOf('_ccrc_pool() {'));
    expect(() => execFileSync('bash', ['-n'], { input: body })).not.toThrow();
    const h = home(body, 'roster-org-labelled-');
    expect(sh(h, "_ccrc_org 'lane-a'")).toBe('org-a');
    expect(sh(h, "_ccrc_org 'lane-a-b'")).toBe('org-b');
    expect(sh(h, "_ccrc_org 'lane-c' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  it('emits no arm for a value that reached the generator unvalidated', () => {
    const junk = {
      id: 'junk', label: 'Junk', configDirSuffix: '.junk', exec: { kind: 'upstream' as const }, homeAble: true,
      hue: 'cyan' as const, telemetry: 'anthropic' as const, hidden: false, pool: null, fableBilling: null, continuity: null,
      org: 'x; rm -rf y',
    };
    const idShaped = { ...junk, id: 'idshaped', org: 'abcdef0123456789abcdef0123456789' };
    const body = generateAccountsSh({
      version: 1 as const, accounts: [junk, idShaped], byId: new Map([['junk', junk], ['idshaped', idShaped]]),
      byIdLengthDesc: [idShaped, junk], homeAble: [junk, idShaped], upstreamId: 'junk',
    });
    expect(arms(body)).toEqual([]);
    expect(body).not.toContain('rm -rf');
    expect(body).not.toContain('abcdef0123456789abcdef0123456789');
  });
});

describe('the wire and the door: the label is a preference', () => {
  it('the wire carries org only when set', () => {
    const base = { fableBilling: null, continuity: null };
    expect(rosterFactsWireOf({ ...base, org: null })).toEqual({});
    expect(rosterFactsWireOf({ ...base, org: 'org-a' })).toEqual({ org: 'org-a' });
  });

  it('setting or clearing a label widens nothing, so it never takes the step-up', () => {
    expect(factsChangeWidens({ org: 'org-a' })).toBe(false);
    expect(factsChangeWidens({ org: 'none' })).toBe(false);
  });
});
