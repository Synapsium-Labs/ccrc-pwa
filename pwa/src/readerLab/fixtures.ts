// The reader lab's pages (native Docs reader, the reader lab plan of 2026-11-03, Task 9, refinement (o)). Ring L1: text.
// The six figures have the node and edge counts of the six figures of a real six-figure design in this repository (the
// path-identity design), relabelled with neutral words, so every phone draws the same pages. `hostileDoc` rebuilds the
// desktop leg's two hostile figures with this run's door URLs as their targets.

const fence = (body: string): string => '```mermaid\n' + body + '\n```\n\n';
const lines = (...l: string[]): string => l.join('\n');

/** The six figures, in order. */
export const LAB_FIGURES: readonly string[] = [
  fence(lines('flowchart LR',
    '  A["Source one<br/>any name"] --> S["Composer<br/>id, then three flags"]',
    '  B["Route parameter"] --> S',
    '  C["Run rows<br/>a list read"] --> S',
    '  S --> V1["Release, archive,<br/>restore, stop<br/>bind an id, no token"]',
    '  S --> V2["Reclaim, expire<br/>bind an id and a token,<br/>then a tree path"]',
    '  S --> V3["Collect<br/>binds an id and a token,<br/>then a leaf"]',
    '  W["A switch<br/>marker or setting"] -.-> V3',
    '  V2 --> T1["Remove the tree<br/>the path reaches"]',
    '  V2 --> T2["Remove the leaf<br/>and its clips"]',
    '  V3 --> T2')),
  fence(lines('flowchart LR',
    '  A["Name with a suffix"] --> B["Server: verb, flags<br/>surface, actor"]',
    '  B --> C["Loop: one flag eats the next"]',
    '  C --> D["A word left over<br/>bound as the id"]',
    '  D --> E{"Row with that id exists?"}',
    '  E -- "no, today" --> F["Refused: unknown id"]',
    '  E -- "if ever yes" --> G["Acts on the wrong row"]')),
  fence(lines('flowchart TD',
    '  A["The tail proves it absent"] --> B{"Witness parses?"}',
    '  B -- "no" --> K1["Keep the witness<br/>unmeasured"]',
    '  B -- "yes" --> C{"Device equals<br/>the witness device?"}',
    '  C -- "no or unreadable" --> K2["Keep the witness<br/>unmeasured: device"]',
    '  C -- "yes" --> D{"A slot stands,<br/>or the list is unreadable?"}',
    '  D -- "yes" --> K3["Keep the witness, warn"]',
    '  D -- "no" --> E["Compare and drop<br/>exactly that generation"]',
    '  E -- "same generation dropped" --> F["Witness gone"]',
    '  E -- "changed or unmeasured" --> K4["Restore or keep<br/>the witness"]')),
  fence(lines('flowchart TD',
    '  L["Ladder rows<br/>ancestry, identity,<br/>mount export, link walk,<br/>one batched call with a deadline"] --> W["Bounded wait after a stop<br/>a refusal-only probe"]',
    '  W --> T["Tombstone and row agree"]',
    '  T --> O["Ownership, asked once<br/>main checkout refused;<br/>record the identity"]',
    '  O --> P["Settle pin"]',
    '  P --> N["Nested children, innermost first"]',
    '  N --> NS["Each standing nested tree<br/>mount check before the keep<br/>and again before removal<br/>identity, fresh rows,<br/>mount map and probe at both"]',
    '  NS --> NG["Remove that nested tree"]',
    '  NG --> S4["Step four: link, directory, keep<br/>the same rechecks"]',
    '  S4 --> G["Remove the child tree"]',
    '  G --> S6["Step six: the leaves<br/>device and slot before a drop;<br/>the mount question"]')),
  fence(lines('flowchart TD',
    '  A["Lane job: the final listing returns<br/>after the job\'s last await"] --> B{"Listing ok, epoch unchanged,<br/>and no pause file?"}',
    '  B -- "no" --> S1["Stopped: compose nothing"]',
    '  B -- "yes" --> C{"Both capabilities<br/>present?"}',
    '  C -- "no" --> S2["Not running: compose nothing"]',
    '  C -- "yes" --> D{"Setting row and journal<br/>measurable?"}',
    '  D -- "no" --> S3["Safety-stopped: compose nothing"]',
    '  D -- "yes" --> E{"Exact seed with no journal,<br/>or the generations agree?"}',
    '  E -- "no" --> S3',
    '  E -- "yes" --> F{"Marker stands and<br/>its latch is unset?"}',
    '  F -- "yes" --> LV1["Live: armed by the marker"]',
    '  F -- "no" --> G{"Choice is live,<br/>the node is known,<br/>and the stored node matches?"}',
    '  G -- "yes" --> LV2["Live: armed in a setting"]',
    '  G -- "no" --> SH["Shadowed: record only"]')),
  fence(lines('flowchart LR',
    '  W0["Wave zero, docs"] --> W3',
    '  SW["Switch<br/>after its rulings"] --> DONE["Deployed"]',
    '  W1a["Wave one, server gate<br/>after two reviews"] --> DONE',
    '  M["An earlier change merges"] --> W1b["Wave one, ids"]',
    '  W1b --> W2["Wave two, absences and mounts"]',
    '  W2 --> W3["Wave three, identity"]',
    '  W3 --> W4["Wave four, optional"]')),
];

