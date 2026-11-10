// The coordinator skill's wave lifecycle, read as one text.
//
// The lifecycle was one reference file, `wave-lifecycle.md`. It is split into one file per step, so that a
// coordinator reads the step it is on, and `wave-lifecycle.md` stays as their index. The pins on it were written
// against one text, and each still says what a coordinator must be told, whichever file now holds it.
//
// So every test that reads the lifecycle reads it here: the index, then each part in order, each part taken from
// its first `##` or `###` heading (the title a part adds above it is left out). A part that is not there reads as
// empty, so the same tests pass on a tree where the lifecycle is still one file.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REFERENCES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ccd', 'coordinator-skill', 'references');

/** The index's file name: the one name older citations ("wave-lifecycle.md §5b") carry. */
export const WAVE_LIFECYCLE_INDEX = 'wave-lifecycle.md';

/** The parts, in the order their sections stood in the one file. */
export const WAVE_LIFECYCLE_PARTS: readonly string[] = [
  'wave-lifecycle-1-open.md',
  'wave-lifecycle-2-dispatch.md',
  'wave-lifecycle-3-mail.md',
  'wave-lifecycle-4-advance.md',
  'wave-lifecycle-5-boundary.md',
  'wave-lifecycle-5b-landing.md',
  'wave-lifecycle-6-final-merge.md',
  'wave-lifecycle-run-care.md',
  'wave-lifecycle-asks.md',
  'wave-lifecycle-mutation.md',
];

const part = (name: string): string => {
  const p = path.join(REFERENCES, name);
  if (!existsSync(p)) return '';
  const text = readFileSync(p, 'utf8');
  const at = text.search(/^#{2,3} /m);
  return at === -1 ? text : text.slice(at);
};

/** The whole lifecycle as one text: the index, then every part that exists. */
export function waveLifecycleText(): string {
  const index = readFileSync(path.join(REFERENCES, WAVE_LIFECYCLE_INDEX), 'utf8');
  return [index, ...WAVE_LIFECYCLE_PARTS.map(part).filter((t) => t !== '')].join('\n');
}
