#!/usr/bin/env node
// deploy/gen-accounts.mjs — Task 10 of the stage-2a roster-becomes-data plan.
//
// Reads an `accounts.json` (path in argv[2]) and writes the finished text of
// `~/.ccrc/accounts.sh` — body plus provenance marker — to stdout. It is the
// one place `deploy/deploy.sh` turns roster DATA into the bash `ccd` sources,
// and it exists as a `.mjs` CLI for one reason: the deploy runs it with a
// BARE `node`, from the local checkout, with no build step, no `tsx` and no
// compiled `dist/`. `shared/generate.mjs` and `shared/mark.mjs` were written
// dependency-free for exactly this caller; composing them is all the happy
// path does.
//
// The JSON validator this file used to carry — `rosterFromJson` and
// everything it depends on — moved to `shared/roster-json.mjs` (Task 4 of the
// stage-2c wrapper-generation plan) once a second bare-`node` caller needed
// it (Task 5's wrapper generator). See that file's header for the full
// account of WHY the validator exists, and why it may be stricter than
// `parseRoster` but never laxer — that contract belongs to the validator, not
// to this CLI shell, and it moved with the code.
//
// Nothing is written to stdout until validation and generation have both
// succeeded, so a failed run leaves an empty file rather than half a roster
// that bash would happily source.

import { readFileSync } from 'node:fs';
import { generateAccountsSh } from '../shared/generate.mjs';
import { markGenerated } from '../shared/mark.mjs';
import { RosterInvalid, rosterFromJson } from '../shared/roster-json.mjs';

function main(argv) {
  const file = argv[2];
  if (file === undefined || file === '' || argv.length > 3) {
    process.stderr.write('usage: node deploy/gen-accounts.mjs <accounts.json> > accounts.sh\n');
    return 2;
  }

  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    process.stderr.write(`gen-accounts: cannot read ${file}: ${e.message}\n`);
    return 1;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`gen-accounts: ${file} is not valid JSON: ${e.message}\n`);
    return 1;
  }

  let text;
  try {
    text = markGenerated(generateAccountsSh(rosterFromJson(json)));
  } catch (e) {
    process.stderr.write(`gen-accounts: ${file}: ${e.message}\n`);
    if (e instanceof RosterInvalid) process.stderr.write(`gen-accounts: remedy: ${e.remedy}\n`);
    return 1;
  }

  process.stdout.write(text);
  return 0;
}

process.exitCode = main(process.argv);
