// The Claude Code version lexicon (D-5695): the bare `x.y.z` grammar, its
// numeric comparator, the channel / mode / lane-kind vocabularies, the closed
// `why` enum, the numbers of spec §12 and the one parser of the tenth node
// file (spec §6.2). Pure functions; no fixture HOME, no process, no network.
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CHANNEL_DEFAULT,
  CLAUDE_CHANNELS,
  CLAUDE_HEADROOM_GATE_BYTES,
  CLAUDE_INSTALL_WHY,
  CLAUDE_LANE_KINDS,
  CLAUDE_MIN_BUILD,
  CLAUDE_ROLL_AFTER_MINUTES,
  CLAUDE_ROLL_MODES,
  CLAUDE_ROLL_MODE_DEFAULT,
  CLAUDE_VERSION,
  compareClaudeVersions,
  isClaudeVersion,
  parseClaudeNodeFile,
} from '../../shared/claudeVersion.js';

/** Spec §6.2's document, every field filled with a neutral value. */
function sample(): Record<string, unknown> {
  return {
    v: 1,
    at: 1_760_000_000,
    mode: 'measure',
    channel: 'latest',
    pin: null,
    pointer: { latest: '2.1.302', stable: '2.1.296', at: 1_760_000_000 },
    candidate: '2.1.302',
    target: { anthropic: null, codex: null },
    prevTarget: { anthropic: null, codex: null },
    builds: [
      { v: '2.1.302', bytes: 285_793_528, sha256ok: true, sigok: true, smoke: 'ok', running: 0, halted: false },
      { v: '2.1.296', bytes: 285_000_000, sha256ok: null, sigok: null, smoke: null, running: 2, halted: false },
    ],
    running: [
      { pid: 4242, build: '2.1.296' },
      { pid: 4343, build: '2.1.296' },
    ],
    placeholders: 1,
    staging: 0,
    selfUpdateOff: false,
    intentAt: null,
    localHalts: [],
    last: { at: 1_760_000_000, result: 'no-op', why: 'measure-only', failures: 0 },
    switches: {
      installDisabled: false,
      rollDisabled: false,
      rollLive: false,
      selfUpdateKept: false,
      adopted: false,
      hibernateShadowAt: null,
      hibernateLiveAt: 1_759_000_000,
    },
    rollAfterMinutes: 90,
    memory: {
      anonBytes: 27_166_000_000,
      ceilingBytes: 27_917_287_424,
      ceiling: 'user',
      swapUsedBytes: 1_000_000,
      swapTotalBytes: null,
    },
  };
}

const parse = (doc: unknown): ReturnType<typeof parseClaudeNodeFile> =>
  parseClaudeNodeFile(JSON.stringify(doc));

describe('the Claude Code version grammar and comparator (D-5695)', () => {
  it('2.1.302 > 2.1.99 (the lexical trap of spec §2.5)', () => {
    expect(compareClaudeVersions('2.1.302', '2.1.99')).toBe(1);
    expect(compareClaudeVersions('2.1.99', '2.1.302')).toBe(-1);
  });

  it('2.1.9 < 2.1.10, and each part is compared numerically', () => {
    expect(compareClaudeVersions('2.1.9', '2.1.10')).toBe(-1);
    expect(compareClaudeVersions('10.0.0', '9.99.99')).toBe(1);
    expect(compareClaudeVersions('2.10.0', '2.9.400')).toBe(1);
    expect(compareClaudeVersions('2.1.302', '2.1.302')).toBe(0);
    expect(compareClaudeVersions('0.0.0', '0.0.1')).toBe(-1);
  });

  it('a component past 2^53 still compares exactly', () => {
    expect(compareClaudeVersions('2.1.9007199254740993', '2.1.9007199254740992')).toBe(1);
  });

  it.each([
    ['`02.1.3` refused', '02.1.3'],
    ['`2.01.3` refused', '2.01.3'],
    ['`2.1.03` refused', '2.1.03'],
    ['`2.1` refused', '2.1'],
    ['`2.1.3.x` refused', '2.1.3.x'],
    ['`2.1.3.` refused', '2.1.3.'],
    ['`2.1.3-beta` refused', '2.1.3-beta'],
    ['`v2.1.3` refused', 'v2.1.3'],
    ['`2.1.3\\n` refused', '2.1.3\n'],
    ['` 2.1.3` refused', ' 2.1.3'],
    ['`` refused', ''],
  ])('%s', (_name, s) => {
    expect(isClaudeVersion(s)).toBe(false);
    expect(CLAUDE_VERSION.test(s)).toBe(false);
  });

  it.each(['0.0.0', '2.1.3', '2.1.302', '10.20.30'])('`%s` accepted', (s) => {
    expect(isClaudeVersion(s)).toBe(true);
  });

  it('isClaudeVersion refuses a non-string', () => {
    expect(isClaudeVersion(2.1)).toBe(false);
    expect(isClaudeVersion(null)).toBe(false);
    expect(isClaudeVersion(undefined)).toBe(false);
  });

  it('compareClaudeVersions throws on a non-version, never orders it', () => {
    expect(() => compareClaudeVersions('v2.1.3', '2.1.3')).toThrow(RangeError);
    expect(() => compareClaudeVersions('2.1.3', '2.1.3\n')).toThrow(RangeError);
    expect(() => compareClaudeVersions('2.1', '2.1.3')).toThrow(RangeError);
    expect(() => compareClaudeVersions('02.1.3', '2.1.3')).toThrow(RangeError);
  });
});

