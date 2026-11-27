// Writes sweep-cases.jsonl: graph-sweep.json texts and repository sources for the census read's jq program
// (`_hook_graph_card`'s rc-1 arm), one {"file": <text>, "src": <string>} a line. gen-sweep-golden.sh runs real jq over
// them; cards_test.go's TestSweepRowMeasured holds attention.SweepRow to what it printed.
import fs from 'node:fs';

const S = '/r/repo/.git';
const ok = { source: S, outcome: 'refused', reason: 'too big' };
const vals = [null, false, true, 0, 1, '', 'x', [], {}, [ok], { a: ok }];
const cases = [];
const add = (file, src = S) => cases.push({ file: typeof file === 'string' ? file : JSON.stringify(file), src });
add({ passes: [{ repos: [ok] }] });
add({ passes: [{ repos: [ok] }] }, '');
add({ passes: [{ repos: [ok] }] }, '/r/other/.git');
for (const v of vals) add({ passes: v });
for (const v of vals) add({ passes: [{ repos: [ok] }, v] });
for (const v of vals) add({ passes: [{ repos: v }] });
for (const v of vals) { add({ passes: [{ repos: [v, ok] }] }); add({ passes: [{ repos: [v, ok] }] }, ''); }
for (const v of vals) add({ passes: [{ repos: [{ ...ok, reason: v }] }] });
for (const v of vals) add({ passes: [{ repos: [{ ...ok, outcome: v }] }] });
for (const v of vals) add({ passes: [{ repos: [{ ...ok, source: v }] }] });
add({ passes: [{ repos: [{ ...ok, reason: '' }, { ...ok, reason: 'second' }] }] });
add({ passes: [{ repos: [{ ...ok, reason: 'first' }, { ...ok, reason: 'second' }] }] });
add({ passes: [{ repos: [{ ...ok, reason: 'line one\nline two\n\n' }] }] });
add({ passes: [{ repos: [{ ...ok, reason: 'nul\u0000inside' }] }] });
add({ passes: [{ repos: [{ ...ok, reason: `é…${'x'.repeat(500)}` }] }] });
add(`${JSON.stringify({ passes: [{ repos: [ok] }] })}\n${JSON.stringify({ passes: [{ repos: [{ ...ok, reason: 'again' }] }] })}`);
add(`${JSON.stringify({ passes: [{ repos: [ok] }] })} 5`);
add(`${JSON.stringify({ passes: [{ repos: [ok] }] })} {`);
add(`${JSON.stringify({ passes: [{ repos: [ok] }] })} garbage`);
add(`${JSON.stringify({ passes: [{ repos: [ok] }] })}\n{"passes": 3}`);
add('');
add('  \n ');
add('null');
add('[]');
add('"s"');
add({ passes: [{ repos: [ok] }], other: 1 });
add({ passes: [{ repos: [{ source: S, reason: 'no outcome' }] }] });
add({ passes: [{}] });
add({});
add({ passes: [{ repos: [ok] }] }, '/r/reépo/.git');
add({ passes: [{ repos: [{ ...ok, source: '/r/reépo/.git' }] }] }, '/r/reépo/.git');
fs.writeFileSync(new URL('./sweep-cases.jsonl', import.meta.url), `${cases.map((c) => JSON.stringify(c)).join('\n')}\n`);
console.log(cases.length);
