// The guards that make `ccrc-api`'s closed table a mechanism rather than a
// docstring. Everything here is a standing property of the tree, not a property
// of one change: each one is something that would be true today and quietly
// false in a month, and each is the kind of thing whose loss is invisible until
// a session on a locked-down repo cannot talk to the server at all.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCRC_API } from './ccdWsHelpers.js';

const root = path.join(import.meta.dirname, '..', '..');
const corpusFiles = (): string[] => {
  const out: string[] = [];
  for (const dir of ['ccd/coordinator-skill', 'ccd/worker-skill']) {
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) out.push(p);
      }
    };
    walk(path.join(root, dir));
  }
  return out.sort();
};

const client = (): string => fs.readFileSync(CCRC_API, 'utf8');

/** The client with its comments stripped. The negative flag scans below MUST
 *  read this and not the raw file: `ccrc-api`'s own header names every flag it
 *  deliberately does not have ("no `--url`, no `--host`, no `--path`, no
 *  `--raw`"), so a scan over the whole text fails on the sentence promising the
 *  property it is checking. Measured while writing this file (D-741). */
const clientCode = (): string => client().split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** Every fenced code block in a markdown file. What a reader RUNS lives in
 *  these; the prose around them is where an invariant explains itself. */
function fences(md: string): string[] {
  const out: string[] = [];
  let inside = false, buf: string[] = [];
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (inside) { out.push(buf.join('\n')); buf = []; }
      inside = !inside;
      continue;
    }
    if (inside) buf.push(line);
  }
  return out;
}

