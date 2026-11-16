// The mockup pre-scan, rule v7 (native Docs reader, completion plan Task 5, C1; base spec 2026-10-01 5.6.2 and decision
// 9, rows M5.22 and M5.B8; departs from 5.6.2's pop sentence as D-8661, is namespace-aware as D-8663, with v4 to v7 folded into D-8663, and the attribute cap D-8671). Ring L1: pure
// text in, a verdict out; it imports only `./policy`, so it holds no DOM, no I/O and no timer, and the browser's HTML
// parser is named in `parse.ts` alone. It is the only guard that runs before the native parse, which cannot be aborted
// (E13), so it is conservative and linear: ONE left-to-right pass, every region consumed once. TAGS ARE COUNTED EVERYWHERE
// (a start or end tag is `<` or `</` followed by an ASCII letter, wherever it sits); WHAT PUSHES AND POPS follows the
// parser, because a parser's real stack and its list of active formatting elements are what cost time and memory (a limit
// read off a different stack is a limit an attacker steps around: v1 popped at end tags the parser IGNORES; v2 popped
// `</foreignObject>` and `</svg>` where a parser ignores them while an HTML element is current, in real Chromium; v4 kept
// raw mode past the tokenizer's real exit, and let a `/` followed by white space count as a self-close: both popped what the
// parser keeps). THE STRUCTURAL RULE: the adoption agency gives up after eight rounds, so ANY element this scan pops while the
// parser keeps it (eight or more special elements) leaves a formatting clone in the parser's list while the scan's count falls.
// Exactness is the requirement, not a bound: where the scan cannot follow the tokenizer or the tree builder exactly it
// refuses, and the browser leg holds both to Chromium (the oracle rows of `browser/mockup-parse.browser.test.ts`). v6 adds:
// the scan never pops through an entry (the parser may not hold it: a stale entry, from an implicit close or a start tag the
// parser ignores, made a later end tag pop what the parser kept), and it refuses CDATA and raw text where it cannot tell what
// the parser does.
//
// ATTRIBUTE CAP (D-8671). The exact attribute tokenizer below counts the attribute TOKENS of every START tag (every attribute name
// that starts, a repeated name and a first `=` included, though the parser keeps the first of a duplicated name), and a start
// tag with more than MOCKUP_MAX_ATTRIBUTES refuses the page as `too-many-attributes`, before the tag is pushed. The parser copies
// every attribute of a formatting element into each clone it makes (reconstruction, adoption agency), so the cost is attributes
// x clones, and neither the tag count nor the formatting count sees it (a tag with 150 000 attributes and 4 000 paragraphs took
// 19.1 s in Chromium). An end tag's attributes are not counted (the parser drops them), nor are names inside a value, a comment or
// raw text. The value is in `policy.ts`, with the committed mockups' own maxima.
//
// Names are read to tab, LF, FF, CR, space, `/` or `>`, and lowered for `A-Z` only (never `toLowerCase`, which maps
// non-ASCII letters, such as the Kelvin sign, onto ASCII ones).
//
// NAMESPACES (D-8663). Every stack entry is HTML or FOREIGN (`svg`, `math` and what the parser puts in them). A start tag is
// foreign when it is `svg` or `math`, or when foreign content is open and the name is not one of the parser's breakout
// names (`b big blockquote body br center code dd div dl dt em embed h1-h6 head hr i img li listing menu meta nobr ol p pre
// ruby s small span strong strike sub sup table tt u ul var`, checked against Chromium for every HTML element name by the
// browser leg); a breakout pops exactly the foreign run the parser pops, and is then an HTML entry. `font` is a breakout only
// with an attribute NAMED `color`, `face` or `size` (read from the exact attribute tokenizer, ASCII case-insensitive); any
// other `font` stays foreign. A self-closed foreign element (the tokenizer's own self-closing flag; `<svg a=b/>` is not one)
// pushes NOTHING, because the parser pops it at once; a foreign void-named element that is not self-closed is pushed (it stays
// open in foreign content).
// FOREIGN CONTENT IS EXACT OR REFUSED (v7). The foreign entries are always ONE RUN on top of the stack, and they mirror the parser's:
//   - a root `svg` or `math` is pushed only where the parser surely makes it. With an HTML `template` or `select` open, or after
//     any `frameset` start tag (the parser ignores a root in column-group mode with a template on top, in select, and in the frameset
//     modes), the page REFUSES (`foreign-markup`); a self-closed root pushes nothing;
//   - a foreign start tag pushes a foreign entry; a breakout pops the whole run (down to the HTML entry below the root) and is
//     pushed as HTML, so the root is gone; `</p>` and `</br>` pop the same run and then run as HTML end tags (`</br>` as a
//     `<br>` start tag); with an integration point open they REFUSE;
//   - any other end tag walks down through the foreign entries to the first one with its name and pops through it, as the
//     parser's foreign end-tag steps do (nothing in the foreign namespace lowers a formatting count); when the walk reaches an HTML
//     entry or the bottom the parser hands the tag to the HTML rules, which the scan does not follow, and the page REFUSES.
// So a foreign entry on the stack is never stale, and the namespace labels (CDATA, integration points, text-only elements, the
// self-closed root) can only be exact. The scan never guesses in either direction. Before v7 a stale foreign entry (a `</svg>`
// ignored with a `<g>` open) labelled the next eight `<section>` elements foreign while the parser held them as HTML specials, and
// a breakout popped them (909 K elements in 19.5 s in Chromium).
//   INTEGRATION POINTS: a foreign `foreignobject`, `desc` or `title`, and a foreign `mi mo mn ms mtext annotation-xml`
//   (every annotation-xml, conservatively). While one is on the stack ANY start tag REFUSES the page as `foreign-markup`
//   (shown as source, like the other refusals): inside one the parser handles HTML, ignores `</foreignObject>` and `</svg>`
//   while an HTML element is current, and the formatting list or the stack grows where this scan would have popped.
//   Text inside an integration point is admitted.
//   TEXT-ONLY FOREIGN ELEMENTS: a foreign `script style xmp iframe noembed noframes textarea plaintext title` is read as text
//   whichever way the parser reads it (a foreign element, or HTML raw text when the parser has left foreign content). In it,
//   `<` followed by a letter, `/`, `!` or `?` REFUSES (`foreign-markup`), except its own `</name` followed by tab, LF, FF,
//   CR, space, `/` or `>`: that end tag's attribute section is tokenized exactly and the element is popped. The one other
//   exception is the exact opener `<![CDATA[`, read as text up to the first `]]>`: inside it every `<` followed by a letter,
//   `/`, `!` or `?` still refuses (its own end tag included), so a markup reading (a CDATA section) and a raw reading (text)
//   see the same structure and the same exit point. A comment, an attribute or a start tag inside one could hide the exit
//   from one reading and not the other, so none is allowed.
//
// MODES. The scan is always in markup mode, except while it reads the text of an HTML raw-text element.
//   - Markup mode tokenizes the regions the HTML tokenizer makes text, EXACTLY, and counts the tags in them but pushes and
//     pops nothing for them:
//       a comment `<!--` ends at once at `<!-->` or `<!--->`, else at the first `-->` or `--!>`, or at the end of the text;
//       a `<![CDATA[` with NO foreign entry on the stack is a bogus comment ending at the first `>`, as are `<!` that is not
//       `<!--`, `<?`, and `</` followed by neither a letter nor `>` (`</>` is skipped); a `<![CDATA[` with ANY foreign entry on the
//       stack REFUSES (`foreign-markup`, v6): the entry may be stale (the parser left foreign content at a `</p>`, a `</br>` or a
//       breakout the scan did not see) and a section ends at `]]>` where a bogus comment ends at the first `>`;
//       a tag's attribute section runs through the tokenizer's own states to the `>` that ends the tag, for start AND end tags
//       (tag name state's `/`, before-attribute-name, attribute-name, after-attribute-name, before-attribute-value, the
//       double-quoted, single-quoted and unquoted value states, after-attribute-value-quoted, self-closing-start-tag). A quote
//       opens a value ONLY after `=`; in a name or an unquoted value it is data; a first `=` starts a name; `>` in
//       before-attribute-value ends the tag; white space after a `/` that no `>` follows goes back to before-attribute-name.
//       The SELF-CLOSING FLAG is set only by a `/` immediately followed by the `>`.
//   - RAW TEXT (v5): an HTML `script style xmp iframe noembed noframes` (raw text), `textarea title` (RCDATA) or `plaintext`
//     start tag switches the tokenizer to that element's text state, and the scan with it. Inside, tags are COUNTED only: no
//     push, no pop, no formatting change. The text ends exactly where the tokenizer's state does: at the first `</` + the
//     OPENER's name (ASCII case-insensitive) + tab, LF, FF, CR, space, `/` or `>`; that end tag's attribute section is then
//     walked and the opener popped. `plaintext` never ends. `script` is the tokenizer's script data states EXACTLY (script data,
//     less-than sign, escape start and escape start dash, escaped, escaped dash and dash dash, escaped less-than sign,
//     double escape start, double escaped, its dash and dash dash states, its less-than sign, double escape end): only a
//     `</script` + terminator in script data or the escaped state (not double escaped) ends it. A `/>` on a raw-text start tag
//     is ignored, as the parser ignores it on a non-void HTML element.
//   - A FOREIGN raw-named element is text-only instead (above).
//
// START TAGS push their name (unless it is an HTML void element), and a formatting name adds one to its multiset count in
// either namespace. A raw-text start tag (HTML `script style xmp iframe noembed noframes textarea title plaintext`) while an HTML
// `template` entry is on the stack REFUSES, as `foreign-markup` (v6, the word covers any markup the scan cannot follow): the parser
// ignores it in column-group mode with a template on top, so no raw text begins there, and the scan cannot know the mode.
// END TAGS: with foreign content open, see above. Outside it, `</body>`, `</html>` and `</form>` change nothing, ever (`</form>` is
// ignored by the parser with a null form pointer, which the scan cannot see), and any other end tag pops ONLY when its name is
// the name of the TOP entry of the stack (v6): never through an entry above it, whatever that entry is. The scan keeps entries
// the parser has closed or never made, and a pop through one popped what the parser kept (eight such specials leave a
// formatting clone behind the adoption agency). THE COST: an end tag the markup omits leaves its element on the stack, so a page
// that omits more than 256 of them is refused (as a long run of unclosed siblings already was).
// FORMATTING: a count drops by ONE only when an HTML formatting entry is popped by its OWN end tag at the top; never otherwise.
//
// It stops at the first moment a limit is exceeded (checked in the order depth, tags, formatting) and reports the counts
// at that moment; every limit is inclusive. In the admitted answer `depth` and `formatting` are the maxima reached.
//
// STILL NOT MODELLED (each only makes the scan over-count or refuse, except where noted):
//   - the parser's own implied elements (html, head, body, tbody, colgroup) and the reconstruction clones are not stack
//     entries here; the measured gates in `browser/mockup-parse.browser.test.ts` bound their cost;
//   - a start tag never closes a `p`, `li`, `dd`, `dt`, `option`, `button` or heading the way the parser does, and an end tag
//     never pops through an open child, so every omitted end tag is retained and a page that omits more than 256 is refused;
//   - foreign `<a>` and `<font>` raise the formatting count and nothing in the foreign namespace lowers it;
//   - the text-only rule refuses a markup character inside an svg `style`, `script` or `title` text (a `<` followed by a
//     letter, `/`, `!` or `?`, except inside a CDATA opener's text it still refuses), and any start tag inside `desc`,
//     `foreignObject` or a math text element: such pages are shown as source;
//   - a stray end tag, or one for an HTML element, while foreign content is open refuses the page, and so does a `<svg>` or `<math>`
//     with a `template` or `select` open or after any `frameset` (a sticky flag, so a stray frameset makes every later root
//     refuse); an ordinary icon that closes in order never meets these;
//   - the reconstruction of formatting elements the parser does when a root start tag is processed (up to MOCKUP_MAX_OPEN_FORMATTING
//     clones, pushed above the HTML parent) is not a stack entry here; the measured gates bound it;
//   - the raw-text states are the ones the tree builder switches to in body, in head and in a table, which Chromium also does
//     inside an open `select`; an engine that ignores `<style>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>` or `<title>`
//     in a `select` (the older "in select" rules) would read that text as markup, and this scan would then under-count: the
//     browser leg's oracle is Chromium's;
//   - every `<form>` stays on the stack (a `</form>` never pops it), so a page with more than a few hundred forms is refused, and
//     the elements around a form are retained after it;
//   - a raw-text start tag the parser ignores in some other mode (the in-frameset modes) is read as raw text here, which
//     hides tags there; only the template case was measured, and only in Chromium;
//   - the property test in `test/mockup-prescan.test.ts` holds the rule to the parser's real output, and the browser leg's
//     foreign-content, stale-entry and oracle rows hold it to Chromium's (jsdom's parser cannot see `desc` or `mi`).
import {
  MOCKUP_FORMATTING_ELEMENTS, MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_DEPTH, MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS, MOCKUP_VOID_ELEMENTS,
} from './policy';

