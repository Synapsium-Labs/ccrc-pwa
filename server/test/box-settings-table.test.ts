// Box settings view, wave 2, Task 3 (D12, D16, D22; D-7909, D-7914; spec 2026-10-25 section 5.1): the per-setting class table, the tools
// that read it, and its L0 mirror. `ccd/ccrc`'s `BOX_SETTINGS_TABLE` and `BOX_SETTING_VALUE_WORDS` are held equal, both ways, to
// `shared/api.ts`'s `BOX_SETTING_TABLE` and `BOX_SETTING_VALUE_WORDS` (bash cannot import them); `_set_says`' words are held equal to
// `BOX_SETTING_REFUSAL_WORDS`; `_set_check`, `_set_fits`, `_set_text` and `_set_json` are run for real in a fixture HOME, and the
// envelope's two regexes are run in bash and in JavaScript on one list. Neutral names only: this repository is public.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { ccrcSettingsNames } from './ccrcSettingsLine.js';
import {
  BOX_SETTINGS_KEYS, BOX_SETTINGS_SHOWN, BOX_SETTINGS_TEXT_MAX, BOX_SETTINGS_WHY_MAX, BOX_SETTING_FAMILIES, BOX_SETTING_ORIGIN_SHAPE,
  BOX_SETTING_REFUSAL_WORDS, BOX_SETTING_SPECS, BOX_SETTING_TABLE, BOX_SETTING_VALUE_SHAPE, BOX_SETTING_VALUE_WORDS,
  type BoxSettingName,
} from '../../shared/api.js';
import {
  ENVELOPE_CORPUS, ENVELOPE_ORIGIN_KEY, ENVELOPE_VALUE_KEY, ORIGIN_SHAPE_FITS, ORIGIN_SHAPE_MISSES, VALUE_SHAPE_FITS, VALUE_SHAPE_MISSES,
  envelopeFits,
} from './boxSettingsEnvelope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCD = path.resolve(here, '..', '..', 'ccd');
const CCRC = join(CCD, 'ccrc');
const SRC = readFileSync(CCRC, 'utf8');
const TB_SRC = readFileSync(join(CCD, 'testbox-knobs'), 'utf8');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

// ── the bash table, read as text ──────────────────────────────────────────────────────────────────────────────────────────────

const LINE = /^ {2}(CCRC_[A-Z0-9_]+):(value|origin|is-set|omit):([a-z-]+):(none|[a-z,]+):(run|update)$/;
const blockOf = (src: string, open: string): string[] => {
  const m = new RegExp(`^${open}=\\(\\n([\\s\\S]*?)\\n\\)$`, 'm').exec(src);
  return m ? m[1]!.split('\n') : [];
};
const tableLines = (src: string): string[] => blockOf(src, 'BOX_SETTINGS_TABLE');
const mirrorLines = (src: string): string[] => blockOf(src, 'BOX_SETTING_VALUE_WORDS');
interface Row { key: string; cls: string; family: string; roles: string; applies: string }
const rowsOf = (lines: readonly string[]): Row[] => lines.flatMap((l) => {
  const m = LINE.exec(l);
  return m ? [{ key: m[1]!, cls: m[2]!, family: m[3]!, roles: m[4]!, applies: m[5]! }] : [];
});
const NAMES = ccrcSettingsNames(SRC) ?? [];
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Every way the bash table departs from `CCRC_SETTINGS` and from L0, as faults listed by their text. */
function tableFaults(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const l of lines) if (!LINE.test(l)) out.push(`line does not match: ${JSON.stringify(l)}`);
  const rows = rowsOf(lines);
  if (!sameList(rows.map((r) => r.key), NAMES)) out.push('the key column is not CCRC_SETTINGS, in order');
  const l0 = BOX_SETTING_TABLE as Record<string, { cls: string; family: string; roles: readonly string[]; applies: string }>;
  if (!sameList(rows.map((r) => r.key), Object.keys(l0))) out.push('the key column is not L0 BOX_SETTING_TABLE\'s keys, in order');
  for (const r of rows) {
    const s = l0[r.key];
    if (s === undefined) continue;
    const roles = r.roles === 'none' ? [] : r.roles.split(',');
    if (s.cls !== r.cls) out.push(`${r.key}: class ${r.cls} against L0 ${s.cls}`);
    if (s.family !== r.family) out.push(`${r.key}: family ${r.family} against L0 ${s.family}`);
    if (!sameList(s.roles, roles)) out.push(`${r.key}: roles ${r.roles} against L0 ${s.roles.join(',') || 'none'}`);
    if (s.applies !== r.applies) out.push(`${r.key}: applies ${r.applies} against L0 ${s.applies}`);
  }
  return out;
}

