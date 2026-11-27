// Prints the value of one single-quoted assignment of ccd/session-hook.sh (argv[2], argv[3] its name): the text between
// `NAME='` at a line's start and the next quote, as the hook's shell holds it (the programs spell a quote as `$q`).
import fs from 'node:fs';
const s = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');
const m = new RegExp(`^${process.argv[3]}='([^']*)'`, 'm').exec(s);
if (m === null) { process.stderr.write(`${process.argv[3]} is not one single-quoted assignment\n`); process.exit(1); }
process.stdout.write(m[1]);
