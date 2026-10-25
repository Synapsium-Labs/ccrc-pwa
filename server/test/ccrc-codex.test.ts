// `ccd/ccrc`'s Codex lane library (Plan 2b-2) — what every `ccrc codex` verb,
// the `ccrc-codex` launcher and the install spine read a lane THROUGH. This
// file owns what the library ANSWERS; the verbs that act on those answers are
// in ccrc-codex-lifecycle.test.ts and ccrc-codex-bridge.test.ts (D-6878).
//
// ── HOW IT IS CONTAINED ───────────────────────────────────────────────────
//  1. HOME is a `mkTmp` directory. ccrc is SOURCED from `<home>/ccrc/ccd/ccrc`
//     — the `BASH_SOURCE` guard at the file's foot exists for this, and
//     `ccrc-account.test.ts`'s `sourceCall` is the idiom — so `CCRC_HERE`
//     resolves `../deploy/models-op.mjs` and `ccrc-wrapper-shape` the way a
//     deployed box does.
//  2. `plantSystemd` writes a FUNCTIONAL fake `systemctl` and a recording
//     `systemd-run` into `<home>/.local/bin` BEFORE `ghContainedEnv(…,
//     {systemd:true})` runs, so its create-if-absent poisons never displace
//     them and nothing here reaches this box's user manager, on which live
//     `ccgpt-*` units run.
//  3. Every listener binds 127.0.0.1 on a port the kernel chose. No case names
//     a fixed port.
//  4. `curl` is poisoned and asserted untouched: the library speaks HTTP over
//     bash's own `/dev/tcp`, because the ccrc install/doctor harnesses poison
//     curl and a probe that needed it would read every lane as unmeasurable.
//  5. This file is NOT in `ccd-workspaces.test.ts`'s name-triggered
//     containment scan (it selects /^ccd.*\.ts$/); the poisons are here
//     because they are right, not because a scanner demands them.
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnPy } from './ccgptHarness.js';
import { describeLinux, IS_DARWIN } from './platformFixtures.js';
import {
  codexAuthDir, codexRoster, eventually, fakeLitellmSource, fakeUnit, freePorts, LISTENER_PY, plantCodexBins, plantFakeRuntime,
  portAccepts, spawnListener, systemctlCalls, trackChild,
} from './codexLaneFixture.js';
import {
  installCcrcCodexHooks, REPO, BASH, PY, KEY_FILE, EXTERNAL_CODEX_TELEMETRY, env, box, type Result, lib, ccrc,
  type Ports, twoLanes, laneDir, laneJson, litellmYaml, sha256, litellmCode, authLib,
} from './ccrcCodexFixture.js';

installCcrcCodexHooks();

describe('_codex_row — one codex lane, read from accounts.json by exec.kind', () => {
  it('sets the six CX_ fields from the row, and says nothing', async () => {
    const h = box('ccrc-codex-row-');
    const p = await twoLanes(h);
    const r = lib(h, '_codex_row codex-a && printf "%s|%s|%s|%s|%s|%s\\n" '
      + '"$CX_ID" "$CX_KIND" "$CX_CFG" "$CX_AUTH" "$CX_PROXY" "$CX_LITELLM"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`codex-a|codex|.claude-codex-a|${codexAuthDir('codex-a')}|`
      + `${p['codex-a']!.proxyPort}|${p['codex-a']!.litellmPort}\n`);
    expect(r.stderr).toBe('');
  });

  it('an id the roster lacks is not-rostered, and a refusal empties every CX_ field', async () => {
    const h = box('ccrc-codex-row-absent-');
    await twoLanes(h);
    const r = lib(h, '_codex_row codex-a >/dev/null; _codex_row codex-z; rc=$?; '
      + 'printf "%s|%s|%s|%s\\n" "$rc" "$CX_ID" "$CX_PROXY" "$CX_AUTH"');
    expect(r.stdout).toBe('1|||\n');
    expect(r.stderr).toMatch(/^ccrc codex: not-rostered: account 'codex-z' /m);
  });

  it('an external lane whose telemetry says codex is not-codex — exec.kind decides, never telemetry', async () => {
    const h = box('ccrc-codex-row-external-');
    await twoLanes(h);
    const r = lib(h, '_codex_row ext-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: not-codex: account 'ext-a' is exec\.kind "external"/m);
  });

  it('a malformed id is refused as usage, at rc 2, before any path is built from it', async () => {
    // rc 2 and not 1: `ccrc codex` exits 2 on a usage refusal and 1 on every
    // other one (the ccrc header's exit-code rule), and it can only do that if
    // the library keeps the two apart. The not-rostered case above pins the 1.
    const h = box('ccrc-codex-row-badid-');
    await twoLanes(h);
    const r = lib(h, "_codex_row '../codex-a'");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
  });

  it('an unreadable roster is roster-invalid, never not-rostered', async () => {
    const h = box('ccrc-codex-row-broken-');
    await twoLanes(h);
    fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), '{not json');
    const r = lib(h, '_codex_row codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    expect(r.stderr).not.toMatch(/not-rostered/);
  });

  it('a box whose ccrc-wrapper-shape is missing is install-incomplete — a refusal, not an unbound-variable crash', async () => {
    const h = box('ccrc-codex-row-noshape-');
    await twoLanes(h);
    fs.rmSync(join(h, 'ccrc', 'ccd', 'ccrc-wrapper-shape'));
    const r = lib(h, '_codex_row codex-a; echo "rc=$?"');
    expect(r.stdout).toBe('rc=1\n');
    expect(r.stderr).toMatch(/^ccrc codex: install-incomplete: /m);
    expect(r.stderr).not.toMatch(/unbound variable/);
  });

  it('a hand-edited row whose two ports are one is roster-invalid', async () => {
    const h = box('ccrc-codex-row-oneport-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
    const a = j.accounts.find((x) => x.id === 'codex-a')!;
    a.exec['litellmPort'] = a.exec['proxyPort'];
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*exec\.proxyPort\/exec\.litellmPort/m);
  });

  it.each([
    ['a relative escape', '../x'],
    ['an absolute path', '/abs'],
    ['empty', ''],
    // Final-review fix wave, D1: `shared/roster.ts`'s `parseAuthDir`, rule
    // for rule — `ccrc codex login` writes the credential into this path, and
    // `ccrc uninstall --purge` empties ~/.ccrc.
    ['~/.ccrc itself', '.ccrc'],
    ['under ~/.ccrc', '.ccrc/tok'],
    ['ending in a separator', '.codex-a/'],
    ['outside the safe charset', 'a b/$(x)'],
    ['a bare dot', '.'],
    ['led by ./', './x'],
    ['carrying /./', 'a/./b'],
  ])('a hand-edited row whose exec.authDir is %s is roster-invalid, and CX_AUTH is emptied', async (_what, authDir) => {
    const h = box('ccrc-codex-row-authdir-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
    const a = j.accounts.find((x) => x.id === 'codex-a')!;
    a.exec['authDir'] = authDir;
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a; rc=$?; printf "%s|%s\\n" "$rc" "$CX_AUTH"');
    expect(r.stdout).toBe('1|\n');
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*exec\.authDir/m);
  });

  it('an exec.authDir that only BEGINS like ~/.ccrc — a sibling such as .ccrc-backups — is a legal row, as the roster validator reads it (D1\'s control)', async () => {
    const h = box('ccrc-codex-row-authdir-sibling-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
    j.accounts.find((x) => x.id === 'codex-a')!.exec['authDir'] = '.ccrc-backups/codex-a';
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a; rc=$?; printf "%s|%s\\n" "$rc" "$CX_AUTH"');
    expect(r.stdout, r.stderr).toBe('0|.ccrc-backups/codex-a\n');
  });

  it('a hand-edited row whose configDirSuffix escapes is roster-invalid, and CX_CFG is emptied', async () => {
    const h = box('ccrc-codex-row-cfgsuffix-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<Record<string, unknown>> };
    const a = j.accounts.find((x) => x['id'] === 'codex-a')!;
    a['configDirSuffix'] = '../../etc';
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a; rc=$?; printf "%s|%s\\n" "$rc" "$CX_CFG"');
    expect(r.stdout).toBe('1|\n');
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*configDirSuffix/m);
  });

  it('a roster naming an account more than once is roster-invalid, never its first row silently', async () => {
    const h = box('ccrc-codex-row-duplicate-');
    await twoLanes(h);
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<Record<string, unknown>> };
    const a = j.accounts.find((x) => x['id'] === 'codex-a')!;
    j.accounts.push({ ...a });
    fs.writeFileSync(f, JSON.stringify(j));
    const r = lib(h, '_codex_row codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: .*more than once/m);
  });
});

describe('_codex_lanes — the codex lanes, by exec.kind', () => {
  it('lists every exec.kind codex row in roster order and never a telemetry:codex external row', async () => {
    const h = box('ccrc-codex-lanes-');
    await twoLanes(h);
    const r = lib(h, '_codex_lanes');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('codex-a\ncodex-b\n');
    // CONTROL — the telemetry-keyed list disagrees in BOTH directions on this
    // roster, so a `_codex_lanes` that read it would red above, whichever way.
    const t = lib(h, '. "$HOME/.ccrc/accounts.sh"; printf "%s\\n" "${CCRC_CODEX_BACKEND[@]}"');
    expect(t.stdout).toBe('codex-a\next-a\n');
  });

  it('a roster with no codex lane prints nothing, at rc 0', async () => {
    const h = box('ccrc-codex-lanes-none-');
    codexRoster(h, [], [EXTERNAL_CODEX_TELEMETRY]);
    const r = lib(h, '_codex_lanes; echo "rc=$?"');
    expect(r.stdout).toBe('rc=0\n');
    expect(r.stderr).toBe('');
  });

  it('a roster it cannot read answers rc 1 and prints no id — "none" and "unreadable" are two answers', async () => {
    const h = box('ccrc-codex-lanes-broken-');
    await twoLanes(h);
    fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), '[]');
    const r = lib(h, '_codex_lanes; echo "rc=$?"');
    expect(r.stdout).toBe('rc=1\n');
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
  });

  // Final-review fix wave, C2: the install spine probes node and systemctl
  // by name, never jq, so a jq that cannot run must not read as a bad
  // roster there — its own rc and its own word, over a VALID roster.
  it('no jq on PATH answers rc 2, missing-dependency, and never roster-invalid — over a roster that is valid (review C2)', async () => {
    const h = box('ccrc-codex-lanes-nojq-');
    await twoLanes(h);
    const r = lib(h, 'PATH=/nonexistent-ccrc-path; _codex_lanes; echo "rc=$?"');
    expect(r.stdout).toBe('rc=2\n');
    expect(r.stderr).toMatch(/^ccrc codex: missing-dependency: jq is not on PATH/m);
    expect(r.stderr).not.toMatch(/roster-invalid/);
  });
});

