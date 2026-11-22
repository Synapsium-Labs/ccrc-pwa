// The fixed-line mail table (Overlord W1, inbox piece, Task 4; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`,
// question 8): `FIXED_LINE_MAIL` and `fixedLineMailOf` (L1, `coord/envelope.ts`), and what `mailNudgeOf` and `resumeRuleOf` make of
// each row. Pure cases: the mail lane's own drive of the table is in `overlord-prompt-record.test.ts` and
// `overlord-inbox-wake-lane.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  FIXED_LINE_MAIL, fixedLineMailOf, mailNudgeOf, renderMailNudge, renderOperatorMessageNudge, resumeRuleOf,
} from '../src/coord/envelope.js';
import { SPOT_PROBE_SUBJECT } from '../src/continuity/renewalFeed.js';
import { INBOX_WAKE_SUBJECT, renderInboxWakeBody, renderInboxWakeLine, renderSpotProbeLine } from '../../shared/overlordInbox.js';
import { operatorMessageSubject } from '../../shared/operatorMessages.js';

const OVERLORD = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const designated = { kind: 'designated', sessionId: OVERLORD } as const;
const NOW = 1_800_000_000_000;
const wakeBody = renderInboxWakeBody({ keys: ['probe-round:r1'], waiting: 3, firstDue: { kind: 'by', at: NOW + 140_000 } });
const mailTo = (toId: string, fromId: string, subject: string) => ({ fromId, subject, toId });

describe('fixedLineMailOf', () => {
  it('answers each row for its mail to the designated session', () => {
    expect(fixedLineMailOf(mailTo(OVERLORD, 'operator', operatorMessageSubject(7)), designated)).toMatchObject({ name: 'operator-message', firstDelivery: 'message-delivered' });
    expect(fixedLineMailOf(mailTo(OVERLORD, 'operator', SPOT_PROBE_SUBJECT), designated)).toMatchObject({ name: 'spot-probe', firstDelivery: 'none' });
    expect(fixedLineMailOf(mailTo(OVERLORD, 'operator', INBOX_WAKE_SUBJECT), designated)).toMatchObject({ name: 'inbox-wake', firstDelivery: 'none' });
  });

  it('answers generic for the spot-probe notice and the wake to any other session, and for either subject from another sender', () => {
    for (const subject of [SPOT_PROBE_SUBJECT, INBOX_WAKE_SUBJECT]) {
      expect(fixedLineMailOf(mailTo(OTHER, 'operator', subject), designated)).toBe('generic');
      expect(fixedLineMailOf(mailTo(OVERLORD, OTHER, subject), designated)).toBe('generic');
      expect(fixedLineMailOf(mailTo(OTHER, 'operator', subject), { kind: 'not-designated' })).toBe('generic');
    }
  });

  it('answers generic for every other mail', () => {
    expect(fixedLineMailOf(mailTo(OVERLORD, 'operator', 'handover'), designated)).toBe('generic');
    expect(fixedLineMailOf(mailTo(OVERLORD, OTHER, 'hi'), designated)).toBe('generic');
    expect(fixedLineMailOf(mailTo(OVERLORD, 'operator', 'operator-message:not-a-number'), designated)).toBe('generic');
  });

  it('answers generic for every designatedOnly row under an unmeasured designation, and keeps the operator message\'s row', () => {
    const only = FIXED_LINE_MAIL.filter((r) => r.designatedOnly);
    expect(only.map((r) => r.name).sort()).toEqual(['inbox-wake', 'spot-probe']);
    for (const subject of [SPOT_PROBE_SUBJECT, INBOX_WAKE_SUBJECT]) {
      expect(fixedLineMailOf(mailTo(OVERLORD, 'operator', subject), { kind: 'unmeasured' })).toBe('generic');
    }
    expect(fixedLineMailOf(mailTo(OVERLORD, 'operator', operatorMessageSubject(7)), { kind: 'unmeasured' })).toMatchObject({ name: 'operator-message' });
  });

  it('names each row once, and a row that matches a mail is the only one that does', () => {
    expect(FIXED_LINE_MAIL.map((r) => r.name)).toEqual(['operator-message', 'spot-probe', 'inbox-wake']);
    for (const m of [{ fromId: 'operator', subject: operatorMessageSubject(1) }, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT }, { fromId: 'operator', subject: INBOX_WAKE_SUBJECT }]) {
      expect(FIXED_LINE_MAIL.filter((r) => r.matches(m))).toHaveLength(1);
    }
  });
});

