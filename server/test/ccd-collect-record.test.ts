// The temp-root collector's QUARANTINE RECORD (child reclamation wave 7,
// spec §5.10): `$REG/tmpquarantine/<id>.<ns>.<pid>`, written before
// anything moves and dropped last, the collector's resume authority. One
// versioned key=value line: the witness line the act was taken on, the token,
// and the checkouts the pre-move question let pass, in `_ws_collect_enc`'s
// spelling. It names NO slot path (ruling G5): the slot is DERIVED from the
// record's name under the physical quarantine. Found by EXACT parse —
// the name less its two trailing all-digit dot-fields — never by a `<id>.*`
// prefix, because ids admit dots. `tmpquarantine/` is a DOTLESS registry
// subdirectory, as `tmproots/` is: no registry walker sees it.
//
// FIXTURE HOMES ONLY (`makePrHarness`, built on `makeCcdHarness`): every
// registry, record and leaf is under the harness's HOME. Nothing here runs a
// destructive verb.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { seedRoster } from './helpers.js';
import { localIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { readRegistryMeasured } from '../src/registry.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-record-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const NS = '1791470480213200844';
const PID = '4242';
const TOKEN = 'ab'.repeat(32);
const ROOT_USER = process.getuid?.() === 0;
const reg = (): string => path.join(h.home, '.cc-sessions');
const qrecDir = (): string => path.join(reg(), 'tmpquarantine');
const recPath = (id: string = ID, ns: string = NS, pid: string = PID): string => path.join(qrecDir(), `${id}.${ns}.${pid}`);
/** The PHYSICAL quarantine, as ccd derives it (`_ws_collect_qpath`); `~/.cc-tmp` is made so that it resolves. */
const qOf = (): string => {
  fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
  return path.join(fs.realpathSync(path.join(h.home, '.cc-tmp')), '.ccd-quarantine');
};
const slotOf = (id: string = ID, ns: string = NS, pid: string = PID): string => path.join(qOf(), `slot.${id}.${ns}.${pid}`);
const leaf = (id: string = ID): string => path.join(h.home, '.cc-tmp', id);

/** The REAL witness of `id`'s leaf, written and read, so `_WS_WIT_*` hold it. */
const WITNESS = (id: string = ID, runId = '7'): string =>
  `mkdir -p -m 0700 "${leaf(id)}" && _ws_tmproot_witness_write ${id} "${leaf(id)}" ${runId} && _ws_tmproot_witness_read ${id};`;
/** Witness, then the record — the writer's answer and why. */
const write = (opts: { id?: string; slot?: string; token?: string; pre?: string } = {}): { rc: string; why: string } => {
  const id = opts.id ?? ID;
  const [rc = '', why = ''] = h.sh(`${opts.pre ?? WITNESS(id)} _ws_collect_record_write '${id}' '${opts.slot ?? slotOf(id)}' '${opts.token ?? TOKEN}';`
    + ' rc=$?; printf \'%s\\x1f%s\' "$rc" "$_WS_QREC_WHY"').split('\x1f');
  return { rc, why };
};
const FIELDS = '"$_WS_QREC_ID|$_WS_QREC_SLOT|$_WS_QREC_DEV|$_WS_QREC_INO|$_WS_QREC_BTIME|$_WS_QREC_RUN|$_WS_QREC_AT|$_WS_QREC_TOKEN|$_WS_QREC_CHECKOUTS"';
/** Reads a GOOD record first, so a failing read must also CLEAR every field. */
const read = (file: string): string => {
  const seed = recPath('demo-good-seed', '1', '2');
  fs.mkdirSync(qrecDir(), { recursive: true });
  qOf();
  fs.writeFileSync(seed, `v=1 id=demo-good-seed dev=1 ino=2 btime=3 run=4 at=1791470480213 token=${TOKEN} checkouts=\n`);
  return h.sh(`_ws_collect_record_read '${seed}' >/dev/null; _ws_collect_record_read '${file}'; printf '[rc=%s] %s' "$?" ${FIELDS}`);
};
const EMPTY = '||||||||';
const GOOD = (): string =>
  `v=1 id=${ID} dev=2064 ino=35 btime=1791468463 run=7 at=1791470480213 token=${TOKEN} checkouts=\n`;
const plant = (text: string, file: string = recPath()): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe('_ws_collect_record_write: one line, temp file then rename, proven by reading it back', () => {
  it('writes ONE versioned line naming the witness it acted on, the token and no checkouts — and no slot path (G5)', () => {
    const w = write();
    expect(w.rc, w.why).toBe('0');
    const wit = fs.readFileSync(path.join(reg(), 'tmproots', ID), 'utf8').trim();
    const f = (k: string): string => new RegExp(` ${k}=(\\S+)`).exec(wit)![1]!;
    expect(fs.readFileSync(recPath(), 'utf8')).toBe(
      `v=1 id=${ID} dev=${f('dev')} ino=${f('ino')} btime=${f('btime')} run=7 at=${f('at')} token=${TOKEN} checkouts=\n`);
    expect(fs.readdirSync(qrecDir()), 'temp file then rename: nothing else is left').toEqual([`${ID}.${NS}.${PID}`]);
    expect((fs.statSync(qrecDir()).mode & 0o777).toString(8), 'made 0700 on first write').toBe('700');
  });

  it('a checkout pair whose paths hold a space, a comma, an `=` and a `%` is spelled %XX, and reads back whole', () => {
    const admin = '/r 2,x=%/.git/worktrees/wt';
    const back = '/h/.cc-tmp/x/wt/.git';
    const spelled = '/r%202%2Cx%3D%25/.git/worktrees/wt=/h/.cc-tmp/x/wt/.git';
    const w = write({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED="$(_ws_collect_enc '${admin}')=$(_ws_collect_enc '${back}')";` });
    expect(w.rc, w.why).toBe('0');
    expect(fs.readFileSync(recPath(), 'utf8')).toContain(` checkouts=${spelled}\n`);
    expect(read(recPath()).split('|')[8]).toBe(spelled);
  });

  it('the checkouts are the caller’s last _WS_CHECKOUTS_ACCEPTED, carried in their own spelling', () => {
    const co = '/r/.git/worktrees/wt=/h/.cc-tmp/x/wt/.git,/r%202/.git/worktrees/b=/h/.cc-tmp/x/b/.git';
    const w = write({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED='${co}';` });
    expect(w.rc, w.why).toBe('0');
    expect(fs.readFileSync(recPath(), 'utf8')).toMatch(new RegExp(` checkouts=${co.replace(/[.%/]/g, '\\$&')}\\n$`));
  });

  it.each([
    ['an id no witness is named for', () => ({ id: '.hidden' }), 'not an id a witness is named for'],
    ['a slot named for ANOTHER id', () => ({ slot: slotOf('demo-quiet-reef') }), 'is not a slot named for'],
    ['a slot named for a NESTED id', () => ({ slot: slotOf('demo-quiet-mesa.v2-x') }), 'is not a slot named for'],
    ['a slot with no `slot.` prefix', () => ({ slot: `/x/${ID}.${NS}.${PID}` }), 'not a quarantine slot'],
    ['a relative slot', () => ({ slot: `slot.${ID}.${NS}.${PID}` }), 'not a quarantine slot'],
    ['a slot outside the physical quarantine', () => ({ slot: path.join(h.home, 'elsewhere', `slot.${ID}.${NS}.${PID}`) }), 'is not in the quarantine'],
    ['a token ccd never mints', () => ({ token: 'XYZ' }), 'not one ccd mints'],
    ['no witness read', () => ({ pre: '' }), 'no witness of'],
    ['a witness with no birth time', () => ({ pre: `${WITNESS()} _WS_WIT_BTIME=-;` }), 'no witness of'],
    ['a checkouts list ccd never writes', () => ({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED='a b=c';` }), 'not a list ccd writes'],
  ] as const)('refuses %s: rc 1, nothing written', (_label, opts, why) => {
    const w = write(opts());
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain(why);
    expect(fs.existsSync(qrecDir()) ? fs.readdirSync(qrecDir()) : []).toEqual([]);
  });

  it('a record that stands is NEVER overwritten', () => {
    plant('a record that stands\n');
    const w = write();
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain('never overwritten');
    expect(fs.readFileSync(recPath(), 'utf8')).toBe('a record that stands\n');
  });

  it('a LINKED tmpquarantine/ is refused, never written through', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, qrecDir());
    const w = write();
    expect(w.rc, w.why).toBe('1');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(w.why, 'refused AT the link — not by the read-back of a record already written through it').toContain('is a link');
  });

  it('a FILE at tmpquarantine/ is refused', () => {
    fs.writeFileSync(qrecDir(), 'in the way');
    expect(write().rc).toBe('1');
  });

  it('a record that would pass the size cap is not written', () => {
    const big = Array.from({ length: 700 }, (_, i) => `/r/.git/worktrees/w${i}=/h/.cc-tmp/x/${'p'.repeat(80)}${i}/.git`).join(',');
    const w = write({ pre: `${WITNESS()} _WS_CHECKOUTS_ACCEPTED='${big}';` });
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain('more than 65536 bytes');
  });

  it('a record that does not read back is removed, and answers 1', () => {
    const w = write({ pre: `${WITNESS()} _ws_collect_record_read() { return 2; };` });
    expect(w.rc, w.why).toBe('1');
    expect(w.why).toContain('did not read back');
    expect(fs.existsSync(recPath())).toBe(false);
  });
});

describe('_ws_collect_record_read: parsed, absent, malformed or unmeasured — four answers, every field cleared first', () => {
  it('rc 0 sets every field; the slot is DERIVED from the name under the physical quarantine, and the checkouts stay spelled', () => {
    plant(GOOD().replace('checkouts=', 'checkouts=/a%20b=/c'));
    expect(read(recPath())).toBe(`[rc=0] ${ID}|${slotOf()}|2064|35|1791468463|7|1791470480213|${TOKEN}|/a%20b=/c`);
  });

  it('rc 1 when nothing stands there', () => {
    expect(read(recPath())).toBe(`[rc=1] ${EMPTY}`);
  });

  it('rc 3 when the physical quarantine cannot be resolved — UNMEASURED, never malformed: the slot is derived, never read from the body', () => {
    plant(GOOD());
    fs.rmSync(path.join(h.home, '.cc-tmp'), { recursive: true, force: true });
    const [got = '', why = ''] = h.sh(`_ws_collect_record_read '${recPath()}'; printf '[rc=%s] %s\\x1f%s' "$?" ${FIELDS} "$_WS_QPATH_WHY"`)
      .split('\x1f');
    expect(got, 'a sound record whose slot cannot be derived now is retried, never kept as malformed').toBe(`[rc=3] ${EMPTY}`);
    expect(why, 'the resolver’s reason is left for the caller').toContain('cannot be resolved');
  });

  it.each([
    ['no trailing newline', (g: string) => g.slice(0, -1)],
    ['a second line', (g: string) => `${g}${g}`],
    ['another id in the body', (g: string) => g.replace(`id=${ID}`, 'id=demo-quiet-reef')],
    ['a body that still names a slot (the field G5 removed)', (g: string) => g.replace(' dev=', ' slot=/q/slot.x dev=')],
    ['a birth time of -', (g: string) => g.replace('btime=1791468463', 'btime=-')],
    ['a run outside the grammar', (g: string) => g.replace('run=7', 'run=07')],
    ['an unknown version', (g: string) => g.replace('v=1', 'v=2')],
    ['keys out of order', (g: string) => g.replace('dev=2064 ino=35', 'ino=35 dev=2064')],
    ['a token ccd never mints', (g: string) => g.replace(TOKEN, 'X'.repeat(64))],
    ['a checkouts list ccd never writes', (g: string) => g.replace('checkouts=', 'checkouts=a,')],
    ['an oversize body', (g: string) => `${g.slice(0, -1)}${'%41'.repeat(22000)}\n`],
  ])('rc 2 for %s', (_label, edit) => {
    plant(edit(GOOD()));
    expect(read(recPath())).toBe(`[rc=2] ${EMPTY}`);
  });

  it('rc 2 for a NAME that is no record’s — dot-leading, or no two trailing all-digit fields', () => {
    for (const n of [`.${ID}.${NS}.${PID}`, `${ID}.${NS}`, `${ID}.${NS}.x`, `.${ID}.${NS}.${PID}.4242.17.tmp`]) {
      const f = path.join(qrecDir(), n);
      plant(GOOD(), f);
      expect(read(f), n).toBe(`[rc=2] ${EMPTY}`);
    }
  });

  it('rc 2 for a directory, a link to a GOOD record, and a linked tmpquarantine/', () => {
    fs.mkdirSync(recPath(), { recursive: true });
    expect(read(recPath())).toBe(`[rc=2] ${EMPTY}`);
    fs.rmdirSync(recPath());
    const good = path.join(h.home, 'good');
    fs.writeFileSync(good, GOOD());
    fs.symlinkSync(good, recPath());
    expect(read(recPath())).toBe(`[rc=2] ${EMPTY}`);
    fs.rmSync(qrecDir(), { recursive: true });
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `${ID}.${NS}.${PID}`), GOOD());
    fs.symlinkSync(elsewhere, qrecDir());
    expect(h.sh(`_ws_collect_record_read '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=2]');
  });

  it('CONTROL: what the writer writes, the reader reads', () => {
    const w = write();
    expect(w.rc, w.why).toBe('0');
    expect(read(recPath())).toMatch(new RegExp(`^\\[rc=0\\] ${ID}\\|${slotOf().replace(/[.]/g, '\\.')}\\|\\d+\\|\\d+\\|[1-9]\\d*\\|7\\|\\d{13}\\|${TOKEN}\\|$`));
  });
});

describe('_ws_collect_records_of: EXACT parse — a nested id is never matched', () => {
  const NESTED = 'p-calm-mesa.v2-quiet-river';
  const of = (id: string): { rc: string; out: string; arr: string } => {
    const [rc = '', out = '', arr = ''] = h.sh(`out=$(_ws_collect_records_of '${id}'); rc=$?; _ws_collect_records_of '${id}' >/dev/null;`
      + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$out" "\${_WS_QRECS[*]-}"`).split('\x1f');
    return { rc, out, arr };
  };

  it('p-calm-mesa finds its own record and not p-calm-mesa.v2-quiet-river’s — and the reverse', () => {
    plant('x\n', recPath('p-calm-mesa', '11', '1'));
    plant('x\n', recPath(NESTED, '22', '2'));
    // The CONTROL, measured: the prefix glob the exact parse replaces matches BOTH.
    expect(h.sh(`compgen -G '${qrecDir()}/p-calm-mesa.*' | sort`).split('\n'))
      .toEqual([recPath('p-calm-mesa', '11', '1'), recPath(NESTED, '22', '2')].sort());
    expect(of('p-calm-mesa')).toEqual({ rc: '0', out: recPath('p-calm-mesa', '11', '1'), arr: recPath('p-calm-mesa', '11', '1') });
    expect(of(NESTED)).toEqual({ rc: '0', out: recPath(NESTED, '22', '2'), arr: recPath(NESTED, '22', '2') });
  });

  it('every record of the id is listed; a writer’s dot-leading temp file and a foreign name are not', () => {
    plant('x\n', recPath(ID, '11', '1'));
    plant('x\n', recPath(ID, '12', '2'));
    plant('x\n', path.join(qrecDir(), `.${ID}.${NS}.${PID}.4242.17.tmp`));
    plant('x\n', path.join(qrecDir(), `${ID}.notdigits.1`));
    plant('x\n', path.join(qrecDir(), ID));
    expect(of(ID).out.split('\n').sort()).toEqual([recPath(ID, '11', '1'), recPath(ID, '12', '2')].sort());
  });

  it('no tmpquarantine/ at all — PROVEN absent — is no record: rc 0, nothing', () => {
    expect(of(ID)).toEqual({ rc: '0', out: '', arr: '' });
  });

  it('a LINKED tmpquarantine/, and a FILE there, answer 2 — never "no record"', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `${ID}.${NS}.${PID}`), 'x');
    fs.symlinkSync(elsewhere, qrecDir());
    expect(of(ID).rc).toBe('2');
    fs.unlinkSync(qrecDir());
    fs.writeFileSync(qrecDir(), 'x');
    expect(of(ID).rc).toBe('2');
  });

  it.skipIf(ROOT_USER)('a tmpquarantine/ that cannot be LISTED answers 2', () => {
    plant('x\n', recPath());
    fs.chmodSync(qrecDir(), 0o300);
    try {
      const a = of(ID);
      expect(a.rc).toBe('2');
      expect(h.sh(`_ws_collect_records_of ${ID} >/dev/null; printf '%s' "$_WS_QRECS_WHY"`)).toContain('could not list');
    } finally { fs.chmodSync(qrecDir(), 0o700); }
  });
});

describe('_ws_collect_record_drop: the record goes, PROVEN — and nothing that is not one', () => {
  it('drops a record and proves it gone', () => {
    plant('x\n', recPath());
    expect(h.sh(`_ws_collect_record_drop '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=0]');
    expect(fs.existsSync(recPath())).toBe(false);
  });

  it.each([
    ['a path outside tmpquarantine/', (): string => path.join(h.home, `${ID}.${NS}.${PID}`)],
    ['a dot-leading temp file', (): string => path.join(qrecDir(), `.${ID}.${NS}.${PID}.1.2.tmp`)],
    ['a name that is no record’s', (): string => path.join(qrecDir(), ID)],
  ])('%s answers 1 and is untouched', (_label, p) => {
    plant('keep\n', p());
    expect(h.sh(`_ws_collect_record_drop '${p()}'; echo "[rc=$?]"`)).toBe('[rc=1]');
    expect(fs.readFileSync(p(), 'utf8')).toBe('keep\n');
  });

  it('an rm that answers 0 and removed nothing is not proven gone: 2', () => {
    plant('x\n', recPath());
    expect(h.sh(`rm() { return 0; }; _ws_collect_record_drop '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=2]');
    expect(fs.existsSync(recPath())).toBe(true);
  });

  it('a DIRECTORY at the record’s name cannot be removed: 2', () => {
    fs.mkdirSync(path.join(recPath(), 'inside'), { recursive: true });
    expect(h.sh(`_ws_collect_record_drop '${recPath()}'; echo "[rc=$?]"`)).toBe('[rc=2]');
    expect(fs.existsSync(path.join(recPath(), 'inside'))).toBe(true);
  });
});

describe('$REG/tmpquarantine is invisible to every registry walker (spec §5.10, the tmproots/ precedent)', () => {
  /** Where ccd ITSELF keeps its records — never this file's own spelling of
   *  it — so each walker below is asked about the place ccd writes, wherever
   *  that is. */
  const qdir = (): string => h.sh('_ws_collect_qrec_dir');
  const seed = (id: string): void => {
    h.sh(`_reg_set ${id} wrapper claude
          _reg_set ${id} workdir '${h.home}'
          _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  };
  /** A record of ID, written by the REAL writer, where ccd keeps it. */
  const recorded = (): { file: string; bytes: string } => {
    const w = write();
    expect(w.rc, `the CONTROL: the record was written — ${w.why}`).toBe('0');
    const file = path.join(qdir(), `${ID}.${NS}.${PID}`);
    return { file, bytes: fs.readFileSync(file, 'utf8') };
  };

  it('_reg_purge takes the row and leaves the record standing', () => {
    seed(ID);
    const r = recorded();
    h.sh(`_reg_purge ${ID}`);
    for (const f of ['uuid', 'wrapper', 'workdir']) expect(h.reg(ID, f), f).toBeNull();
    expect(fs.readFileSync(r.file, 'utf8')).toBe(r.bytes);
  });

  it('survives _reg_purge of a session whose id IS `tmpquarantine` — the collision shape', () => {
    const r = recorded();
    fs.writeFileSync(path.join(reg(), 'tmpquarantine.uuid'), 'u');
    fs.writeFileSync(path.join(reg(), 'tmpquarantine.wrapper'), 'claude');
    h.sh('_reg_purge tmpquarantine');
    expect(fs.existsSync(path.join(reg(), 'tmpquarantine.wrapper')), 'the CONTROL: that row was purged').toBe(false);
    expect(fs.readFileSync(r.file, 'utf8')).toBe(r.bytes);
  });

  it('a slug whose only trace is its record reads FREE, and _ws_slug_residue names nothing', () => {
    recorded();
    fs.rmSync(path.join(reg(), 'tmproots'), { recursive: true });
    expect(h.sh('_ws_slug_free demo quiet-mesa && echo free || echo taken')).toBe('free');
    expect(h.sh('_ws_slug_residue demo quiet-mesa')).toBe('');
  });

  it('`ccd ls` lists no row for it', () => {
    recorded();
    const out = h.sh('cmd_ls');
    expect(out).toContain('(no sessions)');
    expect(out).not.toContain('tmpquarantine');
  });

  it('the server’s registry read derives no session from it — the row beside it is the only one', async () => {
    seed('demo-calm-cove');
    recorded();
    seedRoster(h.home);
    const cfg = loadConfig({ CCRC_HOME: h.home, CCRC_PROJECTS_ROOT: path.join(h.home, 'projects') } as never);
    const r = await readRegistryMeasured(localIO, cfg);
    expect(r.listed).toBe(true);
    if (!r.listed) return;
    expect(r.names, 'the CONTROL: the listing does carry the directory').toContain(path.basename(qdir()));
    expect(r.records.map((x) => x.id)).toEqual(['demo-calm-cove']);
  });

  it('`tmpquarantine` is spelled only inside the COLLECT region, and its one walker is depth-1 and name-filtered', () => {
    // The census of THIS directory. The name-agnostic walker census in
    // `ccd-child-tmproot-witness.test.ts` proves no registry glob or find can
    // see a dotless subdirectory; this proves who may name this one.
    const src = fs.readFileSync(CCD, 'utf8');
    const b = src.indexOf('COLLECT-BEGIN');
    const e = src.indexOf('COLLECT-END');
    expect(b, 'COLLECT-BEGIN').toBeGreaterThan(-1);
    expect(e, 'COLLECT-END').toBeGreaterThan(b);
    const outside: string[] = []; const walkers: string[] = []; let at = 0;
    src.split('\n').forEach((line, i) => {
      const off = at; at += line.length + 1;
      if (/^\s*#/.test(line) || !line.includes('tmpquarantine')) return;
      if (off < b || off > e) outside.push(`ccd:${i + 1}: ${line.trim()}`);
      if (/\bfind\b/.test(line)) walkers.push(line.trim());
    });
    expect(outside).toEqual([]);
    expect(walkers).toHaveLength(1);
    expect(walkers[0]).toMatch(/-maxdepth 1\b/);
    expect(walkers[0]).toMatch(/-name\b/);
    for (const other of fs.readdirSync(path.dirname(CCD))) {
      const p = path.join(path.dirname(CCD), other);
      if (other === 'ccd' || !fs.statSync(p).isFile()) continue;
      const code = fs.readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('tmpquarantine'));
      expect(code, `ccd/${other} names tmpquarantine`).toEqual([]);
    }
  });
});
