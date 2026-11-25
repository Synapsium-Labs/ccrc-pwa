// The mail lane's prompt, in every form the server types today, as the fixture the console's tests read
// (desktop polish wave 176). The console draws a user turn that begins with the mail prompt's head as one quiet line;
// its tests must be fed the real prompts, and they may read `server/test/fixtures/` but not server source
// (`.github/ci/reach.mjs` READS, pinned by `ci-reach-census.test.ts`). This suite holds the fixture equal to the
// server's own renderers, so a renderer that changes its words reds here and the fixture is rendered again.
import { describe, expect, it } from 'vitest';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { renderInboxWakeLine, renderSpotProbeLine } from '../../shared/overlordInbox.js';
import { renderMailNudge, renderOperatorMessageNudge } from '../src/coord/envelope.js';
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
    });
  });

  it('each begins with the mail prompt\'s head, followed by a space', () => {
    const head = INJECTED_PROMPTS['mail-nudge'].text;
    for (const [name, text] of Object.entries(fixture.forms)) expect(text.startsWith(`${head} `), name).toBe(true);
  });
});
