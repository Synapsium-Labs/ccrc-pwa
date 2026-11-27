// Writes the strings FABLE_RE's golden is measured over, one JSON string a line: hand-made edges, a seeded walk over the
// tokens the pattern reads, and a structured walk (the word, its operator, quotes, blanks of every kind, a run of word
// characters, and a word that holds fable or nearly does). Code points are spelled by number so the file holds no invisible
// character. Deterministic.
//
// The file is public: a drawn string that the private-name checker flags (`hitsIn`, the class topology-clean scans every
// tracked line with, and `pairHits` across a line break) is refused and drawn again, so each walk keeps its count. The
// seeded walk joins `claude` with SUP2 and other tokens, and some of those joins fold into a hashed name (final review,
// critical 1).
import { PRIVATE_NAMES, hitsIn, pairHits } from '../../../../../shared/private-names.mjs';
const FILE = 'core/internal/domain/attention/testdata/fable-cases.jsonl';
const c = (...n) => String.fromCodePoint(...n);
const NBSP = c(0xa0), EM = c(0x2003), IDEO = c(0x3000), NEL = c(0x85), LS = c(0x2028), ACUTE = c(0x301), EACUTE = c(0xe9), ARDIGIT = c(0x660), ROMAN = c(0x2160), CIRC = c(0x24b6), SUP2 = c(0xb2), ORD = c(0xaa), ZWJ = c(0x200d);
const out = [];
const lines = [];
/** Whether `s` may go in the file after what is already there: no hit on its own line, none across the break before it. */
const clean = (s) => {
  const line = JSON.stringify(s);
  if (hitsIn(line, FILE, PRIVATE_NAMES).length > 0) return false;
  if (lines.length > 0 && pairHits(lines[lines.length - 1], line, FILE, PRIVATE_NAMES).length > 0) return false;
  return true;
};
const push = (s) => { if (!clean(s)) return false; out.push(s); lines.push(JSON.stringify(s)); return true; };
const hand = ['model: "fable"', "model:'fable'", 'model = `Fable`', 'model(fable)', 'claude-fable-5', 'CLAUDE-FABLE', 'model : "foo/fable"', 'model: "a-b.c/fable"', 'my model,fable',
  `model:${NBSP}fable`, 'model: xfable', 'xmodel: fable', 'modelx: fable', 'model: opus // fable', 'a fable about a fox', 'models: fable', 'model: "a b"', 'Model: fable', 'model', 'model: "x fable"',
  '_model: fable', `${EACUTE}model: fable`, '1model: fable', `a${ACUTE}model: fable`, `${EM}model:fable`, `model:${IDEO}fable`, `model:${LS}"fable`, `model: e${ACUTE}fable`, `model: ${EACUTE}fable`, `model: fabl${EACUTE}`,
  'model:\n fable', 'model: ""fable', 'model: `"fable', 'model: f-a-b-l-e', 'model: ./fable', 'model: _fable_', 'model:fable'];
for (const h of hand) if (!push(h)) throw new Error(`a hand-made case is flagged as a private name: line ${out.length + 1}`);
let a = 0x2545f491;
const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const toks = ['model', 'Model', 'model', ':', '=', ',', '(', ' ', ' ', NBSP, EM, IDEO, NEL, LS, '\t', '\n', "'", '"', '`', 'fable', 'Fable', 'FABLE', 'fabl', 'e', 'x', '-', '.', '/', '_',
  'claude-', 'claude', '-fable', EACUTE, ACUTE, '1', ARDIGIT, ORD, ROMAN, CIRC, SUP2, ZWJ, '$', '{', 'm', 'odel'];
for (let n = 0; n < 3000;) {
  const len = 1 + Math.floor(rnd() * 14);
  let s = '';
  for (let i = 0; i < len; i++) s += pick(toks);
  if (push(s)) n++;
}
const gaps = ['', ' ', NBSP, IDEO, '\t', '\n'];
const ops = [':', '=', ',', '(', ';', ' '];
const qs = ['', '"', "'", '`'];
const runs = ['', 'x', 'a-b/', './', EACUTE, ACUTE, ' ', '$', ARDIGIT, ROMAN, 'claude-'];
const fabs = ['fable', 'Fable', 'FABLE', 'fabl', `fabl${EACUTE}`, 'fab le', ''];
const pre = ['', ' ', 'x', '_', EACUTE, ACUTE, '.', '(', EM, '1'];
for (let n = 0; n < 3000;) if (push(pick(pre) + 'model' + pick(qs) + pick(gaps) + pick(ops) + pick(gaps) + pick(qs) + pick(runs) + pick(fabs) + pick(['', '"', ' x']))) n++;
process.stdout.write(lines.join('\n') + '\n');
