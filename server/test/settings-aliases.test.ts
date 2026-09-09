// §6.1's rule, as a mechanism: a settings file may name ALIASES only
// (`haiku|sonnet|opus|fable|default`) in `model`, in
// `CLAUDE_CODE_SUBAGENT_MODEL` and in any `ANTHROPIC_*MODEL` key. Concrete ids
// live in the per-account registry file and reach a lane only through the env
// block the materialiser owns.
//
// THE CORPUS IS TRACKED FILES ONLY, and that is the whole distinction: the
// materialiser writes concrete ids into a LANE's `~/<configDirSuffix>/
// settings.json`, which is generated, per box, and never in git. What this
// scans is what ships — the settings a checkout carries and a fixture home is
// seeded from. A test that scanned generated homes would fail on the
// materialiser doing its job.
//
// The liveness row is not decoration: this corpus was EMPTY on the branch this
// task was written from (`git ls-files | grep settings.json` → nothing, measured
// 2026-09-08 on origin/main), and a scan over an empty list passes everything.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

const ALIASES: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable', 'default'];
const MODEL_KEY = /^ANTHROPIC_.*MODEL$/;

/** Every tracked path ending in `settings.json`. */
function corpus(): string[] {
  return execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter((p) => p.endsWith('settings.json'));
}

/** The offending `key: value` pairs in one parsed settings object, at the top
 *  level and inside `env`. An empty array is a clean file. */
export function aliasViolations(json: unknown): string[] {
  const out: string[] = [];
  const check = (where: string, obj: unknown): void => {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const governed = k === 'model' || k === 'CLAUDE_CODE_SUBAGENT_MODEL' || MODEL_KEY.test(k);
      if (!governed) continue;
      if (typeof v !== 'string' || !ALIASES.includes(v)) {
        out.push(`${where}${k} = ${JSON.stringify(v)}`);
      }
    }
  };
  check('', json);
  check('env.', (json as Record<string, unknown>)['env']);
  return out;
}

describe('§6.1 — settings files name aliases, never concrete model ids', () => {
  it('the corpus is real: the scan is looking at at least one tracked settings file', () => {
    expect(corpus()).toContain('server/test/fixtures/settings/project.settings.json');
  });

  it('every tracked settings file is alias-only', () => {
    for (const rel of corpus()) {
      const json = JSON.parse(readFileSync(path.join(REPO, rel), 'utf8')) as unknown;
      expect(aliasViolations(json), rel).toEqual([]);
    }
  });

  it('the predicate is not vacuous — a concrete id is caught, at both levels', () => {
    expect(aliasViolations({ model: 'claude-sonnet-5' })).toEqual(['model = "claude-sonnet-5"']);
    expect(aliasViolations({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol' } }))
      .toEqual(['env.ANTHROPIC_DEFAULT_OPUS_MODEL = "gpt-5.6-sol"']);
    expect(aliasViolations({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-5.6-terra' } }))
      .toEqual(['env.CLAUDE_CODE_SUBAGENT_MODEL = "gpt-5.6-terra"']);
    // …and `fable` is in the vocabulary, which is the alias this whole design
    // exists to make routable off an Anthropic lane.
    expect(aliasViolations({ model: 'fable' })).toEqual([]);
    // …and an unrelated key is not governed.
    expect(aliasViolations({ env: { DISABLE_TELEMETRY: '1' } })).toEqual([]);
  });
});
