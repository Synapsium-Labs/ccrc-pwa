// D1 (codex bridge spec §2.9; Stage 2 plan, Task 19): the Codex source watch, `.github/ci/codex-wire-watch.mjs`.
// Offline: `wireReport` and `nextPairs` run over synthetic Rust excerpts in `fixtures/codex-wire/` (D-6424: shaped
// like the two upstream changes D1 names, the 0.162.0 move of `instructions` out of the request struct and the
// 0.155.0 removal of the compaction endpoint constant; no upstream source is copied here). The walk cases run through
// the module's own GitHub layer with `fetch` injected, so they open no socket; the CLI cases run the script as a child
// process against the same fake served on loopback, with a synthetic token, nothing of this environment passed on, and
// a preloaded guard that refuses any request off 127.0.0.1. The workflow reads the real files at run time. Mutation
// rows G1-G4, and G5-G9 (the author filter, the missing-file refusal, the test-module cut, the enum scan and the
// printable-name bound), are measured in the commit body of Task 19; G10-G19 (fix round 1: the CLI's exit codes, the
// first-run state seed, the release flags and paging, the body's length cap, the serde names and the printable-name
// class and length) in fix round 1's; G20-G25 and G20b (fix round 2: the first-run paging stop, `<`, `>` and
// whitespace each alone, the CLI's API base and that the CLI walk reached the fake) in fix round 2's; G26-G27 (fix
// round 3: each arm of the release paging stop set never to stop) in the whole-wave fix round's commit body.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  CONTRACT_FILES, STATE_TITLE, BOT_LOGIN, UPSTREAM, wireReport, nextPairs, pairTitle, issueBody, runWatch, githubIo,
} from '../../.github/ci/codex-wire-watch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'codex-wire');