const TB_BOX_KEYS: readonly string[] = [
  ...(/^_tb_box_table\(\) \{[\s\S]*?\n\}$/m.exec(TB_SRC)?.[0] ?? '').matchAll(/\b_ccrc_knob (CCRC_[A-Z0-9_]+)/g),
].map((m) => m[1]!);
const classOf = (k: string): string => BOX_SETTING_SPECS[k as BoxSettingName].cls;
const keysWhere = (f: (k: BoxSettingName) => boolean): string[] => (Object.keys(BOX_SETTING_TABLE) as BoxSettingName[]).filter(f);

/** (key, words) pairs from `_tb_shape`'s word-only arms, each key through `_tb_shape_class`; an omit key's pair is left out. */
function wordPairs(tb: string): string[] {
  const classBody = /^_tb_shape_class\(\) \{[\s\S]*?\n\}$/m.exec(tb)?.[0] ?? '';
  const keysOf = new Map<string, string[]>();
  for (const m of classBody.matchAll(/^\s+((?:CCRC_[A-Z0-9_]+\|?)+)\) echo (\w+) ;;$/gm)) keysOf.set(m[2]!, m[1]!.split('|'));
  const shapeBody = /^_tb_shape\(\) \{[\s\S]*?\n\}$/m.exec(tb)?.[0] ?? '';
  const out: string[] = [];
  for (const m of shapeBody.matchAll(/^\s*(\w+)\) \[ "\$v" = (\w+) \] \|\| \[ "\$v" = (\w+) \] ;;$/gm))
    for (const k of keysOf.get(m[1]!) ?? []) if (!TB_BOX_KEYS.includes(k)) out.push(`${k}:${m[2]!},${m[3]!}`);
  return out.sort();
}
/** D-8121: the browser default's (key, words) pair, from `_browser_mcp_default_ok`'s one `case` arm in ccd/ccrc. */
function browserPairs(src: string): string[] {
  const body = /^_browser_mcp_default_ok\(\) \{[\s\S]*?\n\}$/m.exec(src)?.[0] ?? '';
  const m = /case "\$1" in ([a-z]+(?:\|[a-z]+)*)\) return 0 ;;/.exec(body);
  return m ? [`CCRC_BROWSER_MCP_DEFAULT:${m[1]!.split('|').join(',')}`] : [];
}
/** D-8122: (key, words) pairs from `_mg_ok`'s word-only arms in ccd/ccrc, the memory gate's own check. */
function mgPairs(src: string): string[] {
  const body = /^_mg_ok\(\) \{[\s\S]*?\n\}$/m.exec(src)?.[0] ?? '';
  return [...body.matchAll(/^\s+(CCRC_[A-Z0-9_]+)\) case "\$2" in ([a-z|]+)\) return 0 ;; \*\) return 1 ;; esac ;;$/gm)]
    .map((m) => `${m[1]!}:${m[2]!.split('|').join(',')}`).sort();
}
/** D-8124: the admin-merge door's (key, words) pair, from `_lnd_ok`'s one word arm in ccd/ccrc. */
function lndPairs(src: string): string[] {
  const body = /^_lnd_ok\(\) \{[\s\S]*?\n\}$/m.exec(src)?.[0] ?? '';
  return [...body.matchAll(/^\s+(CCRC_[A-Z0-9_]+)\) case "\$2" in ([a-z|]+)\) return 0 ;; \*\) return 1 ;; esac ;;$/gm)]
    .map((m) => `${m[1]!}:${m[2]!.split('|').join(',')}`).sort();
}
const l0Pairs = (): string[] => Object.entries(BOX_SETTING_VALUE_WORDS).map(([k, w]) => `${k}:${(w ?? []).join(',')}`).sort();
const mirrorPairs = (src: string): string[] => mirrorLines(src).flatMap((l) => {
  const m = /^ {2}(CCRC_[A-Z_]+):([a-z,]+)$/.exec(l);
  return m ? [`${m[1]!}:${m[2]!}`] : [];
}).sort();

