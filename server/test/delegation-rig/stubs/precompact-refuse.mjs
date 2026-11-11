#!/usr/bin/env node
// precompact-refuse.mjs — a PreCompact hook for the W0 rig (W0-13): blocks a compaction whose payload `trigger` is
// `auto`, by the documented block form (exit code 2, the reason on stderr; hooks page, read 2026-11-11), and passes
// `manual` (exit 0, no output). Appends {t, trigger, decision} to $RIG_EMIT_LOG.
import { logLine, readPayload } from './log.mjs';

const p = readPayload();
const trigger = p.trigger ?? null;
const block = trigger === 'auto';
logLine('RIG_EMIT_LOG', { t: Date.now(), event: 'PreCompact', trigger, decision: block ? 'block' : 'pass' });
if (block) {
  process.stderr.write('W0: an automatic compaction is refused by the rig\'s PreCompact hook\n');
  process.exit(2);
}
process.exit(0);
