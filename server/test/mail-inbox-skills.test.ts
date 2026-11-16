// D-6781 (mail inbox, plan MI-7; spec 2026-10-24 §3.7): the worker, coordinator and reviewer skills teach
// `ccrc-api mail inbox` first, run bare, and keep `mail list`, `fetch` and `ack` as the documented fallback. A clause
// is a mechanism here, so each rule below is read from the shipped text, never from a copy of it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

const SKILL_DIRS = ['ccd/worker-skill', 'ccd/coordinator-skill', 'ccd/reviewer-skill'] as const;
/** The worker and the reviewer read the envelope and the lifecycle's mail step from the coordinator's references,
 *  which install beside them (each SKILL.md names the paths). */
const SHARED = ['ccd/coordinator-skill/references/mail-envelope.md', 'ccd/coordinator-skill/references/wave-lifecycle-3-mail.md'];

const mdFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
};

/** A Markdown file split into its prose and its fenced code. A fence closes only on a run of the same character at
 *  least as long as the one that opened it, so the envelope's four-backtick example holds its three-backtick block. */
function split(md: string): { prose: string; code: string[] } {
  const prose: string[] = [];
  const code: string[] = [];
  let open: { ch: string; len: number } | null = null;
  let buf: string[] = [];
  for (const line of md.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      if (m && m[1]![0] === open.ch && m[1]!.length >= open.len && line.trim() === m[1]) {
        code.push(buf.join('\n')); buf = []; open = null;
      } else buf.push(line);
      continue;
    }
    if (m) { open = { ch: m[1]![0]!, len: m[1]!.length }; prose.push(''); continue; }
    prose.push(line);
  }
  return { prose: prose.join('\n'), code };
}

/** Prose paragraphs: blank-line separated, and each numbered or bulleted item its own paragraph. */
const paragraphs = (prose: string): string[] => prose
  .split(/\n\s*\n|\n(?=\s*(?:\d+\.|-) )/)
  .map((p) => p.replace(/\s+/g, ' ').trim())
  .filter((p) => p !== '');

const BARE = /\brun\b[^.;]*\bbare\b/i;
const BARE_WHY = /no pipe, no redirect, no `?head`? or `?tail`?/;
const FALLBACK = {
  list: /`mail list|GET \/api\/mail\?to=/,
  fetch: /`?mail fetch|GET \/api\/mail\/(?::id|<deliveryId>)/,
  ack: /`?mail ack|POST \/api\/mail\/(?::id|<deliveryId>)\/ack/,
};

/** The passages that teach how to read mail, each by its anchor. The anchor reds here when it moves. */
const PASSAGES: [string, string, RegExp][] = [
  ['the worker\'s reading paragraph', 'ccd/worker-skill/SKILL.md', /\*\*Reading mail is[\s\S]*?(?=\n\n)/],
  ['the coordinator\'s wake step', 'ccd/coordinator-skill/references/wave-steps.md', /3\. \*\*Wake on mail\.\*\*[\s\S]*?(?=\n4\. )/],
  ['the lifecycle\'s mail step', 'ccd/coordinator-skill/references/wave-lifecycle-3-mail.md', /## 3 — Read mail[\s\S]*?(?=\n0\. )/],
  ['the envelope\'s opening', 'ccd/coordinator-skill/references/mail-envelope.md', /^# The envelope[\s\S]*?(?=\n\n<!--)/],
];

describe('the skills teach `mail inbox` first (D-6781)', () => {
  it('every skill that reads mail names `mail inbox` in its own text', () => {
    for (const dir of SKILL_DIRS) {
      const text = mdFiles(dir).map((f) => split(read(f)).prose).join('\n');
      expect(text, `${dir} never names mail inbox`).toMatch(/`(?:~\/\.local\/bin\/ccrc-api )?mail inbox`/);
    }
  });

  it('every clause that names `mail inbox` says to run it bare: no pipe, no redirect, no head or tail', () => {
    let named = 0;
    for (const dir of SKILL_DIRS) {
      for (const f of mdFiles(dir)) {
        for (const p of paragraphs(split(read(f)).prose)) {
          if (!/mail inbox/.test(p)) continue;
          named++;
          expect(p, `${f}: a clause names mail inbox without saying to run it bare`).toMatch(BARE);
          expect(p, `${f}: a clause names mail inbox without the no-pipe rule`).toMatch(BARE_WHY);
        }
      }
    }
    expect(named, 'no clause names mail inbox at all').toBeGreaterThanOrEqual(5);
  });

  it('no skill shows `mail inbox` piped, redirected or captured in an example', () => {
    for (const dir of SKILL_DIRS) {
      for (const f of mdFiles(dir)) {
        const { prose, code } = split(read(f));
        const spans = [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
        for (const c of [...code, ...spans]) {
          expect(c, `${f}: mail inbox is piped or redirected`).not.toMatch(/mail inbox[^\n]*?(?:\||>)/);
          expect(c, `${f}: mail inbox is captured`).not.toMatch(/\$\([^)\n]*mail inbox/);
        }
      }
    }
  });

  it('no skill teaches the three calls as the first way: each reading passage names the inbox before list, fetch or ack', () => {
    for (const [name, file, re] of PASSAGES) {
      const m = re.exec(read(file));
      expect(m, `${name}: its anchor is gone from ${file}`).not.toBeNull();
      const text = m![0];
      const inbox = text.indexOf('mail inbox');
      expect(inbox, `${name} does not name mail inbox`).toBeGreaterThan(-1);
      const firstOld = Math.min(...Object.values(FALLBACK).map((r) => { const i = text.search(r); return i < 0 ? Infinity : i; }));
      expect(inbox, `${name} teaches list, fetch or ack before the inbox`).toBeLessThan(firstOld);
    }
    for (const dir of SKILL_DIRS) {
      for (const f of mdFiles(dir)) expect(read(f), f).not.toMatch(/three calls, not one/);
    }
  });

  it('every skill that reads mail still names `mail list`, `fetch` and `ack` as the fallback', () => {
    for (const dir of SKILL_DIRS) {
      const files = [...new Set([...mdFiles(dir), ...SHARED])];
      const text = files.map((f) => split(read(f)).prose).join('\n');
      for (const [verb, re] of Object.entries(FALLBACK)) expect(text, `${dir} no longer names ${verb}`).toMatch(re);
    }
    for (const [name, file, re] of PASSAGES.slice(0, 3)) {
      const text = re.exec(read(file))![0];
      for (const [verb, r] of Object.entries(FALLBACK)) expect(text, `${name} drops the ${verb} fallback`).toMatch(r);
    }
  });

  it('the README lists the verb, and says its stdout is plain text and it is run bare', () => {
    const readme = read('README.md');
    expect(readme).toContain('`mail list|send|fetch|ack|inbox`');
    const para = paragraphs(readme).find((p) => p.startsWith('**`ccrc-api mail inbox`'));
    expect(para, 'the README has no mail inbox paragraph').toBeDefined();
    expect(para).toMatch(BARE);
    expect(para).toMatch(BARE_WHY);
    expect(para).toMatch(/plain text/);
  });
});
