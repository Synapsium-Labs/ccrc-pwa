// `ccd ws-title --session <id> (--title <text> | --clear)` — rename an EXISTING workspace's operator title
// (named workspaces S9, design 2026-10-20 §6). The verb writes two registry fields, `title` and `named`, the way
// `ws-add --title` does and through the SAME writer, and nothing else; `--clear` removes both, which hands the row
// back to the ai-title sweep.
//
// Everything runs under the harness's fixture HOME, and the verb is run as a PROGRAM (`bash ccd ws-title …`) so the
// dispatcher arm, the exit code and the stream a refusal lands on are what is asserted — never a live session.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, ghContainedEnv, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;
let reg: string;

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ws-title-'); home = h.home; reg = path.join(home, '.cc-sessions'); });
afterEach(() => { h.cleanup(); });

interface Ran { status: number | null; stdout: string; stderr: string }

/** ccd as a program: the dispatcher arm, the real exit status and both streams. */
const ccd = (...args: string[]): Ran => {
  const r = spawnSync('bash', [CCD, ...args], {
    encoding: 'utf8', cwd: home,
    env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

/** A snippet under the sourced ccd (the free-text values ride the environment, `h.sh`'s own rule). */
const sh = (snippet: string, env: NodeJS.ProcessEnv = {}): string => h.sh(snippet, env);

const ID = 'demo-quiet-basin';

/** A real workspace row, made by `ws-add` itself, with the spawn stubbed. `title` makes it a hand-named one. */
const workspace = (opts: { title?: string } = {}): string => {
  if (!fs.existsSync(path.join(home, 'projects', 'demo'))) h.makeRepo('demo');
  const t = opts.title === undefined ? '' : ' --title "$WT_TITLE"';
  sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add${t} demo`, { WT_TITLE: opts.title ?? '' });
  return ID;
};

/** Every file under the registry, name -> bytes: what "nothing else changed" is measured against. */
const snapshot = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(reg).sort()) {
    const p = path.join(reg, f);
    if (fs.statSync(p).isFile()) out[f] = fs.readFileSync(p, 'utf8');
  }
  return out;
};
const field = (id: string, f: string): string | null => {
  try { return fs.readFileSync(path.join(reg, `${id}.${f}`), 'utf8'); } catch { return null; }
};

describe('ws-title --title', () => {
  it('sets title and named on an auto-named workspace, and writes nothing else', () => {
    workspace();
    expect(field(ID, 'title')).toBeNull();
    expect(field(ID, 'named')).toBeNull();
    const before = snapshot();

    const r = ccd('ws-title', '--session', ID, '--title', 'Fix the login redirect');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`titled ${ID}: Fix the login redirect`);

    const after = snapshot();
    expect(Object.keys(after).filter((k) => !(k in before)).sort(), 'the files it ADDED').toEqual([`${ID}.named`, `${ID}.title`]);
    expect(Object.keys(before).filter((k) => !(k in after)), 'the files it removed').toEqual([]);
    expect(Object.keys(after).filter((k) => k in before && after[k] !== before[k]), 'the files it rewrote').toEqual([]);
    expect(after[`${ID}.title`]).toBe('Fix the login redirect');
    expect(after[`${ID}.named`]).toBe('1');
  });

  it('replaces the title of a workspace that already has one, and keeps named', () => {
    workspace({ title: 'First name' });
    expect(field(ID, 'title')).toBe('First name');
    const r = ccd('ws-title', '--session', ID, '--title', 'Second name');
    expect(r.status, r.stderr).toBe(0);
    expect(field(ID, 'title')).toBe('Second name');
    expect(field(ID, 'named')).toBe('1');
  });

  it('writes the SAME bytes ws-add --title writes for the same text', () => {
    workspace({ title: 'Same text — with "quotes" and ünïcode' });
    const viaAdd = { title: field(ID, 'title'), named: field(ID, 'named') };
    ccd('ws-title', '--session', ID, '--clear');
    expect(field(ID, 'title')).toBeNull();
    const r = ccd('ws-title', '--session', ID, '--title', 'Same text — with "quotes" and ünïcode');
    expect(r.status, r.stderr).toBe(0);
    expect({ title: field(ID, 'title'), named: field(ID, 'named') }).toEqual(viaAdd);
  });

  it('accepts the = form and a title that begins with dashes', () => {
    workspace();
    expect(ccd('ws-title', '--session', ID, '--title=-- not a flag').status).toBe(0);
    expect(field(ID, 'title')).toBe('-- not a flag');
  });

  it('is accepted on an ARCHIVED workspace (it writes two fields and costs no pane)', () => {
    workspace();
    fs.writeFileSync(path.join(reg, `${ID}.archived`), '1');
    const r = ccd('ws-title', '--session', ID, '--title', 'Archived but named');
    expect(r.status, r.stderr).toBe(0);
    expect(field(ID, 'title')).toBe('Archived but named');
  });
});

describe('ws-title --clear', () => {
  it('removes title and named, and nothing else, returning the row to the sweep', () => {
    workspace({ title: 'Hand name' });
    const before = snapshot();
    expect(Object.keys(before)).toEqual(expect.arrayContaining([`${ID}.title`, `${ID}.named`]));

    const r = ccd('ws-title', '--session', ID, '--clear');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`untitled ${ID}`);

    const after = snapshot();
    expect(Object.keys(before).filter((k) => !(k in after)).sort(), 'the files it removed').toEqual([`${ID}.named`, `${ID}.title`]);
    expect(Object.keys(after).filter((k) => !(k in before)), 'the files it added').toEqual([]);
    expect(Object.keys(after).filter((k) => after[k] !== before[k]), 'the files it rewrote').toEqual([]);
  });

  it('is idempotent: a row with neither field answers success and changes nothing', () => {
    workspace();
    const before = snapshot();
    const r = ccd('ws-title', '--session', ID, '--clear');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(`untitled ${ID}`);
    expect(snapshot()).toEqual(before);
  });

  it('removes a lone named marker too (a title the sweep never wrote, a marker a person did)', () => {
    workspace();
    fs.writeFileSync(path.join(reg, `${ID}.named`), '1');
    expect(ccd('ws-title', '--session', ID, '--clear').status).toBe(0);
    expect(field(ID, 'named')).toBeNull();
  });

  it('--title after --clear works: set, clear, set', () => {
    workspace();
    expect(ccd('ws-title', '--session', ID, '--title', 'One').status).toBe(0);
    expect(ccd('ws-title', '--session', ID, '--clear').status).toBe(0);
    expect(ccd('ws-title', '--session', ID, '--title', 'Two').status).toBe(0);
    expect([field(ID, 'title'), field(ID, 'named')]).toEqual(['Two', '1']);
  });
});

describe('ws-title refuses, exit 1, `ccd: <sentence>` on stderr, nothing on stdout, the registry untouched', () => {
  const refused = (args: string[], sentence: RegExp): void => {
    const before = snapshot();
    const r = ccd(...args);
    expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(sentence);
    expect(snapshot(), `${args.join(' ')} changed the registry`).toEqual(before);
  };

  it('an unknown session', () => {
    workspace();
    refused(['ws-title', '--session', 'demo-no-such', '--title', 'X'], /^ccd: no such session: demo-no-such$/m);
    refused(['ws-title', '--session', 'demo-no-such', '--clear'], /^ccd: no such session: demo-no-such$/m);
  });

  it('an id that is not an id (a path, a flag, an empty word) — before any file is named', () => {
    workspace();
    refused(['ws-title', '--session', '../x', '--title', 'X'], /^ccd: bad session id$/m);
    refused(['ws-title', '--session', '--title', '--title', 'X'], /^ccd: bad session id$/m);
    refused(['ws-title', '--session', '', '--clear'], /^ccd: bad session id$/m);
  });

  it('a main checkout: it has no workspace, so no title is kept for it', () => {
    workspace();
    sh('_reg_set demo uuid 11111111-1111-1111-1111-111111111111; _reg_set demo project demo');
    refused(['ws-title', '--session', 'demo', '--title', 'X'], /^ccd: demo is not a workspace — /m);
    refused(['ws-title', '--session', 'demo', '--clear'], /^ccd: demo is not a workspace — /m);
    expect(field('demo', 'title')).toBeNull();
    expect(field('demo', 'named')).toBeNull();
  });

  it('both --title and --clear, and neither', () => {
    workspace();
    const usage = /^ccd: usage: ccd ws-title --session <id> \(--title <text> \| --clear\)$/m;
    refused(['ws-title', '--session', ID, '--title', 'X', '--clear'], usage);
    refused(['ws-title', '--session', ID, '--clear', '--title', 'X'], usage);
    refused(['ws-title', '--session', ID], usage);
    refused(['ws-title'], usage);
  });

  it('a missing --session, a repeated flag, a valueless --title and a stray word — the usage line, never a hang', () => {
    workspace();
    const usage = /^ccd: usage: ccd ws-title --session <id> \(--title <text> \| --clear\)$/m;
    refused(['ws-title', '--title', 'X'], usage);
    refused(['ws-title', '--clear'], usage);
    refused(['ws-title', '--session', ID, '--title', 'A', '--title', 'B'], usage);
    refused(['ws-title', '--session', ID, '--clear', '--clear'], usage);
    refused(['ws-title', '--session', ID, '--session', ID, '--clear'], usage);
    refused(['ws-title', '--session', ID, '--title'], usage);
    refused(['ws-title', '--session', ID], usage);
    refused(['ws-title', '--session'], usage);
    refused(['ws-title', '--session', ID, '--clear', 'extra'], usage);
    refused(['ws-title', '--session', ID, '--frobnicate'], usage);
  });

  it('an empty or whitespace-only title: --title must be non-blank', () => {
    workspace({ title: 'Keep me' });
    refused(['ws-title', '--session', ID, '--title', ''], /^ccd: --title must be non-blank$/m);
    refused(['ws-title', '--session', ID, '--title', '   \t '], /^ccd: --title must be non-blank$/m);
    expect(field(ID, 'title'), 'a refused blank must not clear the old title').toBe('Keep me');
  });

  it('a control character (a newline would split a one-line field)', () => {
    workspace();
    refused(['ws-title', '--session', ID, '--title', 'one\ntwo'], /^ccd: --title must not contain control characters$/m);
    refused(['ws-title', '--session', ID, '--title', 'tab\there'], /^ccd: --title must not contain control characters$/m);
    refused(['ws-title', '--session', ID, '--title', 'esc\u001b[31m'], /^ccd: --title must not contain control characters$/m);
  });

  it('a title over the byte cap — measured in BYTES, so a multibyte one trips it earlier', () => {
    workspace();
    const cap = Number(sh('printf %s "$_LC_DEC_MAX"'));
    expect(cap).toBeGreaterThan(0);
    expect(ccd('ws-title', '--session', ID, '--title', 'a'.repeat(cap)).status).toBe(0);
    refused(['ws-title', '--session', ID, '--title', 'a'.repeat(cap + 1)], new RegExp(`^ccd: --title is longer than ${cap} bytes$`, 'm'));
    refused(['ws-title', '--session', ID, '--title', 'é'.repeat(Math.floor(cap / 2) + 1)], new RegExp(`^ccd: --title is longer than ${cap} bytes$`, 'm'));
  });

  it('a write that cannot land is a refusal, never a success line', () => {
    workspace();
    // A directory where the field belongs: the rename over it fails, the way the hold suite's stand-in does.
    fs.mkdirSync(path.join(reg, `${ID}.title`));
    const r = ccd('ws-title', '--session', ID, '--title', 'X');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccd: could not record the title for demo-quiet-basin — /m);
  });

  it('a clear that cannot remove a field is a refusal that says the title STANDS', () => {
    workspace({ title: 'Stays' });
    fs.rmSync(path.join(reg, `${ID}.title`));
    fs.mkdirSync(path.join(reg, `${ID}.title`));
    fs.writeFileSync(path.join(reg, `${ID}.title`, 'x'), '');
    const r = ccd('ws-title', '--session', ID, '--clear');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccd: could not clear the title for demo-quiet-basin — /m);
  });
});

describe('the sanitiser and the writer are ws-add\'s, not a second copy', () => {
  /** The same refusal sentence from both verbs for the same bad text: one sanitiser answers for both. */
  const viaAdd = (title: string): string => {
    if (!fs.existsSync(path.join(home, 'projects', 'demo'))) h.makeRepo('demo');
    const r = spawnSync('bash', ['-c', 'source "$NWS_SRC"; eval "$NWS_SNIP"'], { encoding: 'utf8', cwd: home,
      env: { ...ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }),
        NWS_SRC: CCD, NWS_SNIP: `${WS_ADD} cmd_ws_add --title "$WT_TITLE" demo eng-1234`, WT_TITLE: title } });
    expect(r.status).toBe(1);
    return r.stderr.trim();
  };

  it.each([
    ['blank', '  '],
    ['a control character', 'a\nb'],
    ['too long', 'x'.repeat(600)],
  ])('%s: ws-add --title and ws-title answer in the same words', (_n, title) => {
    const add = viaAdd(title);
    workspace();
    const r = ccd('ws-title', '--session', ID, '--title', title);
    expect(r.stderr.trim()).toBe(add);
  });

  it('cmd_ws_add and cmd_ws_title both call _ws_title_check and _ws_title_set, and neither writes `title` itself', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const body = (name: string): string => {
      const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm').exec(src);
      if (m === null) throw new Error(`no ${name} in ccd`);
      return m[0];
    };
    for (const fn of ['cmd_ws_add', 'cmd_ws_title']) {
      const b = body(fn);
      expect(b, `${fn} calls the shared sanitiser`).toContain('_ws_title_check');
      expect(b, `${fn} calls the shared writer`).toContain('_ws_title_set');
      expect(b, `${fn} writes the title field by hand`).not.toMatch(/_reg_set\s+"\$id"\s+(title|named)\b/);
    }
  });
});

describe('the verb is dispatched and advertised', () => {
  it('ccd caps lists the VERB ws-title (the server offers Rename on this, not on ws-title-v1)', () => {
    const caps = ccd('caps').stdout.split('\n');
    expect(caps).toContain('ws-title');
    expect(caps).toContain('ws-title-v1');
  });

  it('the no-argv usage line names ws-title', () => {
    const r = ccd();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage: ccd \{[^}]*\|ws-title\|[^}]*\}/);
  });
});