describe('the corpora no longer invoke curl', () => {
  it('no fenced block in either corpus runs curl', () => {
    // The test that would have caught the original defect class. A repo may
    // deny `Bash(curl:*)`, and one did on 2026-08-26 — the worker on that
    // programme could not read its mail at all, while the coordinator kept
    // going only because `resp=$(curl …)` slips past that matcher.
    //
    // DEVIATION from the plan's wording, deliberately: the plan asked for "zero
    // `curl ` occurrences in both corpora", but the same plan's Task 4 requires
    // KEEPING the prose that explains why the client exits 0 on a 4xx — "an
    // invariant that loses its stated reason is how it gets re-broken" — and
    // that prose necessarily says the word. So the guard is about INVOCATIONS,
    // which is what the deny rule is about too. Prose may discuss curl; no
    // block a reader would run may call it. (D-739.)
    for (const f of corpusFiles()) {
      const bad = fences(fs.readFileSync(f, 'utf8'))
        .filter((b) => /(^|[|;&(`$]\s*)curl\s/m.test(b));
      expect(bad, `${path.relative(root, f)} still runs curl in a code block`).toEqual([]);
    }
  });

  it('the corpora that call the API name the client', () => {
    const callers = corpusFiles().filter((f) => /```[\s\S]*?\$\("?\$?API/.test(fs.readFileSync(f, 'utf8')));
    expect(callers.length, 'no corpus file calls the client — the rewrite went missing').toBeGreaterThan(0);
  });
});

describe('the client stays closed', () => {
  it('takes no URL, host, path or raw argument', () => {
    // Any one of these would make it curl with a different name, and would
    // retroactively make every install of it an evasion rather than a client.
    for (const flag of ['--url', '--host', '--path', '--raw', '--endpoint', '--base']) {
      expect(clientCode(), `ccrc-api grew a ${flag} argument`)
        .not.toMatch(new RegExp(`['"\`\\s]\\${flag}\\b`));
    }
  });

  it('has exactly ONE identity flag, and it declares rather than forges', () => {
    // Identity here is attribution, not authentication — one UNIX user, no
    // caller auth. `--by` exists because CONTRIBUTING.md:66-70 sends outside
    // contributors to this allocator and auth/gate.ts:256-259 keeps that route
    // EXEMPT so the door stays open: it is a DECLARATION by a caller with no
    // pane, refused on every other row, while a session in a pane is filled from
    // its pane. These spellings would be something else — a way to answer AS
    // another session on a route that checks attribution.
    for (const flag of ['--as', '--from-id', '--from-uuid', '--impersonate',
                        '--as-session', '--identity', '--who']) {
      expect(clientCode(), `ccrc-api grew a ${flag} argument`)
        .not.toMatch(new RegExp(`['"\`\\s]\\${flag}\\b`));
    }
    // DERIVED from the client's own case labels, not a hand-kept list: a second
    // identity-bearing flag reds here the day it lands. (`--*)` is not matched —
    // `*` is outside the class.)
    const cases = [...clientCode().matchAll(/^\s*(--[a-z-]+)\)/gm)].map((m) => m[1]!);
    expect(cases.sort()).toEqual(['--by', '--json']);
  });

  it('never hands the token to anything that prints', () => {
    // Not a style rule: the token is one shared box secret, and a session's
    // scrollback is captured, mailed and rendered in a PWA.
    //
    // The variable names are DERIVED from the client, not guessed. The first
    // version of this guard looked for `$token`/`$TOKEN` and was inert:
    // `read_token`'s local is `$t`, so planting `echo "token=$t"` in the client
    // left this green. Measured (D-740). Anything the client assigns from the token
    // file, or passes as the header, counts — and `read_token`'s own `printf`
    // is the one allowed printer, because returning the value IS how a bash
    // function returns.
    const src = client();
    const names = new Set(['t', 'token', 'TOKEN']);
    for (const m of src.matchAll(/^\s*(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)=\$\((?:cat|grep)[^)]*TOKEN_FILE/gm)) {
      names.add(m[1]!);
    }
    const inReadToken = (i: number): boolean => {
      const fn = src.indexOf('read_token() {');
      const end = src.indexOf('\n}', fn);
      return fn > -1 && i > fn && i < end;
    };
    const offenders: string[] = [];
    let at = 0;
    for (const line of src.split('\n')) {
      const start = at; at += line.length + 1;
      const l = line.trim();
      if (l.startsWith('#')) continue;
      if (!/^(echo|printf|logger|>&2)\b/.test(l)) continue;
      if (![...names].some((n) => new RegExp(`\\$\\{?${n}\\b`).test(l))) continue;
      if (inReadToken(start)) continue;   // the function's own return value
      offenders.push(l);
    }
    expect(offenders).toEqual([]);
  });

  it('validates every caller-supplied fragment before it can reach a URL', () => {
    // The id and the query value are the ONLY caller-supplied text that ever
    // lands in a path or a query string, so they are the only places a path
    // could be smuggled in. Both are checked against one pattern, and the
    // pattern admits no dot — so `..` cannot survive it.
    const src = clientCode();
    expect(src).toMatch(/SAFE_RE='\^\[A-Za-z0-9_-\]\+\$'/);
    expect((src.match(/=~ \$SAFE_RE/g) ?? []).length,
      'both the id and the query value must be checked').toBeGreaterThanOrEqual(3);
  });
});

describe('the client is not on the exec surface', () => {
  it('EXEC_COMMANDS is exactly tmux and ccd, and names no client', () => {
    // `ccrc-api` is a SESSION-side client. The PWA -> server -> agent path has
    // no business reaching it, and the temptation to add it will be real now
    // that the binary exists — the exec whitelist is the one gate between the
    // PWA and a shell on the fleet box, and `gh` is kept off it for exactly
    // this reason.
    //
    // Read as TEXT rather than imported: `EXEC_COMMANDS` lives in
    // `agent/src/whitelist.ts`, a different package with its own tsconfig, and
    // this file belongs to the slice that could add the entry. A textual pin is
    // what the tree's other cross-package guards use.
    const wl = fs.readFileSync(path.join(root, 'agent', 'src', 'whitelist.ts'), 'utf8');
    expect(wl).toContain("export const EXEC_COMMANDS = ['tmux', 'ccd'] as const;");
    const decl = /export const EXEC_COMMANDS = \[([^\]]*)\]/.exec(wl);
    expect(decl, 'EXEC_COMMANDS is no longer a literal array — re-read this guard').not.toBeNull();
    expect(decl![1]).not.toMatch(/ccrc-api/);
  });
});
