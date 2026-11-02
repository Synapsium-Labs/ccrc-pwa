// The guards that make `ccrc-api`'s closed table a mechanism rather than a
// docstring. Everything here is a standing property of the tree, not a property
// of one change: each one is something that would be true today and quietly
// false in a month, and each is the kind of thing whose loss is invisible until
// a session on a locked-down repo cannot talk to the server at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CCRC_API, harnessBin } from './ccdWsHelpers.js';
import { clientRoutes } from './ccrcApiTable.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp } from './tmpHelpers.js';

const root = path.join(import.meta.dirname, '..', '..');
const corpusFiles = (): string[] => {
  const out: string[] = [];
  for (const dir of ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill', 'ccd/history-skill']) {
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

const routeKeys = (): Set<string> => new Set(clientRoutes().map((r) => r.key));

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
      'landing.show',
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
    // `--session` (delegation broker wave 3, Task 15) is the third label and is NOT a second identity-bearing flag: it belongs to
    // `parse_intent`, the focused grammar of `coordinators intent`, where it is an ASSERTION that must equal the pane-derived id
    // (the next test holds that), the shape `asks list --parent` already has.
    expect(cases.sort()).toEqual(['--by', '--json', '--session']);
  });

  it('`coordinators intent` takes its identity from the pane: --session is compared with it and never builds anything (Task 15)', () => {
    // The whole focused grammar is one function, read here as TEXT so a mutation that lets the flag SELECT the session reds by its line.
    const code = clientCode();
    const start = code.indexOf('parse_intent() {');
    expect(start, 'the focused intent grammar is gone').toBeGreaterThan(-1);
    const fn = code.slice(start, code.indexOf('\n}', start));
    // ONE flag, and it is the only case label in the function.
    expect([...fn.matchAll(/^\s*(--[a-z-]+)\)/gm)].map((m) => m[1])).toEqual(['--session']);
    // The identity is derived BEFORE the comparison, and the comparison refuses.
    const derive = fn.indexOf('derive_identity');
    const compare = fn.indexOf('[[ "$session" == "$DERIVED_ID" ]]');
    expect(derive, 'parse_intent no longer derives the pane identity').toBeGreaterThan(-1);
    expect(compare, 'parse_intent no longer compares --session with the derived id').toBeGreaterThan(derive);
    expect(fn.slice(compare, compare + 160)).toContain("refuse 'session-mismatch'");
    // The id and the body come from the derived pair; the flag's value is read into `session` and reaches nothing else.
    const body = /^\s*INTENT_BODY=(.*)$/m.exec(fn)?.[1] ?? '';
    expect(body).toContain('$DERIVED_ID');
    expect(body).toContain('$DERIVED_UUID');
    expect(body, 'the body is built from the --session value').not.toContain('$session');
    expect(/^\s*INTENT_ID="\$DERIVED_ID"$/m.test(fn), 'the path id is not the derived id').toBe(true);
    expect([...fn.matchAll(/\$\{?session\b/g)].length, '--session is used for something besides the one comparison').toBe(1);
    // And the generic parser is told nothing: it runs on an emptied argument list for this row.
    expect(code).toMatch(/if \[\[ "\$key" == 'coordinators\.intent' \]\]; then\n\s+parse_intent "\$@"\n[^\n]*\n\s+set --\n/);
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

  it('hands the token to curl on stdin, as one `-K -` config line, and on no argv (R16)', () => {
    // A `-H` value is readable in every process listing on the box for the
    // life of the call. The behaviour is pinned in ccrc-api.test.ts (a curl
    // that records its argv and stdin); this pins the one sink in the source,
    // so a second header site, or the old `-H "x-ccrc-mail-token: $TOKEN"`,
    // reds here by its line.
    const code = clientCode();
    const mentions = code.split('\n').filter((l) => /x-ccrc-mail-token/i.test(l)).map((l) => l.trim());
    expect(mentions).toEqual([`code=$(printf 'header = "x-ccrc-mail-token: %s"\\n' "$TOKEN" \\`]);
    expect(code).toContain(`\n    | curl "\${args[@]}" "$url" 2>/dev/null)\n`);
    expect(code).toMatch(/^\s*local -a args=\(-sS -K - /m);
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

  it('fills a body on exactly two rows and splices the family\'s kind on the four claimant rows, and the census of rows is unchanged (D-5298, D-7322)', () => {
    // A body fill is one of the two ways this client writes words its caller did not.
    // `ledger.allocate` fills `byId`; `runs.open` fills `claimedByUuid`, the
    // claimant's own `.uuid` (coordinator-first routing, plan Task 11a). A third
    // row, or `runs.open`'s fill moved onto a row that sets no claimant, is a
    // decision this census makes someone take on purpose. Neither fill is a new
    // row, a new route or a passthrough. The other way is `coordinators.intent`
    // (delegation broker wave 3, Task 15), whose body `parse_intent` builds whole
    // from the pane's identity: it fills nothing, so the scan below does not see
    // it, and its row took the table from twenty-four to twenty-five on the merge.
    // The three approvals rows (coordinator-first routing, plan Task 14) took it to
    // twenty-eight; they fill nothing either: the hook builds its request body whole.
    // The claimant's three (plan Task 16) took it to thirty-one: `rule` and `release` carry the caller's own body,
    // and `show` derives its query from the pane as `asks list` does — a query, not a body fill.
    // The test box's two (test box plan TB9, D-7411) took it to thirty-three; neither takes a body or fills one.
    // The landing line's read (landing order wave 5e, D-7625) took it to thirty-four; it takes no body and fills none.
    // The twelve Linear rows (D-7669, #1444) took it to forty-six; they fill no body: their identity rides the query
    // (the describe at the end of this file).
    // The third fill is the question door family's `kind` (K5 Q3j): on the four claimant rows only, the client splices a
    // `kind` read from the row's family template, never from the caller, so it is counted by its own scan below rather
    // than by the two keyed fills' spelling. Since Q3l (D-7324) the template is the row's path and is always sent, so
    // the scan reads the `$claimant` test Q3l writes (named exception).
    const code = clientCode();
    const filled = [...code.matchAll(/^\s*if \[\[ "\$key" == '([a-z.-]+)' && -n "\$body" \]\]; then$/gm)]
      .map((m) => m[1]!).sort();
    expect(filled).toEqual(['ledger.allocate', 'runs.open']);
    expect(routeKeys().size).toBe(46);
    // The claimant's identity is the PANE's, derived, never a value the caller
    // passes as a flag: the runs.open fill splices `$DERIVED_UUID` and nothing else.
    expect(code).toMatch(/splice_body_field 'claimedByUuid' "\$DERIVED_UUID"/);
    // The family's splice: one guard line, one `kind` splice, its value the variable read from the row template's
    // prefix (`$claimant`), and the rows whose template is the family's are exactly the four claimant rows.
    expect([...code.matchAll(/^\s*if \[\[ -n "\$claimant" \]\] && _api_server_cap "\$want"; then$/gm)], 'the family guard line').toHaveLength(1);
    const kindSplices = [...code.matchAll(/splice_body_field 'kind' "\$([a-z_]+)"/g)].map((m) => m[1]!);
    expect(kindSplices, 'the kind splice').toEqual(['claimant']);
    expect(code, 'the spliced kind is derived from the family template\'s prefix').toMatch(
      /^\s*claimant="\$\{tmpl#\/api\/questions\/\}"\n\s*claimant="\$\{claimant%%-\*\}"$/m);
    expect(clientRoutes().filter((r) => r.path.startsWith('/api/questions/')).map((r) => r.key))
      .toEqual(['asks.answer', 'asks.release', 'approvals.rule', 'approvals.release']);
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

describe('the Linear rows: identity in the query on every row, the body as the caller gave it (D-7669, #1444)', () => {
  // Spec §14 row 15. The client derives the pane's identity on every `linear.*` row and appends it to the QUERY, after
  // the row's declared keys, GETs and POSTs alike; it never reads or edits a body for identity. The loopback server
  // below stands in for the proxy's closed body validators (spec §5.3): it parses the body as JSON, so it sees keys
  // as JSON defines them, `\u`-escaped ones included, and refuses `byId`, `byUuid` and `workspace` as `bad-field`
  // with the field named. A body the client had spliced would arrive with a key the caller never wrote.
  const BODY_ONLY_REFUSED = ['byId', 'byUuid', 'workspace'];
  const TOKEN = 'y'.repeat(64);
  let home: string;
  let server: Server;
  let seen: { method: string; url: string; body: string }[];

  beforeEach(async () => {
    home = mkTmp('ccrc-api-linear-');
    seen = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', body });
        let answer: { code: number; json: unknown } = { code: 200, json: { ok: true } };
        if (body !== '') {
          let parsed: unknown;
          try { parsed = JSON.parse(body); } catch { parsed = undefined; }
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            answer = { code: 400, json: { ok: false, error: 'bad-request', detail: 'body' } };
          } else {
            const named = BODY_ONLY_REFUSED.find((k) => Object.hasOwn(parsed as object, k));
            if (named !== undefined) answer = { code: 400, json: { ok: false, error: 'bad-field', detail: named } };
          }
        }
        res.writeHead(answer.code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.json));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    writeClientHome(home, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN);
    // A tmux that answers for the pane, planted first on PATH (`ccrc-api.test.ts#plantPane`'s shape).
    fs.writeFileSync(path.join(harnessBin(home), 'tmux'), "#!/bin/sh\nprintf 'cc-demo-ws\\n'\n", { mode: 0o755 });
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-ws.uuid'), 'u-1234\n');
  });

  afterEach(async () => {
    await new Promise<void>((r) => { server.close(() => r()); });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const PANE = { TMUX_PANE: '%7' };
  const ID = 'byId=demo-ws&byUuid=u-1234';
  const run = (args: string[], input?: string, env: Record<string, string | undefined> = PANE): Promise<Run> =>
    runClient(home, args, input, env);
  const envelope = (r: Run): { ok: boolean; error?: string; detail?: string } =>
    JSON.parse(r.stdout) as { ok: boolean; error?: string; detail?: string };

  // [verb args, method, path, the declared query the call sends before the identity pair ('' for none)].
  const CALLS: ReadonlyArray<readonly [string[], string, string, string]> = [
    [['linear', 'workspaces'], 'GET', '/api/linear/proxy/workspaces', ''],
    [['linear', 'teams', '--workspace', 'ws-a'], 'GET', '/api/linear/proxy/teams', 'workspace=ws-a'],
    [['linear', 'issue', 'AAA-12'], 'GET', '/api/linear/proxy/issues/AAA-12', ''],
    [['linear', 'search', '--json', '-'], 'POST', '/api/linear/proxy/search', ''],
    [['linear', 'comments', 'AAA-12', '--limit', '5', '--after', 'Y3Vyc29y'], 'GET', '/api/linear/proxy/issues/AAA-12/comments', 'limit=5&after=Y3Vyc29y'],
    [['linear', 'statuses', '--team', 'AAA', '--workspace', 'ws-a'], 'GET', '/api/linear/proxy/statuses', 'team=AAA&workspace=ws-a'],
    [['linear', 'projects', '--team', 'BBB', '--limit', '10'], 'GET', '/api/linear/proxy/projects', 'team=BBB&limit=10'],
    [['linear', 'labels', '--team', 'AAA'], 'GET', '/api/linear/proxy/labels', 'team=AAA'],
    [['linear', 'users', '--after', 'Y3Vyc29y'], 'GET', '/api/linear/proxy/users', 'after=Y3Vyc29y'],
    [['linear', 'create', '--json', '-'], 'POST', '/api/linear/proxy/issues', ''],
    [['linear', 'update', 'AAA-12', '--json', '-'], 'POST', '/api/linear/proxy/issues/AAA-12', ''],
    [['linear', 'comment', 'AAA-12', '--json', '-'], 'POST', '/api/linear/proxy/issues/AAA-12/comments', ''],
  ];
  const linearRows = (): ReturnType<typeof clientRoutes> => clientRoutes().filter((r) => r.key.startsWith('linear.'));
  const POSTS = CALLS.filter(([, m]) => m === 'POST');

  it('the twelve Linear rows are exactly the calls below, read through clientRoutes()', () => {
    expect(linearRows().map((r) => r.key).sort()).toEqual(CALLS.map(([a]) => `${a[0]}.${a[1]}`).sort());
    expect(linearRows()).toHaveLength(12);
  });

  it.each(CALLS)('%s sends %s %s with the pane\'s identity last in the query', async (args, method, p, q) => {
    const r = await run(args, args.includes('--json') ? '{"team":"AAA","title":"t"}' : undefined);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.url])).toEqual([[method, `${p}?${q === '' ? '' : `${q}&`}${ID}`]]);
  });

  it.each(POSTS)('%s puts the body on the wire byte for byte, and splices nothing into it', async (args) => {
    const bodies = ['{"team":"AAA","title":"t"}', ' { "body" : "a\\nb" }\n', '{}'];
    for (const b of bodies) await run(args, b);
    // `$(cat)` strips a trailing newline, as every `--json -` row has always sent it; nothing else changes.
    expect(seen.map((s) => s.body)).toEqual(bodies.map((b) => b.replace(/\n+$/, '')));
    expect(seen.every((s) => s.url.endsWith(`?${ID}`))).toBe(true);
  });

  it.each(POSTS)('%s sends a body naming byId as given, the escaped spelling included, and the server refuses it bad-field', async (args) => {
    const bodies = [
      '{"\\u0062yId":"x","team":"AAA","title":"t"}',
      '{"byId":"neighbour","byUuid":"u-other","team":"AAA","title":"t"}',
      '{"workspace":"ws-b","team":"AAA","title":"t"}',
    ];
    const answers: [number, string | undefined, string | undefined][] = [];
    for (const b of bodies) {
      const r = await run(args, b);
      answers.push([r.status, envelope(r).error, envelope(r).detail]);
    }
    expect(seen.map((s) => s.body)).toEqual(bodies);
    expect(seen.every((s) => s.url.endsWith(`?${ID}`)), 'the query carries the pane\'s pair, never the body\'s').toBe(true);
    expect(answers).toEqual([[0, 'bad-field', 'byId'], [0, 'bad-field', 'byId'], [0, 'bad-field', 'workspace']]);
  });

  it('a caller cannot name byId or byUuid on any Linear row: unknown-query, exit 2, nothing sent', async () => {
    for (const [args] of CALLS) {
      for (const k of ['--byId', '--byUuid']) {
        const r = await run([...args, k, 'neighbour'], args.includes('--json') ? '{}' : undefined);
        expect([r.status, envelope(r).error], `${args.join(' ')} ${k}`).toEqual([2, 'unknown-query']);
      }
    }
    expect(seen).toEqual([]);
  });

  it('free text has no query key: every Linear row declares only workspace, team, limit and after', async () => {
    const allowed = new Set(['workspace', 'team', 'limit', 'after']);
    for (const row of linearRows()) {
      expect(row.query.filter((k) => !allowed.has(k)), row.key).toEqual([]);
    }
    for (const k of ['--text', '--title', '--description', '--body', '--q', '--query']) {
      const r = await run(['linear', 'search', k, 'x', '--json', '-'], '{}');
      expect([r.status, envelope(r).error], k).toEqual([2, 'unknown-query']);
    }
    expect(seen).toEqual([]);
  });

  it('workspace is declared on all eleven rows but workspaces, which takes no query key at all', () => {
    for (const row of linearRows()) {
      expect(row.query.includes('workspace'), row.key).toBe(row.key !== 'linear.workspaces');
    }
    expect(linearRows().find((r) => r.key === 'linear.workspaces')?.query).toEqual([]);
  });

  it('the issue verbs take --workspace and send workspace=x', async () => {
    const f = path.join(home, 'comment.json');
    fs.writeFileSync(f, '{"body":"b"}');
    const calls: string[][] = [
      ['linear', 'issue', 'AAA-12', '--workspace', 'x'],
      ['linear', 'comments', 'AAA-12', '--workspace', 'x'],
      ['linear', 'comment', 'AAA-12', '--workspace', 'x', '--json', f],
    ];
    for (const a of calls) {
      const r = await run(a);
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ['GET', `/api/linear/proxy/issues/AAA-12?workspace=x&${ID}`, ''],
      ['GET', `/api/linear/proxy/issues/AAA-12/comments?workspace=x&${ID}`, ''],
      ['POST', `/api/linear/proxy/issues/AAA-12/comments?workspace=x&${ID}`, '{"body":"b"}'],
    ]);
  });

  it('search posts to its own path, never under /issues/', async () => {
    const row = linearRows().find((r) => r.key === 'linear.search');
    expect([row?.method, row?.path, row?.needsId]).toEqual(['POST', '/api/linear/proxy/search', false]);
    await run(['linear', 'search', '--json', '-'], '{"text":"a b"}');
    expect(seen.map((s) => s.url.split('?')[0])).toEqual(['/api/linear/proxy/search']);
    expect(seen[0]!.url).not.toContain('/issues');
  });

  it('a <REF> that fails the identifier grammar is refused locally as bad-ref (D-7685), exit 2, and nothing is sent', async () => {
    const refs = ['AAA12', 'AAA-', 'search', '-12', '1AA-12', 'AAA-1234567890', 'AAA-12-3'];
    for (const verb of ['issue', 'comments', 'update', 'comment']) {
      for (const ref of refs) {
        const r = await run(['linear', verb, ref, ...(verb === 'update' || verb === 'comment' ? ['--json', '-'] : [])], '{}');
        expect([r.status, envelope(r).error], `${verb} ${ref}`).toEqual([2, 'bad-ref']);
      }
    }
    expect(seen).toEqual([]);
    // The grammar's edges that pass: one letter, an underscore, nine digits.
    for (const ref of ['A-1', 'a_B9-123456789']) await run(['linear', 'issue', ref]);
    expect(seen.map((s) => s.url.split('?')[0])).toEqual(['/api/linear/proxy/issues/A-1', '/api/linear/proxy/issues/a_B9-123456789']);
  });

  it('a pane with no identity is refused locally on every Linear row, and nothing is sent', async () => {
    for (const [args] of CALLS) {
      const r = await run(args, args.includes('--json') ? '{}' : undefined, { TMUX_PANE: undefined, TMUX: undefined });
      expect([r.status, envelope(r).error], args.join(' ')).toEqual([2, 'no-pane']);
    }
    fs.rmSync(path.join(home, '.cc-sessions', 'demo-ws.uuid'));
    const r = await run(['linear', 'workspaces']);
    expect([r.status, envelope(r).error]).toEqual([2, 'no-uuid']);
    expect(seen).toEqual([]);
  });

  it('the identity is appended to the query and nowhere else: the Linear block never names the body', () => {
    const code = clientCode();
    const at = code.indexOf('if [[ "$key" == linear.* ]]; then');
    expect(at, 'the Linear identity block is gone').toBeGreaterThan(-1);
    const block = code.slice(at, code.indexOf('\n  fi\n', at));
    expect(block).toContain('derive_identity');
    expect(block).toContain('query+="${query:+&}byId=$DERIVED_ID&byUuid=$DERIVED_UUID"');
    expect(block, 'the Linear block reads or edits the body').not.toMatch(/\$\{?body\b|splice_body_field/);
  });
});
