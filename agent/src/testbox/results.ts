// D-7406, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.2 "Results leave the directory
// first", §2.5 "Results stream back"). L3: the run's output and report, read OUTSIDE the run directory. The system
// manager writes the run unit's stdout and stderr to `out/<k>/stdout` and `out/<k>/stderr` (and the prepare unit's to
// `out/<k>/prepare.stdout` and `out/<k>/prepare.stderr`, D-7501); the service tails the run's two as they grow, sends
// each new piece as a `run.log`, and appends it to `logs/<run-id>/run.log`. The clean unit copies the JSON report to
// `results/<run-id>/report.json` and writes its word (`ok`, `missing`, `oversized`, `not-regular`) to
// `results/<run-id>/report.status` (D-7501); this file reads both for the summary.
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { TESTBOX_REPORT_MAP, type TestboxReport, type TestboxStream } from '../../../shared/testbox.js';

export interface OutputChunk { readonly stream: TestboxStream; readonly offset: number; readonly bytes: Buffer }

export const OUTPUT_FILES: Readonly<Record<TestboxStream, string>> = { stdout: 'stdout', stderr: 'stderr' };
export const PREPARE_STDERR = 'prepare.stderr';
export const RUN_LOG = 'run.log';

/** Bytes of `file` from `offset` to its current end. */
function readFrom(file: string, offset: number): Buffer {
  if (!existsSync(file)) return Buffer.alloc(0);
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return Buffer.alloc(0);
    const buf = Buffer.alloc(size - offset);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, offset + got);
      if (n === 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

/** The tail of one run's two output files. */
export class OutputTail {
  private readonly offsets: Record<TestboxStream, number> = { stdout: 0, stderr: 0 };
  private watchers: FSWatcher[] = [];
  private readonly watched = new Set<string>();

  constructor(private readonly outDir: string, private readonly logFile: string, private readonly onChunk: (c: OutputChunk) => void) {
    mkdirSync(path.dirname(logFile), { recursive: true });
  }

  /** Every new byte of both files, in stream order, sent and logged. */
  drain(): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const bytes = readFrom(path.join(this.outDir, OUTPUT_FILES[stream]), this.offsets[stream]);
      if (bytes.length === 0) continue;
      const offset = this.offsets[stream];
      this.offsets[stream] += bytes.length;
      appendFileSync(this.logFile, bytes);
      this.onChunk({ stream, offset, bytes });
    }
  }

  /** Drain on every change, until `stop`. The directory is watched by its real path (a watcher on a path through a
   *  symlink misses its events on some platforms), and each output file by itself as soon as it exists: a directory
   *  watcher reports a file's creation everywhere but its writes only on some platforms. */
  watch(): void {
    if (this.watchers.length > 0 || !existsSync(this.outDir)) return;
    const dir = realpathSync(this.outDir);
    const attach = (): void => {
      for (const name of Object.values(OUTPUT_FILES)) {
        const f = path.join(dir, name);
        if (this.watched.has(f) || !existsSync(f)) continue;
        this.watched.add(f);
        const w = watch(f, () => this.drain());
        w.on('error', () => undefined);
        this.watchers.push(w);
      }
    };
    const d = watch(dir, () => { attach(); this.drain(); });
    d.on('error', () => undefined);
    this.watchers.push(d);
    attach();
  }

  /** The last drain, then no more. */
  stop(): void {
    for (const w of this.watchers.splice(0)) w.close();
    this.watched.clear();
    this.drain();
  }
}

/** The last non-empty line of a file, or `null`. */
export function lastLine(file: string): string | null {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
  return lines.length === 0 ? null : lines[lines.length - 1]!;
}

/** The last `n` lines of the run's log, control characters but tab dropped (a summary line is one line of text). */
export function logTail(logFile: string, n: number): string[] {
  if (!existsSync(logFile)) return [];
  const lines = readFileSync(logFile, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  // eslint-disable-next-line no-control-regex
  return lines.slice(-n).map((l) => l.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, ''));
}

export interface ReportRead {
  readonly report: TestboxReport;
  readonly files: readonly string[];
  readonly tests: readonly string[];
}

// eslint-disable-next-line no-control-regex
const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();

/** The collected report: its word from the clean unit, and the failed files and test names from vitest's JSON
 *  reporter. A word file that is absent or unknown reads as `missing`; a report that does not parse as vitest's JSON
 *  reads as `missing` too, the exit status being kept either way. File names are made relative to `checkout`. */
export function readReport(resultsDir: string, checkout: string): ReportRead {
  const none = (report: TestboxReport): ReportRead => ({ report, files: [], tests: [] });
  const wordFile = path.join(resultsDir, 'report.status');
  const word = existsSync(wordFile) ? readFileSync(wordFile, 'utf8').trim() : 'missing';
  if (!Object.prototype.hasOwnProperty.call(TESTBOX_REPORT_MAP, word)) return none('missing');
  if (word !== 'ok') return none(word as TestboxReport);
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(path.join(resultsDir, 'report.json'), 'utf8')); } catch { return none('missing'); }
  const results = (doc as { testResults?: unknown }).testResults;
  if (!Array.isArray(results)) return none('missing');
  const files: string[] = [];
  const tests: string[] = [];
  for (const r of results as { name?: unknown; status?: unknown; assertionResults?: unknown }[]) {
    if (typeof r !== 'object' || r === null || typeof r.name !== 'string') continue;
    if (r.status === 'failed') {
      const rel = path.relative(checkout, r.name);
      const f = clean(rel.startsWith('..') ? r.name : rel);
      if (f !== '') files.push(f);
    }
    if (Array.isArray(r.assertionResults)) {
      for (const a of r.assertionResults as { fullName?: unknown; status?: unknown }[]) {
        if (typeof a === 'object' && a !== null && a.status === 'failed' && typeof a.fullName === 'string') {
          const t = clean(a.fullName);
          if (t !== '') tests.push(t);
        }
      }
    }
  }
  return { report: 'ok', files, tests };
}
