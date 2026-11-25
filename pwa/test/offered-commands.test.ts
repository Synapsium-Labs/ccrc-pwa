// THE CONSOLE NEVER OFFERS A COMMAND THE CLI DOES NOT HAVE (desktop-polish wave 180). The Add account door's reason once
// offered `ccrc auth on` to copy, a verb `ccrc` never had, and `ccrc expose` with no subcommand, which exits 2: a person
// who ran either got the usage text and nothing else. This file reads the CLI's own table, `ccd/ccrc`'s dispatch (the
// `case "$VERB" in` at its end), and checks every command the console offers against it: each copy line (the door's
// reasons and the trouble card's commands) and every `ccrc …` the door's words name. A verb must be in the dispatch, and
// when the verb refuses to run without a subcommand, the next word must be one of the subcommands it names.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOOR_NARROWED, fixCommands } from '../src/fleet/accountWords';

const CCRC = readFileSync(path.join(import.meta.dirname, '..', '..', 'ccd', 'ccrc'), 'utf8');

/** The verbs of the CLI's top-level dispatch, read from its `case "$VERB" in … esac`. */
function verbs(): Set<string> {
  const start = CCRC.lastIndexOf('case "$VERB" in');
  if (start < 0) throw new Error('ccd/ccrc has no `case "$VERB" in` dispatch');
  const body = CCRC.slice(start, CCRC.indexOf('\nesac', start));
  const out = new Set<string>();
  for (const m of body.matchAll(/^\s+([a-z][a-z-]*)\)/gm)) out.add(m[1]!);
  return out;
}

/** The body of `cmd_<verb>`, from its opening line to the next top-level `}`. */
function cmdBody(verb: string): string | null {
  const head = `\ncmd_${verb.replace(/-/g, '_')}() {`;
  const start = CCRC.indexOf(head);
  if (start < 0) return null;
  return CCRC.slice(start, CCRC.indexOf('\n}\n', start));
}

/** The subcommands a verb REQUIRES, or `null` when it runs without one. A verb requires one when its body refuses an
 *  empty subcommand (`missing subcommand` / `missing-subcommand`). Its subcommands are the `*_SUBS` list it names, or
 *  else the labels of its first `case "$sub" in`, less help and the catch-alls. */
function requiredSubs(verb: string): Set<string> | null {
  const body = cmdBody(verb);
  if (body === null || !/missing[ -]subcommand/.test(body)) return null;
  const list = /\$\{?([A-Z_]+_SUBS)\b/.exec(body);
  if (list !== null) {
    const def = new RegExp(`^${list[1]}="([^"]*)"`, 'm').exec(CCRC);
    if (def === null) throw new Error(`ccd/ccrc names ${list[1]} but never sets it`);
    return new Set(def[1]!.split(/\s+/).filter(Boolean));
  }
  const at = body.indexOf('case "$sub" in');
  if (at < 0) throw new Error(`cmd_${verb} refuses an empty subcommand but has no \`case "$sub" in\` to read`);
  const block = body.slice(at, body.indexOf('\n  esac', at));
  const subs = new Set<string>();
  for (const m of block.matchAll(/^\s{4}([^\s)]+)\)/gm)) {
    for (const label of m[1]!.split('|')) if (/^[a-z][a-z-]*$/.test(label)) subs.add(label);
  }
  return subs;
}

/** Why `command` is not one the CLI has, or `null` when it is. */
function unknownCommand(command: string): string | null {
  const words = command.trim().split(/\s+/);
  if (words[0] !== 'ccrc') return `${JSON.stringify(command)} does not start with ccrc`;
  const verb = words[1] ?? '';
  if (!verbs().has(verb)) return `${JSON.stringify(command)}: ccrc has no verb "${verb}"`;
  const subs = requiredSubs(verb);
  if (subs === null) return null;
  const sub = words[2] ?? '';
  if (!subs.has(sub)) return `${JSON.stringify(command)}: ccrc ${verb} needs one of ${[...subs].join(', ')}, and got "${sub}"`;
  return null;
}

/** Every `ccrc <verb> [<word>]` a sentence names: the verb, and the word after it when there is one. */
function namedIn(text: string): string[] {
  return [...text.matchAll(/\bccrc ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)].map((m) => `ccrc ${m[1]}${m[2] === undefined ? '' : ` ${m[2]}`}`);
}

/** Every command the console offers to copy, and every one its door's words name. */
function offered(): string[] {
  const out: string[] = [];
  for (const n of Object.values(DOOR_NARROWED)) {
    if (n.fix !== undefined) out.push(n.fix);
    out.push(...namedIn(n.text));
    for (const line of n.more?.lines ?? []) out.push(...namedIn(line));
  }
  const id = 'lane-a';
  out.push(fixCommands.check(id), fixCommands.credential(id), fixCommands.disable(id));
  return out;
}

describe('every command the console offers is one the CLI has (wave 180)', () => {
  it('reads the CLI: its verbs, and a verb that needs a subcommand', () => {
    // The reader itself, against facts of the CLI that no wave of this one changes.
    expect(verbs().has('passwd')).toBe(true);
    expect(verbs().has('expose')).toBe(true);
    expect(requiredSubs('passwd')).toBeNull();
    expect([...requiredSubs('expose')!].sort()).toEqual(['byo', 'duckdns', 'ip', 'status']);
    expect(requiredSubs('account')!.has('check')).toBe(true);
    // What the door offered before this wave: neither is a command the CLI has.
    expect(unknownCommand('ccrc auth on')).toMatch(/no verb "auth"/);
    expect(unknownCommand('ccrc expose')).toMatch(/needs one of/);
  });

  it('each one the console offers', () => {
    const bad = offered().map(unknownCommand).filter((r) => r !== null);
    expect(bad).toEqual([]);
  });
});
