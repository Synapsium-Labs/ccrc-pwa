/**
 * A new id fits every name ccd derives from it (path-identity spec §2.6).
 *
 * Three verbs MINT an id: ws-add composes `<project>-<slug>`, and start and enable compose
 * `<wrapper>-<project>`. Every per-id name that ccd, its session hook and the server derive
 * from that id must fit the 255-byte NAME_MAX, or a write that names it fails long after the
 * id exists. Those names are the registry fields, the dot-leading temps, the reap lock, the
 * quarantine slot, the unit and the history sweep's draining file. `ID_NAME_TEMPLATES` is
 * that census, one row per distinct template, with the bytes each adds beyond the id.
 *
 * The cap is NAME_MAX less the widest overhead, lowered to the hook's own id gate
 * (`CCRC_ID_MAX`). A peer id the hook's census skips is a session that drops out of its peers'
 * counts (its own card turns on its project), so the lower bound binds.
 *
 * THE CENSUS IS A MECHANISM, NOT A LIST. The anti-whitelist case re-scans `ccd/` (doc and
 * skill text excluded) and `server/src` with the census patterns. A name no row covers reds
 * it, and so does a row whose template its own file no longer holds.
 *
 * Nothing here reaches systemd or tmux. `_supervised_start` logs its argv and `_alive`
 * answers no (`ccd-start-id.test.ts`'s stub shape, copied rather than imported), and ws-add
 * runs under `WS_ADD`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, FIXTURE_MOUNTINFO, WS_ADD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { eventsOf } from './lifecycleHelpers.js';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const NAME_MAX = 255;

interface IdNameTemplate { readonly file: string; readonly template: string; readonly overhead: number }

/** A registry field is taken at its longest literal in the tree (`archivemanifest`). */
const FIELD_MAX = 15;

/** The widest each placeholder can expand to:
 *  - a pid or BASHPID: 7 digits;
 *  - $RANDOM: 5;
 *  - epoch milliseconds: 13; nanoseconds: 19;
 *  - `_REG_SET_SEQ`: 10;
 *  - the hook nonce `compact-<ms>-<pid>-<R>-<R>`: 41;
 *  - `_hook_write_atomic`'s base, `compactset`: 10.
 *  mktemp's XXXXXX is written literally in its template. */
const WIDTH: Readonly<Record<string, number>> = {
  '<pid>': 7, '<R>': 5, '<ms>': 13, '<ns>': 19, '<seq>': 10, '<nonce>': 41, '<field>': FIELD_MAX, '<base>': 10,
};

/** The bytes a template adds beyond the id: every placeholder at its widest. */
function overheadOf(template: string): number {
  return template.replace('<id>', '').replace(/<[A-Za-z]+>/g, (p) => {
    const w = WIDTH[p];
    if (w === undefined) throw new Error(`no width for the placeholder ${p} in ${template}`);
    return 'x'.repeat(w);
  }).length;
}