/** Every file of one fixture directory, keyed by its contract path. */
function readSet(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const e of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${e}` : e;
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else out[r] = readFileSync(path.join(dir, r), 'utf8');
    }
  };
  walk('');
  return out;
}
const BASE = readSet(path.join(FIX, 'base'));
const overlay = (name: string): Record<string, string> => ({ ...BASE, ...readSet(path.join(FIX, name)) });

const tag = (minor: number): string => `rust-v0.${minor}.0`;

describe('wireReport over the nine contract files', () => {
  it('the base fixture holds exactly the nine contract files', () => {
    expect(Object.keys(BASE).sort()).toEqual([...CONTRACT_FILES].sort());
    expect(CONTRACT_FILES).toHaveLength(9);
  });

  it('it reports the removal of the instructions field', () => {
    const r = wireReport(BASE, overlay('instructions-moved'));
    expect(r.changed).toEqual(['codex-api/src/common.rs']);
    expect(r.findings).toEqual([
      'removed request-struct field `ResponsesApiRequest.instructions` (codex-api/src/common.rs)',
    ]);
  });

  it('it reports the removal of the compaction endpoint constant', () => {
    const r = wireReport(BASE, overlay('compact-endpoint-removed'));
    expect(r.changed).toEqual(['core/src/client.rs']);
    expect(r.findings).toEqual(['removed endpoint literal `/responses/compact` (core/src/client.rs)']);
  });

  it('an addition is a finding too, in each family', () => {
    const after = { ...BASE };
    after['codex-api/src/common.rs'] = BASE['codex-api/src/common.rs']!
      .replace('    pub store: bool,\n', '    pub store: bool,\n    pub service_tier: Option<String>,\n');
    after['protocol/src/models.rs'] = BASE['protocol/src/models.rs']!
      .replace('    Reasoning(ReasoningItem),\n', '    Reasoning(ReasoningItem),\n    LocalShellCall { call_id: String, action: String },\n');
    after['codex-api/src/sse/responses.rs'] = BASE['codex-api/src/sse/responses.rs']!
      .replace('        _ => None,', '        "response.output_text.done" => Some(Kind::TextDone),\n        _ => None,');
    after['codex-api/src/sse/responses_error.rs'] = BASE['codex-api/src/sse/responses_error.rs']!
      .replace('        _ => Failure::Other,', '        Some("quota_exceeded") => Failure::Quota,\n        _ => Failure::Other,');
    after['core/src/client.rs'] = BASE['core/src/client.rs']!
      .replace('    headers\n}', '    headers.insert("x-codex-turn-state", turn_value());\n    headers\n}');
    expect(wireReport(BASE, after).findings).toEqual([
      'added request-struct field `ResponseItem::LocalShellCall` (protocol/src/models.rs)',
      'added request-struct field `ResponseItem::LocalShellCall.action` (protocol/src/models.rs)',
      'added request-struct field `ResponseItem::LocalShellCall.call_id` (protocol/src/models.rs)',
      'added request-struct field `ResponsesApiRequest.service_tier` (codex-api/src/common.rs)',
      'added event literal `response.output_text.done` (codex-api/src/sse/responses.rs)',
      'added error-code literal `quota_exceeded` (codex-api/src/sse/responses_error.rs)',
      'added header literal `x-codex-turn-state` (core/src/client.rs)',
    ]);
  });

  it('a literal in a comment, a doc comment, a raw string or a test module, and a struct that is never sent, are no finding', () => {
    const after = { ...BASE };
    after['codex-api/src/common.rs'] = BASE['codex-api/src/common.rs']!
      .replace('response.not_an_event', 'response.still_prose')
      .replace('response.also_prose', 'response.more_prose')
      .replace('    pub never_sent: String,\n', '')
      .replace('        test_field: String,\n', '')
      .replace('"response.test_only"', '"response.test_only_too"');
    after['codex-api/src/sse/responses.rs'] = BASE['codex-api/src/sse/responses.rs']!
      .replace('r#"a raw "string" that is', 'r#"a raw "response.raw_text" that is');
    const r = wireReport(BASE, after);
    expect(r.changed).toEqual(['codex-api/src/common.rs', 'codex-api/src/sse/responses.rs']);
    expect(r.findings).toEqual([]);
  });

  it('a literal that could carry markup or a mention into the issue is never a name', () => {
    const after = { ...BASE };
    after['core/src/client.rs'] = BASE['core/src/client.rs']!
      .replace('const RESPONSES_ENDPOINT: &str = "/responses";',
        'const RESPONSES_ENDPOINT: &str = "/responses";\nconst DOCS_URL: &str = "https://example.invalid/`x`";\nconst HELP_URL: &str = "ask @someone";'
        + '\nconst TEAM_URL: &str = "@team-a";\nconst MARKUP_URL: &str = "<b>x</b>";'
        // One literal per excluded character, so each exclusion is pinned alone: `<`, `>` and whitespace.
        + '\nconst OPEN_URL: &str = "<team-a";\nconst CLOSE_URL: &str = "team-a>";\nconst SPACED_URL: &str = "team a";'
        + `\nconst LONG_PATH: &str = "/${'a'.repeat(200)}";`);
    expect(wireReport(BASE, after).findings).toEqual([]);
  });

  it('a change to a serde rename, tag or rename_all of what is sent is a finding', () => {
    const after = { ...BASE };
    after['protocol/src/models.rs'] = BASE['protocol/src/models.rs']!
      .replace('#[serde(tag = "type", rename_all = "snake_case")]', '#[serde(tag = "kind", rename_all = "camelCase")]')
      .replace('    Reasoning(ReasoningItem),\n', '    #[serde(rename = "reasoning_item")]\n    Reasoning(ReasoningItem),\n')
      .replace('arguments: String, call_id: String', 'arguments: String, #[serde(rename = "id")] call_id: String');
    after['codex-api/src/common.rs'] = BASE['codex-api/src/common.rs']!
      .replace('    pub store: bool,\n', '    #[serde(rename = "store_flag")]\n    pub store: bool,\n');
    expect(wireReport(BASE, after).findings).toEqual([
      'removed request-struct field `ResponseItem#rename_all=snake_case` (protocol/src/models.rs)',
      'removed request-struct field `ResponseItem#tag=type` (protocol/src/models.rs)',
      'added request-struct field `ResponseItem#rename_all=camelCase` (protocol/src/models.rs)',
      'added request-struct field `ResponseItem#tag=kind` (protocol/src/models.rs)',
      'added request-struct field `ResponseItem::FunctionCall.call_id=id` (protocol/src/models.rs)',
      'added request-struct field `ResponseItem::Reasoning=reasoning_item` (protocol/src/models.rs)',
      'added request-struct field `ResponsesApiRequest.store=store_flag` (codex-api/src/common.rs)',
    ]);
    const renamed = { ...after };
    renamed['codex-api/src/common.rs'] = after['codex-api/src/common.rs']!.replace('"store_flag"', '"store_on"');
    expect(wireReport(after, renamed).findings).toEqual([
      'removed request-struct field `ResponsesApiRequest.store=store_flag` (codex-api/src/common.rs)',
      'added request-struct field `ResponsesApiRequest.store=store_on` (codex-api/src/common.rs)',
    ]);
  });

  it('a name that moves between contract files is no finding', () => {
    const after = { ...BASE };
    after['codex-api/src/sse/responses_error.rs'] = BASE['codex-api/src/sse/responses_error.rs']!
      .replace('        Some("server_is_overloaded") => Failure::Overloaded,\n', '');
    const r = wireReport(BASE, after);
    expect(r.changed).toEqual(['codex-api/src/sse/responses_error.rs']);
    expect(r.findings).toEqual([]); // core/src/responses_retry.rs still names it
  });

  it('a removed variant of a sent enum, and a removed field of one, are findings', () => {
    const after = { ...BASE };
    after['protocol/src/models.rs'] = BASE['protocol/src/models.rs']!
      .replace('    Message { role: String, content: Vec<ContentItem> },\n', '')
      .replace('arguments: String, call_id', 'call_id');
    expect(wireReport(BASE, after).findings).toEqual([
      'removed request-struct field `ResponseItem::FunctionCall.arguments` (protocol/src/models.rs)',
      'removed request-struct field `ResponseItem::Message` (protocol/src/models.rs)',
      'removed request-struct field `ResponseItem::Message.content` (protocol/src/models.rs)',
      'removed request-struct field `ResponseItem::Message.role` (protocol/src/models.rs)',
    ]);
  });

  it('a contract file missing on either side is an error, never an empty report', () => {
    const without = { ...BASE };
    delete without['core/src/responses_retry.rs'];
    expect(() => wireReport(without, BASE)).toThrow(/core\/src\/responses_retry\.rs/);
    expect(() => wireReport(BASE, without)).toThrow(/core\/src\/responses_retry\.rs/);
  });
});

