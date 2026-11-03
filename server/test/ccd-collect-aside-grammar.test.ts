// path-identity W2, Task 8 (TR6 A, the grammar; path-identity spec §3.6). A crash inside the compare-and-drop can leave
// its aside, `$REG/tmproots/.<id>.drop.<pid>`, standing with no witness. Before anything reads an aside for an id (the
// admission and the settle, later in this wave), its name and its body each get exactly one definition:
//   - `_ws_tmproot_aside_path ID PID`, the one composer, spelled so `ccd-id-cap.test.ts`'s census reads it; the
//     compare-and-drop names its aside through it, with its OWN pid;
//   - `_ws_collect_aside_id NAME`, the one exact parser: never a prefix, and only for an id a witness is named for;
//   - `_ws_tmproot_witness_parse PATH ID`, the witness reader's body made path-parameterised, so an aside "parses"
//     exactly when it would read sound as the witness once restored (`_ws_tmproot_witness_read` is unchanged);
//   - `_ws_collect_asides_of ID`, the lister, which never reads a `tmproots/` it could not list as "no aside".
// No behaviour changes in this task.
// FIXTURE HOMES ONLY (`makePrHarness`): every path derives from `h.home`, and every call is a SOURCED function. Nothing
// here runs a verb or the in-use walk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { ccdSource } from './ccdWsHelpers.js';
import { COL_ID, type Orphan, makeOrphan, regOf, witnessOf } from './wsCollectFixture.js';
import { LINUX, NO_COPY, ROOT_USER } from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-aside-grammar-'); });
afterEach(() => { h.cleanup(); });

const tmproots = (): string => path.join(regOf(h), 'tmproots');
const asideAt = (name: string): string => path.join(tmproots(), name);
/** A snippet's stdout. A snippet that fails answers its exit code and stderr instead of throwing. */
const sh = (snippet: string): string => {
  const r = h.run(snippet);
  return r.code === 0 ? r.stdout : `[exit ${r.code}] ${r.stderr.trim()}`;
};
/** The six fields, read with `-` defaults, so a function that does not exist yet answers instead of tripping `set -u`. */
const PRINT = 'printf \'[rc=%s] %s|%s|%s|%s|%s|%s\' "$?" "${_WS_WIT_RUN-}" "${_WS_WIT_DEV-}" "${_WS_WIT_INO-}"'
  + ' "${_WS_WIT_BTIME-}" "${_WS_WIT_UID-}" "${_WS_WIT_AT-}"';
const CLEARED = '[rc=2] |||||';

