import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDialog, paneOptionRows, paneState } from '../src/pane/dialog.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { Tmux, type Runner } from '../src/exec.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import type { Dialog, FleetSession, SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const panesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
const fixture = (name: string) => readFileSync(path.join(panesDir, name), 'utf8');

describe('paneState', () => {
  it('classifies busy / menu / prompt / other', () => {
    expect(paneState(fixture('busy.txt'))).toBe('busy');
    expect(paneState(fixture('ask-user-question.txt'))).toBe('menu');
    expect(paneState(fixture('multiselect.txt'))).toBe('menu');
    expect(paneState('some output\n❯ \n')).toBe('prompt');
    expect(paneState('plain scrollback\n')).toBe('other');
  });

  it('treats a footer-less confirm (❯ on a numbered option, no "Enter to select") as a menu', () => {
    const pane = 'Switch model?\n\n❯ 1. Yes, switch to Fable 5\n  2. No, go back\n';
    expect(paneState(pane)).toBe('menu');
    // A lone "❯ 1." the user typed at the prompt is NOT a menu (needs a 2nd option).
    expect(paneState('❯ 1. my note\n')).toBe('prompt');
  });
});

describe('parseDialog', () => {
  it('parses ask-user-question: 4 options, selectedIndex 1, title', () => {
    const d = parseDialog(fixture('ask-user-question.txt'))!;
    expect(d).not.toBeNull();
    expect(d.parsed).toBe(true);
    expect(d.options).toHaveLength(4);
    expect(d.options.map((o) => o.index)).toEqual([1, 2, 3, 4]);
    expect(d.options[0]!.label).toBe('A + B drawer (Recommended)');
    expect(d.selectedIndex).toBe(1);
    expect(d.title).toBe('Which architecture should we go with?');
  });

  it('parses the REAL AskUserQuestion format: options carry description lines and split across a rule', () => {
    // Live capture: each numbered option is followed by a description line, and
    // the option list is split by a horizontal rule (options 1-4 above, 5 below),
    // all sitting below conversation-history `❯` turns. The parser must collect
    // the numbered options (1..5) despite the non-adjacent layout.
    const d = parseDialog(fixture('ask-user-question-real.txt'))!;
    expect(d).not.toBeNull();
    expect(d.parsed).toBe(true);
    expect(d.options.map((o) => o.index)).toEqual([1, 2, 3, 4, 5]);
    expect(d.options.map((o) => o.label)).toEqual(['Red', 'Green', 'Blue', 'Type something.', 'Chat about this']);
    expect(d.selectedIndex).toBe(1);
    expect(d.title).toBe('Which colour do you prefer?');
    // The full question preamble (header + question), not just the last line.
    expect(d.body).toBe('Colour\n\nWhich colour do you prefer?');
    // Each option carries its description paragraph (the fix for choosing blind).
    expect(d.options[0]!.description).toBe('Warm, high-energy, attention-grabbing.');
    expect(d.options[1]!.description).toBe('Natural, calm, balanced.');
    expect(d.options[2]!.description).toBe('Cool, calm, trustworthy.');
    expect(d.options[3]!.description).toBeUndefined(); // "Type something." has none
  });

  it('parses trust-folder: 2 options', () => {
    const d = parseDialog(fixture('trust-folder.txt'))!;
    expect(d.parsed).toBe(true);
    expect(d.options).toHaveLength(2);
    expect(d.title).toBe('Do you trust the files in this folder?');
  });

  it('parses resume-full: 3 options', () => {
    const d = parseDialog(fixture('resume-full.txt'))!;
    expect(d.parsed).toBe(true);
    expect(d.options).toHaveLength(3);
    expect(d.options[1]!.label).toBe('Resume full session as-is');
    expect(d.selectedIndex).toBe(1);
  });

  it('parses a footer-less /model confirm: title from the header, 2 options', () => {
    const pane = [
      '──────────────────────────────────────────────',
      '  Switch model?',
      '  Your next response will be slower and use more tokens',
      '',
      '  This conversation is cached for the current model.',
      '',
      '❯ 1. Yes, switch to Fable 5',
      '  2. No, go back',
      '──────────────────────────────────────────────',
    ].join('\n');
    const d = parseDialog(pane)!;
    expect(d.parsed).toBe(true);
    expect(d.title).toBe('Switch model?');
    expect(d.options.map((o) => o.label)).toEqual(['Yes, switch to Fable 5', 'No, go back']);
    expect(d.selectedIndex).toBe(1);
  });

  it('parses a 2-column menu: clean labels (wrapped joined), no garbled box detail', () => {
    const pane = [
      '─────────────────────────────────────────────────────────',
      '  Rates source',
      '',
      '  Where should the rate numbers live?',
      '',
      '❯ 1. Checked-in file + CI          ┌─ model_rates.yaml (source of truth)',
      '     drift-check (Recommended)     │     claude-opus-4-8: {input: 15}',
      '  2. Auto-sync Lambda from         │     cache_write_5m: 18.75',
      '     LiteLLM                       │',
      '  3. Hybrid                        └─ CI weekly: diff vs LiteLLM',
      '  Enter to select',
    ].join('\n');
    const d = parseDialog(pane)!;
    expect(d.parsed).toBe(true);
    expect(d.title).toBe('Where should the rate numbers live?');
    expect(d.options.map((o) => o.label)).toEqual([
      'Checked-in file + CI drift-check (Recommended)',
      'Auto-sync Lambda from LiteLLM',
      'Hybrid',
    ]);
    // The box detail is NOT smeared into per-option descriptions (raw carries it).
    expect(d.options.every((o) => o.description === undefined)).toBe(true);
    expect(d.raw).toContain('model_rates.yaml');
  });

  it('parses a LIVE 2-column pane: clean labels, no trailing chrome, "Chat about this" offered', () => {
    // Captured from cc-claude-corp-data-internal while it was actually asking.
    // Two failures this pane caused: the last option's label ran on into the
    // right-hand box's chrome ("Ship as-is, alert + runbook Notes: press n to
    // add notes Chat about this"), and the unnumbered "Chat about this" row
    // below the rule was invisible to the sheet, so answering in your own words
    // had no route that didn't go through the terminal.
    const d = parseDialog(fixture('ask-2col-chat-about.txt'))!;
    expect(d.parsed).toBe(true);
    expect(d.options.map((o) => o.label)).toEqual([
      'Forward-fill per class (Recommended)',
      'Require completeness, Anthropic only',
      'Ship as-is, alert + runbook',
      'Chat about this',
    ]);
    expect(d.selectedIndex).toBe(1);
    expect(d.title).toContain('how should the partial-capture hazard be handled?');
    // The box detail rides raw, never per-option prose.
    expect(d.options.every((o) => o.description === undefined)).toBe(true);
    expect(d.raw).toContain('No model loses pricing it has today.');
  });

  it('tracks the cursor onto an unnumbered extra row so the walk can verify it landed', () => {
    const pane = fixture('ask-2col-chat-about.txt').replace('  Chat about this', '❯ Chat about this');
    const d = parseDialog(pane)!;
    expect(d.selectedIndex).toBe(4);
    expect(d.options[3]!.label).toBe('Chat about this');
  });

  it('multiselect yields parsed:false with raw pane', () => {
    const d = parseDialog(fixture('multiselect.txt'))!;
    expect(d).not.toBeNull();
    expect(d.parsed).toBe(false);
    expect(d.raw).toContain('Space to select');
  });

  // — whole-branch review, IMPORTANT 2 — the row reader the keystroke gate uses —
  //
  // `answerAsk` must verify the pane IS the question it is about to answer,
  // and multi-select is the shape that most needs it (a digit there only
  // toggles). `parseDialog` cannot serve that: it discards options entirely
  // for a multi-select pane, which is right for RENDERING and useless for a
  // gate. `paneOptionRows` is the shared row reader underneath both.
  describe('paneOptionRows', () => {
    it('reads the numbered rows of a MULTI-SELECT menu parseDialog throws away', () => {
      const rows = paneOptionRows(fixture('multiselect.txt'));
      // The `[ ]` is the row's STATE, never part of its label — leaving it on
      // would make every scraped label disagree with the hook's verbatim copy
      // and refuse every multi-select answer.
      expect(rows.map((r) => r.label)).toEqual(['Bash', 'Edit', 'WebFetch']);
      expect(rows.map((r) => r.index)).toEqual([1, 2, 3]);
      expect(rows[0]!.selected).toBe(true);
      expect(parseDialog(fixture('multiselect.txt'))!.options).toEqual([]);
    });

    it('agrees with parseDialog on a single-select menu, and says nothing about a plain pane', () => {
      const rows = paneOptionRows(fixture('ask-user-question.txt'));
      const d = parseDialog(fixture('ask-user-question.txt'))!;
      expect(rows.map((r) => r.index)).toEqual(d.options.slice(0, rows.length).map((o) => o.index));
      // Presence is `hasMenu`'s job, not this one's: a pane with no menu simply
      // has no rows to report.
      expect(paneOptionRows('some output\n❯ \n')).toEqual([]);
    });
  });

  it('busy pane yields state busy and null dialog', () => {
    expect(paneState(fixture('busy.txt'))).toBe('busy');
    expect(parseDialog(fixture('busy.txt'))).toBeNull();
  });

  it('id is stable across identical panes, different across fixtures', () => {
    const a1 = parseDialog(fixture('ask-user-question.txt'))!;
    const a2 = parseDialog(fixture('ask-user-question.txt'))!;
    expect(a1.id).toBe(a2.id);
    const others = ['trust-folder.txt', 'resume-full.txt', 'multiselect.txt'].map(
      (f) => parseDialog(fixture(f))!.id,
    );
    for (const id of others) expect(id).not.toBe(a1.id);
    expect(new Set(others).size).toBe(others.length);
  });
});

const seedSession = (home: string, id: string, wrapper: string) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

describe('FleetWatcher dialog detection', () => {
  it('emits dialog once, marks dialogPending, then clears', async () => {
    const home = mkTmp('ccrc-');
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    let pane = fixture('ask-user-question.txt');
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: pane, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO };
    const bus = new Bus();
    const msgs: SessionStreamMsg[] = [];
    const fleets: FleetSession[][] = [];
    bus.on('session:claude2-MekWarLive', (m) => msgs.push(m));
    bus.on('fleet', (s) => fleets.push(s));
    const watcher = new FleetWatcher(deps, bus);

    await watcher.tick();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.type).toBe('dialog');
    const dialog = (msgs[0] as { type: 'dialog'; dialog: Dialog }).dialog;
    expect(dialog.parsed).toBe(true);
    expect(dialog.options).toHaveLength(4);
    expect(fleets.at(-1)![0]!.dialogPending).toBe(true);

    await watcher.tick(); // same dialog still up -> not re-emitted
    expect(msgs).toHaveLength(1);

    pane = 'done\n❯ \n'; // dialog gone -> cleared + dialogPending false
    await watcher.tick();
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ type: 'dialog_cleared' });
    expect(fleets.at(-1)![0]!.dialogPending).toBe(false);
  });
});