describe('nextPairs: every stable release since the last walk, never skipped', () => {
  it('three releases since the last walk give three consecutive pairs, oldest first', () => {
    const tags = [tag(163), tag(160), tag(162), tag(159), tag(161)];
    expect(nextPairs(tags, tag(160))).toEqual([[tag(160), tag(161)], [tag(161), tag(162)], [tag(162), tag(163)]]);
  });

  it('no report yet, two releases since the last walk give both pairs', () => {
    expect(nextPairs([tag(162), tag(161), tag(160)], tag(160))).toEqual([[tag(160), tag(161)], [tag(161), tag(162)]]);
  });

  it('with no state yet, the newest pair', () => {
    expect(nextPairs([tag(160), tag(162), tag(161)], null)).toEqual([[tag(161), tag(162)]]);
    expect(nextPairs([tag(160)], null)).toEqual([]);
  });

  it('versions sort numerically, and a walk that is up to date gives nothing', () => {
    expect(nextPairs(['rust-v0.99.0', 'rust-v0.100.0', 'rust-v0.99.1'], 'rust-v0.99.0'))
      .toEqual([['rust-v0.99.0', 'rust-v0.99.1'], ['rust-v0.99.1', 'rust-v0.100.0']]);
    expect(nextPairs([tag(160), tag(161)], tag(161))).toEqual([]);
  });

  it('a state that is not a stable tag refuses rather than restart the walk', () => {
    expect(() => nextPairs([tag(160), tag(161)], 'rust-v0.161.0-alpha.1')).toThrow(/stable/);
  });
});