describe('the lines the table types', () => {
  const wake = FIXED_LINE_MAIL.find((r) => r.name === 'inbox-wake')!;
  const spot = FIXED_LINE_MAIL.find((r) => r.name === 'spot-probe')!;

  it('the wake\'s line with a deadline 140 s ahead reads "the first lapses in 140 s", and typed later reads less', () => {
    expect(wake.line({ subject: INBOX_WAKE_SUBJECT, body: wakeBody }, NOW)).toContain('the first lapses in 140 s');
    expect(wake.line({ subject: INBOX_WAKE_SUBJECT, body: wakeBody }, NOW + 100_000)).toContain('the first lapses in 40 s');
    expect(wake.line({ subject: INBOX_WAKE_SUBJECT, body: wakeBody }, NOW + 200_000)).toContain('the first has lapsed');
    expect(wake.line({ subject: INBOX_WAKE_SUBJECT, body: wakeBody }, NOW)).toContain('3 waiting in your inbox');
  });

  it('an unreadable body types the door and no count', () => {
    const line = wake.line({ subject: INBOX_WAKE_SUBJECT, body: 'not a wake body' }, NOW);
    expect(line).toBe(renderInboxWakeLine({ ok: false }, NOW));
    expect(line).toContain('your inbox door');
    expect(line).not.toMatch(/\d+ waiting/);
  });

  it('the spot-probe row types the probe door, never the notice\'s body, and takes no clock', () => {
    expect(spot.line({ subject: SPOT_PROBE_SUBJECT, body: 'A probe round is open for you. Answer it with `ccrc-api probe`.' }, NOW)).toBe(renderSpotProbeLine());
    expect(renderSpotProbeLine()).not.toContain('ccrc-api');
  });
});

describe('mailNudgeOf and resumeRuleOf over the table', () => {
  it('a wake to the designated session types its line, from the mail\'s body and the clock, and ids no message', () => {
    const nudge = mailNudgeOf(OVERLORD, { fromId: 'operator', subject: INBOX_WAKE_SUBJECT, body: wakeBody }, designated, NOW);
    expect(nudge.operatorMessageId).toBeNull();
    expect(nudge.firstDelivery).toBe('none');
    expect(nudge.line).toBe(renderInboxWakeLine({ ok: true, body: { keys: ['probe-round:r1'], waiting: 3, firstDue: { kind: 'by', at: NOW + 140_000 } } }, NOW));
  });

  it('a spot-probe notice to the designated session types the probe line; to a coordinator it keeps the generic nudge', () => {
    const own = mailNudgeOf(OVERLORD, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT, body: 'b' }, designated, NOW);
    expect(own).toEqual({ line: renderSpotProbeLine(), operatorMessageId: null, firstDelivery: 'none' });
    const coordinator = mailNudgeOf(OTHER, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT, body: 'b' }, designated, NOW);
    expect(coordinator).toEqual({ line: renderMailNudge(OTHER), operatorMessageId: null });
    expect(mailNudgeOf(OVERLORD, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT, body: 'b' }, { kind: 'unmeasured' }, NOW)).toEqual({ line: renderMailNudge(OVERLORD), operatorMessageId: null });
  });

  it('the operator message\'s nudge is unchanged: its line, its id, no first-delivery word beside it', () => {
    const op = mailNudgeOf(OVERLORD, { fromId: 'operator', subject: operatorMessageSubject(7) });
    expect(op).toEqual({ line: renderOperatorMessageNudge(7), operatorMessageId: 7 });
  });

  it('"whole" is asked of every fixed line when the box holds exactly that line, and of no other nudge', () => {
    const wake = mailNudgeOf(OVERLORD, { fromId: 'operator', subject: INBOX_WAKE_SUBJECT, body: wakeBody }, designated, NOW);
    const spot = mailNudgeOf(OVERLORD, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT, body: 'b' }, designated, NOW);
    expect(resumeRuleOf(wake, wake.line)).toEqual({ resumeIfOwn: 'whole' });
    expect(resumeRuleOf(spot, spot.line)).toEqual({ resumeIfOwn: 'whole' });
    // another fixed line, an empty box and an unread box are never resumed: the line is typed, or the box is a draft
    expect(resumeRuleOf(wake, spot.line)).toEqual({});
    expect(resumeRuleOf(wake, renderOperatorMessageNudge(7))).toEqual({});
    expect(resumeRuleOf(wake, '')).toEqual({});
    expect(resumeRuleOf(wake, null)).toEqual({});
    // the time left is typed at typing: a box that holds the line of an earlier clock is a draft, not this delivery's line
    expect(resumeRuleOf(wake, mailNudgeOf(OVERLORD, { fromId: 'operator', subject: INBOX_WAKE_SUBJECT, body: wakeBody }, designated, NOW + 30_000).line)).toEqual({});
    // a generic nudge keeps the prefix mode
    expect(resumeRuleOf({ line: renderMailNudge(OVERLORD), operatorMessageId: null }, null)).toEqual({ resumeIfOwn: true });
  });
});
