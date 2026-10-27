// ccd's docs redactor as one line-oriented process (D-7077; ARCH-67; W5 Task C5h, design note §3.1). The rules live in
// the module imported below, never here: this file only reads requests and writes answers.
//
// `node redact-cli.mjs --profile <name>`: exactly two arguments, a profile the module holds that needs no caller shapes
// (so never `egress`); anything else exits 2 with nothing on stdout. stdin is newline-delimited JSON strings; each line is
// answered with the JSON string of the redacted text and a newline as soon as it is read. A line that is not one JSON
// string exits 2 at once. End of input exits 0 when no partial line is left, else 2.
//
// ITS SHAPE IS FIXED BY HOW CCD STARTS IT. ccd's docs helper reads this file and the rule module once, checks both
// against the digests its installed body pins, and hands node these bytes with the one import specifier below rewritten
// to a `data:` URL (`node --input-type=module -e <source>`), so node opens no file. So this file runs at top level, reads
// no import metadata and never compares its own argv path (under `-e` that is a label), and the specifier is spelled
// exactly once in the whole file, on its one import line (`redact-cli.test.ts` pins all of it). No `node:` builtin is
// imported: `process` is a global.
import { redact } from './redact.mjs';

const args = process.argv.slice(2);
const profile = args.length === 2 && args[0] === '--profile' ? args[1] : null;
let usable = profile !== null && profile !== 'egress';
if (usable) {
  try {
    redact(profile, '');
  } catch {
    usable = false;
  }
}

if (!usable) {
  process.exitCode = 2;
} else {
  let buf = '';
  let from = 0;
  let done = false;
  const refuse = () => {
    done = true;
    process.exitCode = 2;
    process.stdin.destroy();
  };
  process.stdout.on('error', refuse);
  process.stdin.on('error', refuse);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (done) return;
    buf += chunk;
    let nl;
    // The scan starts where the previous chunk ended, so a large request costs one pass, not one per chunk.
    while ((nl = buf.indexOf('\n', from)) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      from = 0;
      let s;
      try {
        s = JSON.parse(line);
      } catch {
        refuse();
        return;
      }
      if (typeof s !== 'string') {
        refuse();
        return;
      }
      process.stdout.write(`${JSON.stringify(redact(profile, s))}\n`);
    }
    from = buf.length;
  });
  process.stdin.on('end', () => {
    if (!done) process.exitCode = buf.length === 0 ? 0 : 2;
  });
}
