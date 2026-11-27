// The in-walls loader's fetch shim (X2 P6.2, plan 2026-11-18-native-docs-parity Task P6.2; spec 4.8). Ring L1: one constant
// and one pure builder, no DOM, no I/O. The build (`load.ts`) writes its text as the first script of the page's head, before
// every script of the page's own, when the page names at least one planned sibling to fetch.
//
// It is a CONVENIENCE, NEVER A WALL. It answers `fetch` of a planned sibling from the bytes the loader read, and hands every
// other call to the browser's own `fetch` unchanged, which fails as it did before this loader: the frame's policy
// (`MOCKUP_CSP`) has no `connect-src`, so it falls back to `default-src 'none'`. Page script can reach the browser's own
// `fetch` past this shim, and nothing rests on it for safety; the policy and the sandbox are the walls.
//
// What it compares: the request's URL against each planned literal's URL, both resolved against `document.baseURI` with the
// query and the fragment set aside, for a GET or HEAD only. A base it cannot resolve against matches nothing, so every call
// then goes to the browser's own `fetch`. It answers on a later task, never in the calling script's own microtasks, as a
// network answer would: measured in Chromium, an answer resolved at once reached a page's handler while the parser was still
// in the head, before `document.body` existed.
import { scriptJson } from './modules';

/** The shim's first characters, by which a test finds it. */
export const MOCKUP_FETCH_SHIM_MARK = '(function(t){';

/** The shim's code around its table: `t.f` is the files (`[mime, base64]`), `t.k` the names (`[literal, file index]`). */
const SHIM_HEAD = `${MOCKUP_FETCH_SHIM_MARK}var F=window.fetch,b=document.baseURI,m={};`
  + "function n(u){var x=new URL(u,b);return x.origin+x.pathname;}"
  + "for(var i=0;i<t.k.length;i++){try{m[n(t.k[i][0])]=t.f[t.k[i][1]];}catch(e){}}"
  + "window.fetch=function(r,o){try{var u=typeof r==='string'?r:(r&&typeof r.url==='string'?r.url:String(r));"
  + "var v=String((o&&o.method)||(r&&typeof r==='object'&&r.method)||'GET').toUpperCase();"
  + "var e=(v==='GET'||v==='HEAD')?m[n(u)]:undefined;"
  + "if(e){var s=atob(e[1]),a=new Uint8Array(s.length);for(var j=0;j<s.length;j++)a[j]=s.charCodeAt(j);"
  + "return new Promise(function(y){setTimeout(function(){y(new Response(v==='HEAD'?null:a,{status:200,headers:{'Content-Type':e[0]}}));},0);});}}catch(x){}"
  + "return F.apply(this,arguments);};})(";
const SHIM_TAIL = ');';

/** One fetched sibling: its type (`MOCKUP_FETCH_MIME`'s) and its bytes as base64. */
export interface ShimFile {
  readonly mime: string;
  readonly b64: string;
}

/** The shim's text: its code with the table written by `scriptJson`, so no page-controlled name or byte can end the
 *  script element it sits in. `names` maps each literal the page wrote to an index into `files`. */
export function mockupFetchShim(files: readonly ShimFile[], names: readonly (readonly [string, number])[]): string {
  return SHIM_HEAD + scriptJson({ f: files.map((f) => [f.mime, f.b64]), k: names }) + SHIM_TAIL;
}

/** The characters the shim's text holds besides its entries: what the build charges against the page's cap for the first
 *  entry. */
export const MOCKUP_FETCH_SHIM_BASE_CHARS = mockupFetchShim([], []).length + '<script></script>'.length;

/** What one file entry adds to the shim's text, at most (its comma included). */
export const shimFileChars = (f: ShimFile): number => scriptJson([f.mime, f.b64]).length + 1;

/** What one name entry adds to the shim's text, at most (its comma included). */
export const shimNameChars = (name: string, index: number): number => scriptJson([name, index]).length + 1;