describe('the issue text', () => {
  it('holds only upstream names: the pair, the compare link and the findings', () => {
    const r = wireReport(BASE, overlay('instructions-moved'));
    expect(pairTitle(tag(161), tag(162))).toBe(`codex wire: ${tag(161)}..${tag(162)}`);
    expect(issueBody(tag(161), tag(162), r)).toBe([
      `The wire-contract files of ${UPSTREAM} changed between \`${tag(161)}\` and \`${tag(162)}\`.`,
      '',
      `Compare: https://github.com/${UPSTREAM}/compare/${tag(161)}...${tag(162)}`,
      '',
      'Findings:',
      '- removed request-struct field `ResponsesApiRequest.instructions` (codex-api/src/common.rs)',
      '',
      'Changed contract files:',
      '- `codex-rs/codex-api/src/common.rs`',
      '',
    ].join('\n'));
  });

  it('stays under GitHub\'s body limit however long the findings, and counts the rest', () => {
    const files = CONTRACT_FILES.join(', ');
    const findings = Array.from({ length: 200 }, (_, k) => `removed endpoint literal \`/${String(k).padStart(3, '0')}${'x'.repeat(196)}\` (${files})`);
    const body = issueBody(tag(161), tag(162), { changed: [...CONTRACT_FILES], findings });
    expect(body.length).toBeLessThanOrEqual(65_536);
    const shown = body.split('\n').filter((l) => l.startsWith('- removed ')).length;
    expect(shown).toBeGreaterThan(0);
    expect(body).toContain(`- … and ${200 - shown} more\n`);
    expect(200 - shown).toBeGreaterThan(0);
  });
});

// ─── the walk, through the module's own GitHub layer with fetch injected ────────

type Issue = { number: number, title: string, body: string, user: { login: string, type: string }, pull_request?: object };
/** A release, newest first as the API lists them: a tag, or a tag with its draft and prerelease flags. */
type Release = string | { tag: string, draft?: boolean, prerelease?: boolean };
type Call = { method: string, url: string, auth?: string, body?: { title?: string, body?: string } };

const API = 'http://api.fake.invalid';
const REPO = 'owner-a/repo-a';
const bot = { login: 'github-actions[bot]', type: 'Bot' };

/** A fake of the four REST calls the walk makes. `files[tag]` is that tag's contract set, or a number: the
 *  status every contents request at that tag answers. Lists are paged by `per_page` and `page`, as the API pages
 *  them. Nothing here opens a socket. */
