// server/test/session-hook-steer.test.ts
// ccrc history W3-1 Task 1C (spec 2026-10-05 §7.2, §7.7; plan 2026-10-29-ccrc-history-w3-steering.md): the steer print and its
// receipt, armed by `~/.ccrc/history/steer-on/<id>` only, through ccd/session-hook.sh in a fixture HOME. Every run asserts the hook
// contract (exit 0, silent stderr) and that the steer directory is byte, inode and mtime identical after it (PX13, behavioural half).
// The harness is COPIED from session-hook.test.ts and session-hook-compact-carry.test.ts (a test file cannot import another).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { tl } from './compactCardFixtures.js';
import { itLinux, IS_DARWIN } from './platformFixtures.js';
import {
  STEER_FIRST_LINE, STEER_GENERIC_TEXT, STEER_FILE_MAX, BACKENDS, steerFileOf, composeSteerFile, makePairIndex, parseSpoolLine, cardLine,
} from '../../ccd/history/lib.mjs';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const ANCHOR = '# @anchor compact-arm-emit-call';
const CALL_LINE = 'if [[ "$event" == PreCompact ]]; then _hook_history_pre || true; fi';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const G2 = '0189abcd-1234-5678-9abc-0123456789ff';
const ID = 'demo-quiet-basin';
const SID = '7d0c3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const LEAF = 'L0123456789abcdef0123';
const LIVE = 5;
const DEAD = 600;
const ROOT = process.getuid?.() === 0;
/** The operator's own session must not reach the hook through `process.env` (spec §10.1). */
const SCRUB: Record<string, string> = {
  TMUX: '', CLAUDE_CONFIG_DIR: '', CLAUDECODE: '',
  ...Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('CCRC_RECALL_') || k.startsWith('HISTORY_TEST_')).map((k) => [k, ''])),
};

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-steer-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);   // 36 bytes, no LF: the writer's contract
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), '');
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => {
  for (const f of ['off-root']) { try { fs.chmodSync(path.join(home, f), 0o700); } catch { /* absent */ } }
  fs.rmSync(home, { recursive: true, force: true });
});

const histDir = (...p: string[]): string => path.join(home, '.ccrc', 'history', ...p);
const reg = (f: string): string => path.join(home, '.cc-sessions', f);
const steerFile = (): string => steerFileOf(home, ID, SID);
const hookEnv = (env: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, CLAUDE_JOB_DIR: '',
  ...SCRUB, ...env,
});

/** The steer directory as a signature: every entry's path, type, inode, mode, size, mtime and (for a file) its bytes. */
const steerSig = (): string => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      out.push([path.relative(home, p), st.isDirectory() ? 'd' : st.isFile() ? 'f' : st.isSymbolicLink() ? 'l' : 'o', st.ino, st.mode, st.size, st.mtimeMs,
        st.isFile() ? fs.readFileSync(p).toString('hex') : ''].join(' '));
      if (st.isDirectory()) { try { fs.accessSync(p, fs.constants.R_OK | fs.constants.X_OK); walk(p); } catch { /* unsearchable: recorded as itself */ } }
    }
  };
  if (fs.existsSync(histDir('steer'))) { try { walk(histDir('steer')); } catch { out.push('unreadable'); } }
  return out.join('\n');
};

