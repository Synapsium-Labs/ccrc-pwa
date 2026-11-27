#!/usr/bin/env node
// make-app-shortcut.mjs — put ccrc in the Start menu as an APP, not a bookmark.
//
// The PWA is installable (localhost is a secure context, the manifest declares
// `display: standalone`), and Edge's own "Install this site as an app" is the
// canonical route. This script is the scriptable equivalent for a box being set
// up unattended: a shortcut that launches the browser in APP MODE — `--app=<url>`
// opens a window with no tab strip, no address bar and no browser chrome — with
// ccrc's own icon on it.
//
// The icon is the interesting part. A .lnk cannot take a PNG, and the PWA ships
// only PNGs, so this writes a real .ico around one: since Vista an ICO
// directory entry may point at a PNG payload verbatim, so the container is 22
// bytes of header in front of the file that is already there. No image library,
// no conversion, no loss.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.CCRC_APP_URL || 'http://127.0.0.1:7788/';
const HOME = process.env.CCRC_HOME || os.homedir();
const LIB = path.join(HOME, '.local', 'lib', 'ccrc');
const PNG = path.join(LIB, 'ccrc-icon.png');
const ICO = path.join(LIB, 'ccrc.ico');

/** ICONDIR + one ICONDIRENTRY + the PNG itself. `0` in the size byte means 256,
 *  which is what every icon this ships is scaled from. */
function pngToIco(png) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);            // reserved
  head.writeUInt16LE(1, 2);            // type: icon
  head.writeUInt16LE(1, 4);            // one image
  head.writeUInt8(0, 6);               // width  256
  head.writeUInt8(0, 7);               // height 256
  head.writeUInt8(0, 8);               // palette: none
  head.writeUInt8(0, 9);               // reserved
  head.writeUInt16LE(1, 10);           // colour planes
  head.writeUInt16LE(32, 12);          // bits per pixel
  head.writeUInt32LE(png.length, 14);  // payload size
  head.writeUInt32LE(22, 18);          // payload offset
  return Buffer.concat([head, png]);
}

function browser() {
  // Chrome first: Edge ships with every Windows, so Chrome on the box was put there by the operator, on purpose.
  for (const p of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]) if (existsSync(p)) return p;
  throw new Error('no Edge or Chrome found — app mode needs a Chromium browser');
}

mkdirSync(LIB, { recursive: true });
if (!existsSync(PNG)) throw new Error(`icon source missing: ${PNG} (fetch /icons/icon-512.png from the server)`);
writeFileSync(ICO, pngToIco(readFileSync(PNG)));

const exe = browser();
// SINGLE-quoted PowerShell literals, not JSON. PowerShell does not treat `\`
// as an escape (its escape is a backtick), so a JSON-escaped path arrives with
// its backslashes DOUBLED — `C:\\Users\\...`. Windows happens to collapse the
// repeats, so it works by luck rather than by construction; a single-quoted
// literal with `'` doubled is the actual rule.
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ps = [
  '$s = (New-Object -ComObject WScript.Shell).SpecialFolders("StartMenu");',
  "$p = Join-Path $s 'Programs\\ccrc.lnk';",
  '$l = (New-Object -ComObject WScript.Shell).CreateShortcut($p);',
  `$l.TargetPath = ${psq(exe)};`,
  `$l.Arguments = ${psq(`--app=${URL_}`)};`,
  `$l.IconLocation = ${psq(ICO)};`,
  "$l.Description = 'ccrc - drive your Claude Code fleet';",
  '$l.Save(); $p',
].join(' ');
const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  encoding: 'utf8', env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
}).trim();
console.log(`ccrc: Start-menu app shortcut written: ${out}`);
console.log(`ccrc: it opens ${URL_} in a window with no browser chrome, icon ${ICO}`);
