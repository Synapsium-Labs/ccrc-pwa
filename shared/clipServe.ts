// The clip serve table (L0, imports nothing). Moved here from `server/src/clip.ts`, which re-exports it under the same
// name, so the table stays one definition that both the server and the console can import. The console reads only the
// table's KEYS, to know which extensions a declared picture must not be renamed over (`namedUpload`); what a file is
// served as stays the server's decision, made in the serve route from this table.
/**
 * Content-Type for the clip route, keyed by the (real) extension `clipName`
 * wrote: the ALLOW-LIST of what is served inline. Since any file is admitted
 * (2026-11-24), most extensions have no entry here, and the route serves those
 * as `application/octet-stream` with `nosniff` — an opaque download, which no
 * browser renders. That fallback is the point, not a gap.
 *
 * Nothing here is a type a browser runs as script in the page, and nothing
 * ever should be: these are bytes a client uploaded, served back from the
 * app's OWN origin. `text/html`, `image/svg+xml`, an XML or a JavaScript type
 * in this table would make the clip route a same-origin script host. The one
 * inline type that is more than a picture or text is `application/pdf`: a PDF
 * is served inline, as on main, and opens in the browser's own viewer. The
 * route also sends `nosniff`, so a browser cannot promote one of these to
 * HTML on its own. A sandbox policy and a download disposition on the reply
 * are a recorded follow-up (review 3647), in this wave's task note,
 * `docs/superpowers/programs/desktop-polish/attach-any-file.md`.
 *
 * A NULL-PROTOTYPE table, frozen. The route reads it as `CLIP_MIME[ext]`, and
 * now that any extension of the admitted shape is stored, `constructor` is
 * one: on a plain object literal it would answer `Object` itself, and the
 * route would hand that function to the reply as its type.
 */
export const CLIP_MIME: Readonly<Record<string, string>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, string>,
  {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    md: 'text/markdown', txt: 'text/plain', log: 'text/plain',
    csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
    yaml: 'text/yaml', yml: 'text/yaml', rtf: 'application/rtf', pdf: 'application/pdf',
  },
));