describe('the class table: bash equals CCRC_SETTINGS and L0 (D16, spec 5.1)', () => {
  const lines = tableLines(SRC);

  it('T1: the bash names are CCRC_SETTINGS, in order, every line well formed', () => {
    expect(NAMES, 'D-8121 adds the two browser MCP settings, D-8122 the memory gate\'s four: 89 -> 95, D-8123 the limit rescue\'s two: 97, D-8125 the review cap\'s coordinator lift: 98, D-8124 the admin-merge switch: 99, D-8165 retires the coordinator lift (always on): 98, D-8290 the live probes\' three box keys: 101').toHaveLength(101);
    expect(lines.filter((l) => !LINE.test(l)), 'lines that do not match').toEqual([]);
    expect(rowsOf(lines).map((r) => r.key)).toEqual(NAMES);
  });
  it('T2: bash equals L0, both ways: order, class, family, roles, applies', () => {
    expect(tableFaults(lines)).toEqual([]);
    expect(Object.keys(BOX_SETTING_TABLE)).toEqual(NAMES);
  });
  it('T3: counts and named members, in L0 and in the bash table', () => {
    const l0 = (c: string): string[] => keysWhere((k) => classOf(k) === c);
    const bash = (c: string): string[] => rowsOf(lines).filter((r) => r.cls === c).map((r) => r.key);
    const IS_SET = [
      'CCRC_BROWSER_MCP_SERVERS', 'CCRC_GRAPH_REPOS_EXCLUDE', 'CCRC_GRAPH_SOURCE_REF', 'CCRC_GRAPH_STORE', 'CCRC_KEEPALIVE_MODEL', 'CCRC_KEEPALIVE_PROMPT',
      'CCRC_TESTBOX_DENY_GLOBS', 'CCRC_TESTBOX_GIT_KEY', 'CCRC_TESTBOX_GIT_URL_BASE', 'CCRC_TESTBOX_TIMES', 'CCRC_TESTBOX_TOKEN_FILE',
      'CCRC_TESTBOX_URL',
    ];
    for (const of of [l0, bash]) {
      expect({ value: of('value').length, origin: of('origin').length, 'is-set': of('is-set').length, omit: of('omit').length })
        .toEqual({ value: 57, origin: 1, 'is-set': 12, omit: 31 });
      expect(of('is-set').sort()).toEqual(IS_SET);
      expect(of('is-set'), 'D19: the test box URL is is-set (the spec\'s presence, D12; D-7921)').toContain('CCRC_TESTBOX_URL');
      expect(of('origin')).toEqual(['CCRC_RELEASE_BASE_URL']);
    }
    expect(BOX_SETTINGS_SHOWN).toHaveLength(70);
    expect(rowsOf(lines).filter((r) => r.cls !== 'omit')).toHaveLength(70);
  });
  it('T4: omit is the test box\'s own table, with roles none and applies run', () => {
    expect(TB_BOX_KEYS, 'D-8290 adds the live probes\' three').toHaveLength(31);
    expect(keysWhere((k) => classOf(k) === 'omit').sort()).toEqual([...TB_BOX_KEYS].sort());
    const host = [...(/^_tb_host_table\(\) \{[\s\S]*?\n\}$/m.exec(TB_SRC)?.[0] ?? '').matchAll(/\b_ccrc_knob (CCRC_[A-Z0-9_]+)/g)].map((m) => m[1]!);
    expect(host).toHaveLength(16);
    expect(host.filter((k) => classOf(k) === 'omit'), 'no host key is omitted').toEqual([]);
    for (const k of TB_BOX_KEYS) {
      expect(BOX_SETTING_SPECS[k as BoxSettingName].roles, k).toEqual([]);
      expect(BOX_SETTING_SPECS[k as BoxSettingName].applies, k).toBe('run');
    }
  });
  it('T5: applies update is exactly the six the installer renders, in L0 and in the bash table', () => {
    const SIX = [
      'CCRC_GRAPH_BUDGET', 'CCRC_GRAPH_BUILD_TIMEOUT', 'CCRC_GRAPH_REFRESH_SECS', 'CCRC_GRAPH_SLOT_WAIT_SECS', 'CCRC_SESSION_SLICE_MEMORY_MAX',
      'CCRC_SESSION_SLICE_SWAP_MAX',
    ];
    expect(keysWhere((k) => BOX_SETTING_SPECS[k].applies === 'update').sort()).toEqual(SIX);
    expect(rowsOf(lines).filter((r) => r.applies === 'update').map((r) => r.key).sort()).toEqual(SIX);
  });
  it('T6: version 1\'s seven are the updates family, the first seven of CCRC_SETTINGS and of the shown list', () => {
    const upd = keysWhere((k) => BOX_SETTING_SPECS[k].family === 'updates');
    expect(upd).toEqual([...BOX_SETTINGS_KEYS]);
    expect(NAMES.slice(0, 7)).toEqual([...BOX_SETTINGS_KEYS]);
    expect(BOX_SETTINGS_SHOWN.slice(0, 7)).toEqual([...BOX_SETTINGS_KEYS]);
  });
  it('T7: every family has a shown row, and the family list is the families in order of first appearance', () => {
    const seen: string[] = [];
    for (const k of Object.keys(BOX_SETTING_TABLE) as BoxSettingName[]) if (!seen.includes(BOX_SETTING_SPECS[k].family)) seen.push(BOX_SETTING_SPECS[k].family);
    expect([...BOX_SETTING_FAMILIES]).toEqual(seen);
    for (const f of BOX_SETTING_FAMILIES) expect(BOX_SETTINGS_SHOWN.some((k) => BOX_SETTING_SPECS[k].family === f), f).toBe(true);
  });
  it('T8: the widened view is the table itself, not a copy', () => {
    expect(BOX_SETTING_SPECS === (BOX_SETTING_TABLE as unknown)).toBe(true);
  });

  it('T10: the value words are held equal, both ways, to L0 and to _tb_shape\'s word arms', () => {
    expect(wordPairs(TB_SRC)).toEqual(['CCRC_TESTBOX_FALLBACK_INSTALL:install,refuse', 'CCRC_TESTBOX_LOST_RUN:local,fail']);
    expect(browserPairs(SRC)).toEqual(['CCRC_BROWSER_MCP_DEFAULT:on,off']);
    expect(mgPairs(SRC)).toEqual(['CCRC_WAKE_PRESSURE_GATE:warn,critical,off']);
    expect(lndPairs(SRC)).toEqual(['CCRC_ADMIN_MERGE:auto,off']);
    const fromShape = [...wordPairs(TB_SRC), ...browserPairs(SRC), ...mgPairs(SRC), ...lndPairs(SRC)].sort();
    expect(fromShape).toEqual([
      'CCRC_ADMIN_MERGE:auto,off', 'CCRC_BROWSER_MCP_DEFAULT:on,off', 'CCRC_TESTBOX_FALLBACK_INSTALL:install,refuse', 'CCRC_TESTBOX_LOST_RUN:local,fail',
      'CCRC_WAKE_PRESSURE_GATE:warn,critical,off',
    ]);
    expect(l0Pairs()).toEqual(fromShape);
    expect(mirrorPairs(SRC)).toEqual(fromShape);
    expect(mirrorLines(SRC).filter((l) => !/^ {2}CCRC_[A-Z_]+:[a-z,]+$/.test(l))).toEqual([]);
    for (const k of Object.keys(BOX_SETTING_VALUE_WORDS)) expect(classOf(k), `${k} is a value key`).toBe('value');
  });
  it('T10 CONTROL: an added word on the shape arm, or on a mirror line, reads unequal', () => {
    const planted = TB_SRC.replace('lostrun) [ "$v" = local ] || [ "$v" = fail ] ;;', 'lostrun) [ "$v" = local ] || [ "$v" = fail ] || [ "$v" = maybe ] ;;');
    expect(planted).not.toBe(TB_SRC);
    expect(wordPairs(planted)).not.toEqual(l0Pairs());
    const mirror = SRC.replace('CCRC_TESTBOX_LOST_RUN:local,fail\n', 'CCRC_TESTBOX_LOST_RUN:local,fail,maybe\n');
    expect(mirror).not.toBe(SRC);
    expect(mirrorPairs(mirror)).not.toEqual(l0Pairs());
  });

  it('CONTROL: a planted extra line, a dropped line, two swapped lines and a class change are each seen', () => {
    expect(tableFaults(lines)).toEqual([]);
    expect(tableFaults([...lines, '  CCRC_NOT_A_SETTING:value:graph:fleet,both:run']).length).toBeGreaterThan(0);
    expect(tableFaults(lines.slice(1)).length).toBeGreaterThan(0);
    const swapped = [...lines];
    [swapped[3], swapped[4]] = [swapped[4]!, swapped[3]!];
    expect(tableFaults(swapped).length).toBeGreaterThan(0);
    const url = lines.map((l) => l.replace(/^ {2}CCRC_TESTBOX_URL:is-set:/, '  CCRC_TESTBOX_URL:origin:'));
    expect(url).not.toEqual(lines);
    expect(tableFaults(url).length).toBeGreaterThan(0);
  });
});

