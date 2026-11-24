// A Docs tab's title (desktop polish wave 174): the document's name first, so several Docs tabs can be told apart by their
// narrow labels. Pure (ring L1). It lives with the reader, whose words it reads (`SECTION_LABEL`), so the tab rule
// (`lib/docTab.ts`) and the router reach no Docs module (fix round 1, A9).
import { parseDocsPage } from '../../../shared/docs';
import { SECTION_LABEL } from './docsTree';

/** The title of a Docs tab, so several can be told apart: the document's file name first, then its project, as a tab's
 *  narrow label shows its start. A directory or a section reads its own name; the index, and an address the reader would
 *  refuse, read "Docs". Every title ends with the console's name. */
export function docsTabTitle(path: string, search: string): string {
  const tail = 'Docs · ccrc';
  const parsed = parseDocsPage(path, search);
  if (!parsed.ok) return tail;
  const loc = parsed.loc;
  switch (loc.kind) {
    case 'index': return tail;
    case 'project': return `${loc.project} · ${tail}`;
    case 'section': return `${SECTION_LABEL[loc.section]} · ${loc.project} · ${tail}`;
    case 'path': {
      const segs = loc.path.split('/').filter((s) => s !== '');
      const name = segs.at(-1) ?? SECTION_LABEL[loc.section];
      return `${name} · ${loc.project} · ${tail}`;
    }
  }
}