const prose = (title: string): string =>
  `# ${title}\n\nA page the reader lab draws on this device, so the console's stall while it draws can be timed.\n\n`;

/** The pages the lab mounts one after another: none, a trivial figure, each figure alone, then all six. */
export const LAB_PAGES: readonly { readonly label: string; readonly text: string }[] = [
  { label: 'none', text: `${prose('No figures')}Only prose, so this mount pays for the reader and nothing else.\n` },
  { label: 'trivial', text: prose('One trivial figure') + fence(lines('flowchart LR', '  A[Start] --> B[End]')) },
  ...LAB_FIGURES.map((f, i) => ({ label: `f${i + 1}`, text: prose(`Figure ${i + 1}`) + f })),
  { label: 'all', text: prose('All six figures') + LAB_FIGURES.join('') },
];

// The gate-sized page (X2 P6.1 Step 0b). Markdown above the render gate is read in parts of at most the gate, so the lab
// times one part of exactly the gate: a dense page with every block a real doc has (headings of three levels, tables,
// bullet and numbered lists, fenced code with an info string, block quotes and prose) and no figure, so the number is
// the reader's own and not Mermaid's. It is ASCII, so its length in characters is its length in UTF-8 bytes, and it is
// built the same way every time. It is no member of `LAB_PAGES`: the nine pages' mounts and the result's gap line stay
// as they were, and the run times this page apart from them (`run.ts`).

/** The page's size: `DOCS_RENDER_GATE_BYTES` (`lib/markdownLimits.ts`), written here because this file imports nothing;
 *  `reader-lab-gate.test.ts` holds the two together. */
const GATE_PAGE_BYTES = 524288;

const TOPICS = ['river', 'harbour', 'orchard', 'lantern', 'meadow', 'compass', 'granite', 'willow', 'ledger', 'beacon', 'quarry', 'thicket'];
const VERBS = ['gathers', 'carries', 'measures', 'follows', 'records', 'shelters', 'crosses', 'repairs'];

/** One section of the page, the same shape each time with its own words: a `##` heading, prose, a `###` heading over a
 *  bullet list, a numbered list, a table, a fenced code block and a block quote. */
