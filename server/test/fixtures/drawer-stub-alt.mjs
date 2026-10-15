#!/usr/bin/env node
// Deterministic alternate-screen stub for the drawer real-tmux suite.
// No clock, PID, path, or hostname; never prints U+00B7.

const BOX_WIDTH = 70;
const BOX_INNER = BOX_WIDTH - 4; // space after "> " plus space before "│"

let typed = '';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function writeAt(row, col, text) {
  const cols = process.stdout.columns || 220;
  const rows = process.stdout.rows || 50;
  if (row < 1 || row > rows || col < 1 || col > cols) return;
  // Never touch the last column of the last row (avoids autowrap scroll).
  const maxLen = row === rows ? cols - col : cols - col + 1;
  if (maxLen <= 0) return;
  const out = text.slice(0, maxLen);
  process.stdout.write(`\x1b[${row};${col}H${out}`);
}

function paint() {
  const cols = process.stdout.columns || 220;
  const rows = process.stdout.rows || 50;

  // Clear the alternate screen.
  process.stdout.write('\x1b[2J');

  // Header.
  writeAt(1, 1, 'drawer stub — synthetic alternate-screen app');

  // 24-bit truecolor line.
  writeAt(3, 1, '\x1b[38;2;215;119;87mtruecolor foreground\x1b[0m');
  writeAt(4, 1, '\x1b[48;2;42;98;143m\x1b[38;2;255;255;255mtruecolor background\x1b[0m');

  // CJK (wide-character) line.
  writeAt(6, 1, '\u6f22\u5b57\u306e\u30c6\u30b9\u30c8 \ud55c\uad6d\uc5b4 \u4e2d\u6587');

  // Box near the bottom.
  const boxTop = Math.max(10, rows - 12);
  const topCh = '\u256d' + '\u2500'.repeat(BOX_WIDTH - 2) + '\u256e';
  const botCh = '\u2570' + '\u2500'.repeat(BOX_WIDTH - 2) + '\u256f';
  const sideCh = '\u2502' + ' '.repeat(BOX_WIDTH - 2) + '\u2502';

  writeAt(boxTop, 1, topCh);
  for (let i = 1; i < 4; i += 1) {
    writeAt(boxTop + i, 1, sideCh);
  }

  // Inner input line: "> " + typed text + reverse-video caret cell.
  const caret = '\x1b[7m \x1b[27m';
  const prompt = '> ';
  const maxText = BOX_INNER - prompt.length - 1; // leave one cell for caret
  const visible = typed.slice(Math.max(0, typed.length - maxText));
  const pad = ' '.repeat(Math.max(0, BOX_INNER - prompt.length - visible.length - 1));
  const inner = `${prompt}${visible}${pad}${caret}`;
  writeAt(boxTop + 2, 2, inner);

  writeAt(boxTop + 4, 1, botCh);

  // Marker written LAST so the harness knows paint() finished.
  writeAt(rows - 3, 1, 'STUB-READY');

  process.stdout.write('\x1b[H');
}

process.stdout.write('\x1b[?1049h\x1b[?25l');

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    if (byte >= 0x20 && byte <= 0x7e) {
      typed += String.fromCharCode(byte);
    }
  }
  const maxStored = BOX_INNER * 4; // generous cap; paint truncates
  if (typed.length > maxStored) {
    typed = typed.slice(typed.length - maxStored);
  }
  paint();
});

process.stdin.on('end', () => {
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  process.exit(0);
});

process.stdout.on('resize', paint);

paint();