describe('_codex_tier_port — the ONE tier -> port mapping (final-review fix wave)', () => {
  it('answers each tier\'s port from the row, and rc 1 with nothing for a tier word it does not know or a row not read', async () => {
    const h = box('ccrc-codex-tier-port-');
    const p = await twoLanes(h);
    const r = lib(h, '_codex_row codex-a; for t in litellm shim proxy ""; do '
      + 'x="$(_codex_tier_port "$t")"; printf "%s=%s|%s\\n" "${t:-empty}" "$?" "$x"; done; '
      + 'CX_LITELLM=""; x="$(_codex_tier_port litellm)"; printf "unread=%s|%s\\n" "$?" "$x"');
    expect(r.stdout).toBe([
      `litellm=0|${p['codex-a']!.litellmPort}`, `shim=0|${p['codex-a']!.proxyPort}`,
      'proxy=1|', 'empty=1|', 'unread=1|', '',
    ].join('\n'));
  });

  // A literal-absence pin, honest by its own terms: a hand-written copy of
  // the mapping in either spelling the four old sites used reds it.
  it('ccd/ccrc spells the mapping nowhere else — no port assignment reads CX_LITELLM or CX_PROXY by a tier test', () => {
    const src = fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(src).not.toMatch(/port="\$CX_(LITELLM|PROXY)"/);
    const uses = src.split('\n').filter((l) => /_codex_tier_port "\$tier"/.test(l) && !/^\s*#/.test(l));
    expect(uses.length, uses.join('\n')).toBeGreaterThanOrEqual(4);
  });
});

describe('_codex_lane_json_ensure — lane.json equals the roster, written only by models-op', () => {
  async function initialised(prefix: string): Promise<{ h: string; p: Ports }> {
    const h = box(prefix);
    const p = await twoLanes(h);
    const init = ccrc(h, ['models', 'codex-a', 'init', 'codex']);
    expect(init.code, init.stderr).toBe(0);
    return { h, p };
  }

  it('a current lane.json is left alone — no materialise: same inode, same mtime', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-current-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    const before = fs.statSync(f);
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    const after = fs.statSync(f);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('an absent lane.json is materialised from the roster', async () => {
    const { h, p } = await initialised('ccrc-codex-lanejson-absent-');
    fs.rmSync(join(laneDir(h, 'codex-a'), 'lane.json'));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('absent\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(laneJson(h, 'codex-a')).toMatchObject({
      id: 'codex-a', configDir: '.claude-codex-a', authDir: codexAuthDir('codex-a'),
      proxyPort: p['codex-a']!.proxyPort, litellmPort: p['codex-a']!.litellmPort,
    });
  });

  // ONE FIELD AT A TIME, and the reason is measured: a case that moved both
  // ports at once stayed green with the proxyPort comparison deleted, because
  // the litellmPort one caught it.
  it.each([
    ['exec.proxyPort', 'proxyPort'],
    ['exec.litellmPort', 'litellmPort'],
    ['exec.authDir', 'authDir'],
    ['configDirSuffix', 'configDir'],
  ] as const)('a lane.json whose %s the roster no longer names is stale, and re-materialised', async (field, key) => {
    const { h } = await initialised('ccrc-codex-lanejson-field-');
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<Record<string, unknown>> };
    const row = j.accounts.find((x) => x['id'] === 'codex-a')!;
    const exec = row['exec'] as Record<string, unknown>;
    let want: unknown;
    if (field === 'exec.authDir') want = exec['authDir'] = `${codexAuthDir('codex-a')}-moved`;
    else if (field === 'configDirSuffix') want = row['configDirSuffix'] = '.claude-codex-a-moved';
    else {
      const taken = new Set([exec['proxyPort'], exec['litellmPort']]);
      let port = (await freePorts(1))[0]!;
      while (taken.has(port)) port = (await freePorts(1))[0]!;
      want = exec[key] = port;
    }
    fs.writeFileSync(f, JSON.stringify(j));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(laneJson(h, 'codex-a')[key]).toBe(want);
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
  });

  it('a lane.json naming another lane is stale, and re-materialised as this one', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-id-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    fs.writeFileSync(f, JSON.stringify({ ...laneJson(h, 'codex-a'), id: 'codex-b' }));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    expect(lib(h, '_codex_lane_json_ensure codex-a').code).toBe(0);
    expect(laneJson(h, 'codex-a')['id']).toBe('codex-a');
  });

  it('a lane.json without its units is stale, and re-materialising restores them', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-units-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    const j = laneJson(h, 'codex-a');
    const units = j['units'];
    delete j['units'];
    fs.writeFileSync(f, JSON.stringify(j));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    expect(lib(h, '_codex_lane_json_ensure codex-a').code).toBe(0);
    expect(laneJson(h, 'codex-a')['units']).toEqual(units);
  });

  // codex-bridge Stage 2, Task 10: `bridge`, `upstream` and `bridgeFiles` are
  // checked for PRESENCE, as `units` is, so a lane.json rendered before the
  // bridge existed reads stale and the one writer re-renders it. One key at a
  // time, for the reason the field case above measured.
  it.each([
    ['bridge', (j: Record<string, unknown>): void => { delete j['bridge']; }],
    ['upstream', (j: Record<string, unknown>): void => { delete j['upstream']; }],
    ['bridgeFiles', (j: Record<string, unknown>): void => { delete j['bridgeFiles']; }],
    ['bridgeFiles.store', (j: Record<string, unknown>): void => { delete (j['bridgeFiles'] as Record<string, unknown>)['store']; }],
    ['bridgeFiles.stats', (j: Record<string, unknown>): void => { delete (j['bridgeFiles'] as Record<string, unknown>)['stats']; }],
    ['bridgeFiles.recordings', (j: Record<string, unknown>): void => { delete (j['bridgeFiles'] as Record<string, unknown>)['recordings']; }],
    ['an empty-string bridgeFiles.store', (j: Record<string, unknown>): void => { (j['bridgeFiles'] as Record<string, unknown>)['store'] = ''; }],
    ['a non-string bridge', (j: Record<string, unknown>): void => { j['bridge'] = 1; }],
    ['a non-string upstream', (j: Record<string, unknown>): void => { j['upstream'] = 1; }],
    ['a non-string bridgeFiles.stats', (j: Record<string, unknown>): void => { (j['bridgeFiles'] as Record<string, unknown>)['stats'] = ['bridge.stats.json']; }],
    ['a bridgeFiles that is not an object', (j: Record<string, unknown>): void => { j['bridgeFiles'] = 'bridge.stats.json'; }],
  ] as const)('an older lane.json with no bridge reads stale and is re-rendered (%s)', async (_what, edit) => {
    const { h } = await initialised('ccrc-codex-lanejson-bridge-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    const rendered = laneJson(h, 'codex-a');
    const j = JSON.parse(JSON.stringify(rendered)) as Record<string, unknown>;
    edit(j);
    fs.writeFileSync(f, JSON.stringify(j));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(laneJson(h, 'codex-a')).toEqual(rendered);
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
  });

  // The state reader reads lane.json as ONE document, as `_codex_lane_word`
  // and the bridge's single `json.loads` do: `jq -e` alone takes its rc from
  // the last document, so a file whose last document matched would read
  // `current` and the launch path would never re-render it.
  it.each([
    ['two documents, the last current', (cur: string): string => `${JSON.stringify({ id: 'codex-b' })}\n${cur}\n`],
    ['the current document twice', (cur: string): string => `${cur}\n${cur}\n`],
  ] as const)('a lane.json of more than one document reads stale and is re-rendered (%s)', async (_what, body) => {
    const { h } = await initialised('ccrc-codex-lanejson-multidoc-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    const rendered = laneJson(h, 'codex-a');
    fs.writeFileSync(f, body(JSON.stringify(rendered)));
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('stale\n');
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(laneJson(h, 'codex-a')).toEqual(rendered);
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
  });

  it('a freshly rendered lane.json carries the three keys and reads current', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-bridge-current-');
    expect(laneJson(h, 'codex-a')).toMatchObject({
      bridge: 'litellm', upstream: 'backend',
      bridgeFiles: { stats: 'bridge.stats.json', store: 'reasoning.sqlite', recordings: 'recordings' },
    });
    expect(lib(h, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
  });

  it('a lane with no class registry is no-registry, names init, and writes nothing', async () => {
    const h = box('ccrc-codex-lanejson-noreg-');
    await twoLanes(h);
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: no-registry: .*'ccrc models codex-a init codex'/m);
    expect(fs.existsSync(laneDir(h, 'codex-a'))).toBe(false);
  });

  it('a lane.json the materialiser cannot replace is lane-unwritable, carrying models-op\'s own reason', async () => {
    const { h } = await initialised('ccrc-codex-lanejson-dir-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    fs.rmSync(f);
    fs.mkdirSync(join(f, 'occupied'), { recursive: true });
    const r = lib(h, '_codex_lane_json_ensure codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: lane-unwritable: .*materialise-failed/m);
  });

  it('an external lane is not-codex before models-op is ever asked', async () => {
    const h = box('ccrc-codex-lanejson-external-');
    await twoLanes(h);
    const r = lib(h, '_codex_lane_json_ensure ext-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: not-codex: /m);
    expect(fs.existsSync(laneDir(h, 'ext-a'))).toBe(false);
  });

  it('a malformed id is usage at rc 2 through lane.json\'s state and its ensure too — the row\'s rc is passed on, never folded to 1', async () => {
    const h = box('ccrc-codex-lanejson-badid-');
    await twoLanes(h);
    const r = lib(h, '_codex_lane_json_state ../codex-a; a=$?; _codex_lane_json_ensure ../codex-a; echo "state=$a ensure=$?"');
    expect(r.stdout).toBe('state=2 ensure=2\n');
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(fs.existsSync(join(h, '.ccrc', 'codex'))).toBe(false);
  });
});

// codex-bridge Stage 2, Task 10 (spec D20): the ONE bash reader of a lane's mode, and its twin for the route. Each
// reads the RENDERED lane.json, never the roster, and answers a word or refuses: rc 1 with its own code, never a default.
describe('_codex_lane_mode and _codex_lane_upstream — the lane\'s words, read from lane.json only', () => {
  async function rendered(prefix: string): Promise<string> {
    const h = box(prefix);
    await twoLanes(h);
    const init = ccrc(h, ['models', 'codex-a', 'init', 'codex']);
    expect(init.code, init.stderr).toBe(0);
    return h;
  }
  const rewrite = (h: string, edit: (j: Record<string, unknown>) => void): void => {
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    const j = laneJson(h, 'codex-a');
    edit(j);
    fs.writeFileSync(f, JSON.stringify(j));
  };
  const ask = (h: string): Result =>
    lib(h, 'm="$(_codex_lane_mode codex-a)"; a=$?; u="$(_codex_lane_upstream codex-a)"; b=$?; '
      + 'printf "mode=%s|%s upstream=%s|%s\\n" "$a" "$m" "$b" "$u"');

  it('_codex_lane_mode reads lane.json, and refuses an absent or unknown word', async () => {
    const h = await rendered('ccrc-codex-lanemode-');
    expect(ask(h).stdout).toBe('mode=0|litellm upstream=0|backend\n');
    rewrite(h, (j) => { j['bridge'] = 'direct'; j['upstream'] = 'siwc'; });
    expect(ask(h).stdout).toBe('mode=0|direct upstream=0|siwc\n');
    for (const [what, edit] of [
      ['absent', (j: Record<string, unknown>): void => { delete j['bridge']; delete j['upstream']; }],
      ['unknown', (j: Record<string, unknown>): void => { j['bridge'] = 'proxy'; j['upstream'] = 'chatgpt'; }],
      ['null', (j: Record<string, unknown>): void => { j['bridge'] = null; j['upstream'] = null; }],
      ['a number', (j: Record<string, unknown>): void => { j['bridge'] = 1; j['upstream'] = 1; }],
      ['a word with a trailing newline', (j: Record<string, unknown>): void => { j['bridge'] = 'direct\n'; j['upstream'] = 'backend\n'; }],
    ] as const) {
      rewrite(h, edit);
      const r = ask(h);
      expect(r.stdout, what).toBe('mode=1| upstream=1|\n');
      expect(r.stderr, what).toMatch(/^ccrc codex: lane-mode-unreadable: /m);
      expect(r.stderr, what).toMatch(/^ccrc codex: lane-upstream-unreadable: /m);
    }
  });

  it('never reads the roster: a roster word lane.json does not carry is not the answer', async () => {
    const h = await rendered('ccrc-codex-lanemode-roster-');
    const f = join(h, '.ccrc', 'accounts.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { accounts: Array<Record<string, unknown>> };
    const exec = j.accounts.find((x) => x['id'] === 'codex-a')!['exec'] as Record<string, unknown>;
    exec['bridge'] = 'direct';
    exec['upstream'] = 'siwc';
    fs.writeFileSync(f, JSON.stringify(j));
    // lane.json is now stale against the roster, and the reader still answers what lane.json says.
    expect(ask(h).stdout).toBe('mode=0|litellm upstream=0|backend\n');
  });

  it('an absent lane.json, a directory in its place, a file that is not JSON, two documents and a malformed id each refuse rc 1', async () => {
    const h = await rendered('ccrc-codex-lanemode-shapes-');
    const f = join(laneDir(h, 'codex-a'), 'lane.json');
    fs.writeFileSync(f, 'not json\n');
    expect(ask(h).stdout).toBe('mode=1| upstream=1|\n');
    // Two documents: the bridge's single json.loads refuses this file, so the bash reader must too — never two
    // words, and never the first document's word past a second it cannot read.
    fs.writeFileSync(f, '{"bridge":"direct","upstream":"siwc"}\n{"bridge":"litellm","upstream":"backend"}\n');
    expect(ask(h).stdout).toBe('mode=1| upstream=1|\n');
    fs.writeFileSync(f, '{"bridge":"direct","upstream":"siwc"}\n{"bridge":"nope","upstream":"nope"}\n');
    expect(ask(h).stdout).toBe('mode=1| upstream=1|\n');
    fs.writeFileSync(f, '["litellm"]\n');
    expect(ask(h).stdout).toBe('mode=1| upstream=1|\n');
    fs.rmSync(f);
    expect(ask(h).stdout).toBe('mode=1| upstream=1|\n');
    fs.mkdirSync(f);
    expect(ask(h).stdout).toBe('mode=1| upstream=1|\n');
    const bad = lib(h, '_codex_lane_mode ../codex-a; a=$?; _codex_lane_upstream ../codex-a; echo "mode=$a upstream=$?"');
    expect(bad.stdout).toBe('mode=1 upstream=1\n');
    expect(bad.stderr).toMatch(/^ccrc codex: lane-mode-unreadable: /m);
  });
});

describe('_codex_runtime_env_ensure — the lane\'s gateway key file (spec §5.4)', () => {
  const envFile = (h: string, id = 'codex-a'): string => join(laneDir(h, id), 'runtime.env');
  const keyOf = (h: string, id = 'codex-a'): string =>
    fs.readFileSync(envFile(h, id), 'utf8').slice('LITELLM_MASTER_KEY='.length).trimEnd();

  it('mints exactly one line, LITELLM_MASTER_KEY=sk-<48 hex>, at 0600 in a 0700 directory, and prints nothing', () => {
    const h = box('ccrc-codex-env-mint-');
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('created\n');
    expect(fs.readFileSync(envFile(h), 'utf8')).toMatch(KEY_FILE);
    expect(fs.statSync(envFile(h)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(laneDir(h, 'codex-a')).mode & 0o777).toBe(0o700);
    const key = keyOf(h);
    expect(r.stdout + r.stderr).not.toContain(key.slice('sk-'.length));
    expect(r.stderr).toBe('');
  });

  it('is stable: a second call keeps the same bytes and the same inode', () => {
    const h = box('ccrc-codex-env-stable-');
    expect(lib(h, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    const bytes = fs.readFileSync(envFile(h), 'utf8');
    const ino = fs.statSync(envFile(h)).ino;
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout).toBe('kept\n');
    expect(fs.readFileSync(envFile(h), 'utf8')).toBe(bytes);
    expect(fs.statSync(envFile(h)).ino).toBe(ino);
    expect(r.stdout + r.stderr).not.toContain(keyOf(h).slice('sk-'.length));
  });

  it('re-chmods a drifted mode back to 0600 without touching the key', () => {
    const h = box('ccrc-codex-env-mode-');
    expect(lib(h, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    const bytes = fs.readFileSync(envFile(h), 'utf8');
    fs.chmodSync(envFile(h), 0o644);
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout).toBe('rechmod\n');
    expect(fs.statSync(envFile(h)).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(envFile(h), 'utf8')).toBe(bytes);
  });

  const VALID = `LITELLM_MASTER_KEY=sk-${'ab'.repeat(24)}`;
  it.each([
    ['a short key', 'LITELLM_MASTER_KEY=sk-short\n'],
    ['uppercase hex', `LITELLM_MASTER_KEY=sk-${'AB'.repeat(24)}\n`],
    ['no trailing newline', VALID],
    ['a trailing blank line', `${VALID}\n\n`],
    ['a second line', `${VALID}\nOTHER=1\n`],
    ['another variable', `OPENAI_API_KEY=sk-${'ab'.repeat(24)}\n`],
  ])('replaces a malformed file (%s) with a well-formed one', (_what, text) => {
    const h = box('ccrc-codex-env-malformed-');
    fs.mkdirSync(laneDir(h, 'codex-a'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(envFile(h), text, { mode: 0o600 });
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout, r.stderr).toBe('replaced\n');
    expect(fs.readFileSync(envFile(h), 'utf8')).toMatch(KEY_FILE);
    expect(fs.statSync(envFile(h)).mode & 0o777).toBe(0o600);
  });

  it('replaces a symlink at runtime.env with a file, and leaves the link\'s target alone', () => {
    // The target's RELATIVE PATH is exactly as long as a well-formed file
    // (71 bytes). `stat` reports a link's own size — its target path's length
    // — so with any other length the size check would refuse the link by
    // coincidence and the `-L` refusal would be pinned by nothing (measured:
    // green with it deleted, until this length was chosen).
    const h = box('ccrc-codex-env-link-');
    const name = `${'t'.repeat(71 - '.env'.length)}.env`;
    expect(name.length).toBe(`${VALID}\n`.length);
    fs.mkdirSync(laneDir(h, 'codex-a'), { recursive: true, mode: 0o700 });
    const target = join(laneDir(h, 'codex-a'), name);
    fs.writeFileSync(target, `${VALID}\n`, { mode: 0o644 });
    fs.symlinkSync(name, envFile(h));
    const r = lib(h, '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"');
    expect(r.stdout, r.stderr).toBe('replaced\n');
    expect(fs.lstatSync(envFile(h)).isFile()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(`${VALID}\n`);
    expect(fs.statSync(target).mode & 0o777).toBe(0o644);
  });

  it('two lanes get two keys', () => {
    const h = box('ccrc-codex-env-two-');
    expect(lib(h, '_codex_runtime_env_ensure codex-a && _codex_runtime_env_ensure codex-b').code).toBe(0);
    expect(keyOf(h, 'codex-a')).not.toBe(keyOf(h, 'codex-b'));
  });

  it('a malformed id is usage (rc 2), and nothing is written — "..", with its ~/.ccrc/runtime.env, included', () => {
    const h = box('ccrc-codex-env-badid-');
    const r = lib(h, "_codex_runtime_env_ensure '..'");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(fs.existsSync(join(h, '.ccrc', 'runtime.env'))).toBe(false);
  });

  it('no external command the mint runs is handed the key', () => {
    // Every external command on the mint's path, replaced by a recorder that
    // logs its argv and execs the real binary. The key is born in a `$( )` and
    // written by the `printf` BUILTIN, so no argv may carry it — a mint that
    // routed the value through `env printf`, `echo | tee` or any other
    // external writer puts it in this log (measured: `env printf` → 1 hit).
    const h = box('ccrc-codex-env-argv-');
    for (const n of ['od', 'tr', 'chmod', 'mv', 'mkdir', 'rm', 'env']) {
      const real = spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
      expect(real, `${n} is not on this box's PATH`).not.toBe('');
      fs.writeFileSync(join(h, '.local', 'bin', n),
        `#!/bin/sh\nprintf '%s %s\\n' '${n}' "$*" >> "$HOME/argv-log"\nexec '${real}' "$@"\n`, { mode: 0o755 });
    }
    expect(lib(h, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    const log = fs.readFileSync(join(h, 'argv-log'), 'utf8');
    // CONTROL: the recorders were on PATH — the mint's own `od` is in the log.
    expect(log).toMatch(/^od -An -tx1 -N24 \/dev\/urandom$/m);
    expect(log).not.toContain(keyOf(h).slice('sk-'.length));
  });

  it('a symlink at the OLD predictable tmp name ($f.tmp.$$) is left untouched — mktemp never reuses an existing name, so runtime.env stays a real file', () => {
    // `$$` inside the sourced script is the SAME pid a plain `tmp="$f.tmp.$$"`
    // would have used, so planting the decoy there reproduces exactly the
    // name a pre-mktemp implementation would follow: with plain `>`, this
    // symlink gets FOLLOWED (writing the real key into decoyTarget) and then
    // `mv`'d onto runtime.env, leaving runtime.env itself a symlink. With
    // mktemp's random template name, the mint never looks at this path at
    // all, so the decoy — and its target — are exactly as planted.
    const h = box('ccrc-codex-env-tmpsymlink-');
    const script = [
      'dir="$(_codex_lane_dir codex-a)"',
      'mkdir -p -- "$dir"',
      "printf 'not a key\\n' > \"$dir/decoy-target\"",
      'ln -s decoy-target "$dir/runtime.env.tmp.$$"',
      '_codex_runtime_env_ensure codex-a && printf "%s\\n" "$CX_ENV_ACTION"',
    ].join('\n');
    const r = lib(h, script);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('created\n');
    const dir = laneDir(h, 'codex-a');
    // runtime.env is a REAL FILE holding the real key, never the decoy symlink.
    expect(fs.lstatSync(envFile(h)).isFile()).toBe(true);
    expect(fs.readFileSync(envFile(h), 'utf8')).toMatch(KEY_FILE);
    // the decoy at the OLD vulnerable naming ($f.tmp.$$) is exactly as planted.
    const tmps = fs.readdirSync(dir).filter((n) => n.startsWith('runtime.env.tmp.'));
    expect(tmps.length, 'the decoy symlink should still be present, untouched').toBe(1);
    expect(fs.lstatSync(join(dir, tmps[0]!)).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(join(dir, 'decoy-target'), 'utf8')).toBe('not a key\n');
  });
});

// Both stand-ins are stdlib `HTTPServer`s, whose `server_bind` asks
// `socket.getfqdn(host)` between bind and listen. On the macOS runner that
// reverse lookup of 127.0.0.1 took ~35 s in every new process (the measurement
// ccd/ccgpt-proxy.py's `_Server` cites), past spawnListener's 10 s READY,
// spawnFakeLitellm's 10 s accept and a start's 20 s readiness bound: 39 reds
// in daily run 36960555979, green on Linux, where the lookup is instant.
// The driver makes any getfqdn call fatal and stops at serve_forever, so each
// stand-in must reach its serve loop without asking — on any box.
describe('the fixture stand-ins start without a reverse lookup of their bind address', () => {
  const NO_FQDN_DRIVER = [
    'import runpy, socket, socketserver, sys',
    'def _refuse(*a, **k):',
    '    raise AssertionError("stand-in called socket.getfqdn%r" % (a,))',
    'socket.getfqdn = _refuse',
    'def _stop(self, *a, **k):',
    '    print("reached serve_forever", flush=True)',
    '    raise SystemExit(0)',
    'socketserver.BaseServer.serve_forever = _stop',
    'sys.argv = sys.argv[1:]',
    'runpy.run_path(sys.argv[0], run_name="__main__")',
    '',
  ].join('\n');
  const cases: Array<[string, (dir: string) => { script: string; args: string[] }]> = [
    ['spawnListener\'s listener.py', (dir) => {
      const script = join(dir, 'listener.py');
      fs.writeFileSync(script, LISTENER_PY);
      return { script, args: ['--answer', '404', '--listen-port', '0'] };
    }],
    ['the fake LiteLLM (spawnFakeLitellm and the runtime\'s tier)', (dir) => {
      const script = join(dir, 'fake-litellm.py');
      fs.writeFileSync(script, fakeLitellmSource(dir));
      const config = join(dir, 'litellm.yaml');
      fs.writeFileSync(config, 'model_list: []\n');
      return { script, args: ['-m', 'litellm.proxy.proxy_cli', '--config', config, '--host', '127.0.0.1', '--port', '0'] };
    }],
  ];
  for (const [what, plant] of cases) {
    it.skipIf(!PY)(`${what} reaches serve_forever and never calls socket.getfqdn`, () => {
      const h = box('ccrc-codex-nofqdn-');
      const dir = join(h, 'fake-procs');
      fs.mkdirSync(dir, { recursive: true });
      const driver = join(dir, 'no-fqdn-driver.py');
      fs.writeFileSync(driver, NO_FQDN_DRIVER);
      const { script, args } = plant(dir);
      const r = spawnSync(PY!, ['-B', driver, script, ...args], {
        cwd: h, encoding: 'utf8', timeout: 20_000,
        env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: h, PYTHONDONTWRITEBYTECODE: '1' },
      });
      expect(r.stderr).not.toMatch(/getfqdn/);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('reached serve_forever');
    });
  }
});

describe('_codex_port_listening', () => {
  it.skipIf(!PY)('0 for a port something accepts on, 1 for one nothing holds', async () => {
    const h = box('ccrc-codex-port-');
    const l = await spawnListener(h, { answer: '404' });
    const [free] = await freePorts(1);
    const r = lib(h, `_codex_port_listening ${l.port}; a=$?; _codex_port_listening ${free}; echo "$a $?"`);
    expect(r.stdout).toBe('0 1\n');
  });

  it.skipIf(!PY)('a malformed CCRC_CODEX_PROBE_S falls back to the default bound instead of failing every probe', async () => {
    // `_plat_timeout` hands its first word to `timeout`, which exits 125
    // WITHOUT RUNNING THE COMMAND on a duration it cannot parse — every
    // listener would read as absent, and a start would try to bind over it.
    const h = box('ccrc-codex-port-knob-');
    const l = await spawnListener(h, { answer: '404' });
    const r = lib(h, `_codex_port_listening ${l.port}; echo "$?"`, { CCRC_CODEX_PROBE_S: 'soon' });
    expect(r.stdout).toBe('0\n');
  });

  // `_codex_probe_secs`'s OWN printed value, not the end-to-end probe: a
  // listener that answers immediately (as the case above's does) completes
  // well within either a 2s bound or NO bound at all, so it cannot tell the
  // two apart — measured, this exact it.each against `_codex_port_listening`
  // stayed green with the normalisation deleted. Only a direct read of
  // `_codex_probe_secs`'s stdout distinguishes them.
  it.each([
    ['a non-digit word', 'soon', '2'],
    ["GNU timeout's own spelling for NO TIMEOUT", '00', '2'],
    ['three digits, all zero', '000', '2'],
    ['an over-long digit string', '99999', '2'],
    ['a well-formed override', '5', '5'],
  ])('_codex_probe_secs (%s: %s) falls back to the default bound (%s)', (_what, given, want) => {
    // `00` is its own hazard: GNU `timeout 00` means NO TIMEOUT AT ALL
    // (measured: `timeout 00 sleep 2` exits 0 after 2s, not 125 — the
    // duration parses as zero and `timeout` reads zero as unbounded), so it
    // must fall back to the default bound rather than pass through as a
    // literal (and unbounded) one.
    const h = box('ccrc-codex-probe-secs-');
    const r = lib(h, '_codex_probe_secs', { CCRC_CODEX_PROBE_S: given });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(want);
  });

  it('2 when the bounded connect expires — held, not free', async () => {
    const h = box('ccrc-codex-port-expired-');
    const [port] = await freePorts(1);
    // `_plat_timeout`'s own expiry code, returned without waiting: what a
    // listener that never completes the handshake produces.
    const r = lib(h, `_plat_timeout() { return 124; }; _codex_port_listening ${port}; echo "$?"`);
    expect(r.stdout).toBe('2\n');
  });

  it('3 for anything that is not a port', () => {
    const h = box('ccrc-codex-port-bad-');
    const r = lib(h, 'for p in abc 0 65536 "" 1.5; do _codex_port_listening "$p"; printf "%s " "$?"; done');
    expect(r.stdout).toBe('3 3 3 3 3 ');
  });
});

describe.skipIf(!PY)('_codex_tier_ours — running, and OURS (spec §7.4)', () => {
  async function lanes(prefix: string, opts: { userManager?: boolean } = {}): Promise<{ h: string; p: Ports }> {
    const h = box(prefix, opts);
    const p = await twoLanes(h);
    // `init` materialises lane.json, whose `units` are the ONLY place a unit
    // name comes from.
    expect(ccrc(h, ['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    return { h, p };
  }
  /** `rc|via|pid|why`. Called DIRECTLY in the library's shell — a `$( … )`
   *  around it would lose the CX_TIER_* it sets. */
  const ours = (h: string, id: string, tier: string, extra: NodeJS.ProcessEnv = {}): string =>
    lib(h, `_codex_tier_ours ${id} ${tier}; printf '%s|%s|%s|%s\\n' "$?" "$CX_TIER_VIA" "$CX_TIER_PID" "$CX_TIER_WHY"`,
      extra).stdout.trim();
  const pidfile = (h: string, id: string, tier: string, pid: number): void =>
    fs.writeFileSync(join(laneDir(h, id), `${tier}.pid`), `${pid}\n`);
  const shimArgv = (h: string, id: string): string[] => [join(h, '.local', 'bin', 'ccgpt-proxy.py'), `--ccrc-lane=${id}`];

  it('the REAL ccgpt-proxy.py, started as this lane WITH its --ccrc-lane marker, binds and answers — ours (0) by its answer alone, and via nohup by its pid', async () => {
    // The marker is a word the shim never reads (it reads no argv; its lane is
    // CCGPT_ACCOUNT_ID), and this case is what proves the word inert: the REAL
    // shim, marker present, still binds and answers /ccgpt/lane. It runs the
    // PLACED copy, because `$HOME/.local/bin/ccgpt-proxy.py` is the path
    // `_codex_pid_is_tier` matches.
    const { h, p } = await lanes('ccrc-codex-ours-realshim-');
    const { shimFile } = plantCodexBins(h);
    const { child } = spawnPy(shimFile, {
      home: h,
      args: ['--ccrc-lane=codex-a'],
      env: {
        CCGPT_ACCOUNT_ID: 'codex-a',
        CCGPT_PROXY_PORT: String(p['codex-a']!.proxyPort),
        CCGPT_LITELLM_PORT: String(p['codex-a']!.litellmPort),
      },
    });
    trackChild(h, child);
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${p['codex-a']!.proxyPort}/ccgpt/lane`);
        up = res.ok && ((await res.json()) as { lane?: unknown }).lane === 'codex-a';
      } catch { /* not bound yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 50));
    }
    expect(up, 'the real shim, marker present, never answered as codex-a').toBe(true);
    expect(ours(h, 'codex-a', 'shim')).toBe('0|||');
    // Its command line carries the marker, so once its pid is recorded the
    // pid itself is proven this lane's tier.
    pidfile(h, 'codex-a', 'shim', child.pid!);
    expect(ours(h, 'codex-a', 'shim')).toBe(`0|nohup|${child.pid!}|`);
    expect(fs.existsSync(join(h, 'curl-poison'))).toBe(false);
  });

  it('a JSON answer for this lane, with its pid in shim.pid carrying this lane\'s marker, is ours via nohup', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-shimpid-');
    const l = await spawnListener(h, {
      answer: 'json', lane: 'codex-a', port: p['codex-a']!.proxyPort, argv: shimArgv(h, 'codex-a'),
    });
    pidfile(h, 'codex-a', 'shim', l.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe(`0|nohup|${l.pid}|`);
  });

  it.each([
    ['the other repository\'s shim — text/plain, the bare id', 'text' as const, 'codex-a', 'listener-unidentified'],
    ['a ccrc shim answering ANOTHER lane', 'json' as const, 'codex-b', 'listener-answers-other-lane'],
    ['a JSON object carrying more than "lane"', 'json-extra' as const, 'codex-a', 'listener-unidentified'],
    ['the right body served as text/plain', 'json-as-text' as const, 'codex-a', 'listener-unidentified'],
    ['the right body at status 500', 'json-500' as const, 'codex-a', 'listener-unidentified'],
    ['a LiteLLM-shaped 404', '404' as const, '', 'listener-unidentified'],
  ])('on the shim port, %s is foreign (2)', async (_what, answer, lane, why) => {
    const { h, p } = await lanes('ccrc-codex-ours-foreign-');
    await spawnListener(h, { answer, lane, port: p['codex-a']!.proxyPort });
    expect(ours(h, 'codex-a', 'shim')).toBe(`2|||${why}`);
  });

  it('nothing on the port and no live pid or unit is not running (1)', async () => {
    const { h } = await lanes('ccrc-codex-ours-down-');
    expect(ours(h, 'codex-a', 'shim')).toBe('1|||');
    expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
  });

  it('another lane\'s shim pid in this lane\'s pidfile is a stale pidfile, ignored — not running (1), never this lane\'s — and this lane\'s own, not yet listening, is ours, starting (4)', async () => {
    // The `--ccrc-lane=<id>` marker: the shim reads no argv, so without it
    // every lane's shim has one command line and a stale pidfile could hand
    // this lane another lane's live shim to "stop". Both listeners bind a
    // kernel-chosen port, so this lane's proxyPort answers nothing. A pidfile
    // whose live pid is not this lane's tier is no handle at all: it is
    // neither adopted nor foreign, and the silent port says "not running".
    const { h } = await lanes('ccrc-codex-ours-marker-');
    const other = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-b') });
    pidfile(h, 'codex-a', 'shim', other.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe('1|||');
    const mine = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', mine.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe(`4|nohup|${mine.pid}|`);
  });

  it('LiteLLM: a pid in litellm.pid whose argv holds this lane\'s --config, listening on litellmPort, is ours (0)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-');
    const l = await spawnListener(h, {
      answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
    });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe(`0|nohup|${l.pid}|`);
  });

  it('LiteLLM: identity survives a narrow COLUMNS — ps is read unbounded', async () => {
    // procps honours $COLUMNS even into a pipe (measured: COLUMNS=40 cut a
    // 366-byte argv to 40 bytes), and the --config path is the argv's tail.
    const { h, p } = await lanes('ccrc-codex-ours-columns-');
    const l = await spawnListener(h, {
      answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
    });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm', { COLUMNS: '20' })).toBe(`0|nohup|${l.pid}|`);
  });

  it('LiteLLM: a listener on litellmPort with no identified pid is foreign (2)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-anon-');
    await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')] });
    expect(ours(h, 'codex-a', 'litellm')).toBe('2|||listener-unidentified');
  });

  // Review F1: a pid this lane's by its command line is OURS, RUNNING only
  // when it ITSELF holds litellmPort's listening socket. A LiteLLM that has
  // not bound yet, or has just died on EADDRINUSE, while another process holds
  // its port, used to read 0 off its argv plus a connect that succeeded.
  // PLATFORM-ONLY (the ruling): the ownership read is /proc on Linux; the
  // Darwin arm (lsof) is asked on Linux in the helper case below.
  it.skipIf(IS_DARWIN)('LiteLLM: this lane\'s pid by its command line that does NOT hold litellmPort, while another process listens there, is foreign (2) listener-other-process, with its handle — never ours (0) (review F1)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-otherproc-');
    // Bound to a kernel-chosen port: this lane's LiteLLM by its command line,
    // not the process on litellmPort.
    const mine = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
    pidfile(h, 'codex-a', 'litellm', mine.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe(`4|nohup|${mine.pid}|`);
    await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort });
    expect(ours(h, 'codex-a', 'litellm')).toBe(`2|nohup|${mine.pid}|listener-other-process`);
  });

  // Final-review fix wave (the Task 5 residue "shim arm ours"): the SAME
  // class on the other tier. A shim pid this lane's by its `--ccrc-lane`
  // marker, while ANOTHER process holds the proxy port and answers there,
  // used to read `listener-unidentified` — a 2 with no handle any consumer
  // could stop through, so a `Restart=always` shim crash-looping against the
  // holder could never be stopped by ccrc.
  it.skipIf(IS_DARWIN)('shim: this lane\'s shim pid by its marker that does NOT hold proxyPort, while another process answers there, is foreign (2) listener-other-process, with its handle — the LiteLLM rule\'s twin (fix wave)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-shim-otherproc-');
    const mine = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', mine.pid);
    expect(ours(h, 'codex-a', 'shim')).toBe(`4|nohup|${mine.pid}|`);
    await spawnListener(h, { answer: 'text', lane: 'codex-a', port: p['codex-a']!.proxyPort });
    expect(ours(h, 'codex-a', 'shim')).toBe(`2|nohup|${mine.pid}|listener-other-process`);
    // …and the proven shim that DOES hold its own port, answering in
    // another shape, keeps its answer's own word (no handle exception).
    // A stub `_codex_tier_port` points the question at `own`'s port.
    const own = await spawnListener(h, { answer: 'text', lane: 'codex-a', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', own.pid);
    const stub = `_codex_tier_port() { printf '%s' ${own.port}; }\n`;
    expect(lib(h, `${stub}_codex_tier_ours codex-a shim; printf '%s|%s|%s\\n' "$?" "$CX_TIER_PID" "$CX_TIER_WHY"`).stdout.trim())
      .toBe(`2|${own.pid}|listener-unidentified`);
  });

  // The consumer half of the same residue: the stop reads the shim's handle
  // through `_codex_tier_is_our_handle`, so it ends this lane's shim and
  // leaves the holder. Run through an ASYNC spawn so this process reaps the
  // killed listener (a spawnSync would leave it a zombie that `kill -0`
  // still calls alive).
  it.skipIf(IS_DARWIN)('shim: _codex_stop_tier stops this lane\'s own shim through its proven handle while another process holds the port, and leaves the holder running (fix wave)', async () => {
    const { h, p } = await lanes('ccrc-codex-stop-shim-otherproc-');
    const mine = await spawnListener(h, { answer: '404', argv: shimArgv(h, 'codex-a') });
    pidfile(h, 'codex-a', 'shim', mine.pid);
    const holder = await spawnListener(h, { answer: 'text', lane: 'codex-a', port: p['codex-a']!.proxyPort });
    const r = await new Promise<Result>((resolve) => {
      const c = spawn(BASH, ['-c', `umask 022\n. "${join(h, 'ccrc', 'ccd', 'ccrc')}"\n_codex_stop_tier codex-a shim`],
        { env: env(h), stdio: ['ignore', 'pipe', 'pipe'] });
      trackChild(h, c);
      let out = '';
      let err = '';
      c.stdout!.on('data', (x: Buffer) => { out += x.toString(); });
      c.stderr!.on('data', (x: Buffer) => { err += x.toString(); });
      c.on('close', (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('stopped\n');
    await eventually(() => mine.child.exitCode !== null || mine.child.signalCode !== null, 'this lane\'s shim to end', 5000);
    expect(holder.child.exitCode, 'the stop ended the port\'s holder').toBeNull();
    expect(await portAccepts(p['codex-a']!.proxyPort)).toBe(true);
    expect(r.stderr).toMatch(/ccrc left it running\.$/m);
  }, 30_000);

  // The ONE reading of the handle exception (review A1): every consumer that
  // decides "this lane's own, stop it through its handle" asks this, so the
  // exception cannot be re-derived three ways again.
  it('_codex_tier_is_our_handle: 0 and 4 are this lane\'s; of the 2s only listener-other-process is; 1, 3 and anything else are not (review A1)', () => {
    const h = box('ccrc-codex-our-handle-');
    const r = lib(h, 'for c in 0:"" 4:"" 2:listener-other-process 2:listener-unidentified 2:unit-unproven 2:"" 1:"" 3:"" 127:"" "":""; do '
      + 'CX_TIER_WHY="${c#*:}"; _codex_tier_is_our_handle "${c%%:*}"; printf "%s=%s " "$c" "$?"; done');
    expect(r.stdout).toBe('0:=0 4:=0 2:listener-other-process=0 2:listener-unidentified=1 2:unit-unproven=1 2:=1 1:=1 3:=1 127:=1 :=1 ');
  });

  const HAS_LSOF = spawnSync('bash', ['-c', 'command -v lsof'], { encoding: 'utf8' }).status === 0;
  const PID1_FD_READABLE = ((): boolean => { try { fs.readdirSync('/proc/1/fd'); return true; } catch { return false; } })();
  const listens = (h: string, pid: number | string, port: number | string, pre = '', extra: NodeJS.ProcessEnv = {}): string =>
    lib(h, `${pre}_codex_pid_listens ${pid} ${port}; printf '%s|%s\\n' "$?" "$CX_LISTEN_WHY"`, extra).stdout.trim();

  // Review N4: 1 is "a LISTEN socket on the port is visible, and it is not
  // this pid's". A port with no LISTEN row at all is 3: the caller asks only
  // after a connect succeeded, so an empty table is a disagreement with the
  // kernel, and a 1 would be rendered as "another process holds the port".
  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux, /proc): 0 for the pid holding the port\'s LISTEN socket; 1 for a live pid that does not, and a dead pid, while one is visible; 3 with a reason for a port with no LISTEN socket visible, and for arguments that are no pid and port (review F1, N4)', async () => {
    const h = box('ccrc-codex-listens-');
    const l = await spawnListener(h, { answer: '404' });
    const q = await spawnListener(h, { answer: '404' });
    const [free] = await freePorts(1);
    expect(listens(h, l.pid, l.port)).toBe('0|');
    expect(listens(h, q.pid, l.port)).toBe('1|');
    expect(listens(h, spawnSync('true').pid!, l.port)).toBe('1|');
    expect(listens(h, l.pid, free!)).toBe(`3|no LISTEN socket on port ${free!} is visible in /proc/net/tcp or /proc/net/tcp6`);
    expect(listens(h, spawnSync('true').pid!, free!)).toMatch(/^3\|no LISTEN socket on port /);
    expect(listens(h, 'x', l.port)).toMatch(/^3\|'x' and '\d+' are not a pid and a port$/);
    expect(listens(h, l.pid, 0)).toMatch(/^3\|/);
  });

  // Review N2: LISTEN rows only. A process that does not listen can hold a
  // socket whose LOCAL port is the lane's: bound to 127.0.0.2:<port> and
  // connected to the listener on 127.0.0.1:<port>. Read without the `0A`
  // filter, its connected socket's inode matches and it reads as the port's
  // holder, F1's false adoption again.
  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux): a process that does not listen, holding a connected socket whose local port is the port, is 1 — only a LISTEN socket counts (review N2)', async () => {
    const h = box('ccrc-codex-listens-connected-');
    const l = await spawnListener(h, { answer: '404' });
    const client = spawn(PY!, ['-c', [
      'import socket, sys, time',
      's = socket.socket()',
      'port = int(sys.argv[1])',
      "s.bind(('127.0.0.2', port))",
      "s.connect(('127.0.0.1', port))",
      "print('READY', flush=True)",
      'time.sleep(600)',
    ].join('\n'), String(l.port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    trackChild(h, client);
    await new Promise<void>((resolve, reject) => {
      let out = '';
      let err = '';
      client.stdout!.on('data', (c: Buffer) => { out += c.toString(); if (out.includes('READY')) resolve(); });
      client.stderr!.on('data', (c: Buffer) => { err += c.toString(); });
      client.once('exit', (code) => reject(new Error(`the connected client exited (${code}) before READY: ${err}`)));
    });
    expect(listens(h, client.pid!, l.port)).toBe('1|');
    expect(listens(h, l.pid, l.port)).toBe('0|');
  });

  // No readlink: every fd would fail its read, and "none of its fds holds
  // the port" would be a 1 nothing measured. It is 3, as no lsof is on Darwin.
  // Final-review fix wave (the Task 5 residue): a readlink that IS on PATH
  // but fails on every fd measured nothing either, and a 1 there reads the
  // port's own holder as "another process holds it".
  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux): a readlink that fails on every fd of a live pid is 3, cannot ask, never 1 (fix wave)', async () => {
    const h = box('ccrc-codex-listens-readlink-fails-');
    const l = await spawnListener(h, { answer: '404' });
    const bin = join(h, 'readlink-fails');
    fs.mkdirSync(bin);
    fs.writeFileSync(join(bin, 'readlink'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(listens(h, l.pid, l.port, `PATH=${bin}:$PATH; `)).toBe(`3|readlink read none of /proc/${l.pid}/fd's entries`);
    // CONTROL: the real readlink reads the same holder as 0.
    expect(listens(h, l.pid, l.port)).toBe('0|');
  });

  it.skipIf(IS_DARWIN)('_codex_pid_listens (Linux): no readlink on PATH is 3, cannot ask, never 1 (review N1)', async () => {
    const h = box('ccrc-codex-listens-noreadlink-');
    const l = await spawnListener(h, { answer: '404' });
    const only = join(h, 'awk-only');
    fs.mkdirSync(only);
    fs.symlinkSync(spawnSync('bash', ['-c', 'command -v awk'], { encoding: 'utf8' }).stdout.trim(), join(only, 'awk'));
    expect(listens(h, l.pid, l.port, `PATH=${only}; `)).toBe('3|readlink is not on PATH');
  });

  // Review N1: GNU `ls -l` spells a link's target by an ambient QUOTING_STYLE
  // even into a pipe (`-> 'socket:[N]'` under shell and shell-escape,
  // `-> "socket:[N]"` under c, curly quotes under locale and clocale), so a
  // helper that parsed its listing read a healthy holder as 1 on such a box,
  // and every start there failed naming another process. One `readlink` per
  // fd, compared exactly, has no quoting to follow.
  it.skipIf(IS_DARWIN).each(['shell-escape', 'shell', 'c', 'locale', 'clocale'])('_codex_pid_listens (Linux): the holder of the LISTEN socket is 0 under an ambient QUOTING_STYLE=%s (review N1)', async (style) => {
    const h = box('ccrc-codex-listens-quoting-');
    const l = await spawnListener(h, { answer: '404' });
    expect(listens(h, l.pid, l.port, '', { QUOTING_STYLE: style })).toBe('0|');
  });

  // Another user's process: an fd table the kernel will not list, so the
  // answer is "cannot ask", never "does not listen". pid 1 is root's; a runner
  // that can read it (root, or a container) has no such process to ask about.
  it.skipIf(IS_DARWIN || PID1_FD_READABLE)('_codex_pid_listens (Linux): a live pid whose fd table cannot be read is 3, cannot ask, with that reason (review F1)', async () => {
    const h = box('ccrc-codex-listens-pid1-');
    const l = await spawnListener(h, { answer: '404' });
    expect(listens(h, 1, l.port)).toBe('3|/proc/1/fd is unreadable');
  });

  // The Darwin arm, asked on this Linux box by setting CCD_OS in the sourced
  // shell (nothing else the helper calls reads it): lsof answers what /proc
  // answers, and no lsof on PATH is 3, cannot ask.
  it.skipIf(IS_DARWIN || !HAS_LSOF)('_codex_pid_listens (the Darwin arm, asked on Linux): lsof answers 0, 1 and a port with no LISTEN socket (3) as /proc does, and no lsof on PATH is 3 (review F1, N4)', async () => {
    const h = box('ccrc-codex-listens-lsof-');
    const l = await spawnListener(h, { answer: '404' });
    const q = await spawnListener(h, { answer: '404' });
    const [free] = await freePorts(1);
    expect(listens(h, l.pid, l.port, 'CCD_OS=darwin; ')).toBe('0|');
    expect(listens(h, q.pid, l.port, 'CCD_OS=darwin; ')).toBe('1|');
    expect(listens(h, q.pid, free!, 'CCD_OS=darwin; ')).toBe(`3|no LISTEN socket on port ${free!} is visible to lsof`);
    expect(listens(h, l.pid, l.port, 'CCD_OS=darwin; PATH=/nonexistent-ccrc-path; ')).toBe('3|lsof is not on PATH');
  });

  // Review N3: the Darwin arm's lsof runs under the probe bound, as every
  // other probe in the block does (macOS lsof stat()s mounts, and a hung
  // network mount hangs it). A stub lsof that outlives the bound is 3, inside
  // the bound's time, and so is a status lsof itself never gives. Both lsof
  // calls are bounded: the second stub answers the pid query with nothing, so
  // the port-wide query is the one that hangs. Runs on both platforms: the
  // arm is the platform's own on macOS, and CCD_OS asks it on Linux.
  it('_codex_pid_listens (the Darwin arm): an lsof that outlives the probe bound is 3, cannot ask, inside the bound — for either query — and an lsof status that is neither 0 nor 1 is 3 (review N3)', async () => {
    const h = box('ccrc-codex-listens-lsof-hang-');
    const bin = join(h, 'lsof-stub');
    fs.mkdirSync(bin);
    const stub = (body: string): void => fs.writeFileSync(join(bin, 'lsof'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const pre = `CCD_OS=darwin; PATH=${bin}:$PATH; `;
    const probe = { CCRC_CODEX_PROBE_S: '1' };
    stub('exec sleep 30');
    let t0 = Date.now();
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof did not answer inside the 1s probe bound');
    expect(Date.now() - t0).toBeLessThan(10_000);
    stub('case " $* " in *" -p "*) exit 1 ;; esac\nexec sleep 30');
    t0 = Date.now();
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof did not answer inside the 1s probe bound');
    expect(Date.now() - t0).toBeLessThan(10_000);
    // A status lsof never gives is no answer, even over output that would
    // otherwise read as a holder: for the pid query (which would read 0,
    // adopted) and for the port-wide one (which would read 1).
    stub('echo 4242; exit 2');
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof exited 2');
    stub('case " $* " in *" -p "*) exit 1 ;; esac\necho 4242; exit 2');
    expect(listens(h, process.pid, 4242, pre, probe)).toBe('3|lsof exited 2');
  }, 60_000);

  // Final-review fix wave (the Task 5 residue): the pid that bound BETWEEN
  // the two lsof queries shows up in the port-wide one. It is the holder, 0,
  // never "another process holds it" (1). Stubbed, so it runs on both
  // platforms, as the bound case above does.
  it('_codex_pid_listens (the Darwin arm): the pid itself in the port-wide list is 0, alone or beside another; only another pid alone is 1 (fix wave)', () => {
    const h = box('ccrc-codex-listens-lsof-self-');
    const bin = join(h, 'lsof-stub');
    fs.mkdirSync(bin);
    const pre = `CCD_OS=darwin; PATH=${bin}:$PATH; `;
    const stub = (portWide: string): void => fs.writeFileSync(join(bin, 'lsof'),
      `#!/bin/sh\ncase " $* " in *" -p "*) exit 1 ;; esac\nprintf '${portWide}'\nexit 0\n`, { mode: 0o755 });
    stub(`${process.pid}\\n`);
    expect(listens(h, process.pid, 4242, pre)).toBe('0|');
    stub(`99999\\n${process.pid}\\n`);
    expect(listens(h, process.pid, 4242, pre)).toBe('0|');
    stub(`${process.pid}9\\n`);   // a longer pid that merely BEGINS with this one
    expect(listens(h, process.pid, 4242, pre)).toBe('1|');
    stub('99999\\n');
    expect(listens(h, process.pid, 4242, pre)).toBe('1|');
  });

  // Ownership that cannot be measured is rc 3 with its own sentence: never
  // adopted (0), and never called foreign (2) on a guess.
  it('LiteLLM: a proven pid on an answering port whose ownership cannot be measured is 3, tier-unmeasured, with the helper\'s reason (review F1)', async () => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-unmeasurable-');
    const l = await spawnListener(h, {
      answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
    });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    const r = lib(h, "_codex_pid_listens() { CX_LISTEN_WHY='a stub that cannot ask'; return 3; }\n"
      + `_codex_tier_ours codex-a litellm; printf '%s|%s|%s|%s\\n' "$?" "$CX_TIER_VIA" "$CX_TIER_PID" "$CX_TIER_WHY"`);
    expect(r.stdout.trim()).toBe(`3|nohup|${l.pid}|`);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: tier-unmeasured: codex-a's litellm tier: pid ${l.pid} is this lane's by its command line and port ${p['codex-a']!.litellmPort} answers, .*\\(a stub that cannot ask\\)`, 'm'));
    // Every other caller is pointed at status (this is the CONTROL)…
    expect(r.stderr).toContain("'ccrc codex status codex-a' reports the lane.");
    // …and status itself is not pointed at itself (fix wave, the Task 5
    // residue): the same sentence, without that clause, then its UNKNOWN line.
    const st = lib(h, "_codex_pid_listens() { CX_LISTEN_WHY='a stub that cannot ask'; return 3; }\n"
      + '_codex_cmd_status codex-a 0');
    expect(st.stderr).toMatch(/^ccrc codex: tier-unmeasured: codex-a's litellm tier: .*\(a stub that cannot ask\)/m);
    expect(st.stderr).not.toContain("'ccrc codex status codex-a' reports the lane");
    expect(st.stdout).toMatch(/^ccrc codex: codex-a: litellm UNKNOWN — its state could not be measured$/m);
  });

  it.each([
    ['another lane\'s config', (h: string) => litellmYaml(h, 'codex-b')],
    ['a longer path that begins with this lane\'s', (h: string) => `${litellmYaml(h, 'codex-a')}.prev`],
  ])('LiteLLM: a pid whose --config is %s is not this lane\'s (2)', async (_what, cfg) => {
    const { h, p } = await lanes('ccrc-codex-ours-litellm-cfg-');
    const l = await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', cfg(h)] });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe('2|||listener-unidentified');
  });

  it('LiteLLM: this lane\'s pid alive but not listening yet is ours, starting (4); a live stranger in the pidfile is a stale pidfile — not running (1) while nothing answers, foreign (2) once something unproven does; a dead pid is not running (1)', async () => {
    // Bound to a kernel-chosen port, not litellmPort: a tier still importing
    // litellm, whose command line is already this lane's.
    const { h, p } = await lanes('ccrc-codex-ours-litellm-notlistening-');
    const l = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe(`4|nohup|${l.pid}|`);
    // This process: alive, and no tier's command line — the pid a pidfile
    // names after a reboot handed it to somebody else. A STALE pidfile, not a
    // foreign tier: it is ignored, so it can neither wedge the lane nor be
    // signalled as ccrc's own, and the silent port says "not running".
    pidfile(h, 'codex-a', 'litellm', process.pid);
    expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
    // A pid whose process has exited and been reaped: no live handle at all.
    const dead = spawnSync('true').pid;
    pidfile(h, 'codex-a', 'litellm', dead);
    expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
    // The stale pidfile again, now with an unproven listener on litellmPort:
    // the PORT decides, and it is foreign for the port's reason, never for one
    // drawn from the pidfile.
    pidfile(h, 'codex-a', 'litellm', process.pid);
    await spawnListener(h, { answer: '404', port: p['codex-a']!.litellmPort });
    expect(ours(h, 'codex-a', 'litellm')).toBe('2|||listener-unidentified');
  });

  it('a connect that outlives the bound is held: unresponsive (2) with no handle, ours, starting (4) with a proven one', async () => {
    // `_plat_timeout`'s own expiry code, returned without waiting: what a port
    // whose holder never completes the handshake produces.
    const { h } = await lanes('ccrc-codex-ours-expired-');
    const probe = (): string => lib(h, `_plat_timeout() { return 124; }; _codex_tier_ours codex-a litellm; `
      + `printf '%s|%s|%s|%s\\n' "$?" "$CX_TIER_VIA" "$CX_TIER_PID" "$CX_TIER_WHY"`).stdout.trim();
    expect(probe()).toBe('2|||listener-unresponsive');
    const l = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
    pidfile(h, 'codex-a', 'litellm', l.pid);
    expect(probe()).toBe(`4|nohup|${l.pid}|`);
  });

  it('a tier word it does not know, and a lane that is not codex, are rc 3 with a sentence', async () => {
    const { h } = await lanes('ccrc-codex-ours-usage-');
    const a = lib(h, '_codex_tier_ours codex-a proxy; echo "rc=$?"');
    expect(a.stdout).toBe('rc=3\n');
    expect(a.stderr).toMatch(/^ccrc codex: usage: /m);
    const b = lib(h, '_codex_tier_ours ext-a shim; echo "rc=$?"');
    expect(b.stdout).toBe('rc=3\n');
    expect(b.stderr).toMatch(/^ccrc codex: not-codex: /m);
  });

  // PLATFORM-ONLY: darwin has no user manager — `_svc_have_user_manager`
  // answers 1 there by contract, so no unit is ever asked and this arm has no
  // darwin counterpart to contrast with (the nohup cases above run on both).
  describeLinux('with a user manager (the fake one)', () => {
    it('a live unit whose MainPID holds this lane\'s --config and listens is ours via systemd — asked by the name lane.json records', async () => {
      const { h, p } = await lanes('ccrc-codex-ours-unit-', { userManager: true });
      // A unit name the id alone would NOT derive: the library must READ it
      // from lane.json (models-op's `laneManifest` is its one derivation).
      const f = join(laneDir(h, 'codex-a'), 'lane.json');
      const unit = 'fixture-codex-a-litellm.service';
      fs.writeFileSync(f, JSON.stringify({ ...laneJson(h, 'codex-a'), units: { litellm: unit, shim: 'fixture-codex-a-shim.service' } }));
      const l = await spawnListener(h, {
        answer: '404', port: p['codex-a']!.litellmPort, argv: ['--config', litellmYaml(h, 'codex-a')],
      });
      fakeUnit(h, unit, { state: 'active', pid: l.pid });
      expect(ours(h, 'codex-a', 'litellm')).toBe(`0|systemd|${l.pid}|`);
      expect(systemctlCalls(h)).toEqual(expect.arrayContaining([
        `--user is-active ${unit}`, `--user show -p MainPID --value ${unit}`,
      ]));
    });

    it('a unit name lane.json spells like a flag is never handed to systemctl', async () => {
      const { h } = await lanes('ccrc-codex-ours-unit-flag-', { userManager: true });
      const f = join(laneDir(h, 'codex-a'), 'lane.json');
      fs.writeFileSync(f, JSON.stringify({ ...laneJson(h, 'codex-a'), units: { litellm: '--all.service', shim: '--all.service' } }));
      expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
      expect(systemctlCalls(h).filter((c) => c.includes('--all.service'))).toEqual([]);
    });

    it('a live unit whose MainPID does not prove this lane is foreign (2): unit-unproven — no MainPID, or a stranger\'s', async () => {
      // The unit NAME is not identity: the other repository's live tiers run
      // under these same names (the 2026-09-23 live-box census).
      const { h } = await lanes('ccrc-codex-ours-unit-silent-', { userManager: true });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      fakeUnit(h, unit, { state: 'active' });
      expect(ours(h, 'codex-a', 'litellm')).toBe('2|||unit-unproven');
      // This process as its MainPID: alive, and no tier's command line.
      fakeUnit(h, unit, { state: 'active', pid: process.pid });
      expect(ours(h, 'codex-a', 'litellm')).toBe('2|||unit-unproven');
    });

    // Review A2 (ruling PF-13): this lane's own crash-looping tier reads
    // exactly so between two restarts, so `status` must not call it FOREIGN
    // or "not this lane's" — it says UNPROVEN, in `_codex_foreign_what`'s
    // words, with the retry. The JSON keeps the contract's word.
    it('status names a live unit whose identity is only unproven UNPROVEN, with the retry — never FOREIGN (review A2)', async () => {
      const { h, p } = await lanes('ccrc-codex-status-unproven-', { userManager: true });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      fakeUnit(h, unit, { state: 'active' });
      const r = lib(h, '_codex_cmd_status codex-a 0');
      expect(r.code, r.stderr).toBe(0);
      const line = r.stdout.split('\n').find((l) => l.startsWith('ccrc codex: codex-a: litellm '));
      expect(line).toBe(`ccrc codex: codex-a: litellm UNPROVEN — the unit ${unit} is active, but its identity as codex-a's litellm tier is unproven: `
        + 'a unit of that name is live with no process that proves this lane, and port '
        + `${p['codex-a']!.litellmPort} does not answer. `
        + 'Re-run in a few seconds: this lane\'s own tier reads this way between two of its restarts, and proves itself once its process is back. '
        + `If it still reads this way, 'systemctl --user status ${unit}' shows what the unit runs.`);
      const j = lib(h, '_codex_cmd_status codex-a 1');
      expect((JSON.parse(j.stdout) as { tiers: Record<string, { state: string }> }).tiers['litellm']!.state).toBe('foreign');
    });

    it('a live unit whose MainPID holds this lane\'s --config while nothing listens yet is ours, starting (4) via systemd', async () => {
      const { h } = await lanes('ccrc-codex-ours-unit-starting-', { userManager: true });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      // A kernel-chosen port, not litellmPort: the unit's process has not bound yet.
      const l = await spawnListener(h, { answer: '404', argv: ['--config', litellmYaml(h, 'codex-a')] });
      fakeUnit(h, unit, { state: 'active', pid: l.pid });
      expect(ours(h, 'codex-a', 'litellm')).toBe(`4|systemd|${l.pid}|`);
    });

    it('with the manager down, no unit is asked about at all', async () => {
      const { h } = await lanes('ccrc-codex-ours-unit-nomgr-', { userManager: false });
      const unit = (laneJson(h, 'codex-a')['units'] as Record<string, string>)['litellm']!;
      fakeUnit(h, unit, { state: 'active' });
      expect(ours(h, 'codex-a', 'litellm')).toBe('1|||');
      expect(systemctlCalls(h)).toContain('--user show-environment');
      expect(systemctlCalls(h).filter((c) => c.startsWith('--user is-active'))).toEqual([]);
    });
  });
});

describe('_codex_started_json and _codex_tier_stale — "running the update" is its own claim (spec §7.4)', () => {
  async function planted(prefix: string): Promise<{ h: string; gen: string; stamp: string; shim: string }> {
    const h = box(prefix);
    const [a1, a2] = await freePorts(2);
    codexRoster(h, [{ id: 'codex-a', proxyPort: a1!, litellmPort: a2! }]);
    const { shimFile } = plantCodexBins(h);
    const rt = plantFakeRuntime(h);
    return { h, gen: rt.gen, stamp: rt.stamp, shim: shimFile };
  }
  const stale = (h: string): string =>
    lib(h, '_codex_tier_stale codex-a litellm; a=$?; _codex_tier_stale codex-a shim; echo "litellm=$a shim=$?"').stdout.trim();
  const record = (h: string): void => {
    fs.mkdirSync(laneDir(h, 'codex-a'), { recursive: true });
    // The two runtime tiers this describe is about; the bridge's record is Task 11's (the bridge tier describe).
    const r = lib(h, 'for t in litellm shim; do _codex_started_json "$t" > "$(_codex_lane_dir codex-a)/$t.started" || exit 1; done');
    expect(r.code, r.stderr).toBe(0);
  };

  // `check` hands its stamp read and its probe hash to the box's real python3
  // (through the fake interpreter), so this one case needs python3; every
  // other case here runs `ccgpt-runtime python`, which runs no interpreter.
  it.skipIf(!PY)('the planted runtime is one the REAL ccgpt-runtime accepts — and its check asks the fake interpreter', async () => {
    const { h, gen, stamp } = await planted('ccrc-codex-stale-parity-');
    const cli = join(h, '.local', 'bin', 'ccgpt-runtime');
    const run = (a: string): Result => {
      const r = spawnSync(BASH, [cli, a], { env: env(h), encoding: 'utf8', timeout: 15_000 });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    expect(run('check').code, run('check').stderr).toBe(0);
    expect(run('python').stdout).toBe(`${gen}/bin/python\n`);
    // All three of check's `-I -c` questions reached the fake: the version it
    // answers itself, and the stamp read and probe hash it execs on python3.
    const calls = fs.readFileSync(join(gen, 'python-calls'), 'utf8');
    for (const k of ['importlib.metadata', 'json.load', 'hashlib']) expect(calls, k).toContain(k);
    // The stamp is the builder's own bytes: json.dump's default separators,
    // its key order, its `python` and `canary` shapes, one trailing newline.
    expect(fs.readFileSync(stamp, 'utf8')).toMatch(new RegExp('^\\{"requirement": "[^"]+", '
      + '"probeSha256": "[0-9a-f]{64}", "litellm": "1\\.101\\.0", "python": "\\d+\\.\\d+\\.\\d+", '
      + '"canary": "raw-shape-leaks-system-role=no", "builtAt": "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z"\\}\\n$'));
    // CONTROL: a stamp recording a version the interpreter does not report.
    const j = JSON.parse(fs.readFileSync(stamp, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(stamp, `${JSON.stringify({ ...j, litellm: '0.0.0' })}\n`);
    const bad = run('check');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/ccgpt-runtime: mutated/);
  });

  it('each tier\'s record names the RESOLVED generation and the sha256 of that tier\'s code file', async () => {
    const { h, gen, stamp, shim } = await planted('ccrc-codex-stale-record-');
    const r = lib(h, '_codex_started_json litellm && _codex_started_json shim');
    expect(r.code, r.stderr).toBe(0);
    const [lit, sh] = r.stdout.trim().split('\n').map((l) => JSON.parse(l) as unknown);
    // The litellm tier runs the auth library too, so its code is the stamp followed by it.
    expect(lit).toEqual({ generation: gen, code: litellmCode(stamp, h) });
    expect(sh).toEqual({ generation: gen, code: sha256(shim) });
    expect(r.stdout).not.toContain('/current');
  });

  it('no record is stale (0); the record a start would write is current (1)', async () => {
    const { h } = await planted('ccrc-codex-stale-first-');
    expect(stale(h)).toBe('litellm=0 shim=0');
    record(h);
    expect(stale(h)).toBe('litellm=1 shim=1');
  });

  it('a new generation makes both tiers stale', async () => {
    const { h } = await planted('ccrc-codex-stale-gen-');
    record(h);
    plantFakeRuntime(h);
    expect(stale(h)).toBe('litellm=0 shim=0');
  });

  it('a library change makes the litellm tier stale', async () => {
    const { h } = await planted('ccrc-codex-stale-authlib-');
    record(h);
    expect(stale(h)).toBe('litellm=1 shim=1');
    fs.appendFileSync(authLib(h), '# a newer auth library\n');
    expect(stale(h)).toBe('litellm=0 shim=1');
  });

  it('a changed shim file makes only the shim stale; a rewritten stamp only LiteLLM', async () => {
    const { h, stamp, shim } = await planted('ccrc-codex-stale-code-');
    record(h);
    fs.appendFileSync(shim, '# a newer shim\n');
    expect(stale(h)).toBe('litellm=1 shim=0');
    record(h);
    fs.appendFileSync(stamp, ' ');
    expect(stale(h)).toBe('litellm=0 shim=1');
  });

  it('an unparseable record is stale', async () => {
    const { h } = await planted('ccrc-codex-stale-garbled-');
    record(h);
    fs.writeFileSync(join(laneDir(h, 'codex-a'), 'shim.started'), 'not json');
    expect(stale(h)).toBe('litellm=1 shim=0');
  });

  it('no runtime NOW is "cannot tell" (2) for both tiers, never stale — a restart would have nothing to start', async () => {
    const { h } = await planted('ccrc-codex-stale-noruntime-');
    record(h);
    fs.rmSync(join(h, '.ccrc', 'runtime', 'codex', 'current'));
    expect(stale(h)).toBe('litellm=2 shim=2');
  });
});

describe('_codex_reap_files — the file half of the reap (Plan 2b-1 carry-forward 8)', () => {
  it('removes the lane\'s generated state and its directory; never its logs, its OAuth, or another lane\'s files', async () => {
    const h = box('ccrc-codex-reap-');
    await twoLanes(h);
    expect(ccrc(h, ['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    expect(lib(h, '_codex_runtime_env_ensure codex-a && _codex_runtime_env_ensure codex-b').code).toBe(0);
    const dir = laneDir(h, 'codex-a');
    // With lane.json (init) and runtime.env (above), EXACTLY the reap list:
    // every file `_codex_reap_files` owns, the per-lane lock file included.
    for (const f of ['litellm.yaml', 'litellm.yaml.prev', 'litellm.started', 'shim.started', 'litellm.pid', 'shim.pid', '.lock']) {
      fs.writeFileSync(join(dir, f), 'fixture\n');
    }
    const logs = join(h, '.ccrc', 'logs', 'codex', 'codex-a');
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(join(logs, 'litellm.log'), 'a log line\n');
    const auth = join(h, codexAuthDir('codex-a'));
    fs.mkdirSync(auth, { recursive: true });
    fs.writeFileSync(join(auth, 'auth.json'), '{"token":"test-token-not-a-secret"}\n');
    const other = fs.readFileSync(join(laneDir(h, 'codex-b'), 'runtime.env'), 'utf8');

    const r = lib(h, '_codex_reap_files codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readFileSync(join(logs, 'litellm.log'), 'utf8')).toBe('a log line\n');
    expect(fs.readFileSync(join(auth, 'auth.json'), 'utf8')).toBe('{"token":"test-token-not-a-secret"}\n');
    expect(fs.readFileSync(join(laneDir(h, 'codex-b'), 'runtime.env'), 'utf8')).toBe(other);
  });

  it('a runtime.env.tmp.* leftover from an interrupted mint is removed by the reap', () => {
    // mktemp's own random suffix, so this is a GLOB, not a fixed name — a
    // killed `_codex_runtime_env_ensure` can leave a key-bearing tmp file
    // behind, and it must not survive account removal or silently block the
    // directory's own removal.
    const h = box('ccrc-codex-reap-tmpfile-');
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(join(dir, 'lane.json'), '{}\n');
    const leftover = join(dir, 'runtime.env.tmp.a1B2c3');
    fs.writeFileSync(leftover, `LITELLM_MASTER_KEY=sk-${'ab'.repeat(24)}\n`, { mode: 0o600 });
    const r = lib(h, '_codex_reap_files codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('keeps the directory, and what it does not own inside it', () => {
    const h = box('ccrc-codex-reap-foreign-');
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'lane.json'), '{}\n');
    fs.writeFileSync(join(dir, 'notes.txt'), 'the operator\'s\n');
    expect(lib(h, '_codex_reap_files codex-a').code).toBe(0);
    expect(fs.readdirSync(dir)).toEqual(['notes.txt']);
  });

  it('needs no roster row — a lane already removed from accounts.json is still reaped', () => {
    const h = box('ccrc-codex-reap-unrostered-');
    codexRoster(h, []);
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'lane.json'), '{}\n');
    expect(lib(h, '_codex_reap_files codex-a').code).toBe(0);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('a malformed id is usage (rc 2), and removes nothing — ".." would have named ~/.ccrc itself', () => {
    const h = box('ccrc-codex-reap-badid-');
    fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
    fs.writeFileSync(join(h, '.ccrc', 'runtime.env'), 'sentinel\n');
    const r = lib(h, "_codex_reap_files '..'");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(fs.readFileSync(join(h, '.ccrc', 'runtime.env'), 'utf8')).toBe('sentinel\n');
  });

  it('a file it cannot remove is lane-unwritable, rc 1, and the rest are still removed', () => {
    const h = box('ccrc-codex-reap-stuck-');
    const dir = laneDir(h, 'codex-a');
    fs.mkdirSync(join(dir, 'lane.json', 'occupied'), { recursive: true });
    fs.writeFileSync(join(dir, 'runtime.env'), 'x\n');
    const r = lib(h, '_codex_reap_files codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: lane-unwritable: could not remove .*lane\.json/m);
    expect(fs.existsSync(join(dir, 'runtime.env'))).toBe(false);
  });
});
