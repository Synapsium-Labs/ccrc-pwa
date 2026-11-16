/**
 * Overlord W1, the vocabulary piece, Task 1 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-vocabulary.md`).
 * A CHARACTERIZATION of every fixed string the server and ccd type into a session's pane, green on `main` before the
 * strings move into `shared/injected-prompts.mjs`. Every expected value is a literal measured once and pasted here,
 * never computed from the code under test, so the later commits (the list, its references) leave this file untouched.
 *
 * It imports only homes no later task moves: `coord/envelope.ts`, `inject/send.ts` and `shared/api.ts` (which keeps the
 * two prompt constants importable through a re-export).
 */
import { describe, expect, it } from 'vitest';
import { renderMailNudge } from '../src/coord/envelope.js';
import { clearSender } from '../src/inject/send.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Tmux, type Runner } from '../src/exec.js';
import { IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX } from '../../shared/api.js';
import { parsedFile } from './scan/symbols.js';
import { walkSrc } from './rings/walkSrc.js';
import { ccdSource } from './ccdWsHelpers.js';

const ID = 'lane-a-project-a';

describe('the server types these texts, byte for byte', () => {
  it('the mail nudge, whole', () => {
    expect(renderMailNudge(ID)).toBe(
      'ccrc-mail: you have new mail. Use the client, never curl or raw HTTP: ~/.local/bin/ccrc-api mail list --to '
      + 'lane-a-project-a ; then per row use its deliveryId, NOT id: ~/.local/bin/ccrc-api mail fetch <deliveryId> and '
      + '~/.local/bin/ccrc-api mail ack <deliveryId> --json - with body {"fromId":"lane-a-project-a","fromUuid":"<your '
      + 'uuid>"}. Invoke by that exact path — ~/.local/bin is not on this unit\'s PATH. The client resolves the server '
      + 'address and reads the box token itself, so you handle neither, and it works in a repo whose settings deny curl.');
  });

  it('the mail nudge\'s fixed head, and the id lands after the 24-character echo needle', () => {
    expect(renderMailNudge(ID).slice(0, 29)).toBe('ccrc-mail: you have new mail.');
    expect(renderMailNudge(ID).indexOf(ID)).toBeGreaterThanOrEqual(24);
    expect(renderMailNudge('x').slice(0, 24)).toBe(renderMailNudge(ID).slice(0, 24));
  });

  it('the idle-compaction nudge and the resume prefix', () => {
    expect(IDLE_COMPACT_NUDGE_PROMPT).toBe(
      "Continue with your open tasks. If you were waiting for the operator's answer, say so in one line and stop.");
    expect(RESUME_PROMPT_PREFIX).toBe('Continue from where you left off.');
  });

  it('clearSender types /clear, by value (the send-keys token after -l --)', async () => {
    const calls: string[][] = [];
    // Empty box, then the echo of `/clear`, then an empty box again (the send left): the shape of
    // dispatch-live-gate.test.ts's CLEAR_PANES.
    const panes = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];
    let cap = 0;
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: panes[Math.min(cap++, panes.length - 1)]!, stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    await clearSender({ tmux: new Tmux(run), queue: new KeyedQueue(), sleep: async () => {} })(ID);
    const typed = calls.filter((a) => a[0] === 'send-keys' && a.includes('-l'))
      .map((a) => { const i = a.indexOf('-l'); expect(a[i + 1]).toBe('--'); return a[i + 2]; });
    expect(typed).toEqual(['/clear']);
  });
});

/** Each call of `name` in server/src, as `<file>#<innermost enclosing symbol>`, sorted. */
const callersOf = (name: string): string[] => {
  const out: string[] = [];
  for (const f of walkSrc({ roots: ['server/src'], min: 300, match: /\.ts$/ })) {
    const p = parsedFile(f);
    for (const c of p.calls) {
      if (c.name !== name) continue;
      const enc = p.symbols.filter((s) => s.start <= c.start && c.end <= s.end)
        .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      out.push(`${f}#${enc?.name ?? '(top)'}`);
    }
  }
  return out.sort();
};

