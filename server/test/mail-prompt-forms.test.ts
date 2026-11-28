// The mail lane's prompt, in every form the server types today, as the fixture the console's tests read
// (desktop polish wave 176). The console draws a user turn that begins with the mail prompt's head as one quiet line;
// its tests must be fed the real prompts, and they may read `server/test/fixtures/` but not server source
// (`.github/ci/reach.mjs` READS, pinned by `ci-reach-census.test.ts`). This suite holds the fixture equal to the
// server's own renderers, so a renderer that changes its words reds here and the fixture is rendered again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { removeTmpFixtures } from './tmpHelpers.js';
import { NOW, ID, PEER, emptyBox, echoedBox, sendCalls, literalSends, primed, designate, queueMail, queueBuilt, sweepMany, mailForHeldRow } from './helpers/reportHoldSweep.js';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { renderInboxWakeLine, renderSpotProbeLine } from '../../shared/overlordInbox.js';
import { renderProviderRetryLine } from '../../shared/provider-retry.js';
import { FIXED_LINE_MAIL, renderMailNudge, renderOperatorMessageNudge, renderTimerFiredLine } from '../src/coord/envelope.js';
import fixture from './fixtures/mail-prompt-forms.json' with { type: 'json' };

// The forms census reads the rows by the HOLD COLUMN, never by a row's name: a row held until acked is never typed, so it
// has no form on the console. A row that later loses that hold re-enters the census by itself and reds until it has a form.
// HELD_ROWS is the filter's complement, which the suite below holds never typed (coordinator's ruling, call 1943).
const FORMS_CENSUS = FIXED_LINE_MAIL.filter((r) => r.hold !== 'acked');
const HELD_ROWS = FIXED_LINE_MAIL.filter((r) => !FORMS_CENSUS.includes(r));

describe('the mail prompt forms fixture is what the server types', () => {
  it('each form, rendered by the server\'s own renderer', () => {
    expect(fixture.forms).toEqual({
      generic: renderMailNudge(fixture.self),
      operatorMessage: renderOperatorMessageNudge(42),
      inboxWake: renderInboxWakeLine({ ok: true, body: { keys: [], waiting: 2, firstDue: { kind: 'by', at: 90_000 } } }, 0),
      inboxWakeLapsed: renderInboxWakeLine({ ok: true, body: { keys: [], waiting: 1, firstDue: { kind: 'by', at: 0 } } }, 5),
      inboxWakeUnreadable: renderInboxWakeLine({ ok: false }, 0),
      spotProbe: renderSpotProbeLine(),
      timerFired: renderTimerFiredLine('timer: 2 due (7, 8)'),
      timerFiredUncounted: renderTimerFiredLine(''),
      providerRetry: renderProviderRetryLine(),
    });
  });

  it('each begins with the mail prompt\'s head, followed by a space', () => {
    const head = INJECTED_PROMPTS['mail-nudge'].text;
    for (const [name, text] of Object.entries(fixture.forms)) expect(text.startsWith(`${head} `), name).toBe(true);
  });

  // Review 3737 A8: the lines the lane can type are the table that chooses them (`FIXED_LINE_MAIL`, read by `mailNudgeOf`)
  // plus the generic nudge. Every row's line, rendered from the table itself, begins with the head, so a new fixed-line
  // mail whose line does not is red here before the console draws it as a person's bubble; and each row the table holds
  // has a form in the fixture the console's tests read.
  it('every line the lane can type, read from the table that chooses it, begins with the head', () => {
    const head = INJECTED_PROMPTS['mail-nudge'].text;
    for (const row of FIXED_LINE_MAIL) {
      for (const mail of [{ subject: '', body: '' }, { subject: 'operator message 42', body: '{}' }]) {
        expect(row.line(mail, 0).startsWith(`${head} `), `${row.name} (${JSON.stringify(mail)})`).toBe(true);
      }
    }
    expect(renderMailNudge(fixture.self).startsWith(`${head} `)).toBe(true);
    const FORM_OF: Record<string, string> = { 'operator-message': 'operatorMessage', 'spot-probe': 'spotProbe', 'inbox-wake': 'inboxWake',
      'provider-retry': 'providerRetry', timer: 'timerFired' };
    expect(FORMS_CENSUS.map((r) => FORM_OF[r.name] ?? `no fixture form for the row ${r.name}`).sort())
      .toEqual(Object.keys(FORM_OF).map((k) => FORM_OF[k]!).sort());
  });

  // The census's other direction, in this same suite: every row the forms census leaves out is a row the lane never types, so
  // "left out of the forms" and "never typed" are held equal. The list is the filter's complement, never a name.
  it('the census is not widened by a second hold word: the timer row, the one `card` row, is in it', () => {
    const card = FIXED_LINE_MAIL.filter((r) => r.hold === 'card');
    expect(card.map((r) => r.name)).toEqual(['timer']);
    for (const r of card) expect(FORMS_CENSUS).toContain(r);
    expect(FORMS_CENSUS.map((r) => r.hold)).not.toContain('acked');
    expect(HELD_ROWS.length + FORMS_CENSUS.length).toBe(FIXED_LINE_MAIL.length);
    expect(HELD_ROWS.length).toBeGreaterThan(0);
  });
});

describe('a row left out of the forms census is a row the mail lane never types', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); removeTmpFixtures(); });

  // The control: the rig does type an ordinary mail, so "nothing typed" below is not a rig that cannot type.
  it('control: an ordinary peer mail to the session is typed by the same rig', async () => {
    const nudge = renderMailNudge(ID);
    const { h, coord, w } = await primed([emptyBox, echoedBox(nudge), emptyBox]);
    designate(coord, ID);
    queueMail(coord, PEER, ID, ID, 'ordinary news');
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([nudge]);
  });

  for (const row of HELD_ROWS) {
    const mail = mailForHeldRow(row);
    const shapes: [string, (h: Awaited<ReturnType<typeof primed>>) => Promise<void>][] = [
      ['unacked, over many sweeps past every back-off', async ({ w }) => { await sweepMany(w, 10); }],
      ['acked', async ({ coord, w }) => { const q = queueBuilt(coord, mail); coord.markAcked(q.id, Date.now()); await sweepMany(w, 3); }],
      ['with the mail-off marker standing', async ({ h, w }) => { writeFileSync(path.join(h.home, '.cc-sessions', 'mail-disabled'), ''); await sweepMany(w, 5); }],
      ['with the coordination-pause marker standing', async ({ h, w }) => { writeFileSync(path.join(h.home, '.cc-sessions', 'coordinator-paused'), ''); await sweepMany(w, 5); }],
    ];
    for (const [when, act] of shapes) {
      it(`the row ${row.name} (hold ${String(row.hold)}) is never typed: ${when}`, async () => {
        const rig = await primed([emptyBox]);
        designate(rig.coord, ID);
        // the acked shape queues its own delivery; the others queue theirs here
        if (when !== 'acked') queueBuilt(rig.coord, mail);
        await act(rig);
        expect(sendCalls(rig.h.calls)).toEqual([]);
      });
    }
  }
});
