// A vitest reporter that records each test file's WHOLE time for the shard planner (`shards.mjs times`).
//
// The stock JSON reporter's `endTime - startTime` spans only the first test's start to the last test's end, so
// a file whose cost sits in `beforeAll`, in collection (imports, fixture builds) or in environment setup is
// recorded as nearly free: two route files that take 345-404 s were recorded at 0.5 s each, and the planner
// packed them as if they cost nothing. This reporter records, per file, the time it held a worker:
// environment setup + test-harness setup + setup files + collection + tests and hooks (vitest's module
// diagnostic, which counts hooks in `duration`).
//
// The output has the JSON reporter's `testResults[]` shape (`name` absolute, `startTime`, `endTime`) plus
// `wallMs`, so it flows through the same artifact and merge; `durationsFromVitestJson` prefers `wallMs`.
// Where it writes: `CCRC_FILE_TIMES_OUT` (a file path). Unset, it writes nothing (a developer's run).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export default class FileTimesReporter {
  constructor() {
    /** @type {Array<{ name: string, startTime: number, endTime: number, wallMs: number }>} */
    this.results = [];
  }

  /** @param {{ moduleId: string, diagnostic: () => { environmentSetupDuration: number, prepareDuration: number, setupDuration: number, collectDuration: number, duration: number } }} testModule */
  onTestModuleEnd(testModule) {
    const d = testModule.diagnostic();
    const wallMs = d.environmentSetupDuration + d.prepareDuration + d.setupDuration + d.collectDuration + d.duration;
    const endTime = Date.now();
    this.results.push({ name: testModule.moduleId, startTime: endTime - wallMs, endTime, wallMs });
  }

  onTestRunEnd() {
    const out = process.env.CCRC_FILE_TIMES_OUT;
    if (!out) return;
    mkdirSync(path.dirname(out), { recursive: true });
    this.results.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    writeFileSync(out, JSON.stringify({ testResults: this.results }, null, 2) + '\n');
  }
}
