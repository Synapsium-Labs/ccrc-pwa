// Export's file name (spec 2026-10-01 4.17 "Filename"; M4.EX9; native Docs reader W5, Export):
// `<project>_<section>_<path with '/' as '__'>_<short8>[-draft].html`, only `[A-Za-z0-9._-]` (every other character
// becomes `-`), at most `EXPORT_FILENAME_MAX` characters. The name is cut from the end of its front part, so the path
// goes first; the tail is always whole. `commit` is the commit the export names (`exportProvenance`'s `commit`).
//
// Ring L1: pure.
import type { DocPin } from '../../../../shared/docs';
import { shortCommit } from '../docsText';
import { EXPORT_FILENAME_MAX } from './policy';

const UNSAFE = /[^A-Za-z0-9._-]/g;
const safe = (s: string): string => s.replace(UNSAFE, '-');

export function exportFilename(project: string, pin: DocPin, commit: string): string {
  const tail = `_${shortCommit(commit)}${pin.kind === 'draft' ? '-draft' : ''}.html`;
  const front = `${safe(project)}_${safe(pin.section)}_${safe(pin.path.split('/').join('__'))}`;
  return front.slice(0, EXPORT_FILENAME_MAX - tail.length) + tail;
}