/** Task 0's census: one row per distinct template, in the first file the scan finds it in. */
const ID_NAME_TEMPLATES: readonly IdNameTemplate[] = [
  // The id as a whole name: the leaf `~/.cc-tmp/<id>` and the witness `tmproots/<id>`.
  { file: 'ccd/ccd', template: '<id>', overhead: 0 },
  // Every `$REG/<id>.<field>` (and `$_SVC_REG/<id>.<field>`), as one family at the longest field literal.
  { file: 'ccd/ccd', template: '<id>.<field>', overhead: 16 },
  { file: 'ccd/ccd', template: '<id>.hookstate.json', overhead: 15 },
  { file: 'ccd/ccd', template: '<id>.turn.json', overhead: 10 },
  { file: 'ccd/ccd', template: '<id>.supervise.log', overhead: 14 },
  { file: 'server/src/usage.ts', template: '<id>.json', overhead: 5 },
  { file: 'ccd/history/sweep.mjs', template: '<id>.<ms>.<pid>.jsonl', overhead: 28 },
  { file: 'ccd/ccd', template: '.<id>.<field>.<pid>.<seq>.tmp', overhead: 40 },
  { file: 'ccd/ccd', template: '.<id>.<pid>.hookstate.tmp', overhead: 23 },
  { file: 'ccd/ccd', template: '.<id>.compactions.lock', overhead: 18 },
  { file: 'ccd/ccd', template: '.<id>.compactions.lock-init.XXXXXX', overhead: 30 },
  { file: 'ccd/ccd', template: '.<id>.compactions.lock-open.<pid>.<R>.<R>', overhead: 43 },
  { file: 'ccd/ccd', template: '.<id>.generation-init.XXXXXX', overhead: 24 },
  { file: 'ccd/ccd', template: '.<id>.generation-read.<pid>.<R>.<R>', overhead: 37 },
  { file: 'ccd/ccd', template: '.<id>.starts', overhead: 8 },
  { file: 'ccd/ccd', template: '.reap-<id>.lock', overhead: 11 },
  // Keyed on the project, which is shorter than any id composed from it, so this row is an upper bound.
  { file: 'ccd/ccd', template: '.ws-add-<id>.lock', overhead: 13 },
  // The quarantine slot: spec §2.6's 222 was derived from this row alone.
  { file: 'ccd/ccd', template: 'slot.<id>.<ns>.<pid>', overhead: 33 },
  { file: 'ccd/ccd', template: 'claude-session@<id>.service', overhead: 23 },
  { file: 'ccd/session-hook.sh', template: '.<id>.<base>.<pid>.<nonce>.hook-write.tmp', overhead: 77 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactcard.<pid>.<nonce>.session-claim.tmp', overhead: 81 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactcard.<pid>.<nonce>.stage', overhead: 69 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactset.<pid>.<nonce>.stage', overhead: 68 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactserved-source.<nonce>.XXXXXX', overhead: 71 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactserved.<nonce>', overhead: 57 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactions-snapshot.<pid>.<R>.<R>.tmp', overhead: 46 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactions-stage.<pid>.<R>.<R>.tmp', overhead: 43 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactpost.<pid>.<R>.<R>.claim', overhead: 39 },
];

/** Every file the census leaves out, each with its reason. Each is also a stated residual. */
const CENSUS_EXCLUDED: readonly { file: string; reason: string }[] = [
  {
    file: 'server/src/token/files.ts',
    reason: 'its `${id}` is a box-token generation id (GENERATION_ID_RE), never a session id: '
      + '`mail-pending-<generation>.token` embeds no registry id',
  },
];

/** Task 0's (e4) patterns as ONE tokenizer:
 *  - a `$REG/<id>.` name, the reap and ws-add locks, the slot, a witness, a leaf and the unit (ccd's bash);
 *  - a `${id}.`/`${sessionId}.` name with its literal prefix (`server/src` and the .mjs files).
 *  A token runs until a quote, a space, a bracket or a separator. */
const CENSUS_TOKEN =
  /(?:\$REG\/\.?\$\{?(?:id|1)\}?\.|\.reap-\$|\.ws-add-\$|slot\.\$\{?id|\/tmproots\/\$|\.cc-tmp\/\$|claude-session@|[A-Za-z0-9._@-]*\$\{(?:id|sessionId)\}\.)[^\s"'`(),;:<>\\]*/g;

/** Every spelling of the id in those templates. `$project` keys the ws-add lock: an upper bound, above. */
const ID_SPELLING = /\$\{1-\}|\$\{1\}|\$1(?![0-9])|\$\{id\}|\$id(?![A-Za-z0-9_])|\$\{sessionId\}|\$project(?![A-Za-z0-9_])/g;

/** Each variable part, as the placeholder `WIDTH` measures. `_hook_write_atomic`'s `$2` is its nonce;
 *  every other `$2` is `_reg_set`'s field, and the history CLI's `regPresence` reads one as `${field}`. */
const PLACEHOLDERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\$2(?=\.hook-write)/g, '<nonce>'],
  [/\$\$|\$\{?BASHPID\}?|\$\{pid\}/g, '<pid>'],
  [/\$RANDOM/g, '<R>'],
  [/\$_REG_SET_SEQ/g, '<seq>'],
  [/\$ns(?![A-Za-z0-9_])/g, '<ns>'],
  [/\$nonce(?![A-Za-z0-9_])|\$COMPACT_SERVE_NONCE/g, '<nonce>'],
  [/\$\{tickMs\}/g, '<ms>'],
  [/\$2(?![0-9])|\$\{f\}|\$f(?![A-Za-z0-9_])|\$field(?![A-Za-z0-9_])|\$\{field\}|\$\{name\}/g, '<field>'],
  [/\$base(?![A-Za-z0-9_])/g, '<base>'],
];