describe('_ws_collect_aside_id: a `.<id>.drop.<pid>` name, parsed EXACTLY (path-identity spec §3.6)', () => {
  /** The answer and the id, bracketed: the harness trims a trailing space. */
  const idOf = (name: string): string =>
    sh(`_ws_collect_aside_id '${name}'; printf '[rc=%s] [%s]' "$?" "\${_WS_ASIDE_ID-}"`);

  it.each([
    ['a plain id', '.a-b.drop.7', 'a-b'],
    ['a dotted id keeps its dots', '.a.b.drop.7', 'a.b'],
    ['greedy: only the last `.drop.<digits>` goes', '.a-b.drop.1.drop.2', 'a-b.drop.1'],
  ])('%s: %s is the aside of %s', (_label, name, id) => {
    expect(idOf(name)).toBe(`[rc=0] [${id}]`);
  });

  it.each([
    ['no pid', '.a-b.drop.'],
    ['a pid that is not all digits', '.a-b.drop.x'],
    ['no leading dot', 'a-b.drop.7'],
    ['a dot-leading id', '..x.drop.7'],
    ['a dash-leading id', '.-x.drop.7'],
    ['the witness writer’s temp file', '.a-b.1.2.tmp'],
  ])('%s (%s) is no aside: rc 1, and no id', (_label, name) => {
    expect(idOf(name)).toBe('[rc=1] []');
  });

  it('a refusal clears the id a previous parse set', () => {
    expect(sh('_ws_collect_aside_id .a-b.drop.7; _ws_collect_aside_id .a-b.drop.x;'
      + ' printf \'[rc=%s] [%s]\' "$?" "${_WS_ASIDE_ID-}"')).toBe('[rc=1] []');
  });

  it('its body holds ONE re=\'…\', the grammar the server’s lane is held equal to', () => {
    const src = ccdSource();
    const at = src.indexOf('\n_ws_collect_aside_id() {');
    expect(at, '_ws_collect_aside_id is defined in ccd/ccd').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect([...body.matchAll(/ re='([^']+)'/g)].map((m) => m[1])).toEqual(['^\\.(.+)\\.drop\\.([0-9]+)$']);
  });
});

describe('_ws_tmproot_aside_path: the ONE composer of an aside’s name (path-identity spec §3.6)', () => {
  it('composes $REG/tmproots/.<id>.drop.<pid>, and the parser reads the name back to its id', () => {
    expect(sh('_ws_tmproot_aside_path a-b 42')).toBe(asideAt('.a-b.drop.42'));
    expect(sh('_ws_collect_aside_id "$(basename "$(_ws_tmproot_aside_path a-b 42)")";'
      + ' printf \'[rc=%s] [%s]\' "$?" "${_WS_ASIDE_ID-}"')).toBe('[rc=0] [a-b]');
  });

  it('is the only spelling of an aside’s name in ccd’s code, braced as the id-cap census reads it', () => {
    const src = ccdSource();
    const def = [...src.matchAll(/^_ws_tmproot_aside_path\(\) \{.*$/gm)].map((m) => m[0]);
    expect(def, 'one definition, on one line').toHaveLength(1);
    expect(def[0], 'the braces are what ccd-id-cap’s census reads').toContain('printf \'%s\' "$REG/tmproots/.${id}.drop.${pid}"');
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /\.\$\{?id\}?\.drop\./.test(l)), 'a second spelling of the name').toEqual([def[0]]);
    expect(code.filter((l) => l.includes('_ws_tmproot_aside_path "$id" "$me"')),
      'the compare-and-drop names its aside through the composer, with the pid it read itself').toHaveLength(1);
  });

  it.skipIf(!LINUX || !NO_COPY)('the compare-and-drop names its aside through it with ITS OWN pid, never a subshell’s', () => {
    makeOrphan(h);
    const out = sh('mv() { printf \'%s\\n\' "${@: -1}" >> "$HOME/mv-calls"; command mv "$@"; };'
      + ` printf '%s' "$BASHPID" > "$HOME/me"; _ws_tmproot_witness_read ${COL_ID} || exit 7;`
      + ` _ws_collect_witness_cad ${COL_ID} "$_WS_WIT_DEV" "$_WS_WIT_INO" "$_WS_WIT_BTIME" "$_WS_WIT_RUN" "$_WS_WIT_AT";`
      + ' printf \'[rc=%s] %s\' "$?" "$_WS_CAD"');
    expect(out).toBe('[rc=0] dropped');
    const me = fs.readFileSync(path.join(h.home, 'me'), 'utf8');
    expect(fs.readFileSync(path.join(h.home, 'mv-calls'), 'utf8').split('\n').filter(Boolean),
      'the one NOREPLACE move, to this process’s aside').toEqual([asideAt(`.${COL_ID}.drop.${me}`)]);
    expect(fs.readdirSync(tmproots()), 'the collected witness is gone, and no aside is left').toEqual([]);
  }, 60_000);
});