describe('the vocabularies and the numbers (D-5695; decisions 1, 2, 3, 6)', () => {
  it('the why tuple has exactly the sixteen names in spec order', () => {
    expect([...CLAUDE_INSTALL_WHY]).toEqual([
      'ok',
      'no-op',
      'measure-only',
      'disabled',
      'intent-stale',
      'pointer-unreachable',
      'manifest-unreachable',
      'below-floor',
      'halted',
      'no-space',
      'install-failed',
      'checksum-mismatch',
      'signature-failed',
      'smoke-failed',
      'pin-unavailable',
      'upstream-retreat',
    ]);
  });

  it('the defaults: channel latest, mode manual, roll after 90 min, 3 GiB headroom', () => {
    expect(CLAUDE_CHANNEL_DEFAULT).toBe('latest');
    expect(CLAUDE_ROLL_MODE_DEFAULT).toBe('manual');
    expect(CLAUDE_ROLL_AFTER_MINUTES).toEqual({ default: 90, min: 15, max: 1440 });
    expect(CLAUDE_HEADROOM_GATE_BYTES).toBe(3 * 1024 * 1024 * 1024);
  });

  it('the closed vocabularies', () => {
    expect([...CLAUDE_CHANNELS]).toEqual(['latest', 'stable']);
    expect([...CLAUDE_ROLL_MODES]).toEqual(['off', 'manual', 'auto']);
    expect([...CLAUDE_LANE_KINDS]).toEqual(['anthropic', 'codex']);
    expect(CLAUDE_CHANNELS).toContain(CLAUDE_CHANNEL_DEFAULT);
    expect(CLAUDE_ROLL_MODES).toContain(CLAUDE_ROLL_MODE_DEFAULT);
  });

  it('the floor is 2.1.277, a version of the grammar', () => {
    expect(CLAUDE_MIN_BUILD).toBe('2.1.277');
    expect(isClaudeVersion(CLAUDE_MIN_BUILD)).toBe(true);
  });
});