function fakeGitHub(opts: { tags: Release[], files: Record<string, Record<string, string> | number>, issues: Issue[], api?: string }) {
  const api = opts.api ?? API;
  const calls: Call[] = [];
  const logs: string[] = [];
  const issues = opts.issues.map((i) => ({ ...i }));
  const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (input: string, init: { method?: string, body?: string, headers?: Record<string, string> } = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    calls.push({ method, url: input, auth: init.headers?.authorization, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
    if (!input.startsWith(`${api}/`)) throw new Error(`the walk reached outside the fake: ${input}`);
    const u = new URL(input);
    const page = Number(u.searchParams.get('page') ?? '1');
    const perPage = Number(u.searchParams.get('per_page') ?? '30');
    const paged = <T>(all: T[]): T[] => all.slice((page - 1) * perPage, page * perPage);
    if (method === 'GET' && u.pathname === `/repos/${UPSTREAM}/releases`) {
      return json(paged(opts.tags.map((t, i) => (typeof t === 'string'
        ? { tag_name: t, draft: false, prerelease: false, id: i }
        : { tag_name: t.tag, draft: t.draft === true, prerelease: t.prerelease === true, id: i }))));
    }
    const contents = new RegExp(`^/repos/${UPSTREAM}/contents/codex-rs/(.+)$`).exec(u.pathname);
    if (method === 'GET' && contents) {
      const set = opts.files[u.searchParams.get('ref') ?? ''];
      if (set === undefined) return json({ message: 'Not Found' }, 404);
      if (typeof set === 'number') return json({ message: 'boom' }, set);
      const text = set[contents[1]!];
      return text === undefined ? json({ message: 'Not Found' }, 404) : new Response(text, { status: 200 });
    }
    if (u.pathname === `/repos/${REPO}/issues`) {
      if (method === 'GET') return json(paged(issues));
      if (method === 'POST') {
        const b = JSON.parse(init.body ?? '{}');
        const made = { number: 100 + issues.length, title: b.title, body: b.body, user: bot };
        issues.push(made);
        return json(made, 201);
      }
    }
    const one = new RegExp(`^/repos/${REPO}/issues/(\\d+)$`).exec(u.pathname);
    if (method === 'PATCH' && one) {
      const i = issues.find((x) => x.number === Number(one[1]));
      if (!i) return json({ message: 'Not Found' }, 404);
      i.body = JSON.parse(init.body ?? '{}').body;
      return json(i);
    }
    return json({ message: `unexpected ${method} ${u.pathname}` }, 500);
  };
  const io = githubIo({ repo: REPO, token: 'synthetic-token', apiBase: api, fetchImpl, log: (l) => { logs.push(l); } });
  const posted = () => calls.filter((c) => c.method === 'POST').map((c) => c.body?.title);
  const patched = () => calls.filter((c) => c.method === 'PATCH').map((c) => `${c.url.split('/').pop()}=${c.body?.body}`);
  /** The pairs the walk compared, from its own log lines. */
  const walkedPairs = () => logs.flatMap((l) => /^codex-wire-watch: (\S+): \d+ file/.exec(l)?.[1] ?? []);
  const read = (t: string) => calls.some((c) => c.url.includes(`ref=${encodeURIComponent(t)}`));
  return { io, calls, logs, posted, patched, walkedPairs, read, issues, fetchImpl };
}

describe('the walk', () => {
  it('an unchanged pair reports nothing', async () => {
    expect(wireReport(BASE, BASE)).toEqual({ changed: [], findings: [] });
    const gh = fakeGitHub({ tags: [tag(161), tag(160)], files: { [tag(160)]: BASE, [tag(161)]: BASE }, issues: [] });
    expect(await runWatch(gh.io)).toBe(0);
    // No finding issue; the state issue is created on this first run, holding the newest tag walked.
    expect(gh.posted()).toEqual([STATE_TITLE]);
    expect(gh.issues.find((i) => i.title === STATE_TITLE)?.body).toBe(tag(161));
  });

  it('a fetch failure on the second of three pairs leaves the state at the first pair\'s newer tag', async () => {
    const gh = fakeGitHub({
      tags: [tag(163), tag(162), tag(161), tag(160)],
      files: { [tag(160)]: BASE, [tag(161)]: overlay('instructions-moved'), [tag(162)]: 500, [tag(163)]: BASE },
      issues: [{ number: 7, title: STATE_TITLE, body: `${tag(160)}\n`, user: bot }],
    });
    expect(await runWatch(gh.io)).not.toBe(0);
    expect(gh.posted()).toEqual([pairTitle(tag(160), tag(161))]);
    expect(gh.patched()).toEqual([`7=${tag(161)}`]);
    // The walk ended at the pair that failed: the third pair's newer tag was never read.
    expect(gh.calls.some((c) => c.url.includes(`ref=${tag(163)}`))).toBe(false);
  });

  it('a contract file missing at one tag ends the walk there, the state unmoved', async () => {
    const partial = { ...BASE };
    delete partial['protocol/src/models.rs'];
    const gh = fakeGitHub({
      tags: [tag(161), tag(160)], files: { [tag(160)]: BASE, [tag(161)]: partial },
      issues: [{ number: 7, title: STATE_TITLE, body: tag(160), user: bot }],
    });
    expect(await runWatch(gh.io)).not.toBe(0);
    expect(gh.posted()).toEqual([]);
    expect(gh.patched()).toEqual([]);
  });

  it('with no state yet, a newest pair that fails still records its older tag, and the next run compares that pair', async () => {
    const gh = fakeGitHub({ tags: [tag(161), tag(160)], files: { [tag(160)]: BASE, [tag(161)]: 500 }, issues: [] });
    expect(await runWatch(gh.io)).toBe(1);
    expect(gh.posted()).toEqual([STATE_TITLE]);
    expect(gh.issues.find((i) => i.title === STATE_TITLE)?.body).toBe(tag(160));
    // A release lands before the next run: the pair that failed is compared, not skipped for the new newest pair.
    const next = fakeGitHub({
      tags: [tag(162), tag(161), tag(160)], files: { [tag(160)]: BASE, [tag(161)]: BASE, [tag(162)]: BASE }, issues: gh.issues,
    });
    expect(await runWatch(next.io)).toBe(0);
    expect(next.walkedPairs()).toEqual([`${tag(160)}..${tag(161)}`, `${tag(161)}..${tag(162)}`]);
  });

  it('a draft or a prerelease with a stable-shaped tag is never walked', async () => {
    const gh = fakeGitHub({
      tags: [{ tag: tag(163), draft: true }, { tag: tag(162), prerelease: true }, tag(161), tag(160)],
      files: { [tag(160)]: BASE, [tag(161)]: BASE, [tag(162)]: 500, [tag(163)]: 500 },
      issues: [{ number: 7, title: STATE_TITLE, body: tag(160), user: bot }],
    });
    expect(await runWatch(gh.io)).toBe(0);
    expect(gh.walkedPairs()).toEqual([`${tag(160)}..${tag(161)}`]);
    expect(gh.patched()).toEqual([`7=${tag(161)}`]);
    expect(gh.read(tag(162)) || gh.read(tag(163))).toBe(false);
  });

  it('a state on the second page of releases walks every stable tag on both pages', async () => {
    const alphas = (minor: number, n: number): Release[] =>
      Array.from({ length: n }, (_, k) => ({ tag: `rust-v0.${minor}.0-alpha.${n - k}`, prerelease: true }));
    // 201 releases: page 2 is full, so only the stop predicate ends the paging there, before page 3.
    const tags: Release[] = [tag(163), ...alphas(163, 130), tag(162), tag(161), tag(160), ...alphas(160, 67)];
    expect(tags).toHaveLength(201);
    const gh = fakeGitHub({
      tags, files: { [tag(160)]: BASE, [tag(161)]: BASE, [tag(162)]: BASE, [tag(163)]: BASE },
      issues: [{ number: 7, title: STATE_TITLE, body: tag(161), user: bot }],
    });
    expect(await runWatch(gh.io)).toBe(0);
    expect(gh.walkedPairs()).toEqual([`${tag(161)}..${tag(162)}`, `${tag(162)}..${tag(163)}`]);
    expect(gh.patched()).toEqual([`7=${tag(163)}`]);
    expect(gh.calls.filter((c) => c.url.includes('/releases?')).length).toBe(2);
  });

  it('with no state yet, a first page holding one stable tag pages on to the second for the newest pair', async () => {
    const alphas = (minor: number, n: number): Release[] =>
      Array.from({ length: n }, (_, k) => ({ tag: `rust-v0.${minor}.0-alpha.${n - k}`, prerelease: true }));
    // 201 releases: page 2 is full, so only the stop predicate ends the paging there, before page 3.
    const tags: Release[] = [tag(163), ...alphas(163, 130), tag(162), tag(161), tag(160), ...alphas(160, 67)];
    expect(tags).toHaveLength(201);
    const gh = fakeGitHub({ tags, files: { [tag(162)]: BASE, [tag(163)]: BASE }, issues: [] });
    expect(await runWatch(gh.io)).toBe(0);
    expect(gh.walkedPairs()).toEqual([`${tag(162)}..${tag(163)}`]);
    expect(gh.posted()).toEqual([STATE_TITLE]);
    expect(gh.issues.find((i) => i.title === STATE_TITLE)?.body).toBe(tag(163));
    expect(gh.calls.filter((c) => c.url.includes('/releases?')).length).toBe(2);
  });

  it('a pair whose issue already exists is walked and not opened twice', async () => {
    const gh = fakeGitHub({
      tags: [tag(161), tag(160)], files: { [tag(160)]: BASE, [tag(161)]: overlay('instructions-moved') },
      issues: [
        { number: 7, title: STATE_TITLE, body: tag(160), user: bot },
        { number: 8, title: pairTitle(tag(160), tag(161)), body: 'opened earlier', user: bot },
      ],
    });
    expect(await runWatch(gh.io)).toBe(0);
    expect(gh.posted()).toEqual([]);
    expect(gh.patched()).toEqual([`7=${tag(161)}`]);
  });

  it('an issue opened by anyone but the workflow is neither the state nor a finding issue', async () => {
    const human = { login: 'someone', type: 'User' };
    const gh = fakeGitHub({
      tags: [tag(162), tag(161), tag(160)],
      files: { [tag(160)]: BASE, [tag(161)]: overlay('instructions-moved'), [tag(162)]: overlay('instructions-moved') },
      issues: [
        { number: 3, title: STATE_TITLE, body: tag(162), user: human },
        { number: 4, title: pairTitle(tag(160), tag(161)), body: 'not the bot', user: human },
        { number: 5, title: STATE_TITLE, body: tag(160), user: { login: BOT_LOGIN, type: 'Bot' }, pull_request: {} },
        { number: 9, title: STATE_TITLE, body: tag(160), user: bot },
      ],
    });
    expect(await runWatch(gh.io)).toBe(0);
    expect(gh.posted()).toEqual([pairTitle(tag(160), tag(161))]);
    expect(gh.patched()).toEqual([`9=${tag(162)}`]);
  });

  it('every request goes to the API base, with the job\'s token', async () => {
    const gh = fakeGitHub({ tags: [tag(161), tag(160)], files: { [tag(160)]: BASE, [tag(161)]: BASE }, issues: [] });
    await runWatch(gh.io);
    expect(gh.calls.length).toBeGreaterThan(0);
    expect(gh.calls.every((c) => c.url.startsWith(`${API}/repos/`))).toBe(true);
    expect(gh.calls.every((c) => c.auth === 'Bearer synthetic-token')).toBe(true);
  });
});

/** Preloaded into the child: its global `fetch` refuses any URL off 127.0.0.1, so a regression in how the CLI picks
 *  its API base fails the case instead of sending the synthetic token to a live endpoint. The source is
 *  percent-encoded, so none of its characters (its `?` included) depends on how a loader parses a data: URL. */
const LOOPBACK_ONLY = 'data:text/javascript,' + encodeURIComponent('const f=globalThis.fetch;globalThis.fetch=(u,i)=>{'
  + 'const s=String(u instanceof Request?u.url:u);'
  + 'return new URL(s).hostname==="127.0.0.1"?f(u,i):Promise.reject(new Error("off loopback: "+s))};');

/** Serve one fake on loopback and run the CLI against it as a child process, with a synthetic token and no other
 *  environment than PATH: its exit status, and the fake, whose `calls` show the walk reached it. */
async function runCli(build: (api: string) => ReturnType<typeof fakeGitHub>, env: Record<string, string> = { GITHUB_TOKEN: 'synthetic-token' }): Promise<{ code: number | null, gh: ReturnType<typeof fakeGitHub> }> {
  let gh: ReturnType<typeof fakeGitHub> | undefined;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      void gh!.fetchImpl(`${api}${req.url ?? ''}`, {
        method: req.method ?? 'GET',
        headers: { authorization: String(req.headers.authorization ?? '') },
        ...(body ? { body } : {}),
      }).then(async (r) => {
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/plain' });
        res.end(Buffer.from(await r.arrayBuffer()));
      }, (e: unknown) => { res.writeHead(500); res.end(String(e)); });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  gh = build(api);
  try {
    const child = spawn(process.execPath, ['--import', LOOPBACK_ONLY, SCRIPT, '--repo', REPO], {
      env: { PATH: process.env.PATH ?? '', GITHUB_API_URL: api, ...env }, stdio: ['ignore', 'ignore', 'ignore'],
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      // A child that hangs is killed under the case's 30 s bound, so it never outlives its case (the live-tools runCli's rule).
      const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (c) => { clearTimeout(timer); resolve(c); });
    });
    return { code, gh };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const SCRIPT = path.join(HERE, '..', '..', '.github', 'ci', 'codex-wire-watch.mjs');

describe('the CLI', () => {
  it('exits 0 on a walk that compared every pair', async () => {
    const { code, gh } = await runCli((api) => fakeGitHub({ api, tags: [tag(161), tag(160)], files: { [tag(160)]: BASE, [tag(161)]: BASE }, issues: [] }));
    expect(code).toBe(0);
    expect(gh.calls.length).toBeGreaterThan(0);
  }, 30_000);

  it('exits non-zero on a pair that could not be compared', async () => {
    const { code, gh } = await runCli((api) => fakeGitHub({
      api, tags: [tag(162), tag(161), tag(160)],
      files: { [tag(160)]: BASE, [tag(161)]: BASE, [tag(162)]: 500 },
      issues: [{ number: 7, title: STATE_TITLE, body: tag(160), user: bot }],
    }));
    expect(code).toBe(1);
    expect(gh.calls.length).toBeGreaterThan(0);
  }, 30_000);

  it('exits 2 when it cannot start the walk', async () => {
    const { code } = await runCli((api) => fakeGitHub({ api, tags: [], files: {}, issues: [] }), {});
    expect(code).toBe(2);
  }, 30_000);
});

describe('the workflow', () => {
  const src = readFileSync(path.join(HERE, '..', '..', '.github', 'workflows', 'codex-wire-watch.yml'), 'utf8');
  const wf = parseYaml(src) as {
    on: { schedule?: Array<{ cron: string }>, workflow_dispatch?: unknown },
    permissions: Record<string, string>,
    jobs: Record<string, { permissions: Record<string, string>, steps: Array<{ name?: string, uses?: string, with?: Record<string, unknown>, run?: string, env?: Record<string, string> }> }>,
  };

  it('runs daily and by hand, with the job\'s token only: contents read, issues write, no secrets', () => {
    expect(wf.on.schedule).toHaveLength(1);
    expect(wf.on.schedule![0]!.cron).toMatch(/^\d+ \d+ \* \* \*$/);
    expect('workflow_dispatch' in wf.on).toBe(true);
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(wf.jobs)).toEqual(['watch']);
    expect(wf.jobs.watch!.permissions).toEqual({ contents: 'read', issues: 'write' });
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/\bsecrets\b/);
    const run = wf.jobs.watch!.steps.find((s) => s.run !== undefined)!;
    expect(run.run).toBe('node .github/ci/codex-wire-watch.mjs --repo "$REPO"');
    expect(run.env).toEqual({ GITHUB_TOKEN: '${{ github.token }}', REPO: '${{ github.repository }}' });
    // The whole-wave fix round, Z9: the job's steps exactly, so the checkout keeps no credential and no step or action
    // is added unseen.
    expect(wf.jobs.watch!.steps).toEqual([
      { uses: 'actions/checkout@v7', with: { 'persist-credentials': false } },
      { name: 'Walk the stable Codex releases since the last walk', env: run.env, run: run.run },
    ]);
  });
});