/** What the pre-scan decided. The counts are the measured ones: the maxima reached when `ok`, the values at the moment
 *  of the refusal when not. `foreign-markup` is a start tag (or markup) where the scan cannot follow what the parser does:
 *  inside an integration point or a text-only foreign element, a raw-text start tag inside a template, and CDATA with a foreign
 *  entry open. */
export type MockupPrescan =
  | { ok: true; depth: number; tags: number; formatting: number }
  | { ok: false; why: 'too-deep' | 'too-many-tags' | 'too-many-formatting' | 'foreign-markup' | 'too-many-attributes'; depth: number; tags: number; formatting: number };

const words = (list: string): ReadonlySet<string> => new Set(list.split(' '));

/** The raw-text elements: their content is text to the tokenizer (HTML), and text-only here when foreign. */
const RAW = words('script style xmp iframe noembed noframes textarea title plaintext');
/** The foreign elements through which the parser handles HTML or whose scope the parser's walks stop at. */
const INTEGRATION = words('foreignobject desc title mi mo mn ms mtext annotation-xml');
/** The start tags that take the parser out of foreign content. `font` is one only with an attribute named `color`, `face` or
 *  `size` (read from the exact attribute tokenizer), so it is not here. */
const BREAKOUT = words('b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu '
  + 'meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var');
