// The parity of the `mailhold` grammar's readers (mid-turn mail plan 2026-11-19, Task 3.3; spec §3.3 "one owner of the
// grammar"): every row of `fixtures/mailhold-grammar.json` gets the same accept or refuse from `parseMailHold`
// (`shared/mailHold.ts`, the owner) and from ccd's `_route_valid mailhold` (fixture HOME), bounds, digit widths and the
// eight-pair edge included, as `_hook_server_cap`'s copies are held to `parseServerCaps`. The session hook's builtin
// parse is the third reader (plan Task 5.2): each row is written as the marker, verbatim as ccd's `_reg_set` writes it,
// and a fixture hook run of a gated act in shadow says whether the hook read it (a log line: `would`, `lapsed` or
// `far`) or refused it (no line).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdSource, ghContainedEnv, makeCcdHarness, stubContainedTool, type CcdHarness } from './ccdWsHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { MAILHOLD_REACH_S, MAILHOLD_RE_BODY, parseMailHold } from '../../shared/mailHold.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CCD_SRC = ccdSource();
const CORPUS = (JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'mailhold-grammar.json'), 'utf8')) as {
  rows: { name: string; value: string; ok: boolean }[];
}).rows;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-mailhold-parity-'); });
afterEach(() => { h.cleanup(); });

describe('ccd\'s _route_valid mailhold and parseMailHold agree on every corpus row', () => {
  it('the corpus has both answers, and no NUL (a value reaches ccd only through argv)', () => {
    expect(CORPUS.some((r) => r.ok) && CORPUS.some((r) => !r.ok)).toBe(true);
    for (const r of CORPUS) expect(r.value.includes('\0'), r.name).toBe(false);
  });

  it('every row, in one shell, fed NUL-separated so a newline or a tab reaches the reader whole', () => {
    const file = path.join(h.home, 'mailhold-values');
    writeFileSync(file, CORPUS.map((r) => `${r.value}\0`).join(''));
    const out = h.sh(`while IFS= read -r -d '' x; do _route_valid mailhold "$x"; printf '%s\\n' "$?"; done < ${JSON.stringify(file)}`);
    const rcs = out.split('\n');
    expect(rcs).toHaveLength(CORPUS.length);
    CORPUS.forEach((r, i) => {
      expect(rcs[i], `${r.name}: ccd`).toBe(r.ok ? '0' : '1');
      expect(parseMailHold(r.value).ok, `${r.name}: parseMailHold`).toBe(r.ok);
    });
  });

  it('the same under a UTF-8 locale, where a range could collate other digits in', () => {
    const file = path.join(h.home, 'mailhold-values');
    writeFileSync(file, CORPUS.map((r) => `${r.value}\0`).join(''));
    const out = h.sh(`while IFS= read -r -d '' x; do _route_valid mailhold "$x"; printf '%s\\n' "$?"; done < ${JSON.stringify(file)}`,
      { LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' });
    CORPUS.forEach((r, i) => { expect(out.split('\n')[i], r.name).toBe(r.ok ? '0' : '1'); });
  });
});

describe('the copies are the owner\'s', () => {
  it('ccd\'s mailhold row is MAILHOLD_RE_BODY, character for character', () => {
    const rows = CCD_SRC.split('\n').filter((l) => /^\s*mailhold\) \[\[ "\$v" =~ /.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trim()).toBe(`mailhold) [[ "$v" =~ ${MAILHOLD_RE_BODY} ]] ;;`);
  });

  it('ccd\'s reach is MAILHOLD_REACH_S', () => {
    expect(h.sh('printf %s "$MAILHOLD_REACH_S"')).toBe(String(MAILHOLD_REACH_S));
  });

  it('ccd compares until base 10 at its write site (plan P14)', () => {
    const bound = CCD_SRC.split('\n').filter((l) => l.includes('mailhold-far:'));
    expect(bound).toHaveLength(1);
    expect(bound[0]).toContain('(( 10#${v%%:*} <= now + MAILHOLD_REACH_S ))');
  });
});

describe('the session hook\'s builtin parse agrees with parseMailHold on every corpus row (plan Task 5.2)', () => {
  const HOOK = path.resolve(HERE, '../../ccd/session-hook.sh');
  const HOOK_SRC = readFileSync(HOOK, 'utf8');
  const ID = 'lane-a-project-a';
  let home: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    home = mkTmp('ccrc-mailhold-hookparity-');
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), 'gen-1');
    env = ghContainedEnv(home, { ...process.env, HOME: home, TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242' },
      { systemd: true, tmux: true });
    stubContainedTool(home, 'tmux', `#!/bin/sh\necho "cc-${ID}"\n`);
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  /** Whether the hook read `value` as a marker: a gated act in shadow logs a line for every marker it reads. */
  const hookReads = (value: string, over: NodeJS.ProcessEnv = {}): boolean => {
    fs.rmSync(path.join(home, '.ccrc'), { recursive: true, force: true });
    fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.mailhold`), value);
    const r = spawnSyncGroup('bash', [HOOK], { encoding: 'utf8', env: { ...env, ...over }, timeout: 60_000,
      input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'uuid-1', tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: home }) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout, 'shadow: nothing is said').toBe('');
    const log = path.join(home, '.ccrc', 'mail-hold-shadow.log');
    return fs.existsSync(log) && /\trefuse\t(would|lapsed|far)\t/.test(fs.readFileSync(log, 'utf8'));
  };

  it('every row, the hook beside the owner', () => {
    for (const r of CORPUS) expect(hookReads(r.value), `${r.name}: the hook`).toBe(r.ok);
  }, 300_000);

  it('the same under a UTF-8 locale, where a range could collate other digits in', () => {
    for (const r of CORPUS) expect(hookReads(r.value, { LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' }), `${r.name}: the hook, UTF-8`).toBe(r.ok);
  }, 300_000);

  it('the hook\'s copy is MAILHOLD_RE_BODY, character for character, its reach MAILHOLD_REACH_S, compared base 10', () => {
    const rows = HOOK_SRC.split('\n').filter((l) => /^\s*if \[\[ "\$v" =~ \^/.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trim()).toBe(`if [[ "$v" =~ ${MAILHOLD_RE_BODY} && "$now" =~ ^[0123456789]+$ ]]; then`);
    const bound = HOOK_SRC.split('\n').filter((l) => l.includes('st=lapsed'));
    expect(bound).toHaveLength(1);
    expect(bound[0]).toContain('(( 10#${v%%:*} <= now ))');
    expect(bound[0]).toContain(`(( 10#\${v%%:*} > now + ${MAILHOLD_REACH_S} ))`);
  });
});