describe('FleetWatcher hookstate wiring', () => {
  // The only test that exercises tick()'s production plumbing end to end:
  // registry -> sweepHookStates() -> readHookState(..., r.uuid, ...) ->
  // assembleFleet's hookStates map -> the emitted 'fleet' frame. Every other
  // hookstate test either calls assembleFleet directly (fleet.test.ts) or
  // readHookState directly (hookstate.test.ts) — neither one proves the
  // watcher actually wires the uuid argument or reads registryDir/the id it
  // holds correctly, which is exactly the kind of wiring bug unit tests on
  // either side, alone, cannot see.
  it('a tick reads a fresh hookstate.json and the emitted fleet frame carries hookState/askSummary/dialogPending', async () => {
    const home = mkTmp('ccrc-');
    const uuid = '1'.repeat(36);
    seedSession(home, 'claude2-MekWarLive', 'claude2'); // writes this same uuid
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      // A plain prompt, never a menu — dialogPending below is earned SOLELY
      // by the hookstate file, not by the pane detector.
      if (args[0] === 'capture-pane') return { code: 0, stdout: 'done\n❯ \n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    writeFileSync(path.join(cfg.registryDir, 'claude2-MekWarLive.hookstate.json'), JSON.stringify({
      v: 1, state: 'waiting', event: 'Notification', sessionId: uuid, pid: 40613,
      updatedAt: Date.now(), // fresh relative to sweepHookStates' own Date.now()
      ask: { questions: [{ question: 'Full text nobody should see on a card', header: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }] },
      subagents: [{ name: 'reviewer', startedAt: Date.now() - 5000 }],
    }));
    const deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO };
    const bus = new Bus();
    const fleets: FleetSession[][] = [];
    bus.on('fleet', (s) => fleets.push(s));
    const watcher = new FleetWatcher(deps, bus);

    await watcher.tick();

    const s = fleets.at(-1)!.find((x) => x.id === 'claude2-MekWarLive')!;
    expect(s.hookState).toBe('waiting');
    expect(s.askSummary).toBe('Pick one');
    expect(s.subagents).toEqual([{ name: 'reviewer', startedAt: expect.any(Number) }]);
    // Earned purely by the hook — the pane above never painted a menu.
    expect(s.dialogPending).toBe(true);
  }, 30000);
});
