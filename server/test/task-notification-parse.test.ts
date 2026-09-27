import { describe, it, expect } from 'vitest';
import { envelopeMembers, parseTaskNotification } from '../../shared/api.js';

/**
 * The grammar the harness's background-task report is written in.
 *
 * Lives beside `mail-envelope-parse.test.ts` and pins the same contract: read
 * the structure ONCE, in `shared/`, refuse cleanly, and let the delivery layer
 * render what came back. A refusal must fall through to the ordinary row —
 * never a half-populated card.
 */
const NOTIF = '<task-notification>\n<task-id>w0s3mcrji</task-id>\n'
  + '<tool-use-id>toolu_01Qj6Dyd</tool-use-id>\n<status>completed</status>\n'
  + '<summary>Dynamic workflow "resolve the six design forks" completed</summary>\n'
  + '<result>{"verdict":"shippable"}</result>\n</task-notification>';

const ok = (text: string) => {
  const p = parseTaskNotification(text);
  if (!p.ok) throw new Error(`expected a notification, got ${p.why}`);
  return p.notification;
};

describe('envelopeMembers — the structural read both sides share', () => {
  it('splits a record into its members IN ARRIVAL ORDER', () => {
    expect(envelopeMembers('<a>1</a>\n<b>2</b>')).toEqual([
      { name: 'a', value: '1' }, { name: 'b', value: '2' },
    ]);
  });

  it('a repeated member is kept twice — a Map would silently collapse it', () => {
    expect(envelopeMembers('<a>1</a><a>2</a>')?.map((m) => m.value)).toEqual(['1', '2']);
  });

  it('refuses prose anywhere outside the blocks — before, between, or after', () => {
    for (const s of ['hi <a>1</a>', '<a>1</a> hi', '<a>1</a> hi <b>2</b>', '<a>1</a>\n\nwhy?']) {
      expect(envelopeMembers(s), s).toBeNull();
    }
  });

  it('refuses an unclosed tag, and text that is not tags at all', () => {
    expect(envelopeMembers('<a>half a li')).toBeNull();
    expect(envelopeMembers('just a sentence')).toBeNull();
    expect(envelopeMembers('')).toBeNull();
  });
});

describe('parseTaskNotification — the harness reporting a finished task', () => {
  it('reads the summary, the status, and every other member by name', () => {
    const n = ok(NOTIF);
    expect(n.summary).toBe('Dynamic workflow "resolve the six design forks" completed');
    expect(n.status).toBe('completed');
    expect(n.fields).toEqual([
      { name: 'task-id', value: 'w0s3mcrji' },
      { name: 'tool-use-id', value: 'toolu_01Qj6Dyd' },
      { name: 'result', value: '{"verdict":"shippable"}' },
    ]);
  });

  it('NOTHING is dropped — summary and status are lifted OUT of fields, not away', () => {
    const n = ok(NOTIF);
    const names = [...n.fields.map((f) => f.name), 'summary', 'status'].sort();
    expect(names).toEqual(['result', 'status', 'summary', 'task-id', 'tool-use-id']);
  });

  it('an ABSENT summary or status is null, not an empty string — the card renders no such row', () => {
    const n = ok('<task-notification>\n<task-id>w1</task-id>\n</task-notification>');
    expect(n.summary).toBeNull();
    expect(n.status).toBeNull();
    expect(n.fields).toEqual([{ name: 'task-id', value: 'w1' }]);
  });

  it('refuses anything that is not the whole record wrapped in the named tag', () => {
    for (const s of [
      'what does a task notification look like?',
      '<command-name>/clear</command-name>',
      `${NOTIF}\n\nwhy is this attributed to me?`,
      '<task-notification>\n<task-id>w1</task-id>',
      '<task-notification>free prose the harness did not tag</task-notification>',
    ]) {
      expect(parseTaskNotification(s), s).toEqual({ ok: false, why: 'not-a-notification' });
    }
  });
});
