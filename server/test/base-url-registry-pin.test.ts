// The registry's `baseUrl` arm, characterised (D-7305; the 2026-10-29 consolidation TS/MJS kernel base-url plan, Task
// BU1, its item 5; spec 2026-10-19 §5.1 rule 1). `shared/models.mjs#parseRegistry` judges a lane's `baseUrl` with an
// inline gate of its own (`census-kernel/baseUrl.ts#inlineGates`), not with `BASE_URL_OK`. This file pins what that arm
// answers over the endpoint gate's case table, row for row, as measured on the old code, and where it disagrees with
// the gate's own verdict (the table's `expect`, which `base-url.test.ts` holds both gate files to). It reads the gate's
// answers from the table, never by importing the gate, so it adds no importer to the census. Only a task that changes
// the arm's behaviour (BU3, in its behaviour commit) edits it.
import { describe, expect, it } from 'vitest';
import { parseRegistry, RegistryInvalid } from '../../shared/models.js';
import { baseUrlCases } from './fixtures/baseUrlCases.js';

type Answer = { ok: true; stored: string } | { ok: false; field: string };

/** One valid compatible registry around `baseUrl`, so the `baseUrl` arm is the only one that can refuse. */
function registryAnswer(baseUrl: unknown): Answer {
  try {
    const out = parseRegistry({
      probe: 'compatible', classes: { haiku: null, sonnet: null, opus: null, fable: null }, subagent: 'sonnet', discovery: [], baseUrl,
    });
    return { ok: true, stored: out.baseUrl as string };
  } catch (e) {
    if (e instanceof RegistryInvalid) return { ok: false, field: e.field };
    throw e;
  }
}

/** Every row except `undefined`: an absent `baseUrl` is the compatible probe's own refusal, not the arm's. */
const ROWS = baseUrlCases.filter((r) => r.raw !== undefined);

const refused = { ok: false, field: 'baseUrl' } as const;

describe("parseRegistry's baseUrl arm over the endpoint gate's case table (D-7305, characterization)", () => {
  it('answers each of the 24 rows as measured on the old code: the raw text stored, or the baseUrl field refused', () => {
    expect(ROWS.map((r) => [r.raw, registryAnswer(r.raw)])).toEqual([
      ['https://openrouter.ai/api/v1', { ok: true, stored: 'https://openrouter.ai/api/v1' }],
      ['https://orchard-api', { ok: true, stored: 'https://orchard-api' }],
      ['https://orchard-api:8443/v1', { ok: true, stored: 'https://orchard-api:8443/v1' }],
      ['http://127.0.0.1:8642', { ok: true, stored: 'http://127.0.0.1:8642' }],
      ['http://[::1]:8642/v1', { ok: true, stored: 'http://[::1]:8642/v1' }],
      ['http://localhost:8642/v1', { ok: true, stored: 'http://localhost:8642/v1' }],
      ['http://127.0.0.1./v1', { ok: true, stored: 'http://127.0.0.1./v1' }],
      ['HTTPS://Orchard-API/V1', { ok: true, stored: 'HTTPS://Orchard-API/V1' }],
      ['  https://orchard-api/v1  ', { ok: true, stored: '  https://orchard-api/v1  ' }],
      ['http://orchard-api/v1', refused],
      ['http://203.0.113.7/v1', refused],
      ['http://127.0.0.2/v1', refused],
      ['ftp://orchard-api/v1', refused],
      ['https://user:pass@orchard-api/v1', { ok: true, stored: 'https://user:pass@orchard-api/v1' }],
      ['https://user@orchard-api/v1', { ok: true, stored: 'https://user@orchard-api/v1' }],
      ['http://user:pass@orchard-api/v1', refused],
      ['https://orchard-api/v1?beta=true', { ok: true, stored: 'https://orchard-api/v1?beta=true' }],
      ['https://orchard-api/v1?', { ok: true, stored: 'https://orchard-api/v1?' }],
      ['https://orchard-api/v1#frag', { ok: true, stored: 'https://orchard-api/v1#frag' }],
      ['https://orchard-api/v1#', { ok: true, stored: 'https://orchard-api/v1#' }],
      ['orchard-api', refused],
      ['https://', refused],
      ['', refused],
      [7, refused],
    ]);
  });

  it("disagrees with BASE_URL_OK on 6 verdicts and on 5 of the 9 values both accept, by the table's why", () => {
    const answers = ROWS.map((r) => ({ r, a: registryAnswer(r.raw) }));
    const verdictDiffers = answers.filter(({ r, a }) => a.ok !== r.expect.ok).map(({ r }) => r.why).sort();
    const storedDiffers = answers.filter(({ r, a }) => a.ok && r.expect.ok && a.stored !== r.expect.url).map(({ r }) => r.why).sort();
    expect(verdictDiffers).toEqual([
      'a BARE hash leaves hash empty and href unchanged — the same trap',
      'a BARE question mark leaves search empty and href unchanged — the trap',
      'a URL is not a place to keep a key',
      'a fragment is not part of an endpoint',
      'a query string is not part of an endpoint',
      'a username with no password is still userinfo',
    ]);
    expect(storedDiffers).toEqual([
      'a trailing-dot loopback normalises to the loopback and is admitted',
      'http on the IPv4 loopback — this fleet\'s existing api-key lanes run here (§4.3)',
      'https with no path — URL supplies the root, and the stored value says so',
      'scheme and host are lower-cased and the path is not — the stored value is what resolves',
      'surrounding whitespace is a paste artefact, not an endpoint',
    ]);
  });
});
