// Model-class-advance R3b (plan 2026-10-15-model-class-auto-advance-codex-arm.md, "Re-plan of 2026-11-16"; D-8406,
// D-8688, D-8693): the lane-models file-read grant is retired. The server reads a lane's models through the fleet's
// `models` op alone, and the agent refuses every file under `~/.ccrc/models`. Each guard here reds the day the grant, or
// the server's files fallback, comes back. The two mixed pairs say what each update order shows while one box is on
// this build and the other is not. Fixture HOMEs and stub ops only: nothing reads or spawns under the real home.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FleetIO } from '../src/io.js';
import { createIo } from '../src/remote/io.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/errors.js';
import { readLaneModels } from '../src/laneModels.js';
import { MODELS_OP, type ModelsAsked } from '../../shared/agent-protocol.js';
import * as modelsKernel from '../../shared/models.mjs';
import {
  CLASSES, MODELS_DIR_NAME, catalogueFileName, laneClassModels, parseCatalogue, parseRegistry, registryFileName,
  type ModelClass,
} from '../../shared/models.js';
import { identifierReferences } from './scan/parse.js';
import { bootAgent, connectToAgent, makeFixture } from './remoteHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(here, '..', 'src');

const [C0, C1, C2, C3] = CLASSES;
const PIN = { [C0]: 'model-5.6-gamma', [C1]: 'model-6.1-gamma', [C2]: 'model-6.1-delta', [C3]: null } as Record<ModelClass, string | null>;
const REG = { probe: 'codex', subagent: C1, discovery: 'catalogue', classes: PIN };
const CAT = {
  probe: 'codex', fetchedAt: 1_700_000_000_000,
  models: [{ id: 'model-5.6-gamma', label: 'Model 5.6 Gamma' }, { id: 'model-6.1-gamma', label: 'Model 6.1 Gamma' }],
};
const CLASS_LABELS = laneClassModels(parseRegistry(REG), parseCatalogue(CAT));
const SHOW = `${JSON.stringify({ ok: true, op: 'show', id: 'lane-a', registry: REG, labels: CLASS_LABELS, advance: { state: 'absent' } })}\n`;

/** A lane's two model files in a fixture home, so a read that reached them would answer. */
function seedLane(home: string, lane: string): string {
  const dir = path.join(home, '.ccrc', MODELS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, registryFileName(lane)), JSON.stringify(REG));
  writeFileSync(path.join(dir, catalogueFileName(lane)), JSON.stringify(CAT));
  return dir;
}

/** Every `.ts` file under `dir`, recursively. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return name.endsWith('.ts') ? [p] : [];
  });
}

/** The names a model file's path is built from (`shared/models.mjs`), and the retired grant's shape. */
const MODEL_FILE_NAMES = new Set(['MODELS_DIR_NAME', 'registryFileName', 'catalogueFileName', 'isLaneModelsReadName']);

describe('the grant is gone (R3b)', () => {
  it('shared/models.mjs no longer exports the grant\'s shape', () => {
    expect(Object.keys(modelsKernel)).not.toContain('isLaneModelsReadName');
  });

  it('CONTROL: the scan below finds a model-file name where one is used', () => {
    const refs = identifierReferences(
      "import { registryFileName } from '../../shared/models.js';\nconst p = registryFileName('lane-a');\n", 'probe.ts', MODEL_FILE_NAMES);
    expect(refs.length).toBeGreaterThan(0);
  });

  it('no server source file builds a lane model file\'s path: nothing on the server reads model files', () => {
    const holders = tsFiles(SERVER_SRC)
      .filter((f) => identifierReferences(readFileSync(f, 'utf8'), f, MODEL_FILE_NAMES).length > 0)
      .map((f) => path.relative(SERVER_SRC, f));
    expect(holders).toEqual([]);
  });

  // The behaviour behind the scan: whatever `show` answers, `readLaneModels` asks the io for `models` and for nothing else.
  it.each([
    ['unsupported', { kind: 'unsupported' }], ['not-started', { kind: 'not-started' }], ['busy', { kind: 'busy' }],
    ['refused', { kind: 'refused', why: 'bad-lane' }], ['timeout', { kind: 'timeout' }], ['too-large', { kind: 'too-large' }],
    ['lost', { kind: 'lost' }], ['an answer', { kind: 'exited', code: 0, stdout: SHOW }],
    ['a carried refusal', { kind: 'exited', code: 1, stdout: `${JSON.stringify({ ok: false, error: 'catalogue-invalid' })}\n` }],
    ['an empty stdout at exit 1', { kind: 'exited', code: 1, stdout: '' }],
  ] as const)('%s: readLaneModels touches no io member but models', async (_n, answer) => {
    const touched: string[] = [];
    const io = new Proxy({} as FleetIO, {
      get(_t, key) {
        if (key === 'then') return undefined;
        if (key === 'models') return async (): Promise<ModelsAsked> => answer as ModelsAsked;
        return (...args: unknown[]) => { touched.push(String(key)); void args; throw new Error(`readLaneModels asked io.${String(key)}`); };
      },
    });
    await readLaneModels(io, 'lane-a');
    expect(touched).toEqual([]);
  });
});