interface Ran { status: number | null; stdout: string; stderr: string }
/** One hook run: exit 0, silent stderr, and the steer directory untouched, asserted every time (PX13, the behavioural half). */
const run = (payload: object, env: Record<string, string> = {}, opts: { timeout?: number; stderr?: 'silent' | 'any' } = {}): Ran => {
  const before = steerSig();
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env), timeout: opts.timeout ?? 60_000, killSignal: 'SIGKILL',
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  if (opts.stderr !== 'any') expect(r.stderr, 'the hook is silent on stderr').toBe('');
  expect(steerSig(), 'the hook changed the steer directory (PX13)').toBe(before);
  // A PreCompact leaves its compaction set, which the NEXT PreCompact in the same HOME reads as an overlap (`ambiguous`, §3.0); PostCompact
  // consumes it in life. Dropped here so a case that runs the hook twice measures each run alone.
  for (const f of ['compactset', 'compactcard']) fs.rmSync(reg(`${ID}.${f}`), { force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

/** A session's transcripts under a fixture `~/.claude/projects/<slug>/` (the scope rule is an mtime rule). */
const plantSession = (opts: {
  sid?: string; lines: string[]; parentAge?: number; subagents?: { id: string; lines: string[]; age: number }[];
}): { transcript: string } => {
  const sid = opts.sid ?? SID;
  const proj = path.join(home, '.claude', 'projects', '-home-u-tree');
  fs.mkdirSync(proj, { recursive: true });
  const transcript = path.join(proj, `${sid}.jsonl`);
  fs.writeFileSync(transcript, opts.lines.join('\n') + '\n');
  const now = Math.floor(Date.now() / 1000);
  const pt = now - (opts.parentAge ?? DEAD);
  fs.utimesSync(transcript, pt, pt);
  for (const a of opts.subagents ?? []) {
    const dir = path.join(proj, sid, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `agent-${a.id}.jsonl`);
    fs.writeFileSync(f, a.lines.join('\n') + '\n');
    fs.utimesSync(f, now - a.age, now - a.age);
  }
  return { transcript };
};
const mainTranscript = (): string => plantSession({ lines: [tl.user('x')] }).transcript;
const pre = (transcript: string, trigger = 'manual', extra: object = {}): object =>
  ({ hook_event_name: 'PreCompact', trigger, cwd: home, transcript_path: transcript, session_id: SID, prompt_id: 'p1', custom_instructions: null, ...extra });
const start = (extra: object = {}): object =>
  ({ hook_event_name: 'SessionStart', source: 'compact', cwd: home, transcript_path: path.join(home, 't.jsonl'),
    session_id: SID, prompt_id: 'p1', model: 'claude-opus-5', ...extra });

const mk = (p: string, mode = 0o700): void => { fs.mkdirSync(p, { recursive: true, mode }); };
const touch = (p: string): void => { mk(path.dirname(p)); fs.writeFileSync(p, ''); };
const arm = (): void => touch(histDir('steer-on', ID));
const plantSpool = (): void => mk(histDir('spool'));
const plantScope = (): void => mk(histDir('scope'));
const plantSteer = (content: string | Buffer): void => {
  mk(histDir('steer', ID));
  fs.writeFileSync(steerFile(), content, { mode: 0o600 });
};
/** The standard armed fixture: armed, a spool/ to receive the receipt, a main transcript. Returns the PreCompact payload. */
const armed = (trigger = 'manual'): object => { arm(); plantSpool(); return pre(mainTranscript(), trigger); };
const spoolLines = (): string[] => {
  const p = histDir('spool', `${ID}.jsonl`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '') : [];
};
const receipts = (): Array<Record<string, unknown>> => spoolLines().map((l) => JSON.parse(l) as Record<string, unknown>).filter((o) => o['ev'] === 'steer');
/** The one receipt, asserted to parse under lib's grammar. */
const oneReceipt = (): Record<string, unknown> => {
  const lines = spoolLines().filter((l) => l.includes('"ev":"steer"'));
  expect(lines, 'exactly one steer receipt').toHaveLength(1);
  const p = parseSpoolLine(lines[0]!);
  expect(p.ok, `the receipt parses under lib's grammar: ${lines[0]}`).toBe(true);
  return (p as unknown as { rec: Record<string, unknown> }).rec;
};
const printed = (r: Ran): string => r.stdout;
/** What a print is: LF, the text, LF. */
const printOf = (text: string): string => `\n${text}\n`;
/** A steer file whose first line is the template's, then LF and `padding` bytes of ASCII `x`, to exactly `total` bytes. */
const FL_BYTES = Buffer.byteLength(STEER_FIRST_LINE);
const sized = (total: number, pad = 'x'): string => `${STEER_FIRST_LINE}\n${pad.repeat(total - FL_BYTES - 1)}`;
const composed = (leafId = LEAF, prev: Parameters<typeof composeSteerFile>[0]['prev'] = null): string =>
  `${composeSteerFile({ leafId, prev, children: [], pairIdx: makePairIndex([]) }).text}\n`;


// ── PX13, the static half: the scanner lives here, as two functions ─────────────────────────────────────────────────────────────
const SEED_RE = /\.ccrc\/history\/steer(?=[/"'\s]|$)/;
/** One word's text from `i`: quotes (`"`, `'`, `$'`) and `${ }`/`$( )` nesting kept whole, ending at unquoted whitespace. */
const wordAt = (line: string, i: number): string => {
  let j = i; let dq = false; let sq = false; let depth = 0;
  for (; j < line.length; j += 1) {
    const c = line[j]!;
    if (sq) { if (c === "'") sq = false; continue; }
    if (c === '\\') { j += 1; continue; }
    if (c === '"') { dq = !dq; continue; }
    if (!dq && c === "'") { sq = true; continue; }
    if (c === '$' && (line[j + 1] === '{' || line[j + 1] === '(')) { depth += 1; j += 1; continue; }
    if (depth > 0 && (c === '}' || c === ')')) { depth -= 1; continue; }
    if (!dq && depth === 0 && /[\s;&|]/.test(c)) break;
  }
  return line.slice(i, j);
};
const codeLinesOf = (text: string): string[] => text.split('\n').filter((l) => !/^\s*#/.test(l));
/** Every assignment (plain, `local`, `readonly`) in the text as [name, value]. */
const assignments = (text: string): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  for (const line of codeLinesOf(text)) {
    for (const m of line.matchAll(/(?<![\w$])([A-Za-z_]\w*)=/g)) out.push([m[1]!, wordAt(line, m.index! + m[0].length)]);
  }
  return out;
};
const mentions = (v: string, n: string): boolean => new RegExp(`\\$\\{?${n}(?![A-Za-z0-9_])`).test(v);
/** The steer names: a variable whose assignment holds the seed path segment, or `$NAME` of an earlier steer name, to a fixpoint. */
const steerNames = (text: string): string[] => {
  const names: string[] = [];
  const as = assignments(text);
  for (let grew = true; grew;) {
    grew = false;
    for (const [n, v] of as) if (!names.includes(n) && (SEED_RE.test(v) || names.some((k) => mentions(v, k)))) { names.push(n); grew = true; }
  }
  return names;
};
/** The writing redirections' targets on one line: `>`, `>>`, `>|`, `&>`, `<>`, outside quotes, never a descriptor (`>&n`), `>=` or /dev/null. */
const writeTargets = (line: string): string[] => {
  const out: string[] = [];
  let dq = false; let sq = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (sq) { if (c === "'") sq = false; continue; }
    if (c === '\\') { i += 1; continue; }
    if (c === '"') { dq = !dq; continue; }
    if (dq) continue;
    if (c === "'") { sq = true; continue; }
    const writing = c === '>' || (c === '<' && line[i + 1] === '>');
    if (!writing) continue;
    let k = i + (c === '<' ? 2 : 1);
    if (line[k] === '>' || line[k] === '|') k += 1;
    if (line[k] === '&' || line[k] === '=') { i = k; continue; }          // `>&2`, `2>&1`, `>=`
    if (c === '>' && line[i - 1] === '=') continue;                         // `=>`
    while (line[k] === ' ') k += 1;
    const target = wordAt(line, k);
    if (target !== '/dev/null' && target !== '"/dev/null"') out.push(target);
    i = k;
  }
  return out;
};
// A command word starts the line, follows a separator or a leading keyword (`if`, `while`, `until` too), and may be path-prefixed or backslash-escaped.
const CMD_START = String.raw`(?:^\s*|[;&|({!]\s*|\b(?:then|do|else|elif|if|while|until|exec|command|sudo|time|nohup|env)\s+)`;
const CMD_PATH = String.raw`(?:\\|[\w.\/-]*\/)?`;
const WRITER = String.raw`(?:rm|mv|unlink|truncate|ln|cp|install|tee|dd)\b|sed\s+(?:-\S+\s+)*(?:-[A-Za-z]*i|--in-place)`;
const WRITER_WORD = new RegExp([
  `${CMD_START}${CMD_PATH}(?:${WRITER})`,                                                       // rm "$f", /bin/rm "$f", \rm "$f", sed -E -i … "$f", sed --in-place …
  `${CMD_START}${CMD_PATH}xargs\\b[^|;&]*?\\s${CMD_PATH}(?:${WRITER})`,                           // … | xargs rm, xargs -0 mv < "$f"
  `${CMD_START}${CMD_PATH}find\\b[^|;&]*?\\s(?:-delete\\b|-fprint\\w*|-fls\\b|-exec(?:dir)?\\s+${CMD_PATH}(?:${WRITER}))`, // find "$f" -delete, find … -exec rm
].join('|'));
/** The lines that remove, move, truncate or write a path in the steer directory (seed or steer name in an operand or a redirection target). */
const steerWriters = (text: string): string[] => {
  const names = steerNames(text);
  const holds = (v: string): boolean => SEED_RE.test(v) || names.some((n) => mentions(v, n));
  return codeLinesOf(text).filter((line) => (WRITER_WORD.test(line) && holds(line)) || writeTargets(line).some(holds)).map((l) => l.trim());
};

describe('PX13: the hook never consumes, writes, moves or deletes a steer file (static half)', () => {
  const hookText = fs.readFileSync(HOOK, 'utf8');
  const SEED = 'HISTORY_STEER_DIR="$HOME/.ccrc/history/steer"\n_hs_sf="$HISTORY_STEER_DIR/$id/$psid.txt"\n';
  it('no command in session-hook.sh removes, moves, truncates or writes a path in the steer directory', () => {
    // the real hook is seeded, so its empty answer is not vacuous
    expect(steerNames(hookText)).toContain('HISTORY_STEER_DIR');
    expect(steerNames(hookText)).toContain('_hs_sf');
    expect(steerWriters(hookText)).toEqual([]);
    // the contained mutant: a deletion through a seeded variable
    expect(steerNames(`${SEED}rm -f -- "$_hs_sf"`)).toEqual(['HISTORY_STEER_DIR', '_hs_sf']);
    expect(steerWriters(`${SEED}rm -f -- "$_hs_sf"`)).toHaveLength(1);
    // the control: the same seeded variable in the legitimate bounded read and its stderr redirect
    expect(steerNames(`${SEED}{ IFS= read -r -N 8193 t < "$_hs_sf"; } 2>/dev/null`)).toEqual(['HISTORY_STEER_DIR', '_hs_sf']);
    expect(steerWriters(`${SEED}{ IFS= read -r -N 8193 t < "$_hs_sf"; } 2>/dev/null`)).toEqual([]);
  });
  it('the scanner sees each writing shape, and no reading one', () => {
    for (const bad of ['mv "$_hs_sf" /x', 'x && unlink "$_hs_sf"', 'truncate -s 0 "$_hs_sf"', 'tee "$_hs_sf" < in', 'cp in "$_hs_sf"', 'ln -s a "$_hs_sf"',
      'dd of="$_hs_sf"', 'sed -i s/a/b/ "$_hs_sf"', '  rm -f -- "$_hs_sf"', '\tmv "$_hs_sf" /x', '  sed -i s/a/b/ "$_hs_sf"', '    if x; then\n      rm -f -- "$_hs_sf"\n    fi', 'x || rm "$_hs_sf"', '! rm "$_hs_sf"', 'else rm "$_hs_sf"', ': > "$_hs_sf"', 'echo x >> "$_hs_sf"', 'echo x >| "$_hs_sf"', 'echo x &> "$_hs_sf"', 'exec 3<> "$_hs_sf"',
      'printf x > "$HISTORY_STEER_DIR/x"', 'rm -rf "$HOME/.ccrc/history/steer"', 'if x; then rm "$_hs_sf"; fi',
      // the remaining writer forms: after a leading keyword, path-prefixed or escaped, through xargs or find, sed -i in its other spellings
      'if rm -f "$_hs_sf"; then', 'while rm "$_hs_sf"; do :; done', 'until mv "$_hs_sf" /x; do :; done', 'elif rm "$_hs_sf"; then',
      '/bin/rm "$_hs_sf"', '/usr/bin/mv "$_hs_sf" /x', '\\rm "$_hs_sf"', 'x && /bin/rm -f "$_hs_sf"',
      'xargs rm < "$_hs_sf"', 'printf %s "$_hs_sf" | xargs rm', 'printf %s "$_hs_sf" | xargs -0 -n1 mv -t /x', 'printf %s "$_hs_sf" | xargs sed -i s/a/b/',
      'find "$_hs_sf" -delete', 'find "$_hs_sf" -exec rm {} \\;', 'find "$HISTORY_STEER_DIR" -type f -exec /bin/mv {} /x +',
      'sed -E -i s/a/b/ "$_hs_sf"', 'sed -n -i s/a/b/ "$_hs_sf"', 'sed -E -n -i.bak s/a/b/ "$_hs_sf"', 'sed --in-place s/a/b/ "$_hs_sf"', 'sed -E --in-place=.bak s/a/b/ "$_hs_sf"']) {
      expect(steerWriters(`${SEED}${bad}`), bad).toHaveLength(1);
    }
    for (const ok of ['[[ -f "$_hs_sf" ]] && return 1', 'x=$(< "$_hs_sf")', 'cat "$_hs_sf" 2>&1', 'echo "$_hs_sf" >&2', 'echo "$_hs_sf" > /dev/null', '(( n >= 1 )) && echo "$_hs_sf"',
      'rm -f -- "$other"', 'echo x > "$other"', '# rm "$_hs_sf"', '  # rm "$_hs_sf"', '  { IFS= read -r -d "" -n 8193 t; } 2>/dev/null < "$_hs_sf" && return 1', '  [[ -f "$_hs_sf" && -r "$_hs_sf" ]] || return 1',
      'if [[ -f "$_hs_sf" ]]; then', 'while IFS= read -r -N 8193 t; do :; done < "$_hs_sf"', 'find "$other" -name x -type f', 'find "$_hs_sf" -maxdepth 0 -type f', 'find "$_hs_sf" -exec cat {} \\;',
      '# xargs rm "$_hs_sf"; find "$_hs_sf" -delete; rm "$_hs_sf"', 'sed -n -E s/a/b/p "$_hs_sf"', 'sed --expression=s/a/b/ "$_hs_sf"', 'printf %s "$_hs_sf" | xargs cat', 'xargs rm < "$other"']) {
      expect(steerWriters(`${SEED}${ok}`), ok).toEqual([]);
    }
  });
});

describe('the print: armed, scope main, and every refusal silent (spec §7.2, §7.7; W3-1 Task 1C)', () => {
  const cardOff = (): void => touch(path.join(home, '.ccrc', 'compact-card-off'));

  it('CONTROL: an armed, main-scope manual compaction with no steer file prints the generic text, LF first and LF last, on both scope arms', () => {
    const payload = armed();
    const r = run(payload);
    expect(printed(r)).toBe(printOf(STEER_GENERIC_TEXT));
    fs.rmSync(histDir('spool', `${ID}.jsonl`));
    cardOff();                                       // the card returns before scoping: the print's own verdict decides
    expect(printed(run(payload))).toBe(printOf(STEER_GENERIC_TEXT));
    fs.rmSync(histDir('spool', `${ID}.jsonl`));
    plantScope();                                    // and with the scope marker's block having decided it first
    expect(printed(run(payload))).toBe(printOf(STEER_GENERIC_TEXT));
  });

  it('PX10: an auto trigger with one live agent file → stdout empty', () => {
    arm(); plantSpool();
    const { transcript } = plantSession({ lines: [tl.user('x')], parentAge: DEAD, subagents: [{ id: 'a1', lines: [tl.user('y')], age: LIVE }] });
    expect(printed(run(pre(transcript, 'auto')))).toBe('');
    cardOff();
    expect(printed(run(pre(transcript, 'auto')))).toBe('');
    expect(receipts()).toEqual([]);
  });

  it('the §7.7 scope row: scope ambiguous, scope rc 1, and an empty transcript_path → stdout empty, on the card\'s verdict and the print\'s own', () => {
    arm(); plantSpool();
    const two = plantSession({ lines: [tl.user('x')], parentAge: DEAD,
      subagents: [{ id: 'a1', lines: [tl.user('y')], age: LIVE }, { id: 'a2', lines: [tl.user('z')], age: LIVE }] }).transcript;
    const live = plantSession({ lines: [tl.user('x')], parentAge: LIVE, subagents: [{ id: 'a1', lines: [tl.user('y')], age: LIVE }] }).transcript;
    const rows: Array<[string, object]> = [
      ['ambiguous: two live subagents', pre(two, 'auto')],
      ['ambiguous: a live parent beside a live subagent', pre(live, 'auto')],
      ['scope rc 1: no readable transcript', pre(path.join(home, 'missing.jsonl'))],
      ['an empty transcript_path', pre('', 'manual', { transcript_path: '' })],
    ];
    for (const off of [false, true]) {
      if (off) cardOff();
      for (const [what, payload] of rows) expect(printed(run(payload)), `${what}${off ? ' (card off)' : ''}`).toBe('');
    }
    const { transcript_path: _gone, ...bare } = pre('', 'manual') as Record<string, unknown>;
    expect(printed(run(bare)), 'the key absent altogether').toBe('');
    expect(receipts()).toEqual([]);
  });

  it('PX11: history-off, history-steer-off, a matching recall-off/<id>, and an unarmed session → stdout empty; compact-steer-off alone → still prints', () => {
    const payload = armed();
    plantSteer(composed());
    const refusals: Array<[string, () => void, () => void]> = [
      ['history-off', () => touch(path.join(home, '.ccrc', 'history-off')), () => fs.rmSync(path.join(home, '.ccrc', 'history-off'))],
      ['history-steer-off', () => touch(path.join(home, '.ccrc', 'history-steer-off')), () => fs.rmSync(path.join(home, '.ccrc', 'history-steer-off'))],
      ['a matching recall-off/<id>', () => { mk(histDir('recall-off')); fs.writeFileSync(histDir('recall-off', ID), `${GENERATION}\n`); }, () => fs.rmSync(histDir('recall-off', ID))],
      ['an unarmed session', () => fs.rmSync(histDir('steer-on', ID)), arm],
    ];
    for (const [what, on, off] of refusals) {
      on();
      expect(printed(run(payload)), what).toBe('');
      off();
    }
    expect(receipts(), 'no refusal left a receipt').toEqual([]);
    expect(printed(run(payload)), 'CONTROL: with every switch back to its start the file prints').toBe(printOf(composed().slice(0, -1)));
    touch(path.join(home, '.ccrc', 'compact-steer-off'));
    expect(printed(run(payload)), 'compact-steer-off is Plan B\'s switch: it changes nothing here').toBe(printOf(composed().slice(0, -1)));
  });

  it('a session id over 224 chars, and a psid that is no lowercase UUID, print nothing', () => {
    const payload = armed();
    expect(printed(run({ ...payload, session_id: 'sess-1' }))).toBe('');
    expect(printed(run({ ...payload, session_id: SID.toUpperCase() }))).toBe('');
    for (const [n, ok] of [[224, true], [225, false]] as const) {
      const id = 'a'.repeat(n);
      fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${id}"\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(home, '.cc-sessions', `${id}.generation`), GENERATION);
      touch(histDir('steer-on', id));
      expect(printed(run(payload)) !== '', `${n} chars`).toBe(ok);
    }
  });

  it('an arming marker that is a link, a directory or absent does not arm', () => {
    const payload = armed();
    fs.rmSync(histDir('steer-on', ID));
    fs.writeFileSync(path.join(home, 'marker-target'), '');
    fs.symlinkSync(path.join(home, 'marker-target'), histDir('steer-on', ID));
    expect(printed(run(payload)), 'a link').toBe('');
    fs.rmSync(histDir('steer-on', ID));
    fs.mkdirSync(histDir('steer-on', ID));
    expect(printed(run(payload)), 'a directory').toBe('');
    fs.rmdirSync(histDir('steer-on', ID));
    expect(printed(run(payload)), 'absent').toBe('');
  });

  it('only PreCompact prints a steer: SessionStart(compact) and PostCompact print none, armed with a file planted', () => {
    const payload = armed();
    plantSteer(composed());
    expect(printed(run(start()))).not.toContain('ccrc history archive entry');
    expect(printed(run({ ...(payload as object), hook_event_name: 'PostCompact', compact_summary: 'x' }))).toBe('');
    expect(spoolLines().filter((l) => l.includes('"ev":"steer"'))).toEqual([]);
  });

  it('PX12: an unreadable steer file, a directory, a link, a FIFO and a linked or unsearchable steer directory → stdout empty', () => {
    const payload = armed();
    plantSteer(composed());
    if (!ROOT) {
      fs.chmodSync(steerFile(), 0o000);
      expect(printed(run(payload)), 'an unreadable file').toBe('');
      fs.chmodSync(steerFile(), 0o600);
    }
    fs.rmSync(steerFile());
    fs.mkdirSync(steerFile());
    expect(printed(run(payload)), 'a directory').toBe('');
    fs.rmdirSync(steerFile());
    fs.writeFileSync(path.join(home, 'steer-target'), composed());
    fs.symlinkSync(path.join(home, 'steer-target'), steerFile());
    expect(printed(run(payload)), 'a link to a good file').toBe('');
    fs.rmSync(steerFile());
    fs.symlinkSync(path.join(home, 'nowhere'), steerFile());
    expect(printed(run(payload)), 'a dangling link').toBe('');
    fs.rmSync(steerFile());
    execFileSync('mkfifo', [steerFile()]);
    expect(printed(run(payload, {}, { timeout: 20_000 })), 'a FIFO is never opened').toBe('');
    fs.rmSync(steerFile());
    fs.rmdirSync(histDir('steer', ID));
    mk(path.join(home, 'steer-real', ID)); fs.writeFileSync(path.join(home, 'steer-real', ID, `${SID}.txt`), composed());
    fs.symlinkSync(path.join(home, 'steer-real', ID), histDir('steer', ID));
    expect(printed(run(payload)), 'a linked steer/<id>').toBe('');
    fs.rmSync(histDir('steer', ID));
    if (!ROOT) {
      mk(histDir('steer', ID)); fs.writeFileSync(steerFile(), composed()); fs.chmodSync(histDir('steer', ID), 0o000);
      try { expect(printed(run(payload)), 'an unsearchable steer/<id>').toBe(''); } finally { fs.chmodSync(histDir('steer', ID), 0o700); }
    }
    expect(receipts()).toEqual([]);
  });

  it('PX17: a steer file beginning { or with another first line → no print', () => {
    const payload = armed();
    const good = composed();
    const rows: Array<[string, string | Buffer]> = [
      ['begins {', `{"not":"ours"}\n${good}`],
      ['a JSON file in the template\'s place', `{${good.slice(1)}`],
      ['another first line', `Some other first line\n${good.split('\n').slice(1).join('\n')}`],
      ['the first line with a trailing space', `${STEER_FIRST_LINE} \n${good.split('\n').slice(1).join('\n')}`],
      ['the first line with a CR', `${STEER_FIRST_LINE}\r\n${good.split('\n').slice(1).join('\n')}`],
      ['a leading LF', `\n${good}`],
      ['the first line cut short', `${STEER_FIRST_LINE.slice(0, -1)}\n`],
      ['empty', ''],
      ['one LF', '\n'],
    ];
    for (const [what, content] of rows) {
      plantSteer(content);
      expect(printed(run(payload)), what).toBe('');
    }
    expect(receipts()).toEqual([]);
    plantSteer(good);
    expect(printed(run(payload)), 'CONTROL: the intact file prints').not.toBe('');
  });

  it('PX18: armed, scope main, no steer file → the generic text, and the receipt\'s leaf is ""', () => {
    const payload = armed();
    expect(printed(run(payload))).toBe(printOf(STEER_GENERIC_TEXT));
    expect(oneReceipt()).toMatchObject({ v: 1, ev: 'steer', id: ID, sid: SID, leaf: '' });
    fs.rmSync(histDir('spool', `${ID}.jsonl`));
    mk(histDir('steer', ID));                         // the directory the card step made, with no file in it
    expect(printed(run(payload))).toBe(printOf(STEER_GENERIC_TEXT));
    expect(oneReceipt()['leaf']).toBe('');
  });

  it('after any withdrawal, an armed main-scope PreCompact prints the generic text, and its receipt\'s leaf is ""', () => {
    const payload = armed();
    plantSteer(composed());
    expect(printed(run(payload))).toBe(printOf(composed().slice(0, -1)));
    fs.rmSync(histDir('spool', `${ID}.jsonl`));
    fs.unlinkSync(steerFile());                       // the sweep's withdrawal: the file is gone, the directory stays
    expect(printed(run(payload))).toBe(printOf(STEER_GENERIC_TEXT));
    expect(oneReceipt()).toMatchObject({ ev: 'steer', leaf: '' });
  });

  it('a steered print is LF, the file\'s text and LF: the file\'s one trailing LF is stripped, so it has the generic variant\'s shape', () => {
    const payload = armed();
    const file = composed();
    expect(file.endsWith('\n') && !file.endsWith('\n\n')).toBe(true);
    plantSteer(file);
    expect(printed(run(payload)), 'the bytes printed').toBe(`\n${file.slice(0, -1)}\n`);
    expect(printed(run(payload)).startsWith('\n')).toBe(true);
    const quoted = composed(LEAF, { id: 'L89abcdef012345678901', range: '2026-10-29T07:05Z..2026-10-29T09:40Z', kind: 'steered_leaf', status: 'ok', gist: 'Moved the parser & kept <the> reader.', flag: false });
    plantSteer(quoted);
    expect(printed(run(payload))).toBe(`\n${quoted.slice(0, -1)}\n`);
    expect(oneReceiptLast()['leaf']).toBe(LEAF);
  });
});

/** The last steer receipt (a case that prints twice). */
const oneReceiptLast = (): Record<string, unknown> => {
  const lines = spoolLines().filter((l) => l.includes('"ev":"steer"'));
  const p = parseSpoolLine(lines[lines.length - 1]!);
  expect(p.ok).toBe(true);
  return (p as unknown as { rec: Record<string, unknown> }).rec;
};

describe('PX20: the steer file is read in bytes, at most 8,192 of them, and a NUL refuses it', () => {
  // Every row starts with the first line and an LF, so only its size or its NUL bytes can refuse it.
  const FIRST = Buffer.from(`${STEER_FIRST_LINE}\n`);
  const pad = (n: number, byte = 0x78): Buffer => Buffer.alloc(n, byte);
  const utf8Counts = spawnSync('bash', ['-c', 'x=$(printf "\\303\\251"); echo ${#x}'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', LC_ALL: 'C.UTF-8' } }).stdout.trim() === '1';
  if (!utf8Counts) console.warn('session-hook-steer: bash does not count a two-byte character as one under LC_ALL=C.UTF-8 here, so PX20\'s UTF-8 row is skipped');
  const printsOf = (content: Buffer, env: Record<string, string> = {}): string => { plantSteer(content); return printed(run(armed(), env)); };

  it('a 9 KB steer file → no print', () => {
    const f = Buffer.concat([FIRST, pad(9130)]);
    expect(f.length).toBe(9216);
    expect(printsOf(f)).toBe('');
  });
  it('exactly 8,192 bytes → printed whole; 8,193 → no print', () => {
    const f8192 = Buffer.concat([FIRST, pad(8106)]);
    const f8193 = Buffer.concat([FIRST, pad(8107)]);
    expect([f8192.length, f8193.length]).toEqual([STEER_FILE_MAX, STEER_FILE_MAX + 1]);
    expect(FIRST.length, 'the first line is 85 bytes and an LF').toBe(86);
    expect(printsOf(f8192)).toBe(`\n${f8192.toString('latin1')}\n`);
    expect(printsOf(f8193)).toBe('');
  });
  it.skipIf(!utf8Counts)('16,000 bytes of two-byte UTF-8 chars under LC_ALL=C.UTF-8 → no print (the read counts bytes, not characters)', () => {
    const left = 16000 - FIRST.length;
    const f = Buffer.concat([FIRST, Buffer.from('é'.repeat(Math.floor(left / 2)), 'utf8'), pad(left % 2)]);
    expect(f.length).toBe(16000);
    expect(Math.floor(left / 2), '7,957 two-byte characters').toBe(7957);
    expect(printsOf(f, { LC_ALL: 'C.UTF-8' })).toBe('');
  });
  it('8,192 non-NUL bytes and one NUL byte (8,193 on disk) → no print', () => {
    const f = Buffer.concat([FIRST, pad(8106), Buffer.from([0])]);
    expect(f.length).toBe(8193);
    expect(printsOf(f)).toBe('');
  });
  it('a 9 KB file whose bytes past the first 8,000 are NUL → no print', () => {
    const f = Buffer.concat([FIRST, pad(8000 - FIRST.length), Buffer.alloc(1216, 0)]);
    expect(f.length).toBe(9216);
    expect(printsOf(f)).toBe('');
  });
  it('a NUL in the middle of a small file → no print, and a small file without one prints', () => {
    expect(printsOf(Buffer.concat([FIRST, pad(100), Buffer.from([0]), pad(10)]))).toBe('');
    expect(printsOf(Buffer.concat([FIRST, pad(100)])).length).toBeGreaterThan(100);
  });
});

describe('PX22: a print that fails writes no receipt', () => {
  const runShell = (redirect: string): { out: string; err: string } => {
    arm(); plantSpool(); plantSteer(composed());
    const payload = pre(mainTranscript());
    const before = steerSig();
    const r = spawnSync('bash', ['-c', `bash "$0" ${redirect}; echo "rc=$?"`, HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(), timeout: 60_000 });
    expect(steerSig()).toBe(before);
    return { out: r.stdout, err: r.stderr };
  };
  it('CONTROL: the same run with stdout open writes its receipt', () => {
    expect(runShell('')).toMatchObject({ err: '' });
    expect(receipts()).toHaveLength(1);
  });
  it('stdout closed → exit 0, silent, no ev:"steer" line', () => {
    const r = runShell('>&-');
    expect(r.out, 'the hook\'s own exit status, through a shell that kept its stdout').toBe('rc=0\n');
    expect(r.err).toBe('');
    expect(spoolLines().filter((l) => l.includes('"ev":"steer"'))).toEqual([]);
  });
  itLinux('stdout a full device → exit 0, silent, no ev:"steer" line', () => {
    const r = runShell('> /dev/full');
    expect(r.out).toBe('rc=0\n');
    expect(r.err).toBe('');
    expect(spoolLines().filter((l) => l.includes('"ev":"steer"'))).toEqual([]);
  });
});

describe('the receipt: its grammar, its leaf, its place and its clock (O23 (d))', () => {
  const stubDate = (body: string): void => fs.writeFileSync(path.join(home, 'bin', 'date'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  /** A BASH_ENV that strips the dynamic EPOCHREALTIME builtin and, given a value, plants a plain one. */
  const epochEnv = (value: string | null): Record<string, string> => {
    const f = path.join(home, 'epochrealtime.bash');
    fs.writeFileSync(f, value === null ? 'unset EPOCHREALTIME\n' : `unset EPOCHREALTIME\nEPOCHREALTIME='${value}'\n`);
    return { BASH_ENV: f };
  };

  it('the receipt parses under lib\'s SPOOL_KEYS.steer and SPOOL_VALUE, and has exactly the planned shape', () => {
    const payload = armed();
    plantSteer(composed());
    expect(printed(run(payload))).not.toBe('');
    const rec = oneReceipt();
    expect(Object.keys(rec)).toEqual(['v', 'ev', 'id', 'sid', 'leaf', 'gen', 'ts']);
    expect(rec).toMatchObject({ v: 1, ev: 'steer', id: ID, sid: SID, leaf: LEAF, gen: GENERATION });
    expect(Number.isSafeInteger(rec['ts']) && (rec['ts'] as number) > 1_700_000_000_000).toBe(true);
    const line = spoolLines().find((l) => l.includes('"ev":"steer"'))!;
    expect(line).toMatch(/^\{"v":1,"ev":"steer","id":"demo-quiet-basin","sid":"[0-9a-f-]{36}","leaf":"L[0-9a-f]{20}","gen":"[0-9a-f-]{36}","ts":\d+\}$/);
    expect(fs.readFileSync(histDir('spool', `${ID}.jsonl`), 'utf8'), 'the fence: LF, the line, LF').toBe(`\n${line}\n`);
  });

  it('a malformed generation leaves gen out; a steer file naming no leaf id leaves leaf ""; the line still parses', () => {
    const payload = armed();
    plantSteer(composed().replace(`id="${LEAF}"`, 'id="L0123"'));
    expect(printed(run(payload, { CCRC_SESSION_GENERATION: 'not-a-uuid' }))).not.toBe('');
    const rec = oneReceipt();
    expect(rec['leaf']).toBe('');
    expect('gen' in rec).toBe(false);
  });

  it('with no spool/ the print still happens and no receipt, and no directory, is made; a linked spool/ is not written through', () => {
    arm(); plantSteer(composed());
    const payload = pre(mainTranscript());
    expect(printed(run(payload))).not.toBe('');
    expect(fs.existsSync(histDir('spool')), 'the hook never mkdirs').toBe(false);
    mk(path.join(home, 'elsewhere'));
    fs.symlinkSync(path.join(home, 'elsewhere'), histDir('spool'));
    expect(printed(run(payload))).not.toBe('');
    expect(fs.readdirSync(path.join(home, 'elsewhere'))).toEqual([]);
  });

  it('a spool file that is a FIFO, a directory or a link costs the receipt, never the print or the exit status', () => {
    arm(); plantSpool(); plantSteer(composed());
    const payload = pre(mainTranscript());
    const p = histDir('spool', `${ID}.jsonl`);
    execFileSync('mkfifo', [p]);
    expect(printed(run(payload, {}, { timeout: 20_000 })), 'a FIFO').not.toBe('');
    fs.rmSync(p);
    fs.mkdirSync(p);
    expect(printed(run(payload)), 'a directory').not.toBe('');
    fs.rmdirSync(p);
    fs.symlinkSync(path.join(home, 'spool-target'), p);
    expect(printed(run(payload)), 'a link').not.toBe('');
    expect(fs.existsSync(path.join(home, 'spool-target')), 'a dangling link is not created through').toBe(false);
  });

  it('with no EPOCHREALTIME, the receipt carries a ts read from date', () => {
    const payload = armed();
    stubDate('echo 1700000000123');
    expect(printed(run(payload, epochEnv(null)))).not.toBe('');
    expect(oneReceipt()['ts']).toBe(1700000000123);
  });
  it('a date that gives no valid count writes the receipt with no ts, and it still parses', () => {
    const payload = armed();
    stubDate('exit 1');
    // With no date at all the hook's own hookstate stamp (`--argjson updatedAt 000`, above the anchor) complains on stderr: not this
    // task's, so stderr is read for the steer's own silence only.
    const r = run(payload, epochEnv(null), { stderr: 'any' });
    expect(printed(r)).not.toBe('');
    expect(r.stderr.toLowerCase().includes('steer'), 'the steer code spoke').toBe(false);
    const rec = oneReceipt();
    expect('ts' in rec, 'no clock could time it: the drain stamps it (ts_source received)').toBe(false);
    expect(rec).toMatchObject({ v: 1, ev: 'steer', id: ID, sid: SID, leaf: '' });
  });
  it('an EPOCHREALTIME with no separator passes the hook\'s stamps but is no clock for the receipt: date is read instead', () => {
    const payload = armed();
    stubDate('echo 1700000007777');
    expect(printed(run(payload, epochEnv('1700000001'))), 'the hook reaches the tail and prints').not.toBe('');
    expect(oneReceipt()['ts'], 'the stub\'s value, not 1700000001170').toBe(1700000007777);
  });
  it('CONTROL: an EPOCHREALTIME that parses is read before date', () => {
    const payload = armed();
    stubDate('echo 1700000009999');
    expect(printed(run(payload, epochEnv('1700000001.234567')))).not.toBe('');
    expect(oneReceipt()['ts']).toBe(1700000001234);
  });
});

describe('PX16 (the half W3-1 can prove: STEER_TEXT is not on this base) and the tail rule', () => {
  const src = fs.readFileSync(HOOK, 'utf8');
  const lines = src.split('\n');
  const anchorAt = lines.findIndex((l) => l.includes(ANCHOR) && l.includes('_hook_emit_context "$CARD"'));

  it('Plan B\'s STEER_TEXT is absent, so the two-print case is Plan B\'s: the source order, and the first byte printed is LF', () => {
    expect(src.includes('STEER_TEXT'), 'STEER_TEXT has landed: ship the full PX16').toBe(false);
    const preCall = lines.indexOf('if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi');
    const steerCall = lines.indexOf(CALL_LINE);
    expect(preCall).toBeGreaterThan(anchorAt);
    expect(steerCall, '_hook_history_pre\'s call line is after _hook_compact_pre\'s').toBeGreaterThan(preCall);
    expect(lines.indexOf('if [[ "$event" == PostCompact ]]; then _hook_compact_post || true; fi'), 'and before PostCompact\'s').toBeGreaterThan(steerCall);
    expect(lines.filter((l) => l === CALL_LINE), 'one call, at column 0: outside every function and every lock').toHaveLength(1);
    const body = src.slice(src.indexOf('\n_hook_compact_pre() {'), src.indexOf('\n}\n', src.indexOf('\n_hook_compact_pre() {')));
    expect(body.includes('_hook_history_pre'), 'not inside _hook_compact_pre\'s locked body').toBe(false);
    expect(printed(run(armed())).charCodeAt(0)).toBe(0x0a);
    expect(printed(run(armed())).slice(1, 1 + STEER_FIRST_LINE.length)).toBe(STEER_FIRST_LINE);
  });

  it('every W3 name in session-hook.sh is defined and called below # @anchor compact-arm-emit-call', () => {
    expect(anchorAt, 'the anchor, on the emitter call line').toBeGreaterThan(0);
    const code = lines.map((l, i) => [i, l] as const).filter(([, l]) => !/^\s*#/.test(l));
    const where = (name: string): number[] => code.filter(([, l]) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(l)).map(([i]) => i);
    const fns = ['_hook_history_pre', '_hook_history_scope_verdict', '_hook_history_spool_append', '_hook_history_steer_recall_off', '_hook_history_steer_read'];
    const consts = [...new Set(code.flatMap(([, l]) => [...l.matchAll(/HISTORY_STEER_[A-Z_]+/g)].map((m) => m[0])))];
    expect(consts.sort(), 'the steer constants').toEqual(['HISTORY_STEER_DIR', 'HISTORY_STEER_FIRST_LINE', 'HISTORY_STEER_GENERIC']);
    for (const name of [...fns, ...consts]) {
      const at = where(name);
      expect(at.length, `${name} is defined and used`).toBeGreaterThanOrEqual(2);
      for (const i of at) expect(i, `${name} at line ${i + 1} sits above the anchor (line ${anchorAt + 1})`).toBeGreaterThan(anchorAt);
    }
    expect(src.includes('HISTORY_STEER_DIR="$HOME/.ccrc/history/steer"\n'), 'the steer directory is declared as the plan spells it').toBe(true);
  });
});

describe('parity: the hook\'s copies equal lib\'s (D-8130 history-steer-hook-copies)', () => {
  const src = fs.readFileSync(HOOK, 'utf8');
  const valueOf = (name: string): string => {
    const line = src.split('\n').find((l) => l.startsWith(`${name}=`))!;
    expect(line, `${name} is assigned`).toBeDefined();
    const r = spawnSync('bash', ['-c', `${line}\nprintf %s "$${name}"`], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    return r.stdout;
  };
  it('HISTORY_STEER_FIRST_LINE and HISTORY_STEER_GENERIC equal STEER_FIRST_LINE and STEER_GENERIC_TEXT, byte for byte', () => {
    expect(valueOf('HISTORY_STEER_FIRST_LINE')).toBe(STEER_FIRST_LINE);
    expect(valueOf('HISTORY_STEER_GENERIC')).toBe(STEER_GENERIC_TEXT);
    expect(Buffer.byteLength(STEER_FIRST_LINE)).toBe(85);
  });
  it('the lane words: W3-1 reads no history-steer-live marker, so the hook spells none (lib\'s BACKENDS is the one declaration)', () => {
    expect([...BACKENDS]).toEqual(['anthropic', 'other', 'unknown']);
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.includes('history-steer-live'), 'a lane marker is read: spell its words and pin them against BACKENDS').toBe(false);
  });
  it('gate 6\'s `{` test is spelled (first-line equality implies it, so only the source can pin it)', () => {
    const at = src.indexOf('\n_hook_history_steer_read() {');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).toContain('[[ "${t:0:1}" != "{" ]] || return 1');
    // Why the gate is behaviourally redundant, pinned too: the template's first line cannot begin `{`, so a `{` file already fails the
    // first-line equality. Deleting the gate is an equivalent mutant (mutant (c)); PX17's rows cannot kill it, this source pin does.
    expect(STEER_FIRST_LINE.startsWith('{')).toBe(false);
    expect(body).toContain("local LC_ALL=C");
    expect(body).toContain("read -r -d '' -n 8193");
  });
});

describe('the README\'s two sentences are narrowed with the code', () => {
  it('"PreCompact and PostCompact print nothing" now reads "unless armed and scope main", both times', () => {
    const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8').replace(/\s+/g, ' ');
    expect(readme.match(/`PreCompact` and `PostCompact` print nothing at all(?! unless armed and scope main)/g), 'an un-narrowed sentence').toBeNull();
    expect(readme.match(/`PreCompact` and `PostCompact` print nothing at all unless armed and scope main/g)).toHaveLength(2);
  });
});

describe('the unarmed session forks nothing the steering added (Linux, strace -f; the S16 idiom)', () => {
  itLinux('an unarmed session\'s PreCompact forks as often as a hook with no W3 print', () => {
    touch(path.join(home, '.ccrc', 'compact-card-off'));      // the card does not scope, so CS_SCOPE stays unset and a scope check would fork
    const { transcript } = plantSession({ lines: [tl.user('x')] });
    expect(fs.existsSync(histDir('scope')), 'no scope/ directory').toBe(false);
    const src = fs.readFileSync(HOOK, 'utf8').split('\n');
    const kept = src.filter((l) => l !== CALL_LINE);
    expect(src.length - kept.length, 'the baseline lost exactly the call line').toBe(1);
    const baseline = path.join(home, 'hook-baseline.sh');
    fs.writeFileSync(baseline, kept.join('\n'));
    const forks = (hook: string): number => {
      const trace = path.join(home, 'steer-trace.txt');
      const r = spawnSync('strace', ['-f', '-o', trace, '-e', 'trace=clone,clone3,fork,vfork', 'bash', hook], {
        input: JSON.stringify(pre(transcript)), encoding: 'utf8', env: hookEnv(),
      });
      expect(r.status, `strace ran the hook: ${r.stderr}`).toBe(0);
      const ls = fs.readFileSync(trace, 'utf8').split('\n').filter((l) => l !== '');
      fs.rmSync(trace);
      const root = /^(\d+)\s/.exec(ls[0] ?? '')?.[1];
      expect(root, 'strace traced a fork').toBeDefined();
      return ls.filter((l) => new RegExp(`^${root}\\s+(?:clone3?|v?fork)\\(`).test(l)).length;
    };
    forks(baseline); forks(HOOK);                              // WARM-UP: a first run may make state no later run repeats
    const base = forks(baseline);
    expect(base, 'the baseline forks (the card\'s own work), so an equal count is not vacuous').toBeGreaterThan(0);
    expect(forks(HOOK), 'unarmed').toBe(base);
    touch(path.join(home, '.ccrc', 'history-steer-off'));
    expect(forks(HOOK), 'unarmed under history-steer-off').toBe(base);
    expect(fs.existsSync(histDir('steer-on')), 'nothing armed it').toBe(false);
    fs.rmSync(path.join(home, '.ccrc', 'history-steer-off'));
    arm();                                                      // CONTROL: armed, the scope verdict is the print's own fork
    expect(forks(HOOK), 'CONTROL: an armed session does fork for its scope verdict').toBeGreaterThan(base);
  }, 120_000);
});

// ── The recall-off verdict matrix (O9 (a), D-8131 history-steer-recall-off-tail-copy) ────────────────────────────────────────────
// The tail's copy of the card's recall-off gate must withhold exactly where the card's does. Each row is planted once, then run
// through SessionStart(compact), where the card line is served or withheld, and through PreCompact, where the print happens or not,
// and the two must agree. The rows are the card's own (session-hook.test.ts's PARITY table, copied: a test file cannot import
// another) plus the shapes a steer file adds: a steer file can stand where the card's `.gen` record does not (card/<id> refused).
describe('the recall-off gate: the print and the card line withhold on the same rows (spec §7.7, O9 (a))', () => {
  const NBSP_G = `${String.fromCharCode(0xa0)}${GENERATION}\n`;
  const BOM_G = `${String.fromCharCode(0xfeff)}${GENERATION}\n`;
  const EMSP_G = `${GENERATION}${String.fromCharCode(0x2003)}\n`;   // D-5064: U+2003 after G; glibc's UTF-8 [:space:] takes it
  type Reg = 'fifo' | 'G-lf' | 'G-ws' | 'blank-ws' | 'G-emsp' | 'G-nul' | 'G2-nul' | 'G2-nul-split' | 'nul-only' | 'G' | 'G2' | 'absent' | 'unreadable' | 'symlink-G' | 'junk' | 'G-wide' | 'G-nbsp' | 'empty' | 'blank-wide' | 'G2-wide-junk' | 'dangling';
  type Off = 'absent' | 'G' | 'G-padded' | 'G-wide' | 'G-nbsp' | 'G-bom' | 'G2' | 'empty' | 'unreadable' | 'dir' | 'symlink-G' | 'unsearchable' | 'parent-file' | 'G2-tabcr' | 'link-loop' | 'link-notdir' | 'link-000' | 'link-dangling' | 'G-nul';
  type Rec = 'dir' | 'fifo' | 'G-nbsp' | 'G-ws' | 'G-emsp' | 'G' | 'G2' | 'legacy' | 'absent' | 'junk' | 'symlink-G' | 'G-nul' | 'G-wide';
  /** A row is an AGREE row (the hook's verdict is the CLI's) unless its sixth cell reads 'fail-closed': the hook
   *  withholds where the CLI serves, the one difference R-recalloff-parity allows (it never serves where the CLI
   *  answers exit 8), named in §8.2 and §8.6 check 2. */
  const PARITY: ReadonlyArray<readonly [string, string, Reg, Off, Rec, 'fail-closed'?]> = [
    ['no recall-off file', GENERATION, 'G', 'absent', 'G'],
    ['recall-off names this generation', GENERATION, 'G', 'G', 'G'],
    ['recall-off names it inside whitespace', GENERATION, 'G', 'G-padded', 'G'],
    // Ruling RC4: 130 spaces push the generation past the hook's CCRC_ID_MAX-char read, inside the CLI's 4,096 bytes.
    ['130 spaces followed by the resolved generation G', GENERATION, 'G', 'G-wide', 'G'],
    // Ruling R-recalloff-trim: the CLI's trim strips each, so it reads G and exits 8; the hook withholds.
    ['a no-break space before the resolved generation G', GENERATION, 'G', 'G-nbsp', 'G'],
    ['a byte-order mark before the resolved generation G', GENERATION, 'G', 'G-bom', 'G'],
    ['recall-off names another generation (stale)', GENERATION, 'G', 'G2', 'G'],
    // The hook's ASCII trim strips both ends and every one of tab, CR, LF, VT and FF: a stale value inside tab, space and CR
    // is still stale (the CLI trims it to G2 and recalls); a trim that misses one end or one character withholds instead.
    ['another generation inside tab, space and CR whitespace (stale)', GENERATION, 'G', 'G2-tabcr', 'G'],
    ['an empty recall-off file beside a generation', GENERATION, 'G', 'empty', 'G'],
    ['an unreadable recall-off file', GENERATION, 'G', 'unreadable', 'G'],
    ['a directory at recall-off/<id>', GENERATION, 'G', 'dir', 'G'],
    ['a symlink at recall-off/<id>', GENERATION, 'G', 'symlink-G', 'G'],
    // D-5060 (history-card-recall-off-dir-unreadable-is-off): the CLI opens recall-off/<id> and reads EACCES (the directory
    // cannot be searched) or ENOTDIR (a file where the directory goes) as UNREADABLE, so off (exit 8); the hook agrees.
    ['recall-off/ itself at mode 000 (cannot be searched)', GENERATION, 'G', 'unsearchable', 'G'],
    ['a regular file where the recall-off/ directory goes', GENERATION, 'G', 'parent-file', 'G'],
    // F5 of review 476 (D-5060): recall-off/ itself a link. The CLI opens through it and reads ELOOP, ENOTDIR and EACCES
    // as UNREADABLE (off); builtins cannot tell those from ENOENT, so the hook withholds on any link (RV9 forbids one).
    ['recall-off/ a link that loops on itself (ELOOP)', GENERATION, 'G', 'link-loop', 'G'],
    ['recall-off/ a link through a regular file (ENOTDIR)', GENERATION, 'G', 'link-notdir', 'G'],
    ['recall-off/ a link into a directory at mode 000 (EACCES)', GENERATION, 'G', 'link-000', 'G'],
    ['recall-off/ a dangling link (fail-closed: the CLI reads ENOENT as absent and recalls)', GENERATION, 'G', 'link-dangling', 'G', 'fail-closed'],
    ['a malformed env generation falls back to .generation (named)', 'not-a-uuid', 'G', 'G', 'G'],
    ['a malformed env generation falls back to .generation (stale)', 'not-a-uuid', 'G', 'G2', 'G'],
    ['the env generation wins over .generation (named)', GENERATION, 'G2', 'G', 'G'],
    ['the env generation wins over .generation (stale)', GENERATION, 'G2', 'G2', 'G'],
    // R-recalloff-parity: no env or registry generation, so the CLI compares with the newest family's generation.
    // No resolvable generation and an empty file: the CLI compares '' with '' (a legacy newest family, or a store
    // holding no family of the id, which Task 5's record writes the same way) and exits 8; the hook agrees.
    ['a legacy newest family recorded empty and an empty recall-off file', '', 'absent', 'empty', 'legacy'],
    ['the newest family recorded G and an empty recall-off file reads stale', '', 'absent', 'empty', 'G'],
    ['no env or registry generation and recall-off names the recorded newest family', '', 'absent', 'G', 'G'],
    ['recall-off names G while the recorded newest family is G2', '', 'absent', 'G', 'G2'],
    ['an unreadable .generation is unusable: the hook withholds and the CLI answers exit 8 too', '', 'unreadable', 'G', 'G'],
    // D-5063: the record decides ONLY when .generation is absent or empty. One the hook cannot read as a UUID (linked,
    // unreadable, a full read window, any non-UUID value) is unusable, and a recall-off file that exists withholds.
    ['a symlinked .generation is unusable, recall-off names the recorded G2', '', 'symlink-G', 'G2', 'G2'],
    ['a symlinked .generation is unusable, recall-off is stale (fail-closed: the CLI recalls)', '', 'symlink-G', 'G', 'G2', 'fail-closed'],
    ['a malformed .generation, recall-off names the recorded G', '', 'junk', 'G', 'G'],
    ['a malformed .generation, recall-off is stale (fail-closed: the CLI recalls)', '', 'junk', 'G2', 'G', 'fail-closed'],
    ['an unreadable .generation, recall-off is stale (fail-closed: the CLI recalls)', '', 'unreadable', 'G2', 'G', 'fail-closed'],
    // F3 of review 476: a .generation the hook's CCRC_ID_MAX-char window cannot hold (or a no-break space it will not
    // trim) is G to the CLI, which reads 4,096 bytes and trims in JS. recall-off names G, the record names G2: the CLI
    // answers exit 8, so a hook that fell back to the record would serve.
    ['a .generation padded past the read window, recall-off names G, the record G2', '', 'G-wide', 'G', 'G2'],
    ['a .generation behind a no-break space, recall-off names G, the record G2', '', 'G-nbsp', 'G', 'G2'],
    ['a .generation padded past the read window, recall-off is stale (fail-closed: the CLI recalls)', '', 'G-wide', 'G2', 'G', 'fail-closed'],
    // D-5064 (macOS CI): this row holds on every platform. glibc's [:space:] leaves U+00A0 out and Darwin's takes it, but the
    // reader trims the probe's raw read of ASCII whitespace only, never `_ct_read`'s class, so both read a value that is no UUID.
    // The CLI's JS trim strips U+00A0 and reads G, so the row is fail-closed on both. The U+2003 cases below pin the widening locale.
    ['a .generation behind a no-break space, recall-off is stale (fail-closed: the CLI recalls)', '', 'G-nbsp', 'G2', 'G', 'fail-closed'],
    // D-5064: the reader trims a generation of ASCII whitespace itself (the probe's raw read, `$ws`), both ends: padded still reads as G
    // (the registry wins over the record, so recall-off naming the record's G2 is stale and the line serves), and a value of ASCII
    // whitespace only is none, so the record decides.
    ['a .generation of G then LF (the registry wins over the record)', '', 'G-lf', 'G2', 'G2'],
    ['a .generation inside tab, space, CR and LF whitespace (the registry wins over the record)', '', 'G-ws', 'G2', 'G2'],
    ['a generation record inside tab, space, CR and LF whitespace is the newest family G, recall-off names G', '', 'absent', 'G', 'G-ws'],
    ['a generation record inside tab, space, CR and LF whitespace is the newest family G, recall-off is stale', '', 'absent', 'G2', 'G-ws'],
    ['an all-ASCII-whitespace .generation is none: the record decides (stale)', '', 'blank-ws', 'G2', 'G'],
    ['a .generation of whitespace only past the read window (fail-closed: the CLI recalls)', '', 'blank-wide', 'G2', 'G', 'fail-closed'],
    // A window that FILLS is unusable even with a UUID inside it: the CLI trims all 4,096 bytes, finds junk after the
    // padding, and falls to the newest family (the record G, which recall-off names: exit 8).
    ['a .generation holding G2 in a full read window, junk beyond it, recall-off names the recorded G', '', 'G2-wide-junk', 'G', 'G'],
    ['a dangling-link .generation is unusable, recall-off is stale (fail-closed: the CLI recalls)', '', 'dangling', 'G2', 'G', 'fail-closed'],
    // D-5063 (C4 of fix round 1): `read -N` drops a NUL and does not count it, so a .generation holding one read as the
    // UUID around it. The CLI keeps the NUL (presenceOf's trim does not strip U+0000), finds no UUID and resolves the
    // newest family's generation, the record. A bounded `read -d ''` finds the NUL, and the hook withholds.
    ['a .generation of G2 then a NUL, recall-off names the recorded G (the hook once read G2 and served)', '', 'G2-nul', 'G', 'G'],
    ['a .generation of G then a NUL, recall-off is stale (fail-closed: the CLI recalls)', '', 'G-nul', 'G2', 'G', 'fail-closed'],
    ['a NUL between two halves that join into a UUID, recall-off names the recorded G', '', 'G2-nul-split', 'G', 'G'],
    ['a NUL-only .generation (once empty to the hook, so the record decided), recall-off is stale (fail-closed: the CLI recalls)', '', 'nul-only', 'G2', 'G', 'fail-closed'],
    ['a NUL-only .generation, recall-off names the recorded G', '', 'nul-only', 'G', 'G'],
    ['a record holding G and a NUL is no record', '', 'absent', 'G2', 'G-nul'],
    // D-5063 (review 479 F1): a record padded past the read window would read as empty (legacy) from `_ct_read`, which holds only the
    // first CCRC_ID_MAX characters. The CLI resolves the newest family, G, and recall-off names it: exit 8. A hook that took the record
    // for empty would compare '' with G and serve. Against both shapes, a window-filling pad and a NUL, the record's one guard is the
    // bounded NUL probe (`read -d '' -n CCRC_ID_MAX`), which answers rc 0 on either, so it withholds both; the value it tests is the probe's own
    // read, ASCII-trimmed, never `_ct_read`'s `CT_V` (D-5064). The record spells no window test of its own.
    ['a generation record padded past the read window, recall-off names G', '', 'absent', 'G', 'G-wide'],
    ['a generation record padded past the read window, recall-off is stale (fail-closed: the CLI recalls)', '', 'absent', 'G2', 'G-wide', 'fail-closed'],
    // D-5064 (review 495 F2): the record arm trims the probe's raw read of ASCII whitespace only, so U+00A0 stays and fails the
    // grammar, where the CLI's JS trim strips it and reads G (stale beside G2: it recalls). A record that tested `_ct_read`'s CT_V
    // instead would trim U+00A0 on a libc whose [:space:] takes it (Darwin's, measured on the `.generation` twin by the macOS leg
    // that 116663ad5 answers) and serve, so under a UTF-8 runner locale (the row inherits the runner's) this row would red there for
    // that mutant, as the U+2003 case does on glibc: argued, not measured. On glibc it pins only the withhold; the macOS leg
    // (`test-macos`) proves the withhold there, never the mutant's red.
    ['a generation record behind a no-break space, recall-off is stale (fail-closed: the CLI recalls)', '', 'absent', 'G2', 'G-nbsp', 'fail-closed'],
    // D-5063 (review 495 F1, review 503 F2 and F5): `.generation`'s `(( CT_RAWN >= CCRC_ID_MAX ))` and the record's `_ct_read … ||
    // return 0`. The guards' only unique work is a non-regular file: drop either and only a FIFO (or a device node, which only root can
    // plant) changes the verdict, because the seed would withhold an unreadable file too (the probes' `x=.`). A FIFO present at `_ct_read`'s
    // `-f` test is refused there, so the probe's `<` never opens it; without the guards it would block, SessionStart(compact) would hang to
    // the hook timeout and the whole compact card be lost. The tests are builtin, so one swapped in after the test still blocks, a window no
    // row can measure. These rows run bounded (the FIFO runner below), so a dropped guard reds on the bound, not by wedging.
    ['a FIFO .generation is unusable: the hook returns at once and withholds (fail-closed: the CLI recalls)', '', 'fifo', 'G2', 'G', 'fail-closed'],
    ['a FIFO generation record is no record: the hook returns at once and withholds', '', 'absent', 'G2', 'fifo'],
    // The safe direction, named (R-recalloff-parity): the hook drops the NUL and reads G, so it withholds; the CLI reads
    // 'G' + NUL, which is not the generation, so recall-off is stale there and the line is served.
    ['recall-off holds G and a NUL, the generation is G (fail-closed: the CLI recalls)', GENERATION, 'G', 'G-nul', 'G', 'fail-closed'],
    ['an empty .generation is none: the record decides (stale)', '', 'empty', 'G2', 'G'],
    ['an empty .generation is none: the record decides (named)', '', 'empty', 'G', 'G'],
    // The ruling's pin: the CLI exits 8 here, so the card line must not reach the control arm.
    ['R-recalloff: an invalid env generation, an unreadable .generation, recall-off naming the recorded G', 'not-a-uuid', 'unreadable', 'G', 'G'],
    ['R-recalloff: an invalid env generation, no .generation, recall-off naming the recorded G', 'not-a-uuid', 'absent', 'G', 'G'],
    ['nothing recorded withholds a line beside a recall-off value', '', 'absent', 'G2', 'absent'],
    ['nothing recorded and no recall-off file serves', '', 'absent', 'absent', 'absent'],
    ['a symlinked record is no record', '', 'absent', 'G2', 'symlink-G'],
    ['a malformed record is no record', '', 'absent', 'G2', 'junk'],
    ['the env generation wins over the record', GENERATION, 'absent', 'G2', 'G2'],
    ['the registry generation wins over the record', '', 'G', 'G2', 'G2'],
  ];
  const parityRows = PARITY.filter(([, , r, o, k]) => r !== 'fifo' && k !== 'fifo' && (!ROOT || (r !== 'unreadable' && o !== 'unreadable' && o !== 'unsearchable' && o !== 'link-000')))
    .map(([what, env, r, o, k, kind]) => [what, env, r, o, k, kind ?? 'agree'] as const);
  /** The FIFO rows stay in PARITY (CONTROL and the CLI model cover them) but run through `fifoServed`, which bounds the spawn. */
  const fifoRows = PARITY.filter(([, , r, , k]) => r === 'fifo' || k === 'fifo')
    .map(([what, env, r, o, k, kind]) => [what, env, r, o, k, kind ?? 'agree'] as const);
  /** The text each Reg kind plants in $REG/<id>.generation (the CLI reads the same text through presenceOf's trim). */
  const REG_TEXT: Partial<Record<Reg, string>> = {
    G: GENERATION, G2, junk: 'not-a-generation', empty: '',
    'G-nul': `${GENERATION}\0\n`, 'G2-nul': `${G2}\0\n`, 'G2-nul-split': `${G2.slice(0, 18)}\0${G2.slice(18)}\n`, 'nul-only': '\0',
    'G-wide': `${' '.repeat(130)}${GENERATION}\n`, 'G2-wide-junk': `${G2}${' '.repeat(100)}junk\n`, 'G-nbsp': NBSP_G, 'G-emsp': EMSP_G, 'G-lf': `${GENERATION}\n`, 'G-ws': ` \t\r${GENERATION}\v\f \r\n`, 'blank-ws': ' \t\r\n\v\f', 'blank-wide': `${' '.repeat(130)}\n`,
  };
  const plantParity = (regKind: Reg, offKind: Off, recKind: Rec): void => {
    const genFile = reg(`${ID}.generation`);
    fs.rmSync(genFile, { force: true });
    if (regKind in REG_TEXT) fs.writeFileSync(genFile, REG_TEXT[regKind]!);
    if (regKind === 'unreadable') { fs.writeFileSync(genFile, GENERATION); fs.chmodSync(genFile, 0o000); }
    if (regKind === 'dangling') fs.symlinkSync(path.join(home, 'gen-nowhere'), genFile);
    if (regKind === 'fifo') execFileSync('mkfifo', [genFile]);   // removed with the fixture HOME; nothing ever opens it but a guard-less hook
    if (regKind === 'symlink-G') { fs.writeFileSync(path.join(home, 'gen-target'), GENERATION); fs.symlinkSync(path.join(home, 'gen-target'), genFile); }
    const off = histDir('recall-off', ID);
    if (offKind === 'parent-file' || offKind.startsWith('link-')) fs.rmSync(histDir('recall-off'), { recursive: true, force: true });
    else fs.mkdirSync(histDir('recall-off'), { recursive: true, mode: 0o700 });
    if (offKind === 'G') fs.writeFileSync(off, `${GENERATION}\n`);
    if (offKind === 'G-padded') fs.writeFileSync(off, `  ${GENERATION}  \n\n`);
    if (offKind === 'G-wide') fs.writeFileSync(off, `${' '.repeat(130)}${GENERATION}\n`);
    if (offKind === 'G-nbsp') fs.writeFileSync(off, NBSP_G);
    if (offKind === 'G-bom') fs.writeFileSync(off, BOM_G);
    if (offKind === 'G-nul') fs.writeFileSync(off, `${GENERATION}\0\n`);
    if (offKind === 'G2') fs.writeFileSync(off, `${G2}\n`);
    if (offKind === 'G2-tabcr') fs.writeFileSync(off, `\t${G2} \r\n`);
    if (offKind === 'empty') fs.writeFileSync(off, '');
    if (offKind === 'unreadable') { fs.writeFileSync(off, `${G2}\n`); fs.chmodSync(off, 0o000); }
    if (offKind === 'dir') fs.mkdirSync(off);
    if (offKind === 'symlink-G') { fs.writeFileSync(path.join(home, 'off-target'), `${G2}\n`); fs.symlinkSync(path.join(home, 'off-target'), off); }
    // The file inside is a stale value, so a reader that searched the directory would serve; the mode comes last.
    if (offKind === 'unsearchable') { fs.writeFileSync(off, `${G2}\n`); fs.chmodSync(histDir('recall-off'), 0o000); }
    if (offKind === 'parent-file') fs.writeFileSync(histDir('recall-off'), `${G2}\n`);
    // A link at recall-off/ itself. The 'stale' value sits where a reader that followed the link would find it.
    const rdir = histDir('recall-off');
    if (offKind === 'link-loop') fs.symlinkSync(rdir, rdir);
    if (offKind === 'link-notdir') { fs.writeFileSync(path.join(home, 'off-file'), 'x'); fs.symlinkSync(path.join(home, 'off-file', 'sub'), rdir); }
    if (offKind === 'link-000') {
      fs.mkdirSync(path.join(home, 'off-root', 'sub'), { recursive: true });
      fs.writeFileSync(path.join(home, 'off-root', 'sub', ID), `${G2}\n`);
      fs.symlinkSync(path.join(home, 'off-root', 'sub'), rdir);
      fs.chmodSync(path.join(home, 'off-root'), 0o000);
    }
    if (offKind === 'link-dangling') fs.symlinkSync(path.join(home, 'off-nowhere'), rdir);
    // The sweep's generation record beside the prediction (Task 5; plantAll made card/<id>/).
    const rec = histDir('card', ID, `${SID}.gen`);
    fs.rmSync(rec, { force: true });
    if (recKind === 'G') fs.writeFileSync(rec, `${GENERATION}\n`);
    if (recKind === 'G2') fs.writeFileSync(rec, `${G2}\n`);
    if (recKind === 'G-nul') fs.writeFileSync(rec, `${GENERATION}\0\n`);
    if (recKind === 'G-wide') fs.writeFileSync(rec, `${' '.repeat(130)}${GENERATION}\n`);
    if (recKind === 'G-emsp') fs.writeFileSync(rec, EMSP_G);
    if (recKind === 'G-nbsp') fs.writeFileSync(rec, NBSP_G);
    if (recKind === 'fifo') execFileSync('mkfifo', [rec]);
    if (recKind === 'dir') fs.mkdirSync(rec);
    if (recKind === 'G-ws') fs.writeFileSync(rec, ` \t\r${GENERATION}\v\f \r\n`);
    if (recKind === 'legacy') fs.writeFileSync(rec, '\n');
    if (recKind === 'junk') fs.writeFileSync(rec, 'not-a-generation\n');
    if (recKind === 'symlink-G') { fs.writeFileSync(path.join(home, 'rec-target'), `${GENERATION}\n`); fs.symlinkSync(path.join(home, 'rec-target'), rec); }
  };  const EXTRA: ReadonlyArray<readonly [string, string, Reg, Off, Rec]> = [
    ['W3 (.gen absent): no generation anywhere, recall-off names G, no .gen record beside the file', '', 'absent', 'G', 'absent'],
    ['W3 (.gen absent): no generation anywhere, an empty recall-off, no .gen record', '', 'absent', 'empty', 'absent'],
    ['W3 (.gen absent): no generation anywhere and no recall-off file: nothing withheld', '', 'absent', 'absent', 'absent'],
    ['W3 (.gen a directory): recall-off names G', '', 'absent', 'G', 'dir'],
    ['W3 (.gen a directory): no recall-off file', '', 'absent', 'absent', 'dir'],
    ['W3 (.gen absent): an env generation decides without it, recall-off names it', GENERATION, 'absent', 'G', 'absent'],
  ];
  const LINE = cardLine({ leaf: 'L03a9c1', parent: 'N7c1e2f' });
  const mark = (): void => fs.writeFileSync(histDir('scope', ID), `main ${SID} ${Date.now()}\n`);
  /** The card's fixture and the print's, one: both directories, a fresh main marker, the prediction, a steer-on marker, a spool. */
  const plantAll = (): void => {
    fs.rmSync(histDir('card'), { recursive: true, force: true });
    fs.rmSync(histDir('recall-off'), { recursive: true, force: true });   // a row after a row in one HOME starts with no recall-off state
    mk(histDir('scope')); mk(histDir('card', ID));
    mark();
    fs.writeFileSync(histDir('card', ID, `${SID}.txt`), `${LINE}\n`, { mode: 0o600 });
    arm(); plantSpool();
  };
  const restore = (): void => {
    for (const f of [reg(`${ID}.generation`), histDir('recall-off'), histDir('recall-off', ID), path.join(home, 'off-root')]) {
      try { fs.chmodSync(f, 0o700); } catch { /* absent or a link */ }
    }
  };
  /** Is the card line served by SessionStart(compact)? Bounded: a hook blocked on a FIFO is killed and reads as a red exit status. */
  const cardServed = (envGen: string): boolean => {
    const r = run(start(), { CCRC_SESSION_GENERATION: envGen }, { timeout: 20_000 });
    return r.stdout.includes('History: node ');
  };
  /** Does PreCompact print the steer? The same fixture, the same environment. */
  const printHappens = (envGen: string): boolean => {
    const r = run(pre(mainTranscript()), { CCRC_SESSION_GENERATION: envGen }, { timeout: 20_000 });
    return r.stdout !== '';
  };
  const row = (envGen: string, regKind: Reg, offKind: Off, recKind: Rec): { card: boolean; print: boolean } => {
    plantAll();
    plantParity(regKind, offKind, recKind);
    try {
      const card = cardServed(envGen);
      mark();
      return { card, print: printHappens(envGen) };
    } finally { restore(); }
  };

  it('CONTROL: the table reaches both answers, so it cannot pass by printing always or never', () => {
    const seen = new Set<boolean>();
    for (const [, env, r, o, k] of [PARITY[0]!, PARITY.find(([w]) => w === 'recall-off names this generation')!]) seen.add(row(env, r, o, k).card);
    expect([...seen].sort()).toEqual([false, true]);
  }, 60_000);

  it.each(parityRows)('recall-off parity, the print against the card: %s', (_what, envGen, regKind, offKind, recKind) => {
    const { card, print } = row(envGen, regKind, offKind, recKind);
    expect(print, `the print ${print ? 'happened' : 'was withheld'} where the card line was ${card ? 'served' : 'withheld'}`).toBe(card);
  }, 60_000);

  it.each(fifoRows)('recall-off parity, the print against the card (a FIFO, bounded): %s', (_what, envGen, regKind, offKind, recKind) => {
    const { card, print } = row(envGen, regKind, offKind, recKind);
    expect(print, `the print ${print ? 'happened' : 'was withheld'} where the card line was ${card ? 'served' : 'withheld'}`).toBe(card);
  }, 90_000);

  it.each(EXTRA)('%s', (_what, envGen, regKind, offKind, recKind) => {
    const { card, print } = row(envGen, regKind, offKind, recKind);
    expect(print, `the print ${print ? 'happened' : 'was withheld'} where the card line was ${card ? 'served' : 'withheld'}`).toBe(card);
    if (offKind !== 'absent' && regKind === 'absent' && envGen === '') expect(print, 'a recall-off file with no recorded generation withholds').toBe(false);
    if (offKind === 'absent') expect(print, 'no recall-off file: nothing is withheld').toBe(true);
  }, 60_000);

  it('W3 (card/<id> refused): a steer file stands where the card\'s record cannot; the print answers as the card does with the record absent', () => {
    // Where card/<id> is not a directory there is no card file for the card half to serve, so the card's verdict is the one it gives
    // for the same recall inputs with the `.gen` record merely absent: measured above, here, in the same fixture.
    for (const [offKind, withheld] of [['G', true], ['absent', false]] as const) {
      const measured = row('', 'absent', offKind, 'absent');
      expect(measured.card, `the card, ${offKind}`).toBe(!withheld);
      for (const [shape, plant] of [
        ['card/<id> a regular file', (): void => { fs.rmSync(histDir('card'), { recursive: true }); mk(histDir('card')); fs.writeFileSync(histDir('card', ID), ''); }],
        ['card/ absent', (): void => { fs.rmSync(histDir('card'), { recursive: true }); }],
        ['card/<id> a link to nowhere', (): void => { fs.rmSync(histDir('card'), { recursive: true }); mk(histDir('card')); fs.symlinkSync(path.join(home, 'card-nowhere'), histDir('card', ID)); }],
      ] as const) {
        plantAll();
        plantParity('absent', offKind, 'absent');
        plant();
        try { expect(printHappens(''), `${shape}, recall-off ${offKind}`).toBe(!withheld); } finally { restore(); }
      }
    }
  }, 60_000);
});
