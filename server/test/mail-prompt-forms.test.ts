// The mail lane's prompt, in every form the server types today, as the fixture the console's tests read
// (desktop polish wave 176). The console draws a user turn that begins with the mail prompt's head as one quiet line;
// its tests must be fed the real prompts, and they may read `server/test/fixtures/` but not server source
// (`.github/ci/reach.mjs` READS, pinned by `ci-reach-census.test.ts`). This suite holds the fixture equal to the
// server's own renderers, so a renderer that changes its words reds here and the fixture is rendered again.
import { describe, expect, it } from 'vitest';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { renderInboxWakeLine, renderSpotProbeLine } from '../../shared/overlordInbox.js';
import { renderProviderRetryLine } from '../../shared/provider-retry.js';
import { FIXED_LINE_MAIL, renderMailNudge, renderOperatorMessageNudge, renderTimerFiredLine } from '../src/coord/envelope.js';
import fixture from './fixtures/mail-prompt-forms.json' with { type: 'json' };

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
    expect(FIXED_LINE_MAIL.map((r) => FORM_OF[r.name] ?? `no fixture form for the row ${r.name}`).sort())
      .toEqual(Object.keys(FORM_OF).map((k) => FORM_OF[k]!).sort());
  });
});