function gateSection(i: number): string {
  const a = TOPICS[i % TOPICS.length]!;
  const b = TOPICS[(i * 5 + 3) % TOPICS.length]!;
  const v = VERBS[i % VERBS.length]!;
  const n = i + 1;
  return [
    `## Section ${n}: the ${a} and the ${b}`,
    '',
    `The ${a} ${v} what the ${b} leaves behind, and the notes of section ${n} say how. A reader goes over the page line by `
      + `line, so each paragraph is plain prose with a **bold** word, an *emphasised* one and a \`code span\` in it.`,
    '',
    `### Notes ${n}`,
    '',
    `- The ${a} is counted once for each pass, number ${n}.`,
    `- The ${b} keeps its own tally, with \`tally_${n}\` as its name.`,
    `  - A nested point about the ${a}, which a list inside a list carries.`,
    `- Both are checked against the same rule before the next section starts.`,
    '',
    `1. Read the ${a} entry for section ${n}.`,
    `2. Compare it with the ${b} entry beside it.`,
    `3. Write down the difference, or write that there is none.`,
    '',
    `| Name | Count | Note |`,
    `| --- | ---: | :--- |`,
    `| ${a}-${n} | ${n * 3} | first pass |`,
    `| ${b}-${n} | ${n * 7 % 1000} | second pass |`,
    `| total-${n} | ${n * 10 % 1000} | both passes |`,
    '',
    '```ts',
    `export function tally${n}(values: readonly number[]): number {`,
    `  let total = ${n};`,
    '  for (const value of values) total += value;',
    '  return total;',
    '}',
    '```',
    '',
    `> The ${a} ${v} and the ${b} waits. Nothing in section ${n} asks for more than that.`,
    '',
    '',
  ].join('\n');
}

/** The gate-sized page: a `#` heading over each forty sections, sections while the next one fits, then plain closing prose
 *  that brings the page to exactly `bytes`. The closing prose is one paragraph under its own heading, so no fence is ever
 *  cut. */
function gatePage(bytes: number): string {
  let text = '';
  for (let i = 0; ; i += 1) {
    const part = (i % 40 === 0 ? `# Part ${i / 40 + 1}\n\nA part of the gate-sized page, whose sections follow.\n\n` : '') + gateSection(i);
    if (text.length + part.length > bytes - 96) break;
    text += part;
  }
  const head = '## Closing words\n\n';
  const room = bytes - text.length - head.length - 1;
  return `${text}${head}${closingProse(room)}\n`;
}

const CLOSING_SENTENCE = 'The page ends in plain prose, which only brings it to its size. ';
/** Words of two to six letters, by length, that the last sentence is made of. */
const CLOSING_WORDS = ['so', 'and', 'also', 'which', 'though'];

/** Plain prose of exactly `room` characters (at least 24) that ends on a whole sentence: whole copies of one sentence, then a
 *  last sentence of a start word and as many small words as it takes, so the length is exact whatever the room. */
function closingProse(room: number): string {
  const copies = Math.max(0, Math.floor((room - 24) / CLOSING_SENTENCE.length));
  let left = room - copies * CLOSING_SENTENCE.length - 'Done.'.length;
  let last = 'Done';
  while (left > 0) {
    // The next word is the longest one that leaves nothing, or room for another word of at least two letters.
    const w = [...CLOSING_WORDS].reverse().find((x) => left - (x.length + 1) === 0 || left - (x.length + 1) >= 3)!;
    last += ` ${w}`;
    left -= w.length + 1;
  }
  return `${CLOSING_SENTENCE.repeat(copies)}${last}.`;
}

/** The gate page, for the run's gate timing: not one of `LAB_PAGES`. */
export const LAB_GATE_PAGE: { readonly label: 'gate'; readonly text: string } = { label: 'gate', text: gatePage(GATE_PAGE_BYTES) };

/** Two hostile figures (the desktop leg's): a directive that tries to restyle the frame, and one that loosens Mermaid's
 *  security level to load an image and bind a click, both aimed at this run's door through `base`. */
export function hostileDoc(base: string): string {
  return '# Hostile figures\n\nTwo figures whose directives try to restyle the frame and to reach the door.\n\n'
    + fence(lines(
      '%%{init: {"themeCSS": ".node rect { fill: magenta !important; } /* reader-lab-hostile */", "theme": "base"}}%%',
      'flowchart LR', '  H1[Hostile] --> H2[Node]'))
    + fence(lines(
      '%%{init: {"securityLevel": "loose", "flowchart": {"htmlLabels": true}}}%%',
      'flowchart LR', `  L1["<img src='${base}hostile-img'>"] --> L2[Link]`, `  click L2 "${base}hostile-click"`));
}
