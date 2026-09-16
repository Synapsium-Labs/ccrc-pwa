// The guards that make `ccrc-api`'s closed table a mechanism rather than a
// docstring. Everything here is a standing property of the tree, not a property
// of one change: each one is something that would be true today and quietly
// false in a month, and each is the kind of thing whose loss is invisible until
// a session on a locked-down repo cannot talk to the server at all.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CCRC_API } from './ccdWsHelpers.js';

const root = path.join(import.meta.dirname, '..', '..');
const corpusFiles = (): string[] => {
  const out: string[] = [];
  for (const dir of ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill']) {
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

const routeKeys = (): Set<string> => {
  const src = client();
  const start = src.indexOf('declare -A ROUTES=(');
  const table = src.slice(start, src.indexOf('\n)', start));
  return new Set([...table.matchAll(/^\s*\[([a-z.-]+)\]=/gm)].map((m) => m[1]!));
};

/** The client with its comments stripped. The negative flag scans below MUST
 *  read this and not the raw file: `ccrc-api`'s own header names every flag it
 *  deliberately does not have ("no `--url`, no `--host`, no `--path`, no
 *  `--raw`"), so a scan over the whole text fails on the sentence promising the
 *  property it is checking. Measured while writing this file (D-741). */
const clientCode = (): string => client().split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** Every executable Markdown block: backtick/tilde fences plus runs of
 *  four-space-indented code. The corpora deliberately use both forms. */
function executableBlocks(md: string): string[] {
  const out: string[] = [];
  const lines = md.split('\n');
  let fence: '`' | '~' | null = null;
  let buf: string[] = [];

  const flush = (): void => {
    if (buf.some((line) => line.trim() !== '')) out.push(buf.join('\n'));
    buf = [];
  };

  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (marker?.[0] === fence) {
        flush();
        fence = null;
      } else {
        buf.push(line);
      }
      continue;
    }
    if (marker) {
      flush();
      fence = marker[0] as '`' | '~';
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      buf.push(line.replace(/^(?: {4}|\t)/, ''));
      continue;
    }
    if (buf.length > 0 && line.trim() === '') {
      buf.push('');
      continue;
    }
    flush();
  }
  flush();
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
      const bad = executableBlocks(fs.readFileSync(f, 'utf8'))
        .filter((b) => /(^|[|;&(`$]\s*)curl\s/m.test(b));
      expect(bad, `${path.relative(root, f)} still runs curl in a code block`).toEqual([]);
    }
  });

  it('the corpora that call the API name the client', () => {
    const callers = corpusFiles().filter((f) => /```[\s\S]*?\$\("?\$?API/.test(fs.readFileSync(f, 'utf8')));
    expect(callers.length, 'no corpus file calls the client — the rewrite went missing').toBeGreaterThan(0);
  });

  it('every executable corpus client command maps to the closed route table', () => {
    const declared = routeKeys();
    const invoked = new Set<string>();
    // D-2727: harvest on the BINARY NAME, not on the two spellings that already
    // comply. The old alternation recognised only `$API`/`"$API"` and the fully
    // quoted `"$HOME/.local/bin/ccrc-api"`, so a bare on-PATH `ccrc-api <group>
    // <verb>` — the spelling the corpora themselves use elsewhere — entered no
    // census at all: an undeclared verb written that way stayed green. A census
    // assembled only from compliant forms cannot see its own next violation.
    const command = /(?:"?(?:\$HOME\/\.local\/bin\/)?ccrc-api"?|"?\$API"?)\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g;
    for (const file of corpusFiles()) {
      for (const block of executableBlocks(fs.readFileSync(file, 'utf8'))) {
        for (const match of block.matchAll(command)) {
          if (match[1] === 'whoami') continue;
          expect(match[2], `${path.relative(root, file)} has an incomplete client command`)
            .toBeDefined();
          invoked.add(`${match[1]}.${match[2]}`);
        }
      }
    }
    expect(invoked.size, 'the executable corpus no longer calls a routed operation')
      .toBeGreaterThan(0);
    expect([...invoked].sort()).toEqual([
      'asks.answer',
      'asks.list',
      'asks.release',
      'claims.release',
      'claims.take',
      'ledger.allocate',
      'mail.send',
      'peers.list',
      'runs.list',
      'runs.open',
      'runs.route',
      'runs.signals',
    ]);
    expect([...invoked].filter((key) => !declared.has(key)),
      'an executable corpus command has no ccrc-api route row').toEqual([]);
  });

  it('executes ask examples with no valid default and exact expanded calls', () => {
    const lifecycle = fs.readFileSync(path.join(
      root, 'ccd/coordinator-skill/references/wave-lifecycle.md'), 'utf8');
    const askBlocks = executableBlocks(lifecycle)
      .filter((block) => /"\$API"\s+asks\s+(?:answer|release)\b/.test(block));
    expect(askBlocks, 'the lifecycle must carry answer and release examples').toHaveLength(2);

    for (const block of askBlocks) {
      const operation = /"\$API"\s+asks\s+(answer|release)\b/.exec(block)?.[1];
      expect(operation).toBeDefined();
      expect(block, `${operation}: a copied example must not default to a valid ask id`)
        .not.toMatch(/(?:^|\n)\s*ask_id=\d+/);
      expect(block, `${operation}: the ask id must fail closed before client invocation`)
        .toContain(': "${ask_id:?set ask_id to the held ask row positive decimal id}"');
      expect(block, `${operation}: the client receives one quoted ask id`)
        .toMatch(/asks\s+(?:answer|release)\s+"\$ask_id"\s+--json/);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ccrc-ask-example-${operation}-`));
      const calls = path.join(dir, 'calls');
      const client = path.join(dir, 'client');
      fs.writeFileSync(client,
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CALLS"\ncat >> "$CALLS"\n', { mode: 0o755 });
      try {
        const baseEnv = { ...process.env, API: client, id: 'parent-id', uuid: 'parent-uuid', CALLS: calls };
        const missing = spawnSync('bash', ['-c', block], { env: baseEnv, encoding: 'utf8' });
        expect(missing.status, `${operation}: an absent ask_id must stop the example`).not.toBe(0);
        expect(fs.existsSync(calls), `${operation}: the client ran before ask_id was supplied`).toBe(false);

        const supplied = spawnSync('bash', ['-c', block], {
          env: { ...baseEnv, ask_id: '37' }, encoding: 'utf8',
        });
        expect(supplied.status, `${operation}: supplied example stderr: ${supplied.stderr}`).toBe(0);
        const expected = operation === 'answer'
          ? 'asks answer 37 --json -\n{"fromId":"parent-id","fromUuid":"parent-uuid","optionIndexes":[0]}\n'
          : 'asks release 37 --json -\n{"fromId":"parent-id","fromUuid":"parent-uuid"}\n';
        expect(fs.readFileSync(calls, 'utf8')).toBe(expected);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
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
