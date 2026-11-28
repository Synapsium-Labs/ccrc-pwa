// The retry holds no value (Overlord W2 Settings, review 4167 F1, ruled call 1930). A card that hands the section a retry with its
// `step-up-required` (the key's Save, the list's Upload and Clear) keeps that retry in the section's state until the confirm lands. A
// closure keeps alive every variable of the scope it is made in that any closure of that scope names, so a retry made inside a send
// that read the key, or parsed the names, keeps them reachable on the heap while the step shows, though the field has been emptied.
//
// No runtime check sees a closure's captured variables (the fiber walk skips functions, `helpers/fiberWalk.ts`), so this census
// holds a shape by source, over the two card files. The fact it guards is that NO VALUE STANDS IN A SEND'S SCOPE, the scope the
// retry would otherwise be made in; it is a check on lines of text, not a proof about closures (review 4183 F3). It checks:
//   - every retry is made by a MAKER declared at the component's own level, outside every send: a line of the form
//     `const <name>Retry: StepRetry = { act: '<act>', send: () => <send>(true) };`, or, for the key's Save, which keeps one boolean,
//     `const <name>Retry = (carried: boolean): StepRetry => ({ act: '<act>', send: () => <send>(carried, true) });`;
//   - no other line of the file holds `send: () =>` (the reviewer's surviving mutant, the retry arrow written again inside the send,
//     is red);
//   - each door call hands a maker's retry, by name (a `toContain`, so a comment holding the same text would satisfy it);
//   - the request itself reads the field: the key's `peek` inside the request, and Upload's body built from the box inside the
//     request (`rowsBodyOf(text.current)`), so a send that keeps the rows in a local of any name is red; and no local named `typed`
//     or `body` stands.
// It cannot see, and nothing else here sees: a component-level `let` assigned inside a send; a retry written as `send: async () =>`,
// in method shorthand or split over lines; a cast that passes a string as `carried`; a value kept by another means than a local of
// the send. The code holds none of these today; a reviewer reads for them. It is not grown into a parser.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SETTINGS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/screens/settings');
const sourceOf = (file: string): string => readFileSync(path.join(SETTINGS, file), 'utf8');

/** A maker: at the component's own level (two spaces in), its act, and the send it calls with `true` (the retry). */
const MAKER = /^ {2}const (\w+)Retry(?:: StepRetry = | = \(carried: boolean\): StepRetry => \()\{ act: '(\w+)', send: \(\) => (\w+)\((?:carried, )?true\) \}\)?;$/;

interface Card {
  readonly file: string; readonly makers: readonly string[]; readonly handed: string;
  /** The request arms that read the field inside the request, each of which must stand. */
  readonly request: readonly RegExp[];
}
/** Upload's send hands a body that reads the box inside the request (review 4183 F3: a local of any name is red). */
const UPLOAD_READS_THE_BOX = /send\('upload', \(\) => rowsBodyOf\(text\.current\), /;
const CARDS: readonly Card[] = [
  {
    file: 'DecisionHostCard.tsx', makers: ['save'], handed: 'retry ? undefined : saveRetry(carried)',
    request: [/\(\) => api\.setDecisionKey\(withKey\(to, carried \? key\.current\?\.peek\(\) \?\? '' : ''\)\)/],
  },
  {
    file: 'PrivateNamesCard.tsx', makers: ['upload', 'clear'], handed: "retry ? undefined : act === 'clear' ? clearRetry : uploadRetry",
    request: [/\(\) => api\.uploadPrivateNames\(body\(\)\)/, UPLOAD_READS_THE_BOX],
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
    for (const arm of request) expect(src).toMatch(arm);
    expect(src, `${file}: a local holding what the field held`).not.toMatch(/const (typed|body) = /);
  });

  it('the census sees the names body kept in a renamed local: Upload\'s send no longer reads the box inside the request', () => {
    // Review 4183 F3's blind spot, closed: the rows kept in a local the name rule does not know (`rowsNow`) are red here.
    const src = sourceOf('PrivateNamesCard.tsx');
    const mutant = src.replace(
      "send('upload', () => rowsBodyOf(text.current), uploadAnswerWords, retry);",
      "const rowsNow = rowsBodyOf(text.current);\n    send('upload', () => rowsNow, uploadAnswerWords, retry);",
    );
    expect(mutant).not.toBe(src);
    expect(mutant).not.toMatch(/const (typed|body) = /);
    expect(mutant).not.toMatch(UPLOAD_READS_THE_BOX);
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