describe('the mixed pairs (R3b), so the wave is safe in either update order', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => { while (closers.length) await closers.pop()!(); });

  // A new server with an agent that still holds the grant: an R3 or R4 agent, which lists the op AND would still answer
  // the file read. The op is used, and no read frame is ever sent, whatever the op answers.
  describe('new server, agent that still holds the grant', () => {
    const r3Agent = (onModels: () => Promise<unknown>) => {
      const home = mkTmp('ccrc-lanemodels-retired-r3-');
      seedLane(home, 'lane-a');
      const frames: string[] = [];
      const client = {
        state: { agentOps: ['update', 'token-sync', 'account', MODELS_OP] },
        request: async (f: Record<string, unknown>) => {
          frames.push(String(f.op));
          // the grant this agent still holds: it would answer the read
          if (f.op === 'read') return { t: 'res', id: 1, ok: true, data: readFileSync(f.path as string, 'utf8') };
          return onModels();
        },
      };
      return { io: createIo(client as never), frames };
    };

    it('an answer: the op is used, and the grant is never asked', async () => {
      const a = r3Agent(() => Promise.resolve({ kind: 'exited', code: 0, stdout: SHOW, fleetIdentity: null }));
      const got = await readLaneModels(a.io, 'lane-a');
      expect(got).toEqual({ kind: 'read', classes: CLASS_LABELS, advance: { state: 'absent', detail: null, pending: null, classes: null } });
      expect(a.frames).toEqual([MODELS_OP]);
    });

    it.each([
      ['busy', 'busy', () => Promise.resolve({ kind: 'busy', fleetIdentity: null })],
      ['a frame that never left', 'not-started', () => Promise.reject(new LinkNotSentError('disconnected'))],
      ['an agent bad-request', 'unsupported', () => Promise.reject(new AgentOpError('bad-request', null))],
      ['a carried refusal', 'unreadable', () => Promise.resolve({
        kind: 'exited', code: 1, stdout: `${JSON.stringify({ ok: false, error: 'roster-invalid' })}\n`, fleetIdentity: null,
      })],
    ] as const)('%s reads as %s, and the grant is never asked', async (_n, kind, onModels) => {
      const a = r3Agent(onModels);
      expect((await readLaneModels(a.io, 'lane-a')).kind).toBe(kind);
      expect(a.frames).toEqual([MODELS_OP]);
    });

    it('an agent from before the op (no models in its ops) is unsupported, with nothing sent at all', async () => {
      const frames: string[] = [];
      const client = {
        state: { agentOps: ['update', 'token-sync', 'account'] },
        request: async (f: Record<string, unknown>) => { frames.push(String(f.op)); throw new Error('never asked'); },
      };
      expect(await readLaneModels(createIo(client as never), 'lane-a')).toEqual({ kind: 'unsupported' });
      expect(frames).toEqual([]);
    });
  });

  // An old server (R3 or R4) with a new agent: the old server reads the op first and, where `show` did not answer, falls
  // back to the files under the grant. The new agent refuses that read, and the old server's mapping of a refused read
  // (`readFileMeasured`'s `unreadable`, never `absent`) makes the lane `unreadable`. So in that window an old server shows
  // the lane as it always did wherever `show` answers, and as unreadable wherever it would have fallen back.
  describe('old server, new agent', () => {
    /** The first two lines of R3's and R4's `readLaneModelFiles`, the files fallback this wave retires: what an old
     *  server makes of the two reads. */
    async function oldServerFilesFallback(io: FleetIO, ccrcDir: string, lane: string): Promise<{ kind: string }> {
      const dir = path.join(ccrcDir, MODELS_DIR_NAME);
      const [reg] = await Promise.all([
        io.readFileMeasured(path.join(dir, registryFileName(lane))),
        io.readFileMeasured(path.join(dir, catalogueFileName(lane))),
      ]);
      if (!reg.ok) return { kind: reg.reason === 'absent' ? 'absent' : 'unreadable' };
      return { kind: 'read' };
    }

    it('the new agent refuses the files fallback\'s reads, and the old server reads that as unreadable', async () => {
      const fixture = makeFixture();
      const dir = seedLane(fixture.home, 'lane-a');
      // CONTROL: a file under an admitted prefix answers over the same link, so the refusal below is the grant's absence
      writeFileSync(path.join(fixture.home, '.cc-sessions', 'probe'), 'x\n');
      const agent = await bootAgent(fixture);
      closers.push(() => agent.close());
      const fleet = connectToAgent(agent.port);
      closers.push(() => fleet.close());
      await expect.poll(() => fleet.client.state.agentOps ?? [], { timeout: 3000 }).toContain(MODELS_OP);
      expect(await fleet.io.readFileMeasured(path.join(fixture.home, '.cc-sessions', 'probe'))).toEqual({ ok: true, content: 'x\n' });
      for (const name of [registryFileName('lane-a'), catalogueFileName('lane-a')]) {
        expect(await fleet.io.readFileMeasured(path.join(dir, name)), name).toEqual({ ok: false, reason: 'unreadable' });
      }
      expect(await oldServerFilesFallback(fleet.io, path.join(fixture.home, '.ccrc'), 'lane-a')).toEqual({ kind: 'unreadable' });
    });
  });
});
