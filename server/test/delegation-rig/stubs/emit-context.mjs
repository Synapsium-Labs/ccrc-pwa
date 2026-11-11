#!/usr/bin/env node
// emit-context.mjs --event <E> --chars <N> [--fill ascii|wide] [--tag <t> | --tag-source] — a sized hook emitter for the W0 rig
// (W0-01 to W0-04). Prints {"hookSpecificOutput":{"hookEventName":E,"additionalContext":T}} where T is exactly N
// characters (JS length), starts `W0-HEAD-<N>-` and ends `-W0-TAIL-<N>`: the tail canary in a request proves the whole
// text arrived; the head alone survives a spill's preview. The filler is `x`, or `é` (U+00E9, two UTF-8 bytes) for
// wide. A tag goes inside both canaries (`W0-HEAD-<N>-<t>-`, `-<t>-W0-TAIL-<N>`), for two emitters on one event;
// `--tag-source` makes the payload's `source` the tag, so each start's text is told apart in a later request.
// Appends {t, event, source} from its stdin payload to $RIG_EMIT_LOG.
import { logLine, readPayload } from './log.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const event = opt('--event', 'SessionStart');
const n = Number(opt('--chars', '200'));
const fill = opt('--fill', 'ascii') === 'wide' ? 'é' : 'x';
const payload = readPayload();
const tag = argv.includes('--tag-source') ? String(payload.source ?? 'none') : opt('--tag', '');
if (!Number.isInteger(n) || n < 0) { process.stderr.write('emit-context: --chars must be a whole number\n'); process.exit(2); }
const head = `W0-HEAD-${n}-${tag ? `${tag}-` : ''}`;
const tail = `${tag ? `-${tag}` : ''}-W0-TAIL-${n}`;
if (head.length + tail.length > n) { process.stderr.write('emit-context: --chars is shorter than the two canaries\n'); process.exit(2); }
const text = head + fill.repeat(n - head.length - tail.length) + tail;
logLine('RIG_EMIT_LOG', { t: Date.now(), event, source: payload.source ?? null, tag: tag || null });
process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`);