const isLetter = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isSpace = (c: number): boolean => c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
/** The characters that end a tag name (the HTML tokenizer's own set): tab, LF, FF, CR, space, `/` and `>`. */
const isNameEnd = (c: number): boolean => isSpace(c) || c === 0x2f || c === 0x3e;
const lowerAscii = (name: string): string => name.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x20));

/** The tokenizer's attribute states, by number. */
const Attr = { BeforeName: 0, Name: 1, AfterName: 2, BeforeValue: 3, Double: 4, Single: 5, Unquoted: 6, AfterQuoted: 7, SelfClosing: 8 } as const;

/** The script data tokenizer states, by number (HTML standard, tokenization). */
const Script = {
  Data: 0, DataLt: 1, EscapeStart: 2, EscapeStartDash: 3, Escaped: 4, EscapedDash: 5, EscapedDashDash: 6, EscapedLt: 7, DoubleStart: 8,
  DoubleEscaped: 9, DoubleDash: 10, DoubleDashDash: 11, DoubleLt: 12, DoubleEnd: 13,
} as const;

type Why = 'too-deep' | 'too-many-tags' | 'too-many-formatting' | 'foreign-markup' | 'too-many-attributes';

/** Decides, from the raw text alone, whether a mockup may be handed to the HTML parser. */
export function prescanMockup(text: string): MockupPrescan {
  const names: string[] = [];
  /** Parallel to `names`: whether the entry is in the foreign (svg or math) namespace. */
  const foreign: boolean[] = [];
  /** How many foreign entries are on the stack (they are always one run on top, so `foreignCount > 0` means foreign content is open),
   *  how many HTML `template` and `select` entries, and whether a `frameset` start tag has been seen. */
  let foreignCount = 0;
  let templates = 0;
  let selects = 0;
  let sawFrameset = false;
  const formattingCount = new Map<string, number>();
  let tags = 0;
  let maxDepth = 0;
  let formatting = 0;
  let maxFormatting = 0;
  /** The HTML raw-text element whose start tag was just pushed: its text is scanned at once, in `rawText`, and this is cleared. */
  let raw: string | null = null;
  let intPoints = 0;
  /** Where the `]]>` of the CDATA text being read inside a text-only foreign element is (-1: not inside one). */
  let cdataEnd = -1;
  /** Whether the tag the last `attributeSection` walked ended with the tokenizer's self-closing flag (`/>` in the right state). */
  let selfClosing = false;
  /** Whether that tag has an attribute NAMED color, face or size (what makes a `font` start tag a breakout). */
  let fontAttr = false;
  /** The cached place of the first `--!>` at or after some earlier point (-2: not looked up yet, -1: none to the end). */
  let nextBang = -2;
  const n = text.length;

  const refuse = (why: Why): MockupPrescan => ({ ok: false, why, depth: maxDepth, tags, formatting: maxFormatting });
  const overLimit = (): MockupPrescan | null => {
    if (maxDepth > MOCKUP_MAX_DEPTH) return refuse('too-deep');
    if (tags > MOCKUP_MAX_TAGS) return refuse('too-many-tags');
    if (maxFormatting > MOCKUP_MAX_OPEN_FORMATTING) return refuse('too-many-formatting');
    return null;
  };

  /** Whether a tag starts at the `<` at `j`: `<` or `</` followed by an ASCII letter. */
  const startsTag = (j: number): boolean => {
    const c = text.charCodeAt(j + 1);
    return isLetter(c) || (c === 0x2f && isLetter(text.charCodeAt(j + 2)));
  };
  /** Counts the tags in `[from, to)`; true once the tag limit is exceeded. */
  const countIn = (from: number, to: number): boolean => {
    let j = text.indexOf('<', from);
    while (j !== -1 && j < to) {
      if (startsTag(j)) {
        tags += 1;
        if (tags > MOCKUP_MAX_TAGS) return true;
      }
      j = text.indexOf('<', j + 1);
    }
    return false;
  };

  const popOne = (): void => {
    const name = names.pop() as string;
    if (foreign.pop() as boolean) {
      foreignCount -= 1;
      if (INTEGRATION.has(name)) intPoints -= 1;
    } else if (name === 'template') templates -= 1;
    else if (name === 'select') selects -= 1;
  };

  /** A start tag: null, or the refusal. `fontBreakout`: the tag carries an attribute named color, face or size. */
  const startTag = (name: string, selfClosed: boolean, fontBreakout: boolean): MockupPrescan | null => {
    if (intPoints > 0) return refuse('foreign-markup');
    if (name === 'frameset') sawFrameset = true;
    const isRoot = name === 'svg' || name === 'math';
    // The parser pops a self-closed svg or math at once, in every context, so it never stands on the stack.
    if (selfClosed && isRoot) return null;
    // FOREIGN CONTENT IS EXACT OR REFUSED. The foreign entries are one run on top of the stack and mirror the parser's: a root is
    // pushed only where the parser surely makes it (not in a template, a select or after a frameset, which ignore it), every
    // foreign start tag is a foreign entry unless self-closed (the parser pops it), a breakout pops exactly the foreign entries the
    // parser pops, and an end tag that does not match inside the run refuses (below). No stale foreign entry can exist.
    if (isRoot && foreignCount === 0 && (templates > 0 || selects > 0 || sawFrameset)) return refuse('foreign-markup');
    let isForeign: boolean;
    if (isRoot) isForeign = true;
    else if (foreignCount > 0) {
      isForeign = !(BREAKOUT.has(name) || (name === 'font' && fontBreakout));
      if (!isForeign) while (foreignCount > 0) popOne();
      else if (selfClosed) return null;
    } else isForeign = false;
    // The parser ignores a raw-text start tag in some modes (column group, with a template on top), so no raw text begins there
    // and the scan cannot know: with a template open, refuse.
    if (!isForeign && RAW.has(name) && templates > 0) return refuse('foreign-markup');
    if (isForeign || !MOCKUP_VOID_ELEMENTS.has(name)) {
      names.push(name);
      foreign.push(isForeign);
      if (isForeign) {
        foreignCount += 1;
        if (INTEGRATION.has(name)) intPoints += 1;
      } else {
        if (name === 'template') templates += 1;
        if (name === 'select') selects += 1;
        if (RAW.has(name)) raw = name;
      }
      if (names.length > maxDepth) maxDepth = names.length;
    }
    if (MOCKUP_FORMATTING_ELEMENTS.has(name)) {
      formattingCount.set(name, (formattingCount.get(name) ?? 0) + 1);
      formatting += 1;
      if (formatting > maxFormatting) maxFormatting = formatting;
    }
    return null;
  };

  /** An end tag. Foreign content open: `</p>` and `</br>` pop the foreign run (the parser's own exit; with an integration point
   *  open, refuse) and then run as HTML end tags; any other end tag walks down through the foreign entries to the first of its
   *  name and pops through it, as the parser's foreign end-tag steps do, and REFUSES when the walk reaches an HTML entry or the
   *  bottom (the parser then hands the tag to the HTML rules, which the scan does not follow). Outside foreign content an end tag
   *  pops ONLY when its name is the name of the TOP entry (the scan keeps entries the parser closed or never made, and a pop
   *  through one popped what the parser kept); `</body>`, `</html>` and `</form>` never pop (the parser ignores `</form>` with a
   *  null form pointer). Returns the refusal, or null. */
  const endTag = (name: string): MockupPrescan | null => {
    if (foreignCount > 0) {
      if (name === 'p' || name === 'br') {
        if (intPoints > 0) return refuse('foreign-markup');
        while (foreignCount > 0) popOne();
        if (name === 'br') return null;
      } else {
        for (let k = names.length - 1; k >= 0 && foreign[k]; k -= 1) {
          if (names[k] === name) {
            while (names.length > k) popOne();
            return null;
          }
        }
        return refuse('foreign-markup');
      }
    }
    if (name === 'body' || name === 'html' || name === 'form') return null;
    const top = names.length - 1;
    if (top < 0 || names[top] !== name) return null;
    popOne();
    const own = formattingCount.get(name) ?? 0;
    if (own > 0) {
      formattingCount.set(name, own - 1);
      formatting -= 1;
    }
    return null;
  };

  /** Walks a tag's attribute section from `from` (just after the name) to the `>` that ends the tag, counting the tags in
   *  it. Returns that index (`n` when the text ends first), -1 once the tag limit is exceeded, or -3 once a START tag has more
   *  than MOCKUP_MAX_ATTRIBUTES attributes (D-8671). */
  const attributeSection = (from: number, isStart: boolean): number => {
    let st: number = Attr.BeforeName;
    /** The attribute tokens seen so far: every attribute NAME that starts, a repeated name and a first `=` included. */
    let attrCount = 0;
    selfClosing = false;
    fontAttr = false;
    let nameStart = from;
    /** At the end of an attribute name: is it color, face or size (ASCII case-insensitive)? */
    const endName = (p: number): void => {
      const len = p - nameStart;
      if (fontAttr || (len !== 4 && len !== 5)) return;
      const attr = lowerAscii(text.slice(nameStart, p));
      if (attr === 'color' || attr === 'face' || attr === 'size') fontAttr = true;
    };
    for (let p = from; p < n; p += 1) {
      const c = text.charCodeAt(p);
      if (c === 0x3e) selfClosing = st === Attr.SelfClosing;
      if (c === 0x3c && startsTag(p)) {
        tags += 1;
        if (tags > MOCKUP_MAX_TAGS) return -1;
      }
      switch (st) {
        case Attr.Double:
          if (c === 0x22) st = Attr.AfterQuoted;
          break;
        case Attr.Single:
          if (c === 0x27) st = Attr.AfterQuoted;
          break;
        case Attr.BeforeValue:
          if (isSpace(c)) break;
          if (c === 0x3e) return p;
          st = c === 0x22 ? Attr.Double : c === 0x27 ? Attr.Single : Attr.Unquoted;
          break;
        case Attr.Unquoted:
          if (isSpace(c)) st = Attr.BeforeName;
          else if (c === 0x3e) return p;
          break;
        case Attr.Name:
          if (isSpace(c)) {
            endName(p);
            st = Attr.AfterName;
          } else if (c === 0x2f) {
            endName(p);
            st = Attr.SelfClosing;
          } else if (c === 0x3e) {
            endName(p);
            return p;
          } else if (c === 0x3d) {
            endName(p);
            st = Attr.BeforeValue;
          }
          break;
        case Attr.AfterName:
          if (isSpace(c)) break;
          if (c === 0x3e) return p;
          st = c === 0x2f ? Attr.SelfClosing : c === 0x3d ? Attr.BeforeValue : Attr.Name;
          if (st === Attr.Name) {
            nameStart = p;
            attrCount += 1;
            if (isStart && attrCount > MOCKUP_MAX_ATTRIBUTES) return -3;
          }
          break;
        default: {
          // BeforeName, AfterQuoted and SelfClosing: `>` ends the tag; the first two skip space, and AfterQuoted and
          // SelfClosing hand any other character to before-attribute-name, which starts a name (an `=` starts one too).
          if (c === 0x3e) return p;
          if (isSpace(c)) {
            // After a quoted value, and after a `/` that no `>` followed, white space goes (back) to before-attribute-name.
            if (st !== Attr.BeforeName) st = Attr.BeforeName;
            break;
          }
          if (c === 0x2f && st !== Attr.SelfClosing) st = Attr.SelfClosing;
          else if (c === 0x2f) break;
          else {
            st = Attr.Name;
            nameStart = p;
            attrCount += 1;
            if (isStart && attrCount > MOCKUP_MAX_ATTRIBUTES) return -3;
          }
        }
      }
    }
    selfClosing = false;
    fontAttr = false;
    return n;
  };

  const nameEnd = (from: number): number => {
    let stop = from + 1;
    while (stop < n && !isNameEnd(text.charCodeAt(stop))) stop += 1;
    return stop;
  };

  /** Whether the text at `p` is `name` (ASCII case-insensitive) followed by tab, LF, FF, CR, space, `/` or `>`: the tokenizer's
   *  "appropriate end tag" test after `</`. */
  const endTagAt = (p: number, name: string): boolean => {
    for (let k = 0; k < name.length; k += 1) {
      let c = text.charCodeAt(p + k);
      if (c >= 0x41 && c <= 0x5a) c += 0x20;
      if (c !== name.charCodeAt(k)) return false;
    }
    const e = p + name.length;
    return e < n && isNameEnd(text.charCodeAt(e));
  };

  /** RAWTEXT and RCDATA (`style xmp iframe noembed noframes`, `textarea title`): the text ends at the first `</` + the opener's
   *  name + a terminator. Returns the `<` of that end tag, or -1 when the text ends first. */
  const textExit = (opener: string, from: number): number => {
    let j = text.indexOf('</', from);
    while (j !== -1) {
      if (endTagAt(j + 2, opener)) return j;
      j = text.indexOf('</', j + 1);
    }
    return -1;
  };

  /** Script data, state by state, as the HTML standard's tokenizer has them (from the script data state to the script data double escape end state). Only a `</script` + a
   *  terminator seen in the script data state or the script data escaped state (not double escaped) ends it. A `</` that is
   *  not that end tag is text, and the characters after it are read in the state it was seen in (they are letters and a
   *  `/`, which change no state). Returns the `<` of the end tag, or -1 when the text ends first. */
  const scriptExit = (from: number): number => {
    let st: number = Script.Data;
    let buf = '';
    let p = from;
    while (p < n) {
      const c = text.charCodeAt(p);
      switch (st) {
        case Script.Data: // script data state: `<` is the less-than sign state
          if (c === 0x3c) st = Script.DataLt;
          p += 1;
          break;
        case Script.DataLt: // script data less-than sign state: `/` end tag open, `!` escape start, else reconsume in data
          if (c === 0x2f) {
            if (endTagAt(p + 1, 'script')) return p - 1;
            st = Script.Data;
            p += 1;
          } else if (c === 0x21) {
            st = Script.EscapeStart;
            p += 1;
          } else st = Script.Data;
          break;
        case Script.EscapeStart: // script data escape start state: `-` goes on, else reconsume in data
          if (c === 0x2d) {
            st = Script.EscapeStartDash;
            p += 1;
          } else st = Script.Data;
          break;
        case Script.EscapeStartDash: // script data escape start dash state: `-` is escaped dash dash, else reconsume in data
          if (c === 0x2d) {
            st = Script.EscapedDashDash;
            p += 1;
          } else st = Script.Data;
          break;
        case Script.Escaped: // script data escaped state
          if (c === 0x2d) st = Script.EscapedDash;
          else if (c === 0x3c) st = Script.EscapedLt;
          p += 1;
          break;
        case Script.EscapedDash: // script data escaped dash state
          st = c === 0x2d ? Script.EscapedDashDash : c === 0x3c ? Script.EscapedLt : Script.Escaped;
          p += 1;
          break;
        case Script.EscapedDashDash: // script data escaped dash dash state: `-` stays, `>` returns to script data
          if (c === 0x3c) st = Script.EscapedLt;
          else if (c === 0x3e) st = Script.Data;
          else if (c !== 0x2d) st = Script.Escaped;
          p += 1;
          break;
        case Script.EscapedLt: // script data escaped less-than sign state: `/` end tag open, a letter starts double escape
          if (c === 0x2f) {
            if (endTagAt(p + 1, 'script')) return p - 1;
            st = Script.Escaped;
            p += 1;
          } else if (isLetter(c)) {
            buf = '';
            st = Script.DoubleStart;
          } else st = Script.Escaped;
          break;
        case Script.DoubleStart: // script data double escape start state: a terminator after `script` enters double escape
          if (isSpace(c) || c === 0x2f || c === 0x3e) {
            st = buf === 'script' ? Script.DoubleEscaped : Script.Escaped;
            p += 1;
          } else if (isLetter(c)) {
            if (buf.length < 7) buf += String.fromCharCode(c | 0x20);
            p += 1;
          } else st = Script.Escaped;
          break;
        case Script.DoubleEscaped: // script data double escaped state
          if (c === 0x2d) st = Script.DoubleDash;
          else if (c === 0x3c) st = Script.DoubleLt;
          p += 1;
          break;
        case Script.DoubleDash: // script data double escaped dash state
          st = c === 0x2d ? Script.DoubleDashDash : c === 0x3c ? Script.DoubleLt : Script.DoubleEscaped;
          p += 1;
          break;
        case Script.DoubleDashDash: // script data double escaped dash dash state: `>` returns to script data
          if (c === 0x3c) st = Script.DoubleLt;
          else if (c === 0x3e) st = Script.Data;
          else if (c !== 0x2d) st = Script.DoubleEscaped;
          p += 1;
          break;
        case Script.DoubleLt: // script data double escaped less-than sign state: `/` starts double escape end
          if (c === 0x2f) {
            buf = '';
            st = Script.DoubleEnd;
            p += 1;
          } else st = Script.DoubleEscaped;
          break;
        default: // script data double escape end state: a terminator after `script` leaves double escape for escaped
          if (isSpace(c) || c === 0x2f || c === 0x3e) {
            st = buf === 'script' ? Script.Escaped : Script.DoubleEscaped;
            p += 1;
          } else if (isLetter(c)) {
            if (buf.length < 7) buf += String.fromCharCode(c | 0x20);
            p += 1;
          } else st = Script.DoubleEscaped;
      }
    }
    return -1;
  };

  /** The text of the HTML raw-text element `opener`, from `from`: tags in it are COUNTED, nothing is pushed or popped, and it
   *  ends exactly where the tokenizer's state does (`plaintext` never ends). At its end tag the opener is popped and the end
   *  tag's attribute section is walked. Returns where scanning goes on (the next `<`, or -1), or -2 past the tag limit. */
  const rawText = (opener: string, from: number): number => {
    const exit = opener === 'plaintext' ? -1 : opener === 'script' ? scriptExit(from) : textExit(opener, from);
    if (exit === -1) return countIn(from, n) ? -2 : -1;
    if (countIn(from, exit)) return -2;
    tags += 1;
    if (tags > MOCKUP_MAX_TAGS) return -2;
    popOne();
    const gt = attributeSection(exit + 2 + opener.length, false);
    if (gt === -1) return -2;
    return gt >= n ? -1 : text.indexOf('<', gt + 1);
  };

  let i = text.indexOf('<');
  while (i !== -1) {
    const c1 = text.charCodeAt(i + 1);
    const isEnd = c1 === 0x2f;
    const nameStart = i + (isEnd ? 2 : 1);
    const top = names.length - 1;

    if (top >= 0 && foreign[top] && RAW.has(names[top] as string)) {
      // A text-only foreign element: nothing but text, its own end tag, and a CDATA opener's text.
      if (cdataEnd !== -1 && i >= cdataEnd) cdataEnd = -1;
      if (!(isEnd || c1 === 0x21 || c1 === 0x3f || isLetter(c1))) {
        i = text.indexOf('<', i + 1);
        continue;
      }
      if (cdataEnd === -1 && c1 === 0x21 && text.startsWith('[CDATA[', i + 2)) {
        const close = text.indexOf(']]>', i + 9);
        cdataEnd = close === -1 ? n : close;
        i = text.indexOf('<', i + 9);
        continue;
      }
      if (cdataEnd === -1 && isEnd && isLetter(text.charCodeAt(nameStart))) {
        const stop = nameEnd(nameStart);
        if (lowerAscii(text.slice(nameStart, stop)) === names[top] && stop < n && isNameEnd(text.charCodeAt(stop))) {
          tags += 1;
          popOne();
          const limited = overLimit();
          if (limited !== null) return limited;
          const gt = attributeSection(stop, false);
          if (gt === -1) return refuse('too-many-tags');
          i = gt >= n ? -1 : text.indexOf('<', gt + 1);
          continue;
        }
      }
      if (startsTag(i)) tags += 1;
      return refuse('foreign-markup');
    }

    if (!isLetter(text.charCodeAt(nameStart))) {
      if (c1 === 0x21 && text.startsWith('--', i + 2)) {
        // A comment: it ends at once at `<!-->` or `<!--->`, else at the first `-->` or `--!>`, else at the end of the text.
        const from = i + 4;
        let bodyEnd = n;
        let end = n;
        const c4 = text.charCodeAt(from);
        if (c4 === 0x3e) {
          bodyEnd = from;
          end = from + 1;
        } else if (c4 === 0x2d && text.charCodeAt(from + 1) === 0x3e) {
          bodyEnd = from;
          end = from + 2;
        } else {
          const dashes = text.indexOf('-->', from);
          if (nextBang === -2 || (nextBang >= 0 && nextBang < from)) nextBang = text.indexOf('--!>', from);
          if (dashes !== -1 && (nextBang === -1 || dashes < nextBang)) {
            bodyEnd = dashes;
            end = dashes + 3;
          } else if (nextBang !== -1) {
            bodyEnd = nextBang;
            end = nextBang + 4;
          }
        }
        if (countIn(from, bodyEnd)) return refuse('too-many-tags');
        i = text.indexOf('<', end);
        continue;
      }
      if (c1 === 0x21 && foreignCount > 0 && text.startsWith('[CDATA[', i + 2)) {
        // With a foreign entry open the parser may or may not have left foreign content (a stale entry here is possible), and a
        // CDATA section there ends at `]]>` where a bogus comment ends at the first `>`: the scan cannot tell, so it refuses.
        return refuse('foreign-markup');
      }
      if (c1 === 0x21 || c1 === 0x3f || (isEnd && text.charCodeAt(nameStart) !== 0x3e && nameStart < n)) {
        // A bogus comment runs to the first `>` (`<!`, `<?`, `</` and a non-letter other than `>`).
        const gt = text.indexOf('>', i + 2);
        if (countIn(i + 2, gt === -1 ? n : gt)) return refuse('too-many-tags');
        i = gt === -1 ? -1 : text.indexOf('<', gt + 1);
        continue;
      }
      i = text.indexOf('<', isEnd && text.charCodeAt(nameStart) === 0x3e ? nameStart + 1 : i + 1);
      continue;
    }
    const stop = nameEnd(nameStart);
    const name = lowerAscii(text.slice(nameStart, stop));
    tags += 1;
    // The attribute section is walked first, for the tokenizer's self-closing flag.
    const gt = attributeSection(stop, !isEnd);
    if (gt === -1) return refuse('too-many-tags');
    if (gt === -3) return refuse('too-many-attributes');
    if (isEnd) {
      const ended = endTag(name);
      if (ended !== null) return ended;
    } else {
      const refusal = startTag(name, selfClosing, fontAttr);
      if (refusal !== null) return refusal;
    }
    const limited = overLimit();
    if (limited !== null) return limited;

    if (raw !== null) {
      // A raw-text element's text is its own tokenizer state: scanned exactly, nothing pushed, and it ends at its own end tag.
      const opener: string = raw;
      raw = null;
      const next = rawText(opener, gt >= n ? n : gt + 1);
      if (next === -2) return refuse('too-many-tags');
      const afterRaw = overLimit();
      if (afterRaw !== null) return afterRaw;
      i = next;
      continue;
    }
    i = gt >= n ? -1 : text.indexOf('<', gt + 1);
  }
  return { ok: true, depth: maxDepth, tags, formatting: maxFormatting };
}
