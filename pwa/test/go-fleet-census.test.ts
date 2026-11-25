// The go-fleet census (Overlord W1 home, Task 3; Review Focus 1): `/` is the console's home now, not the Fleet, so a door
// that means the Fleet must name `FLEET_PATH`. The scan fails on any of these in `pwa/src` outside the route table:
// - `navigate('/')`;
// - an `href` or a `to` of `/`;
// - in a file that marks a `go-fleet` door, a target spelled `'/'` (returned, or compared as the door's target).
// Its single-definition arm fails on a second declaration of `FLEET_PATH` anywhere in `pwa/src` (F7).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(import.meta.dirname, '..', 'src');
const ROUTE_TABLE = 'lib/routes.ts';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

/** The text with its comments blanked, so a comment that quotes an old spelling is not a finding. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const ROOT = String.raw`['"]\/['"]`;
const RULES: readonly { readonly name: string; readonly re: RegExp; readonly goFleetFilesOnly?: true }[] = [
  { name: "navigate('/')", re: new RegExp(String.raw`\bnavigate\(\s*${ROOT}`) },
  { name: 'an href of /', re: new RegExp(String.raw`\bhref\s*[=:]\s*\{?\s*${ROOT}`) },
  { name: 'a to of /', re: new RegExp(String.raw`\bto\s*[=:]\s*\{?\s*${ROOT}`) },
  { name: "a go-fleet target returned as '/'", re: new RegExp(String.raw`\breturn\s+${ROOT}`), goFleetFilesOnly: true },
  { name: "a go-fleet target compared with '/'", re: new RegExp(String.raw`[=!]==\s*${ROOT}|${ROOT}\s*[=!]==`), goFleetFilesOnly: true },
];
const GO_FLEET_MARK = /['"]go-fleet['"]/;
const FLEET_PATH_DECL = /\b(?:const|let|var)\s+FLEET_PATH\b|\bfunction\s+FLEET_PATH\b/;

/** What the census finds in one file's text, by rule name. */
export function goFleetFindings(rel: string, text: string): string[] {
  if (rel === ROUTE_TABLE) return [];
  const c = code(text);
  const marks = GO_FLEET_MARK.test(c);
  return RULES.filter((r) => (r.goFleetFilesOnly !== true || marks) && r.re.test(c)).map((r) => r.name);
}

const FILES = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join('/'), text: readFileSync(f, 'utf8') }));

describe('the go-fleet census (Overlord W1 home, Task 3)', () => {
  it('CONTROL: a planted navigate("/") and a planted root href are found; the Fleet\'s path is not', () => {
    expect(goFleetFindings('x.tsx', "onClick={() => navigate('/')}")).toEqual(["navigate('/')"]);
    expect(goFleetFindings('x.tsx', 'onClick={() => navigate("/")}')).toEqual(["navigate('/')"]);
    expect(goFleetFindings('x.tsx', '<a href="/">home</a>')).toEqual(['an href of /']);
    expect(goFleetFindings('x.tsx', "<Back to={'/'} label=\"Back\" />")).toEqual(['a to of /']);
    expect(goFleetFindings('x.tsx', 'onClick={() => navigate(FLEET_PATH)}')).toEqual([]);
    expect(goFleetFindings('x.tsx', "// was navigate('/') before the home\nnavigate(FLEET_PATH);")).toEqual([]);
  });
  it("CONTROL: a go-fleet door whose target is '/' is found; the same text in a file with no go-fleet mark is not", () => {
    const docs = "function up() { return '/'; }\nconst b = { ...(up() === '/' ? doorMark('go-fleet') : {}) };";
    expect(goFleetFindings('x.tsx', docs)).toEqual(["a go-fleet target returned as '/'", "a go-fleet target compared with '/'"]);
    expect(goFleetFindings('x.tsx', "if (e.key !== '/') return;")).toEqual([]);
    expect(goFleetFindings('x.tsx', "up === FLEET_PATH ? doorMark('go-fleet') : {}")).toEqual([]);
  });
  it('CONTROL: the route table is the one place that may spell the root', () => {
    expect(goFleetFindings(ROUTE_TABLE, "{ id: 'home', pattern: /^\\/$/, path: '/' }; navigate('/')")).toEqual([]);
  });
  it("no door in pwa/src navigates to '/' meaning the Fleet", () => {
    const found = FILES.flatMap((f) => goFleetFindings(f.rel, f.text).map((r) => `${f.rel}: ${r}`));
    expect(found).toEqual([]);
  });
  it('CONTROL: the single-definition arm sees a planted second FLEET_PATH', () => {
    expect(FLEET_PATH_DECL.test("const FLEET_PATH: string = ROUTES.find((r) => r.id === 'fleet')?.path ?? '/';")).toBe(true);
    expect(FLEET_PATH_DECL.test("import { FLEET_PATH } from '../lib/routes';")).toBe(false);
  });
  it('FLEET_PATH is declared in the route table alone (F7)', () => {
    expect(FILES.filter((f) => FLEET_PATH_DECL.test(code(f.text))).map((f) => f.rel)).toEqual([ROUTE_TABLE]);
  });
});
