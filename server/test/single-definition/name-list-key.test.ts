// The private-name list's key slot is removed by nothing (Overlord W2, private names B, Task 5; plan question 5, Table P1).
// The slot is written at the first upload and is one of the list's two witnesses that an upload happened: a key with no list
// reads `list-missing`, a list with no key `key-missing`, and only both absent read `none`, the one answer that skips the
// check. A call that removed the slot would turn a lost list into "never uploaded". So no call of `removeServerSecret` in
// `server/src` may name the slot, by its constant or its literal. Keyed on the parse (`test/scan`). KNOWN WIDTH: a slot
// passed through a variable of another name, or a removal by another function (`rm` of the path), is not seen.
import { describe, expect, it } from 'vitest';
import { ALL, rel } from './helpers.js';
import { parsedFile } from '../scan/symbols.js';
import { parseSource, type ParsedFile } from '../scan/parse.js';
import { NAME_LIST_KEY_SLOT } from '../../../shared/privateNames.js';

/** Every `removeServerSecret` call of a parse whose slot argument names the name list's key. */
function removalsOfTheKey(p: ParsedFile): number[] {
  return p.calls.filter((c) => c.name === 'removeServerSecret').filter((c) => {
    const slot = c.args[1];
    if (slot === undefined) return false;
    return slot.text.includes('NAME_LIST_KEY_SLOT') || (slot.kind === 'string' && slot.text.replace(/^['"`]|['"`]$/g, '') === NAME_LIST_KEY_SLOT);
  }).map((c) => c.line);
}

describe('nothing removes the private-name list\'s key slot', () => {
  it('CONTROL: a planted call by the constant and by the literal is each found; another slot is not', () => {
    expect(removalsOfTheKey(parseSource([
      'await removeServerSecret(ccrcDir, NAME_LIST_KEY_SLOT);',
      "await removeServerSecret(dir, 'private-names-key');",
      "await removeServerSecret(dir, 'decision-model-key');",
    ].join('\n')))).toEqual([1, 2]);
  });

  it('no call in server/src names it', () => {
    const files = ALL.filter((f) => rel(f).startsWith('server/src/'));
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) => removalsOfTheKey(parsedFile(f)).map((line) => `${rel(f)}:${line}`));
    expect(hits).toEqual([]);
  });
});