describe('_ws_tmproot_witness_parse: the one witness-body parser, at any path (path-identity spec §3.6)', () => {
  let o: Orphan;
  beforeEach(() => { o = makeOrphan(h); });
  const ASIDE = `.${COL_ID}.drop.42`;
  const plant = (body: string, name: string = ASIDE): string => {
    fs.writeFileSync(asideAt(name), body);
    return asideAt(name);
  };
  /** A sound witness OUTSIDE `tmproots/`: the parser reads any path it is given. */
  const seed = (): string => {
    const p = path.join(h.home, 'seed', 'witness');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, o.witness);
    return p;
  };
  /** Parses the sound seed first, so a failing parse must also CLEAR every field. */
  const parse = (p: string, id: string = COL_ID): string =>
    sh(`_ws_tmproot_witness_parse '${seed()}' ${COL_ID} >/dev/null; _ws_tmproot_witness_parse '${p}' '${id}'; ${PRINT}`);
  /** `o.witness` padded through `dev`'s digits (leading zeros, which the grammar admits) to exactly `n` bytes. */
  const sized = (n: number): string =>
    o.witness.replace(` dev=${o.dev} `, ` dev=${'0'.repeat(n - Buffer.byteLength(o.witness))}${o.dev} `);

  it('an aside holding the witness byte for byte parses to the witness’s own fields, and so does a copy anywhere', () => {
    const viaRead = sh(`_ws_tmproot_witness_read ${COL_ID}; ${PRINT}`);
    expect(viaRead, 'the CONTROL: the reader takes the witness').toMatch(/^\[rc=0\] 7\|/);
    expect(viaRead).toContain(`|${o.dev}|${o.ino}|`);
    expect(parse(plant(o.witness))).toBe(viaRead);
    expect(sh(`_ws_tmproot_witness_parse '${seed()}' ${COL_ID}; ${PRINT}`)).toBe(viaRead);
  });

  it('an absent aside answers 1, every field cleared', () => {
    expect(parse(asideAt(`.${COL_ID}.drop.77`))).toBe('[rc=1] |||||');
  });

  it.each([
    ['a body naming another id', (w: string): string => w.replace(`id=${COL_ID} `, 'id=demo-quiet-other ')],
    ['two lines', (w: string): string => `${w}${w}`],
    ['no trailing newline', (w: string): string => w.slice(0, -1)],
  ])('rc 2 for %s, every field cleared', (_label, f) => {
    expect(parse(plant(f(o.witness)))).toBe(CLEARED);
  });

  it('rc 2 for a VALID-shape body one byte over the cap (513 bytes), every field cleared, and 512 is read', () => {
    expect(Buffer.byteLength(sized(513)), 'the CONTROL: the plant is 513 bytes').toBe(513);
    expect(parse(plant(sized(513)))).toBe(CLEARED);
    expect(parse(plant(sized(512)))).toMatch(new RegExp(`^\\[rc=0\\] 7\\|0+${o.dev}\\|${o.ino}\\|`));
  });

  it('rc 2 for a symlinked aside, even one that reaches the sound witness: a link is never followed, every field cleared', () => {
    fs.symlinkSync(witnessOf(h), asideAt(ASIDE));
    expect(parse(asideAt(ASIDE))).toBe(CLEARED);
  });

  it('rc 2 when tmproots/ ITSELF is a link, even to a directory holding a sound aside, every field cleared', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.renameSync(tmproots(), elsewhere);
    fs.writeFileSync(path.join(elsewhere, ASIDE), o.witness);
    fs.symlinkSync(elsewhere, tmproots());
    expect(parse(asideAt(ASIDE))).toBe(CLEARED);
  });

  it('the reader still refuses a dot-leading id, every field cleared, over a body the parser would take', () => {
    const name = '.hidden-id';
    const p = plant(o.witness.replace(`id=${COL_ID} `, `id=${name} `), name);
    expect(parse(p, name), 'the CONTROL: the body is sound for that id, so only the id gate refuses it').toMatch(/^\[rc=0\] 7\|/);
    expect(sh(`_ws_tmproot_witness_read ${COL_ID} >/dev/null; _ws_tmproot_witness_read '${name}'; ${PRINT}`)).toBe(CLEARED);
  });
});

