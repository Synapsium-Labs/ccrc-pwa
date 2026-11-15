// server/test/fixtures/overlord-history/preload-openspy.mjs
// TEST-ONLY, never shipped. An open spy for the Overlord's history read (review 2126 F4: "any open"): it records every
// string or URL path handed to an fs call that opens or lists a file, as one `<fn> <path>` line appended to the file named
// by $OVERLORD_TEST_OPENSPY, and is inert when that variable is unset or empty. It wraps the sync, callback and promise
// forms (readFileSync, openSync, readdirSync, readFile, open, readdir, createReadStream, promises.readFile, promises.open,
// promises.readdir), so a reader that moves from one form to another is still seen. It never records, and never re-enters
// on, its own appends. history's preload-readspy.mjs, which other suites read line by line, is left as it is.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const out = process.env.OVERLORD_TEST_OPENSPY ?? '';
if (out !== '') {
  const append = fs.appendFileSync;
  let busy = false;
  const text = (p) => (typeof p === 'string' ? p : p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : null);
  const note = (fn, p) => {
    const s = text(p);
    if (busy || s === null || s === out) return;
    busy = true;
    try { append(out, `${fn} ${s}` + String.fromCharCode(10)); } finally { busy = false; }
  };
  const wrap = (obj, name, label) => {
    const real = obj[name];
    obj[name] = function openSpy(p, ...rest) { note(label, p); return real.call(this, p, ...rest); };
  };
  for (const name of ['readFileSync', 'openSync', 'readdirSync', 'readFile', 'open', 'readdir', 'createReadStream']) wrap(fs, name, name);
  for (const name of ['readFile', 'open', 'readdir']) wrap(fs.promises, name, `promises.${name}`);
  syncBuiltinESMExports();
}
