// The AGENT's exec of `ccd` crosses the installed direct entry (reclaim-entry-
// safety, D-3696; Task 5): the agent resolves `ccd` to `~/.local/bin/ccd` and
// execFile's it, so on a box that path is the rendered Python launcher, and a
// direct `ws-reclaim` or `ws-audit --session <id> --reclaim` it forwards must
// reach the Bash body under privileged mode — an ordinary verb must not.
//
// The pair here is published by the SHIPPED publisher (`ccd/ccd-entry-install.py`)
// from a fixture tree whose `ccd/ccd` is a body that records how it was started
// to an absolute fixture path. Nothing here touches a real ccd or the real HOME.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

interface ExecRes { ok: boolean; code?: number; stdout?: string; stderr?: string; err?: string }

describe('the agent’s exec of ccd crosses the installed launcher', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      for (const d of [fixture.home, fixture.projectsRoot, fixture.outside]) rmSync(d, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  it('protected argv reaches the body privileged, an ordinary verb does not — through the real exec op', async () => {
    fixture = makeFixture();
    const out = path.join(fixture.home, 'started-as');
    const tree = path.join(fixture.home, 'fixture-tree');
    mkdirSync(path.join(tree, 'ccd'), { recursive: true });
    writeFileSync(path.join(tree, 'ccd', 'ccd'),
      `#!/usr/bin/env bash\n{ printf "%s\\0" "$-"; printf "%s\\0" "$@"; } > ${JSON.stringify(out)}\n`);
    copyFileSync(path.join(REPO, 'ccd', 'ccd-entry.py'), path.join(tree, 'ccd', 'ccd-entry.py'));
    copyFileSync(path.join(REPO, 'ccd', 'ccd-entry-install.py'), path.join(tree, 'ccd', 'ccd-entry-install.py'));
    const python = spawnSync('python3', ['-IS', '-c', 'import os,sys;sys.stdout.write(os.path.realpath(sys.executable))'],
      { encoding: 'utf8' }).stdout;
    const pub = spawnSync(python, ['-IS', path.join(tree, 'ccd', 'ccd-entry-install.py'), 'install', tree, fixture.home],
      { encoding: 'utf8' });
    expect(pub.status, pub.stderr).toBe(0);
    expect(readFileSync(path.join(fixture.home, '.local', 'bin', 'ccd'), 'utf8').split('\n')[0]).toBe(`#!${python} -IS`);

    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    const startedAs = (): { flags: string; argv: string[] } => {
      const parts = readFileSync(out, 'utf8').split('\0');
      parts.pop();
      return { flags: parts[0] ?? '', argv: parts.slice(1) };
    };
    const cases: Array<[string[], boolean]> = [
      [['ws-audit', '--session', 'demo-x', '--reclaim'], true],
      [['ws-audit', '--session', 'demo-x', '--reclaim', '--defer-expired'], true],
      [['ws-reclaim', '--expect', 'a'.repeat(64), '--child-of', '7', '--session', 'demo-x'], true],
      [['ensure', 'demo-x'], false],
    ];
    let id = 0;
    for (const [args, privileged] of cases) {
      rmSync(out, { force: true });
      const res = await client.req<ExecRes>(++id, { op: 'exec', cmd: 'ccd', args });
      expect(res, args.join(' ')).toMatchObject({ ok: true, code: 0 });
      expect(startedAs().argv, args.join(' ')).toEqual(args);
      expect(startedAs().flags.includes('p'), `${args.join(' ')}: flags ${startedAs().flags}`).toBe(privileged);
    }
  }, 60_000);
});
