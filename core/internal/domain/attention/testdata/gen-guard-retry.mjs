// Writes the glob words of the retry-limit sweep (task 5 review F9): pmglob's `try test(…) catch true` reads an
// Oniguruma retry-limit error as a match, so where jq's search of `^(?:<g2re>)$` runs out of retries, bash denies.
// gen-guard-golden.sh measures each word against the five names (guard-retry.golden); onigRetryRisk in
// forbiddenglob.go is held to fire on every word jq errors on. One JSON string a line: stars before and after tails,
// alternations of several widths, classes, `?`, and letters between stars.
const out = new Set();
const TAILS = ['Q', 'b', 'db', '.db', 'log', '{a,b}Q', '{a,b}', '{a,b,c}Q', '{a,b,c,d,e,f}Q', '{ab,cd}Q', '{a,b}{c,d}Q', '{Q}', '{,a}Q',
  '?Q', '??Q', '[ab]Q', '[!a]Q', '[a-z]Q', 'aQ', 'Qa', 'x{a,b}', '{a,b}x', '{a,b}', '{operator,privacy}Q', '-{wal,shm}Q', '.{log,torn}Q',
  '[[:alpha:]]Q', '{a,b}*Q', '{a,b}?', ''];
for (let k = 1; k <= 40; k += k < 20 ? 1 : 4) {
  for (const t of TAILS) {
    out.add('*'.repeat(k) + t);
    out.add(t + '*'.repeat(k));
  }
  out.add('*?'.repeat(k) + 'Q');
  out.add('?*'.repeat(k) + '{a,b}Q');
  out.add('*o'.repeat(k) + 'Q');
  out.add('*a'.repeat(k) + '{a,b}Q');
  out.add('[!/]*'.repeat(k) + '{a,b}Q');
  out.add('o' + '*'.repeat(k) + '{a,b}Q');
  out.add('*'.repeat(k) + '{a,b}' + '*'.repeat(k) + 'Q');
  out.add('{' + 'a,'.repeat(k) + 'b}' + '*'.repeat(Math.min(k, 12)) + 'Q');
}
// the alternation's width and count against fewer stars (5 to 7: a 30- or 60-way alternation errs with 7 or 6)
const alts = (n) => `{${Array.from({ length: n }, (_, i) => `a${i}`).join(',')}}`;
for (const k of [4, 5, 6, 7]) {
  const st = '*'.repeat(k);
  for (const x of [st + alts(10) + 'Q', st + alts(30) + 'Q', st + alts(60) + 'Q', st + alts(120) + 'Q', st + '{a,b}{c,d}{e,f}{g,h}Q', st + '{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}Q',
    st + '?????Q', st + '[ab][cd][ef]Q', st + '{a,b}?{c,d}?Q', '*{a,b}'.repeat(k) + 'Q', '*?'.repeat(k) + '{a,b}Q', st + '{o,p}*Q', '{a,b}' + st + '{c,d}Q', st + '{a,b}' + st + 'Q']) out.add(x);
}
// review round 2's three shapes, across 4 to 20 stars: a letter (a store-name letter, or one no name holds) before,
// after or inside the run (and `?`, `??`, `o?` splits), before a tail of a literal no name has, an alternation of 2 to
// 4 arms, or a class
const LETTERS = ['o', 'r', 'e', 'p', 'a', 'l', '-', '.', 'd', 'b', 'j', 'g', 's', 'w', 'Q', 'x', 'Z', '0'];
const SPLITS = ['?', '??', 'o', 'o?', 'r', '-', 'Q', 'x?'];
const RTAILS = ['Q', 'x', '[0-9]', '', '?Q', 'o?Q', '{a,b}Q', '{x,y}', '{a,b,c}Q', '{a,b,c,d}', '[ab]Q', '[o-p]', '[!x]'];
for (let k = 4; k <= 20; k++) {
  for (const t of RTAILS) {
    for (const l of LETTERS) {
      out.add(l + '*'.repeat(k) + t);
      out.add('*'.repeat(k) + l + t);
      out.add('*' + l + '*'.repeat(k - 1) + t);
    }
    for (const sp of SPLITS) {
      for (let s = 1; s < k; s += Math.max(1, Math.floor(k / 4))) out.add('*'.repeat(s) + sp + '*'.repeat(k - s) + t);
    }
  }
}
process.stdout.write([...out].map((g) => `${JSON.stringify(g)}\n`).join(''));