describe('parseClaudeNodeFile: the version-1 node file (spec §6.2)', () => {
  it("accepts the spec's sample", () => {
    const doc = sample();
    expect(parse(doc)).toEqual(doc);
  });

  it('accepts the install-mode shape with targets, a pin and no memory figures', () => {
    const doc = {
      ...sample(),
      mode: 'install',
      channel: 'stable',
      pin: '2.1.296',
      pointer: null,
      candidate: null,
      target: { anthropic: '2.1.302', codex: '2.1.296' },
      prevTarget: { anthropic: '2.1.296', codex: null },
      intentAt: 1_760_000_100,
      localHalts: ['2.1.300'],
      last: { at: 1_760_000_100, result: 'failed', why: 'smoke-failed', failures: 2 },
      rollAfterMinutes: 15,
      memory: null,
    };
    expect(parse(doc)).toEqual(doc);
  });

  it('refuses text that is not JSON, or JSON that is not an object', () => {
    expect(parseClaudeNodeFile('')).toBeNull();
    expect(parseClaudeNodeFile('{')).toBeNull();
    expect(parseClaudeNodeFile('null')).toBeNull();
    expect(parseClaudeNodeFile('[1]')).toBeNull();
    expect(parseClaudeNodeFile('"x"')).toBeNull();
  });

  it('refuses v: 2 (and a missing v)', () => {
    expect(parse({ ...sample(), v: 2 })).toBeNull();
    const { v: _v, ...rest } = sample();
    expect(parse(rest)).toBeNull();
  });

  it('refuses a running entry with a non-integer pid', () => {
    expect(parse({ ...sample(), running: [{ pid: 42.5, build: '2.1.296' }] })).toBeNull();
    expect(parse({ ...sample(), running: [{ pid: '42', build: '2.1.296' }] })).toBeNull();
    expect(parse({ ...sample(), running: [{ pid: 0, build: '2.1.296' }] })).toBeNull();
  });

  it('refuses a builds[].v that is not a version', () => {
    const builds = [{ ...(sample().builds as Record<string, unknown>[])[0], v: '2.1.302-rc' }];
    expect(parse({ ...sample(), builds })).toBeNull();
  });

  it('refuses a why outside the enum', () => {
    expect(
      parse({ ...sample(), last: { at: 1, result: 'failed', why: 'something-else', failures: 1 } }),
    ).toBeNull();
  });

  it('refuses a rollAfterMinutes outside 15 to 1440', () => {
    expect(parse({ ...sample(), rollAfterMinutes: 14 })).toBeNull();
    expect(parse({ ...sample(), rollAfterMinutes: 1441 })).toBeNull();
    expect(parse({ ...sample(), rollAfterMinutes: 90.5 })).toBeNull();
    expect(parse({ ...sample(), rollAfterMinutes: 15 })).not.toBeNull();
    expect(parse({ ...sample(), rollAfterMinutes: 1440 })).not.toBeNull();
  });

  it('refuses a mode, channel or lane-kind key outside its vocabulary', () => {
    expect(parse({ ...sample(), mode: 'auto' })).toBeNull();
    expect(parse({ ...sample(), channel: 'dev' })).toBeNull();
    expect(parse({ ...sample(), target: { anthropic: null } })).toBeNull();
    expect(parse({ ...sample(), pin: 'latest' })).toBeNull();
  });

  it('refuses a memory ceiling name outside the safe alphabet', () => {
    const memory = { ...(sample().memory as Record<string, unknown>), ceiling: '../x y' };
    expect(parse({ ...sample(), memory })).toBeNull();
  });

  it('drops an unknown key, at the top and inside every nested object', () => {
    const doc = sample();
    const noisy = {
      ...doc,
      extra: 'x',
      pointer: { ...(doc.pointer as object), url: 'https://example.invalid/?q=1' },
      builds: (doc.builds as object[]).map((b) => ({ ...b, path: '~/.local/share/claude/versions/x' })),
      running: (doc.running as object[]).map((r) => ({ ...r, cmdline: 'claude --x' })),
      last: { ...(doc.last as object), detail: 'x' },
      switches: { ...(doc.switches as object), other: true },
      memory: { ...(doc.memory as object), current: 1 },
      target: { ...(doc.target as object), other: '2.1.1' },
    };
    const out = parse(noisy);
    expect(out).toEqual(doc);
    expect(JSON.stringify(out)).not.toMatch(/extra|example\.invalid|versions\/x|cmdline|detail|other|current/);
  });

  it('never returns installer stderr (a stderr key is dropped)', () => {
    const doc = sample();
    const secret = 'curl: (22) The requested URL returned error: 404 TOKEN-LIKE-abc123';
    const out = parse({
      ...doc,
      stderr: secret,
      last: { ...(doc.last as object), stderr: secret },
    });
    expect(out).toEqual(doc);
    expect(JSON.stringify(out)).not.toContain('TOKEN-LIKE');
  });
});