describe('the server\'s typers, by parsedFile', () => {
  it('sendPrompt has five callers (the renewal act added renewalActsOf, which types renewal-first-prompt)', () => {
    expect(callersOf('sendPrompt')).toEqual([
      'server/src/continuity/renewalWiring.ts#renewalActsOf',
      'server/src/inject/send.ts#clearSender',
      'server/src/server.ts#buildServer',
      'server/src/watch.ts#FleetWatcher.idleNudgeOne',
      'server/src/watch.ts#FleetWatcher.mailPass',
    ]);
  });

  it('sendLiteral has two callers, inside the two primitives', () => {
    expect(callersOf('sendLiteral')).toEqual([
      'server/src/inject/send.ts#answerDialogText',
      'server/src/inject/send.ts#sendPrompt.attempt',
    ]);
  });

  it('answerDialogText has one caller', () => {
    expect(callersOf('answerDialogText')).toEqual(['server/src/server.ts#buildServer']);
  });

  it('sendKey\'s literal keys, and its four computed-key sites', () => {
    const literal = new Set<string>();
    const computed: string[] = [];
    for (const f of walkSrc({ roots: ['server/src'], min: 300, match: /\.ts$/ })) {
      const p = parsedFile(f);
      for (const c of p.calls) {
        if (c.name !== 'sendKey' || c.args.length !== 2) continue;
        const key = c.args[1]!;
        if (key.kind === 'string') { literal.add(key.text); continue; }
        const enc = p.symbols.filter((s) => s.start <= c.start && c.end <= s.end)
          .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        computed.push(`${f}#${enc?.name ?? '(top)'}`);
      }
    }
    expect([...literal].sort()).toEqual(['C-s', 'C-u', 'Enter', 'Escape', 'M-Enter', 'Tab', 'Up']);
    expect(computed.sort()).toEqual([
      'server/src/inject/ask.ts#answerAsk',
      'server/src/inject/send.ts#answerDialogMulti',
      'server/src/inject/send.ts#moveDialogTab',
      'server/src/inject/send.ts#walkCursor',
    ]);
  });
});

/** The body of ccd's function `name`, from its `name() {` line to the next `}` at column 0. */
const ccdFunction = (src: string, name: string): string => {
  const m = new RegExp(`^${name}\\(\\) *\\{[^\\n]*\\n([\\s\\S]*?)^\\}`, 'm').exec(src);
  if (m === null) throw new Error(`no ccd function ${name}`);
  return m[1]!;
};

/** Every `send-keys` of a function body, in order, as what it types: `-l <arg as written>` or the key word. */
const ccdSends = (body: string): string[] => {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const re = /send-keys -t (?:"\$\([^)]*\)"|"\$\w+"|\S+) (-l ("\$\((?:[^()]|\([^()]*\))*\)"|"(?:[^"\\]|\\.)*")|\w+)/g;
    for (const m of line.matchAll(re)) out.push(m[2] !== undefined ? `-l ${m[2]}` : m[1]!);
  }
  return out;
};

describe('ccd types these texts', () => {
  const src = ccdSource();

  it('the five functions that type text, each send as written', () => {
    expect(ccdSends(ccdFunction(src, '_auto_compact_check'))).toEqual(['-l "/compact${ctext:+ $ctext}"', 'Enter']);
    expect(ccdSends(ccdFunction(src, '_route_type_effort'))).toEqual([
      '-l "/effort ultracode"', 'Enter', 'Enter', '-l "/effort"', 'Enter', 'Left', 'Right', '-l "s"', 'Enter',
    ]);
    expect(ccdSends(ccdFunction(src, '_route_type_model'))).toEqual(['-l "/model"', 'Enter', 'Down', 'Up', '-l "s"']);
    expect(ccdSends(ccdFunction(src, '_redrive_after_spawn'))).toEqual(['-l "$(_resume_prompt_for "$id")"', 'Enter']);
    expect(ccdSends(ccdFunction(src, 'cmd_clip'))).toEqual(['-l "$dest "']);
  });

  it('eight -l sends across them, five with no $ and three spliced', () => {
    const lit = ['_auto_compact_check', '_route_type_effort', '_route_type_model', '_redrive_after_spawn', 'cmd_clip']
      .flatMap((f) => ccdSends(ccdFunction(src, f))).filter((s) => s.startsWith('-l '));
    expect(lit).toHaveLength(8);
    expect(lit.filter((s) => !s.includes('$'))).toHaveLength(5);
    expect(lit.filter((s) => s.includes('$'))).toHaveLength(3);
  });

  it('RESUME_PROMPT begins with the resume prefix', () => {
    const m = /^RESUME_PROMPT="([^"]*)"/m.exec(src);
    expect(m?.[1]?.slice(0, 33)).toBe('Continue from where you left off.');
  });
});
