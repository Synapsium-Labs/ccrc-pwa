import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDialog, paneState } from '../src/pane/dialog.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { Tmux, type Runner } from '../src/exec.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import type { Dialog, FleetSession, SessionStreamMsg } from '../../shared/api.js';

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

  it('multiselect yields parsed:false with raw pane', () => {
    const d = parseDialog(fixture('multiselect.txt'))!;
    expect(d).not.toBeNull();
    expect(d.parsed).toBe(false);
    expect(d.raw).toContain('Space to select');
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
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    let pane = fixture('ask-user-question.txt');
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: pane, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps = { cfg: loadConfig({ CCRC_HOME: home }), run, tmux: new Tmux(run), io: localIO };
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
