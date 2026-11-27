// Writes the glob words `pmglob` hands to g2re and then to Oniguruma (gen-guard-golden.sh measures each against the five
// names of the private store): one JSON string a line, bracket-heavy, so the class grammar Oniguruma reads (a leading
// `]`, a nested `[`, POSIX names, ranges, `[!`, braces around and across a class) is where a divergence shows.
const out = new Set();
const fixed = ['*', '?', 'op*', 'operator-model.d?', '*.db', '*.torn', 'p*.l?g', '[o]perator-model.db', '[!a]*', '[^a]*', '[a-', '[]', '[]]',
  '[]a]*', '[^]a]*', '[*]', '[[]*', '[[:alpha:]]*', '[[:foo:]]*', '[[:lower:]-]*', '[z-a]*', '[a-z-]*', '[--z]*', '[\\]]*', '[a\\-z]*',
  '{operator,x}-model.db', '{{a}}', 'x{a', '{a,{b,c}}*', '{[a,b]}*', '[{a,b}]*', '{a]b}*', '[{]a}*', '[(]*', '[|]*', '*[', '*]', '[^/]*',
  '[o-p]rivacy-journal.*', 'privacy-journal.[lt]*', 'operator-model.db-[sw]*', 'operator-model.db{,-wal}', 'p[[]*', '[[]]*', '[a[b]c]*',
  '[a[^b]c]*', '[[^a]]*', '[^[a]]*', '[a-[b]]*', '[!]*', '[!!]*', '[.]*', '[\\.]*', '*\\*', '*\\', '[\\', 'o\\*', '[*-z]*', '[+]*',
  '[$]*', '[^^]*', '[a^]*', '{}*', '{,}*', '{,,}*', '*{', '*}', '}{*', '[[:alpha:][:digit:]-]*', '[[:alpha:]', '[[:alpha:]*', '[[.a.]]*',
  '[[=a=]]*', '[:alpha:]*', '[[:alpha:]-z]*', '[a-[:alpha:]]*', '[[:^alpha:]]*', '[[:^digit:]]*', '[[:x]*', '[[:alpha]*', '[[:alpha:]]]*',
  '[[:aaaaaaaaaaaaaaaaaaa:]]*', '[[:aaaaaaaaaaaaaaaaaaaa:]]*', '[[:aaaaaaaaaaaaaaaaaaaaa:]]*', '[[:aaaaaaaaaaaaaaaaaaaaaa:]]*', '[[:a]b:]]*',
  '[a-b-c]*', '[a-d-]*', '[]-a]*', '[]-]*', '[^]-a]*', '[]\\]]*', '[\\]a]*', '[!]a]*', '[!][]*', '[[:]*', '[[::]]*', '[[:alpha:][]*', '[o-[]*',
  '[[:a:b:{?,operator}{[,l}[]@-?][:^x:]', '[[-o]*', '[a-\\]*', '[[:al:]]*', '[[:a:b:]]*', '[[:é1:]]*', '[[:ɐ:]]*', '[[:Ⅰ:]]*', '[[:a̧:]]*', '[[:١:]]*', '[[:alpha :]]*', '[[:a-:]]*',
  '[[:alpha:x:]]*', '[[:a:]x:]]*', '[[::]]*', '[[!:alpha:]]*', '[!]-]*', '[\\-a]*', '{[!a],b}*', '{a,b}{c,d}*', '[a-z]perator-model.db', '[!a-z]*', '[[:punct:]]*', '[[:word:]-]*', 'p?ivacy-journal.l?g', '?????????????????', 'operator-model.db*', '*-*', '*.*.*', 'é*', '[é-ö]*', '[o-é]*'];
for (const f of fixed) out.add(f);
let seed = 0x9e3779b9;
const rnd = (n) => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
const T = ['[', ']', '!', '^', '-', '*', '?', '{', '}', ',', '\\', '.', '$', '+', ':', '[:alpha:]', '[:lower:]', '[:x:]', 'o', 'p', 'e',
  'r', 'a', 't', 'm', 'd', 'l', 'b', 'w', 's', 'h', 'i', 'v', 'c', 'y', 'j', 'u', 'n', 'g', 'z', 'operator', 'privacy', 'model', 'journal', 'db'];
while (out.size < 12000) {
  let g = '';
  const n = 1 + rnd(9);
  for (let k = 0; k < n; k++) g += T[rnd(T.length)];
  if (/[*?[{]/.test(g)) out.add(g);
}
process.stdout.write([...out].map((g) => `${JSON.stringify(g)}\n`).join(''));