// ── the tools, run for real ───────────────────────────────────────────────────────────────────────────────────────────────────

const HOME = mkTmp('bst-home-');
const HIDDEN: Record<string, string> = {};
/** A copy of ccd/ with one library missing, so the verb run from it cannot load that library. */
function ccrcWithout(...names: string[]): string {
  const key = names.join('+');
  if (HIDDEN[key] === undefined) {
    const dir = join(mkTmp('bst-ccd-'), 'ccd');
    cpSync(CCD, dir, { recursive: true });
    for (const n of names) rmSync(join(dir, n));
    HIDDEN[key] = join(dir, 'ccrc');
  }
  return HIDDEN[key];
}

interface RunOpts { ccrc?: string; envFile?: string; vars?: Record<string, string> }
/** Runs `script` after sourcing ccrc and `_set_libs`, in the fixture HOME. The values reach it as exported variables, so an empty string, a tab or
 *  a quote arrives as written. stdout is returned with stderr; both are asserted clean by the callers that need it. */
function run(script: string, o: RunOpts = {}): { out: string; err: string; status: number | null } {
  const home = HOME;
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), o.envFile ?? '');
  const env = ccrcContainedEnv(home, process.env, { managers: false, curl: 'poison' });
  for (const k of Object.keys(env)) if (k.startsWith('CCRC_') && k !== 'CCRC_HERE') delete env[k];
  env['TMPDIR'] = join(home, 'tmp');
  mkdirSync(env['TMPDIR'], { recursive: true });
  Object.assign(env, o.vars ?? {});
  const r = spawnSyncGroup(BASH, ['-c', `. "$1"; _set_libs; ${script}`, 'box-settings-table', o.ccrc ?? CCRC], { env, encoding: 'utf8', input: '', timeout: 120_000 });
  return { out: r.stdout, err: r.stderr, status: r.status };
}
const US = '\u001f';
const RS = '\u001e';