describe('_ws_collect_asides_of: every aside of the id, and never "none" for a tmproots/ it could not list', () => {
  const ID = COL_ID;
  const of = (id: string = ID): { rc: string; why: string; asides: string[] } => {
    const [rc = '', why = '', list = ''] = sh(`_ws_collect_asides_of '${id}'; rc=$?;`
      + ' printf \'%s\\x1f%s\\x1f\' "$rc" "${_WS_ASIDES_WHY-}";'
      + ' for a in ${_WS_ASIDES[@]+"${_WS_ASIDES[@]}"}; do printf \'%s\\n\' "$a"; done').split('\x1f');
    return { rc, why, asides: list.split('\n').filter(Boolean).sort() };
  };
  const plantNames = (...names: string[]): void => {
    fs.mkdirSync(tmproots(), { recursive: true });
    for (const n of names) fs.writeFileSync(asideAt(n), 'x\n');
  };
  /** The lister under a private TMPDIR, and what it left there. */
  const scratch = (): string => sh(`export TMPDIR="$HOME/scratch"; mkdir -p "$TMPDIR"; _ws_collect_asides_of ${ID}; rc=$?;`
    + ' n=$(ls -A "$TMPDIR" | wc -l); printf \'[rc=%s] scratch=%s\' "$rc" "$((n))"');

  it('lists exactly the asides of the id, and prints nothing', () => {
    plantNames(`.${ID}.drop.1`, `.${ID}.drop.22`, `.${ID}.drop.x`, `.${ID}.v2-x.drop.3`, `.${ID}.drop.1.drop.2`,
      `.${ID}.1.2.tmp`, ID);
    // The CONTROL, measured: the prefix glob an exact parse replaces sees another id's aside too.
    expect(sh(`compgen -G '${tmproots()}/.${ID}.*' | sort`).split('\n')).toContain(asideAt(`.${ID}.v2-x.drop.3`));
    expect(of()).toEqual({ rc: '0', why: '', asides: [asideAt(`.${ID}.drop.1`), asideAt(`.${ID}.drop.22`)].sort() });
    expect(sh(`_ws_collect_asides_of ${ID}`), 'it prints nothing').toBe('');
  }, 60_000);

  it('an aside of a NESTED id is that id’s alone', () => {
    plantNames(`.${ID}.drop.1`, `.${ID}.v2-x.drop.3`);
    expect(of(`${ID}.v2-x`)).toEqual({ rc: '0', why: '', asides: [asideAt(`.${ID}.v2-x.drop.3`)] });
  });

  it('no tmproots/ at all, PROVEN absent, is no aside: rc 0, nothing', () => {
    expect(fs.existsSync(tmproots()), 'the CONTROL: the harness made none').toBe(false);
    expect(of()).toEqual({ rc: '0', why: '', asides: [] });
  });

  it('a LINKED tmproots/, and a FILE there, answer 2, never "none"', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, `.${ID}.drop.1`), 'x\n');
    fs.symlinkSync(elsewhere, tmproots());
    const linked = of();
    expect({ rc: linked.rc, asides: linked.asides }).toEqual({ rc: '2', asides: [] });
    expect(linked.why).toContain('is a link');
    fs.unlinkSync(tmproots());
    fs.writeFileSync(tmproots(), 'x');
    const file = of();
    expect({ rc: file.rc, asides: file.asides }).toEqual({ rc: '2', asides: [] });
    expect(file.why).toContain('is not a directory');
  }, 60_000);

  it.each([['.x'], ['-x']])('an id no aside is named for (%j) answers 2 and lists nothing', (id) => {
    plantNames(`.${ID}.drop.1`);
    const a = of(id);
    expect({ rc: a.rc, asides: a.asides }).toEqual({ rc: '2', asides: [] });
    expect(a.why).toContain('is not an id an aside is named for');
  });

  it.skipIf(ROOT_USER)('a tmproots/ that cannot be LISTED answers 2, and leaves no scratch file', () => {
    plantNames(`.${ID}.drop.1`);
    fs.chmodSync(tmproots(), 0o300);
    try {
      const a = of();
      expect({ rc: a.rc, asides: a.asides }).toEqual({ rc: '2', asides: [] });
      expect(a.why).toContain('could not list');
      expect(scratch()).toBe('[rc=2] scratch=0');
    } finally { fs.chmodSync(tmproots(), 0o700); }
  }, 60_000);

  it.skipIf(ROOT_USER)('under a $REG that cannot be SEARCHED, an aside that stands is never "none": 2, with the reason', () => {
    plantNames(`.${ID}.drop.1`);
    const mode = fs.statSync(regOf(h)).mode & 0o777;
    fs.chmodSync(regOf(h), 0o600);
    try {
      const a = of();
      expect({ rc: a.rc, asides: a.asides }).toEqual({ rc: '2', asides: [] });
      expect(a.why).toContain('cannot be searched');
    } finally { fs.chmodSync(regOf(h), mode); }
  });

  it('a listing leaves no scratch file behind', () => {
    plantNames(`.${ID}.drop.1`, `.${ID}.drop.2`);
    expect(scratch()).toBe('[rc=0] scratch=0');
  });
});