/** A token's template (`<id>` plus placeholders), or null when it names no file: a glob, a prefix, or no id. */
function shapeOf(token: string, after: string): string | null {
  // `"$REG/.reap-$id".lo[c]k` and `"$REG/.$id.compactions.lock-open."*` are globs, and `"$REG/.$id."` is a prefix.
  if (/^"?[.*[]/.test(after) || token.endsWith('.')) return null;
  let s = token;
  if (s.startsWith('claude-session@')) {
    // The instance is the id. systemd appends `.service` when the spelling omits it.
    const inst = /^claude-session@(\$\{?[A-Za-z0-9_]+\}?|%s)/.exec(s);
    if (inst === null) return null;   // `@*`, `@.service`, `@}` or a fixed instance: no id in it
    const rest = s.slice(inst[0].length);
    s = `claude-session@<id>${rest.startsWith('.service') ? rest : `.service${rest}`}`;
  }
  s = s.replace(ID_SPELLING, '<id>');
  // NAME_MAX bounds one path component, so keep the last component that holds the id.
  const parts = s.split('/').filter((c) => c.includes('<id>'));
  if (parts.length === 0) return null;
  s = parts[parts.length - 1];
  for (const [re, ph] of PLACEHOLDERS) s = s.replace(re, ph);
  if (s.includes('*')) return null;
  return s.replace(/[.`,'}\]…]+$/, '');
}

const FAMILY = '<id>.<field>';
function covered(shape: string): boolean {
  if (ID_NAME_TEMPLATES.some((r) => r.template === shape)) return true;
  const field = /^<id>\.([a-z]+)$/.exec(shape);
  return field !== null && field[1].length <= FIELD_MAX && ID_NAME_TEMPLATES.some((r) => r.template === FAMILY);
}

function walk(rel: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
    const p = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** Every file under `ccd/` and `server/src`, with doc text (`*.md`) and skill text excluded. */
const SCANNED = (): string[] => [...walk('ccd'), ...walk('server/src')]
  .filter((f) => !f.endsWith('.md') && !/^ccd\/[a-z]+-skill\//.test(f)).sort();

interface Hit { readonly file: string; readonly line: number; readonly shape: string }
function censusHits(files: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    read(file).split('\n').forEach((ln, i) => {
      for (const m of ln.matchAll(CENSUS_TOKEN)) {
        const shape = shapeOf(m[0], ln.slice((m.index ?? 0) + m[0].length));
        if (shape !== null) hits.push({ file, line: i + 1, shape });
      }
    });
  }
  return hits;
}

const HOOK = read('ccd/session-hook.sh');
const hookGate = /^CCRC_ID_MAX=(\d+)$/m.exec(HOOK);
const CCRC_ID_MAX = hookGate === null ? Number.NaN : Number(hookGate[1]);
const WIDEST = Math.max(...ID_NAME_TEMPLATES.map((r) => r.overhead));
/** The hook's id gate binds (path-identity spec §2.9, SEC5): the lower of the room the widest name leaves and the
 *  hook's own id gate. Derived here, never read from ccd, so a raised `_REG_ID_MAX` reds every boundary row too. */
const CAP = Math.min(NAME_MAX - WIDEST, CCRC_ID_MAX);

function bodyOf(text: string, fn: string): string {
  const start = text.indexOf(`\n${fn}() {`);
  if (start < 0) throw new Error(`no ${fn}() { in ccd/ccd`);
  const end = text.indexOf('\n}\n', start);
  return text.slice(start, end < 0 ? text.length : end);
}

const capSentence = (id: string, remedy: string): string =>
  `id '${id}' is ${id.length} bytes; a new id may be at most ${CAP}, so that every name ccd derives from it `
  + `fits the 255-byte name limit — ${remedy}; nothing was created`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-id-cap-'); });
afterEach(() => { h.cleanup(); });

const STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; `
  + `_alive() { return 1; };`;

/** Captures all three streams, because the refusals under test exit non-zero. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 60000,
    env: ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home,
      CCD_MOUNTINFO: path.join(h.home, FIXTURE_MOUNTINFO) }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

const PLANTED_UUID = 'b7001948-0000-4c2f-9a1b-0cfc0dc3d199';
const seedRow = (id: string, wrapper: string, project: string): void => {
  fs.mkdirSync(path.join(h.home, 'projects', project), { recursive: true });
  h.sh(`_reg_set ${id} uuid ${PLANTED_UUID}
    _reg_set ${id} project ${project}
    _reg_set ${id} workdir "$HOME/projects/${project}"
    _reg_set ${id} wrapper ${wrapper}
    _reg_set ${id} started 1`);
};

const supervisedStarts = (): string[] => h.calls().filter((c) => c.startsWith('supervised_start'));

describe('a new id fits every name ccd derives from it (path-identity spec §2.6)', () => {
  it('the cap is the value the census and the ruling give', () => {
    const ccd = read('ccd/ccd');
    for (const r of ID_NAME_TEMPLATES) {
      expect(r.overhead, `${r.template}: its overhead is its parts at their widest`).toBe(overheadOf(r.template));
    }
    // The widths the table relies on are still the tree's.
    expect(HOOK, 'the hook nonce is compact-<13-digit ms>-<pid>-<R>-<R>, at most 41 bytes')
      .toContain('nonce="compact-${at}-${$}-${RANDOM}-${RANDOM}"');
    expect([...HOOK.matchAll(/^\s*_hook_write_atomic "(\$[a-z]+)"/gm)].map((m) => m[1]).sort(),
      '_hook_write_atomic has two callers, whose bases are compactset and turn.json').toEqual(['$mf', '$set']);
    expect(HOOK).toContain('set="$REG/$id.compactset"');
    expect(HOOK).toContain('mf="$REG/$id.turn.json"');
    expect(Number.isInteger(CCRC_ID_MAX), 'ccd/session-hook.sh defines CCRC_ID_MAX=<n> on a line of its own').toBe(true);
    // A sanity band around the 174 that path-identity spec §2.9 (SEC5) states; the number itself is derived above.
    expect(NAME_MAX - WIDEST).toBeGreaterThanOrEqual(160);
    expect(NAME_MAX - WIDEST).toBeLessThanOrEqual(200);
    const defs = [...ccd.matchAll(/^_REG_ID_MAX=(\d+)$/gm)].map((m) => Number(m[1]));
    expect(defs, 'ccd/ccd defines _REG_ID_MAX=<n> exactly once').toHaveLength(1);
    expect(defs[0], 'min(NAME_MAX − the widest overhead, CCRC_ID_MAX)').toBe(CAP);
    // The comment names what decides the number: the widest template, and the hook's gate.
    const at = ccd.indexOf('\n_REG_ID_MAX=');
    const block = ccd.slice(ccd.lastIndexOf('\n# THE COMPOSED-ID CAP', at), at);
    for (const r of ID_NAME_TEMPLATES.filter((x) => x.overhead === WIDEST)) {
      expect(block, `the cap's comment names the widest template ${r.template}`).toContain(r.template);
    }
    expect(block, "the cap's comment names the hook's gate").toContain('CCRC_ID_MAX');
  });

  it('every name template that embeds an id is in the census table', () => {
    const files = SCANNED();
    expect(files.length, 'the census scans something').toBeGreaterThan(100);
    for (const r of ID_NAME_TEMPLATES) expect(files, `${r.template}'s file is one the census scans`).toContain(r.file);
    for (const x of CENSUS_EXCLUDED) {
      expect(files, `${x.file} exists, so its exclusion is not stale`).toContain(x.file);
      expect(censusHits([x.file]).length, `${x.file} still holds a hit, so its exclusion is not stale`).toBeGreaterThan(0);
      expect(x.reason.length, `${x.file} says why it is left out`).toBeGreaterThan(0);
    }
    const excluded = new Set(CENSUS_EXCLUDED.map((x) => x.file));
    const hits = censusHits(files.filter((f) => !excluded.has(f)));
    expect(hits.length, 'the scan finds templates at all').toBeGreaterThan(300);
    expect(hits.filter((x) => !covered(x.shape)).map((x) => `${x.file}:${x.line} ${x.shape}`),
      'a name embeds an id and no census row covers it').toEqual([]);
    expect(ID_NAME_TEMPLATES.filter((r) => !hits.some((x) => x.file === r.file && x.shape === r.template))
      .map((r) => `${r.file} ${r.template}`), 'a census row names a template its file no longer holds').toEqual([]);
    // The field family is taken at the longest field literal in the tree.
    const fields = [...read('ccd/ccd').matchAll(/\b_reg_(?:set|get|read)\s+"?\$\{?[A-Za-z_0-9]+\}?"?\s+([a-z][a-z0-9_-]*)/g)]
      .map((m) => m[1]);
    expect(fields.length, 'the field scan finds the registry writers and readers').toBeGreaterThan(40);
    expect(Math.max(...fields.map((f) => f.length)), 'FIELD_MAX is the longest registry field literal').toBe(FIELD_MAX);
  });

  it('each mint site carries its own die line', () => {
    const ccd = read('ccd/ccd');
    const DIE = /_reg_id_cap "[^"\n]+" \|\| die "\$_REG_ID_CAP_WHY — [^"\n]+; nothing was created"/g;
    for (const fn of ['cmd_ws_add', 'cmd_start', 'cmd_enable']) {
      expect(bodyOf(ccd, fn).match(DIE) ?? [], `${fn} holds exactly one _reg_id_cap … || die "$_REG_ID_CAP_WHY …" line`)
        .toHaveLength(1);
    }
    expect(ccd.match(/_reg_id_cap "/g) ?? [], 'the three mint sites are the cap\'s only callers').toHaveLength(3);
    // ws-add: appended to the slug line (line-neutral), before the fetch and the worktree.
    const add = bodyOf(ccd, 'cmd_ws_add');
    expect(add).toContain('|| die "could not find a free slug for $project"; }; _reg_id_cap "$project-$slug" '
      + '|| die "$_REG_ID_CAP_WHY — choose a shorter project or slug; nothing was created"\n');
    expect(add.indexOf('_reg_id_cap "$project-$slug"')).toBeLessThan(add.indexOf('git -C "$main" fetch origin'));
    // start: directly after the creating form composes the id, whether or not the row exists.
    expect(bodyOf(ccd, 'cmd_start')).toMatch(
      /\n {4}id=\$\(_id "\$wrapper" "\$project"\)\n {4}_reg_id_cap "\$id" \|\| die "\$_REG_ID_CAP_WHY — choose a shorter project; nothing was created"\n/);
    // enable: before the expiry refusal and before the journal.
    const en = bodyOf(ccd, 'cmd_enable');
    const cap = en.indexOf('_reg_id_cap "$id"');
    expect(cap, 'cmd_enable calls the cap').toBeGreaterThan(-1);
    expect(cap).toBeLessThan(en.indexOf('_ws_expire_refuse_return "$id" enable'));
    expect(cap).toBeLessThan(en.indexOf('_lc_done enable'));
    // One definition each, and one source for the sentence.
    expect(ccd.match(/^_reg_id_cap\(\) \{/gm) ?? []).toHaveLength(1);
    expect(ccd.match(/^_REG_ID_CAP_WHY=/gm) ?? []).toHaveLength(1);
    expect(ccd.match(/fits the 255-byte name limit/g) ?? [], "the cap's sentence has one source").toHaveLength(1);
    expect(bodyOf(ccd, '_reg_id_cap'), 'the cap counts BYTES: local LC_ALL=C in its own body').toContain('local LC_ALL=C');
  });

  it('ws-add creates an id of exactly _REG_ID_MAX', () => {
    const project = 'p'.repeat(CAP - 1 - 'quiet-mesa'.length);
    const id = `${project}-quiet-mesa`;
    expect(id).toHaveLength(CAP);
    h.makeRepo(project);
    const r = run(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add ${project}`);
    expect(r.code, r.stderr).toBe(0);
    expect(h.reg(id, 'uuid'), 'the row of an id exactly at the cap exists').not.toBeNull();
    expect(fs.existsSync(path.join(h.home, 'worktrees', project, 'quiet-mesa'))).toBe(true);
  }, 60_000);

  it('ws-add refuses one byte more, leaving no row, no worktree and no ws/<slug> branch', () => {
    const project = 'p'.repeat(CAP - 'quiet-mesa'.length);
    const id = `${project}-quiet-mesa`;
    expect(id).toHaveLength(CAP + 1);
    const main = h.makeRepo(project);
    for (const argv of [`cmd_ws_add ${project} quiet-mesa`, `CCD_WS_SLUG=quiet-mesa cmd_ws_add ${project}`]) {
      const r = run(`${WS_ADD} ${argv}`);
      expect(r.code, argv).not.toBe(0);
      expect(r.stderr, argv).toContain(capSentence(id, 'choose a shorter project or slug'));
      expect(h.reg(id, 'uuid'), `${argv}: no row`).toBeNull();
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.uuid`)), `${argv}: no .uuid`).toBe(false);
      expect(fs.existsSync(path.join(h.home, 'worktrees', project)), `${argv}: no worktree directory`).toBe(false);
      expect(h.git(main, 'branch', '--list', 'ws/quiet-mesa'), `${argv}: no ws/quiet-mesa branch`).toBe('');
    }
  }, 60_000);

  it('start creates _REG_ID_MAX, and refuses one more with no supervised start', () => {
    const ok = 'q'.repeat(CAP - 'claude-b-'.length);
    const okId = `claude-b-${ok}`;
    expect(okId).toHaveLength(CAP);
    fs.mkdirSync(path.join(h.home, 'projects', ok), { recursive: true });
    const a = run(`${STUBS} cmd_start claude-b ${ok}`);
    expect(a.code, a.stderr).toBe(0);
    expect(h.reg(okId, 'uuid'), 'the row of an id exactly at the cap exists').not.toBeNull();
    expect(supervisedStarts()).toContain(`supervised_start ${okId}`);

    const over = 'q'.repeat(CAP - 'claude-b-'.length + 1);
    const overId = `claude-b-${over}`;
    expect(overId).toHaveLength(CAP + 1);
    fs.mkdirSync(path.join(h.home, 'projects', over), { recursive: true });
    const b = run(`${STUBS} cmd_start claude-b ${over}`);
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain(capSentence(overId, 'choose a shorter project'));
    expect(h.reg(overId, 'uuid'), 'no row for one byte more').toBeNull();
    expect(supervisedStarts().filter((c) => c.includes(overId)), 'no supervised start for one byte more').toEqual([]);
  }, 60_000);

  it('start refuses an over-cap id even when its row already exists', () => {
    const over = 'q'.repeat(CAP - 'claude-b-'.length + 1);
    const overId = `claude-b-${over}`;
    seedRow(overId, 'claude-b', over);
    const r = run(`${STUBS} cmd_start claude-b ${over}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(capSentence(overId, 'choose a shorter project'));
    expect(h.reg(overId, 'uuid'), 'the planted row is left as it was').toBe(PLANTED_UUID);
    expect(supervisedStarts(), 'no supervised start').toEqual([]);
  }, 60_000);

  it('enable refuses one more before it journals, and enables exactly _REG_ID_MAX', () => {
    const over = 'q'.repeat(CAP - 'claude-b-'.length + 1);
    const overId = `claude-b-${over}`;
    fs.mkdirSync(path.join(h.home, 'projects', over), { recursive: true });
    const r = run(`${STUBS} cmd_enable claude-b ${over}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(capSentence(overId, 'choose a shorter project'));
    expect(eventsOf(h.home, 'enable'), 'no enable row: the cap answers before the journal').toEqual([]);
    expect(eventsOf(h.home, 'start'), 'and start was never reached').toEqual([]);
    expect(supervisedStarts(), 'no supervised start').toEqual([]);
    // THE ACCEPT HALF (path-identity spec §2.8: one pin at the cap and one past it, at every mint site).
    const ok = 'q'.repeat(CAP - 'claude-b-'.length);
    const okId = `claude-b-${ok}`;
    expect(okId).toHaveLength(CAP);
    fs.mkdirSync(path.join(h.home, 'projects', ok), { recursive: true });
    const a = run(`${STUBS} cmd_enable claude-b ${ok}`);
    expect(a.code, a.stderr).toBe(0);
    expect(eventsOf(h.home, 'enable').map((e) => e['id']), 'the id at the cap was enabled').toEqual([okId]);
    expect(supervisedStarts()).toContain(`supervised_start ${okId}`);
  }, 60_000);

  it('enable <id> stays uncapped for a hand-planted row over the cap, which the two-argument form refuses', () => {
    // The cap binds the MINT sites, and enable mints only on its two-argument form (`<wrapper> <project>` composes the
    // id). `enable <id>` names a row that already exists, so it asks no cap: refusing it would strand a session whose
    // row predates the cap. The `$# >= 2` guard around the cap is the whole exemption, and a `>= 1` there would
    // cap the one-argument form too.
    const over = 'q'.repeat(CAP - 'claude-b-'.length + 1);
    const overId = `claude-b-${over}`;
    expect(overId).toHaveLength(CAP + 1);
    seedRow(overId, 'claude-b', over);
    // The CONTROL: the same row, named by its pair, is refused with the cap's words and nothing is journaled, so
    // the one-argument success below is the exemption's and not a cap that never binds.
    const pair = run(`${STUBS} cmd_enable claude-b ${over}`);
    expect(pair.code, pair.stdout).not.toBe(0);
    expect(pair.stderr).toContain(capSentence(overId, 'choose a shorter project'));
    expect(eventsOf(h.home, 'enable'), 'the two-argument form journaled an enable row').toEqual([]);
    expect(supervisedStarts(), 'the two-argument form asked for a supervised start').toEqual([]);
    // The id form: startable, journaled and supervised, with the planted row as it was.
    const r = run(`${STUBS} cmd_enable ${overId}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr, 'the cap answered the one-argument form').not.toContain('may be at most');
    expect(eventsOf(h.home, 'enable').map((e) => e['id']), 'the over-cap row was enabled').toEqual([overId]);
    expect(supervisedStarts(), 'the over-cap row was started').toContain(`supervised_start ${overId}`);
    expect(h.reg(overId, 'uuid'), 'the planted row is left as it was').toBe(PLANTED_UUID);
  }, 60_000);
});