describe('W: the closed set of words, and the writer\'s cut', () => {
  const keys = [...BOX_SETTINGS_SHOWN];
  let memo: [string, string, string][] | null = null;
  const said = (): [string, string, string][] => {
    if (memo === null) {
      const r = run(`for k in ${keys.join(' ')}; do w="$(_set_says "$k")"; rc=$?; printf '%s\\037%s\\037%s\\036' "$k" "$rc" "$w"; done`);
      expect(r.status, r.err).toBe(0);
      memo = r.out.split(RS).filter((x) => x !== '').map((x) => x.split(US) as [string, string, string]);
    }
    return memo;
  };

  it('W1: the words _set_says prints for the 70 are BOX_SETTING_REFUSAL_WORDS, as a set, both ways', () => {
    const said_ = said();
    expect(said_).toHaveLength(70);
    const words = new Set(said_.map(([, , w]) => w).filter((w) => w !== ''));
    expect([...words].sort()).toEqual([...BOX_SETTING_REFUSAL_WORDS].sort());
    expect(said_.filter(([, rc]) => rc === '1').map(([k]) => k).sort()).toEqual(['CCRC_KEEPALIVE_MODEL', 'CCRC_KEEPALIVE_PROMPT', 'CCRC_RELEASE_BASE_URL']);
    expect(said_.filter(([, rc]) => rc === '0')).toHaveLength(67);
    for (const [k, rc, w] of said_) expect(rc === '1' ? w : 'x', `${k}: rc 1 prints nothing`).toBe(rc === '1' ? '' : 'x');
    expect(new Set(BOX_SETTING_REFUSAL_WORDS).size, 'no duplicate').toBe(BOX_SETTING_REFUSAL_WORDS.length);
    for (const w of BOX_SETTING_REFUSAL_WORDS) {
      expect(w, w).toMatch(/^[ -~]+$/);
      expect(w.length, w).toBeLessThanOrEqual(BOX_SETTINGS_WHY_MAX);
      expect(w, w).not.toMatch(/['="$]/);
    }
  });

  it('W1b: every refusal word survives _set_text and _set_json at 240, byte for byte', () => {
    const r = run(`while IFS= read -r W; do export W; printf '%s\\037%s\\036' "$(_set_text "$W" 240)" "$(_set_json "$W" 240)"; done <<<"$WORDS"`,
      { vars: { WORDS: BOX_SETTING_REFUSAL_WORDS.join('\n') } });
    expect(r.status, r.err).toBe(0);
    const got = r.out.split(RS).filter((x) => x !== '').map((x) => x.split(US) as [string, string]);
    expect(got).toHaveLength(BOX_SETTING_REFUSAL_WORDS.length);
    got.forEach(([t, j], i) => {
      expect(t).toBe(BOX_SETTING_REFUSAL_WORDS[i]);
      expect(j).toBe(JSON.stringify(BOX_SETTING_REFUSAL_WORDS[i]));
    });
  });

  it('W2: the cuts, and the default is the L0 constant', () => {
    const r = run(`x="$(printf 'x%.0s' {1..900})"; printf '%s\\037%s\\037%s\\037%s\\037%s' "$(_set_text "$x")" "$(_set_text "$x" 240)" "$(_set_json "$x" 240)" "$(_set_json "$x")" "$BOX_SETTINGS_TEXT_MAX"`);
    expect(r.status, r.err).toBe(0);
    const [t480, t240, j240, j480, max] = r.out.split(US) as [string, string, string, string, string];
    expect(t480).toHaveLength(480);
    expect(t480.endsWith('...')).toBe(true);
    expect(t240).toHaveLength(240);
    expect(t240.endsWith('...')).toBe(true);
    expect(j240).toHaveLength(242);
    expect(j480).toHaveLength(482);
    expect(Number(max)).toBe(BOX_SETTINGS_TEXT_MAX);
    expect(/^BOX_SETTINGS_TEXT_MAX=480 /m.test(SRC)).toBe(true);
  });
});

describe('C: _set_check answers 0, 1 or 2, prints nothing, and judges the value it is given', () => {
  interface Case { key: string; value: string; rc: number; file?: string; hide?: string[]; why?: string }
  const GR_WHY = 'the graph settings check (graph-resolve) could not be loaded beside ccrc';
  const TB_WHY = 'the test box settings check (testbox-knobs) could not be loaded beside ccrc';
  const cases: Case[] = [
    { key: 'CCRC_GRAPH_BUDGET', value: '4', rc: 0 }, { key: 'CCRC_GRAPH_BUDGET', value: 'zz', rc: 1 },
    { key: 'CCRC_GRAPH_BUDGET', value: '4', rc: 2, hide: ['graph-resolve'], why: GR_WHY },
    { key: 'CCRC_TESTBOX_QUEUE_LIMIT', value: '20', rc: 0 }, { key: 'CCRC_TESTBOX_QUEUE_LIMIT', value: 'zz', rc: 1 },
    { key: 'CCRC_TESTBOX_QUEUE_LIMIT', value: '', rc: 0 },
    { key: 'CCRC_TESTBOX_QUEUE_LIMIT', value: '20', rc: 2, hide: ['testbox-knobs'], why: TB_WHY },
    // the order: the library step comes before the empty step, and the omit step before both
    { key: 'CCRC_TESTBOX_URL', value: '', rc: 2, hide: ['testbox-knobs'], why: TB_WHY },
    { key: 'CCRC_GRAPH_REPOS_EXCLUDE', value: '', rc: 2, hide: ['graph-resolve'], why: GR_WHY },
    { key: 'CCRC_TESTBOX_URL', value: '', rc: 0 }, { key: 'CCRC_GRAPH_REPOS_EXCLUDE', value: '', rc: 0 },
    { key: 'CCRC_TESTBOX_RUNS', value: '', rc: 2, why: 'CCRC_TESTBOX_RUNS has no check in this view' },
    // the empty step on the updates arm, and the file never judged
    { key: 'CCRC_BACKUP_KEEP', value: '', rc: 0, file: 'CCRC_BACKUP_KEEP=abc\n' },
    { key: 'CCRC_BACKUP_KEEP', value: '5', rc: 0, file: 'CCRC_BACKUP_KEEP=abc\n' },
    { key: 'CCRC_BACKUP_KEEP', value: 'abc', rc: 1, file: 'CCRC_BACKUP_KEEP=5\n' },
    { key: 'CCRC_TESTBOX_URL', value: 'relative', rc: 1 }, { key: 'CCRC_TESTBOX_GIT_KEY', value: 'relative/key', rc: 1 },
    { key: 'CCRC_TEST_HEAVY_SLOTS', value: '99', rc: 0 }, { key: 'CCRC_TEST_HEAVY_SLOTS', value: '100', rc: 1 },
    { key: 'CCRC_SESSION_SLICE_MEMORY_MAX', value: '24G', rc: 0 }, { key: 'CCRC_SESSION_SLICE_MEMORY_MAX', value: '90', rc: 1 },
    { key: 'CCRC_SESSION_SLICE_SWAP_MAX', value: '0', rc: 0 },
    { key: 'CCRC_KEEPALIVE_FRESH', value: '1800', rc: 0 }, { key: 'CCRC_KEEPALIVE_FRESH', value: '30m', rc: 1 },
    { key: 'CCRC_KEEPALIVE_FRESH', value: '99999999999999999999', rc: 1 }, { key: 'CCRC_KEEPALIVE_MODEL', value: 'anything', rc: 0 },
    { key: 'CCRC_USAGE_SWEEP_DAYS', value: '0', rc: 1 }, { key: 'CCRC_CARRY_COPY_WARN_BYTES', value: '10G', rc: 1 },
    { key: 'CCRC_BACKUP_KEEP', value: '5', rc: 0 }, { key: 'CCRC_BACKUP_KEEP', value: 'abc', rc: 1 },
    { key: 'CCRC_BACKUP_DATA_KEEP', value: '1', rc: 1 }, { key: 'CCRC_BACKUP_DATA_KEEP', value: '2', rc: 0 },
    { key: 'CCRC_VERSIONS_KEEP', value: '3', rc: 0 },
    { key: 'CCRC_UPDATE_HEALTH_S', value: 'ninety', rc: 1 }, { key: 'CCRC_UPDATE_HEALTH_S', value: '90', rc: 0 },
    { key: 'CCRC_UPDATE_DEADLINE_MS', value: '6e5', rc: 1 }, { key: 'CCRC_UPDATE_DEADLINE_MS', value: '600000', rc: 0 },
    { key: 'CCRC_MODELS_ADVANCE_BUDGET_S', value: '250', rc: 0 }, { key: 'CCRC_MODELS_ADVANCE_BUDGET_S', value: '3601', rc: 1 },
    { key: 'CCRC_MODELS_ADVANCE_BUDGET_S', value: 'off', rc: 1 }, { key: 'CCRC_RELEASE_BASE_URL', value: 'ftp://x', rc: 0 },
    { key: 'CCRC_TESTBOX_RUNS', value: '4', rc: 2 }, { key: 'CCRC_NOT_A_SETTING', value: '1', rc: 2, why: 'CCRC_NOT_A_SETTING has no check in this view' },
  ];
  it.each(cases.map((c, i) => [`${c.key}=${JSON.stringify(c.value)}${c.hide ? ` without ${c.hide.join('+')}` : ''}${c.file ? ' (a different value in ccrc.env)' : ''} -> ${c.rc}`, c, i] as const))(
    '%s', (_t, c) => {
      const file = c.file ?? `${c.key}=zz-file\n`;
      const r = run('o="$(_set_check "$K" "$V" 2>&1)"; _set_check "$K" "$V" >/dev/null 2>&1; rc=$?; printf "%s\\037%s\\037%s" "$rc" "${SET_CHECK_WHY:-}" "$o"', {
        ccrc: c.hide ? ccrcWithout(...c.hide) : CCRC, envFile: file, vars: { K: c.key, V: c.value },
      });
      expect(r.status, r.err).toBe(0);
      const [rc, why, printed] = r.out.split(US) as [string, string, string];
      expect({ rc: Number(rc), printed }).toEqual({ rc: c.rc, printed: '' });
      if (c.why !== undefined) expect(why).toBe(c.why);
    });

  // review 1487: an updates key with no resolver arm used to pass (`*) return 0`), so a key added to the table without an arm read
  // `ok`. The arm now answers 2, and the fixed "could not be checked by its resolver" sentence reaches the caller. The table is not
  // edited: the row replaces `_set_spec` in the fixture shell, for one key the table does not hold, so the family is `updates`
  // and no arm names the key.
  it('an updates key no resolver arm names is not checked: rc 2 and the resolver sentence, never a pass (review 1487)', () => {
    const r = run('_set_spec() { SET_CLASS=value; SET_FAMILY=updates; SET_ROLES=fleet; SET_APPLIES=run; return 0; }; _set_check CCRC_PLANTED_UPDATES_KEY 5 >/dev/null 2>&1; rc=$?; printf "%s\\037%s" "$rc" "${SET_CHECK_WHY:-}"', { envFile: '' });
    expect(r.status, r.err).toBe(0);
    expect(r.out.split(US)).toEqual(['2', 'CCRC_PLANTED_UPDATES_KEY could not be checked by its resolver']);
  });

  it('the updates arm\'s default case answers 2 in the source, never 0 (the harness row above is the behaviour)', () => {
    const m = /^ {6}\(\n {8}BOX_ENV_FILE="\$BOX_ENV_FILE\/\."\n {8}case "\$k" in\n([\s\S]*?)\n {8}esac\n {6}\) >\/dev\/null 2>&1$/m.exec(/^_set_check\(\) \{[\s\S]*?\n\}$/m.exec(SRC)?.[0] ?? '');
    expect((m?.[1] ?? '').split('\n').at(-1)).toBe('          *) return 2 ;;');
  });

  it('the mask is a source row: one mask assignment in _set_check, the first statement of the one subshell that holds all six resolver calls', () => {
    const body = /^_set_check\(\) \{[\s\S]*?\n\}$/m.exec(SRC)?.[0] ?? '';
    expect(body.match(/BOX_ENV_FILE="\$BOX_ENV_FILE\/\."/g), 'exactly one mask').toHaveLength(1);
    const m = /^ {6}\(\n {8}BOX_ENV_FILE="\$BOX_ENV_FILE\/\."\n {8}case "\$k" in\n([\s\S]*?)\n {8}esac\n {6}\) >\/dev\/null 2>&1$/m.exec(body);
    expect(m, 'the mask is the first statement of the subshell, ahead of its case, which is redirected').not.toBeNull();
    const calls = (m?.[1] ?? '').split('\n').filter((l) => /^ {10}CCRC_[A-Z_]+\) CCRC_[A-Z_]+="\$v" _[a-z_]+ ;;$/.test(l));
    expect(calls.map((l) => l.trim().split(' ').at(-2))).toEqual(['_bak_keep', '_bak_data_keep', '_ver_keep', '_upd_health_s', '_upd_deadline_ms', '_models_budget']);
  });
});

describe('E: the envelope, in bash and in JavaScript', () => {
  it('E-bytes: the two shapes are the bash literals byte for byte', () => {
    expect(/^BOX_SETTING_VALUE_SHAPE='([^']*)'$/m.exec(SRC)?.[1]).toBe(BOX_SETTING_VALUE_SHAPE);
    expect(/^BOX_SETTING_ORIGIN_SHAPE='([^']*)'$/m.exec(SRC)?.[1]).toBe(BOX_SETTING_ORIGIN_SHAPE);
    for (const s of [BOX_SETTING_VALUE_SHAPE, BOX_SETTING_ORIGIN_SHAPE]) expect(s, 'no construct bash and RegExp read differently').not.toMatch(/\(\?|\\d|[A-Za-z0-9]-[A-Za-z0-9]/);
  });

  // The list rides in as one newline-separated variable (no value below holds a newline), split by the loop.
  const bashAnswers = (shape: 'VALUE' | 'ORIGIN', values: readonly string[]): boolean[] => {
    const r = run(`while IFS= read -r V; do [[ "$V" =~ $BOX_SETTING_${shape}_SHAPE ]] && printf 1 || printf 0; done <<<"$LIST"`, { vars: { LIST: values.join('\n') } });
    expect(r.status, r.err).toBe(0);
    return [...r.out].map((c) => c === '1');
  };

  it('E1: bash [[ =~ ]] and RegExp give one answer on every string, and the answers are the expected ones', () => {
    const v = [...VALUE_SHAPE_FITS, ...VALUE_SHAPE_MISSES];
    expect(bashAnswers('VALUE', v)).toEqual(v.map((s) => new RegExp(BOX_SETTING_VALUE_SHAPE).test(s)));
    expect(v.map((s) => new RegExp(BOX_SETTING_VALUE_SHAPE).test(s))).toEqual([...VALUE_SHAPE_FITS.map(() => true), ...VALUE_SHAPE_MISSES.map(() => false)]);
    const o = [...ORIGIN_SHAPE_FITS, ...ORIGIN_SHAPE_MISSES];
    expect(bashAnswers('ORIGIN', o)).toEqual(o.map((s) => new RegExp(BOX_SETTING_ORIGIN_SHAPE).test(s)));
    expect(o.map((s) => new RegExp(BOX_SETTING_ORIGIN_SHAPE).test(s))).toEqual([...ORIGIN_SHAPE_FITS.map(() => true), ...ORIGIN_SHAPE_MISSES.map(() => false)]);
  });

  it('E2: _set_fits and the server\'s check composed from L0 agree on the whole differential corpus', () => {
    expect(ENVELOPE_CORPUS.length).toBeGreaterThan(40);
    const r = run(`while IFS= read -r line; do k="\${line%%|*}"; c="\${line#*|}"; v="\${c#*|}"; c="\${c%%|*}"; _set_fits "$k" "$c" "$v" && printf 1 || printf 0; done <<<"$LIST"`,
      { vars: { LIST: ENVELOPE_CORPUS.map((e) => `${e.key}|${BOX_SETTING_SPECS[e.key].cls}|${e.value}`).join('\n') } });
    expect(r.status, r.err).toBe(0);
    const bash = [...r.out].map((c) => c === '1');
    expect(bash).toHaveLength(ENVELOPE_CORPUS.length);
    expect(bash).toEqual(ENVELOPE_CORPUS.map((e) => envelopeFits(e.key, e.value)));
    const fits = (k: string, v: string): boolean => envelopeFits(k as BoxSettingName, v);
    expect(fits('CCRC_TESTBOX_LOST_RUN', 'local')).toBe(true);
    expect(fits('CCRC_TESTBOX_FALLBACK_INSTALL', 'local'), 'a word is admitted only on its own key').toBe(false);
    expect(fits('CCRC_TESTBOX_LOST_RUN', 'zz')).toBe(false);
    expect(fits(ENVELOPE_ORIGIN_KEY, 'custom https://')).toBe(false);
    expect(fits(ENVELOPE_VALUE_KEY, '1'.repeat(481))).toBe(false);
    expect(ENVELOPE_CORPUS.filter((e) => Buffer.byteLength(e.value) === 480 && e.key === ENVELOPE_ORIGIN_KEY).every((e) => fits(e.key, e.value))).toBe(true);
  });

  it('E3: every default of a value-class key, and the origin\'s default, fits _set_fits', () => {
    const defaults = new Map<string, string>();
    for (const src of [SRC, TB_SRC])
      for (const m of src.matchAll(/\b(?:_ccrc_knob|_keep_knob) (CCRC_[A-Z0-9_]+) ('[^']*'|"[^"]*"|[^\s;&|)]+)/g)) defaults.set(m[1]!, m[2]!.replace(/^['"]|['"]$/g, ''));
    const valueKeys = keysWhere((k) => classOf(k) === 'value').filter((k) => defaults.has(k));
    expect(valueKeys.length, 'the census\' extractor reaches most of the value keys').toBeGreaterThan(20);
    const r = run(`while IFS= read -r line; do k="\${line%%|*}"; v="\${line#*|}"; _set_fits "$k" value "$v" || printf "%s," "$k"; done <<<"$LIST"; _set_fits CCRC_RELEASE_BASE_URL origin default && printf ok`,
      { vars: { LIST: valueKeys.map((k) => `${k}|${defaults.get(k)!}`).join('\n') } });
    expect(r.status, r.err).toBe(0);
    expect(r.out, 'no default is refused, and the origin\'s default fits').toBe('ok');
  });
});
