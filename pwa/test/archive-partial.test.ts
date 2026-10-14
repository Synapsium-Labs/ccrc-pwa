// `archivePartial` — the ONE reader of the archive door's `archived:false` (workspace lifecycle spec §5.2).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivePartial } from '../src/lib/api';
import type { ArchiveAnswer } from '../../shared/api';

const answer = (over: Partial<ArchiveAnswer>): ArchiveAnswer => ({ ok: true, archived: true, stopped: false, ended: [], ...over });

describe('archivePartial', () => {
  it('reads a stop that was followed by a refused archive', () => {
    expect(archivePartial(answer({ archived: false, stopped: true, refusal: 'status-unknown', detail: ' ccd: status-unknown\n' })))
      .toEqual({ refusal: 'status-unknown', detail: 'ccd: status-unknown' });
  });

  it('keeps a refusal this build has no word for as null, with ccd\'s text', () => {
    expect(archivePartial(answer({ archived: false, stopped: true, refusal: null, detail: 'ccd: no such session' })))
      .toEqual({ refusal: null, detail: 'ccd: no such session' });
    expect(archivePartial({ ...answer({ archived: false, stopped: true }), refusal: 'not-a-code' as never }))
      .toEqual({ refusal: null, detail: null });
  });

  it('absence permits: archived, an older server\'s {ok:true}, and an unreadable answer are all a completed archive', () => {
    expect(archivePartial(answer({}))).toBeNull();
    expect(archivePartial({ ok: true } as ArchiveAnswer)).toBeNull();
    expect(archivePartial(null)).toBeNull();
  });

  it('is the one place pwa/src compares an answer\'s `archived` — a second reader would decide "archived" on its own', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    // Any CODE line that reads `.archived` other than as `group.archived.<member>` (the Archived fold's list) — a
    // comparison, a negation (`!answer.archived`), a bare truthiness test. `archivedAt`/`archivedBytes` fail `\b`.
    const READ = /^(?!\s*(?:\/\/|\/?\*)).*\.archived\b(?!\s*\.)/m;
    const readers = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && READ.test(readFileSync(path.join(src, f), 'utf8')));
    expect(readers).toEqual([path.join('lib', 'api.ts')]);
  });
});
