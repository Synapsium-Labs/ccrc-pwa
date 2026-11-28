// The retry holds no value (Overlord W2 Settings, review 4167 F1, ruled call 1930). A card that hands the section a retry with its
// `step-up-required` (the key's Save, the list's Upload and Clear) keeps that retry in the section's state until the confirm lands. A
// closure keeps alive every variable of the scope it is made in that any closure of that scope names, so a retry made inside a send
// that read the key, or parsed the names, keeps them reachable on the heap while the step shows, though the field has been emptied.
//
// No runtime check sees a closure's captured variables (the fiber walk skips functions, `helpers/fiberWalk.ts`), so this census
// holds the shape by source, over the two card files:
//   - every retry is made by a MAKER declared at the component's own level, outside every send: a line of the form
//     `const <name>Retry: StepRetry = { act: '<act>', send: () => <send>(true) };`, or, for the key's Save, which keeps one boolean,
//     `const <name>Retry = (carried: boolean): StepRetry => ({ act: '<act>', send: () => <send>(carried, true) });`. Its only
//     parameter is a boolean, and its only free name is the card's send function, so nothing it can reach holds a value;
//   - no other line of the file builds a retry (a `send: () =>` anywhere else is red: the reviewer's surviving mutant, the retry
//     arrow written again inside the send, capturing the key);
//   - each door call hands a maker's retry, by name;
//   - the request itself reads the field (the key's `peek`, the names' body built inside the request), so no send keeps the value
//     in a local that a closure names.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SETTINGS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/screens/settings');
const sourceOf = (file: string): string => readFileSync(path.join(SETTINGS, file), 'utf8');

/** A maker: at the component's own level (two spaces in), its act, and the send it calls with `true` (the retry). */
const MAKER = /^ {2}const (\w+)Retry(?:: StepRetry = | = \(carried: boolean\): StepRetry => \()\{ act: '(\w+)', send: \(\) => (\w+)\((?:carried, )?true\) \}\)?;$/;

interface Card { readonly file: string; readonly makers: readonly string[]; readonly handed: string; readonly request: RegExp }
const CARDS: readonly Card[] = [
  {
    file: 'DecisionHostCard.tsx', makers: ['save'], handed: 'retry ? undefined : saveRetry(carried)',
    request: /\(\) => api\.setDecisionKey\(withKey\(to, carried \? key\.current\?\.peek\(\) \?\? '' : ''\)\)/,
  },
  {
    file: 'PrivateNamesCard.tsx', makers: ['upload', 'clear'], handed: "retry ? undefined : act === 'clear' ? clearRetry : uploadRetry",
    request: /\(\) => api\.uploadPrivateNames\(body\(\)\)/,
  },
];

/** Every line of `src` that builds a retry's send: `send: () =>`, wherever it stands. */
const retryLines = (src: string): string[] => src.split('\n').filter((l) => /\bsend: \(\) =>/.test(l));

describe('the retry holds no value: it is made outside every send, by a maker that can reach none (review 4167 F1)', () => {
  it.each(CARDS)('$file: every retry is built by a maker at the component level, and nowhere else', ({ file, makers }) => {
    const lines = retryLines(sourceOf(file));
    expect(lines.length, `${file}: one retry line per maker`).toBe(makers.length);
    for (const line of lines) expect(line, `${file}: a retry built outside a maker`).toMatch(MAKER);
    expect(lines.map((l) => MAKER.exec(l)![2]).sort()).toEqual([...makers].sort());
  });

  it.each(CARDS)('$file: each maker names its own act, and calls the send of that act as the retry', ({ file }) => {
    for (const line of retryLines(sourceOf(file))) {
      const [, name, act, send] = MAKER.exec(line)!;
      expect(name, line).toBe(act);
      // The key's Save retries through the card's `send`; the list's acts through the act's own function.
      expect(send === 'send' || send === act, line).toBe(true);
    }
  });

  it.each(CARDS)('$file: the door call hands the maker\'s retry by name', ({ file, handed }) => {
    expect(sourceOf(file)).toContain(handed);
  });

  it.each(CARDS)('$file: the request reads the field itself, so no send keeps the value in a local a closure names', ({ file, request }) => {
    const src = sourceOf(file);
    expect(src).toMatch(request);
    expect(src, `${file}: a local holding what the field held`).not.toMatch(/const (typed|body) = /);
  });

  it('the census sees the reviewer\'s mutant: a retry arrow written inside the send is red', () => {
    const mutant = sourceOf('DecisionHostCard.tsx').replace(
      'retry ? undefined : saveRetry(carried)',
      "retry ? undefined : { act: 'save', send: () => send(carried, true) }",
    );
    expect(mutant).not.toBe(sourceOf('DecisionHostCard.tsx'));
    const lines = retryLines(mutant);
    expect(lines.length).toBe(2);
    expect(lines.some((l) => !MAKER.test(l))).toBe(true);
  });
});
