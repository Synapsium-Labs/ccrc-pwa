// ── the licence, and the three literals that make it mean something ───────
//
// A public repository with no LICENCE is "all rights reserved" by default:
// publishing the code would grant nobody the right to use, fork, or contribute
// to it. This suite exists so that state cannot come back silently, and so the
// pieces that must agree with each other cannot drift apart.
//
// Ruled in docs/superpowers/specs/2026-08-21-stage5-oss-decision-brief.md:
//   S8 — root LICENSE (AGPL-3.0), `license` fields in server/agent/pwa,
//        shared/ stays a bare resolver shim, a README section, NO per-file
//        headers (they would fight the design-rationale comment that opens
//        every file in this tree).
//   S1 — the release owner is Synapsium-Labs; `CCRC_RELEASE_OWNER` is the
//        one literal the install and update paths build their URL from.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/** SPDX id, spelled once here and required everywhere it is claimed. */
const SPDX = 'AGPL-3.0-only';

/** sha256 of the GNU AGPL-3.0 text as published at
 *  https://www.gnu.org/licenses/agpl-3.0.txt (34,523 bytes, 661 lines),
 *  fetched 2026-08-22 and installed UNMODIFIED.
 *
 *  Pinned as a hash on purpose. A licence is only the licence while it is
 *  verbatim: an edited copy is a new, unreviewed legal document wearing a
 *  familiar name, and GitHub's licence detector stops recognising it — which
 *  is how a repo ends up looking licensed while granting nothing. Changing
 *  this constant is a deliberate legal act, not a test fix. */
const AGPL_SHA256 = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';

describe('LICENSE', () => {
  it('exists at the repo root, where every tool looks for it', () => {
    expect(existsSync(join(REPO, 'LICENSE')), 'no LICENSE at the repo root').toBe(true);
  });

  it('is the GNU AGPL-3.0 text, byte for byte', () => {
    const text = read('LICENSE');
    const got = createHash('sha256').update(text).digest('hex');
    expect(got,
      'LICENSE no longer matches the canonical AGPL-3.0 text — if this change is '
      + 'deliberate, re-fetch from https://www.gnu.org/licenses/ and update AGPL_SHA256')
      .toBe(AGPL_SHA256);
  });

  it('says what it is, in the places a reader and a parser each look', () => {
    // Belt and braces to the hash: if the hash is ever updated carelessly,
    // these still fail on a licence that is not the AGPL.
    const text = read('LICENSE');
    expect(text).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(text).toContain('Version 3, 19 November 2007');
    expect(text).toContain('13. Remote Network Interaction');   // the clause AGPL exists for
    expect(text).toContain('END OF TERMS AND CONDITIONS');
  });

  it('carries no copyright line of ours prepended to it', () => {
    // The FSF text opens with the FSF's own notice. Prepending our copyright
    // is the common mistake: it breaks verbatim-ness and GitHub's detector,
    // and the notice belongs with the PROGRAM (README) rather than inside the
    // licence. This asserts the file still starts where the FSF text starts.
    expect(read('LICENSE').split('\n')[0].trim()).toBe('GNU AFFERO GENERAL PUBLIC LICENSE');
  });
});

describe('the license field, in the packages that are real', () => {
  const pkg = (dir: string): Record<string, unknown> =>
    JSON.parse(read(join(dir, 'package.json'))) as Record<string, unknown>;

  it.each(['server', 'agent', 'pwa'])('%s/package.json declares %s', (dir) => {
    expect(pkg(dir).license, `${dir}/package.json has no license field`).toBe(SPDX);
  });

  it('shared/ does NOT — it is a resolver shim, not a package (S8)', () => {
    // shared/'s package.json exists for ONE reason: a bare "type":"module"
    // marker, without which tsc emits CommonJS into dist/shared/ and the
    // server dies at boot. Adding a license field there would assert it is a
    // distributable package, which it is not. Pinned so the next person to
    // "fix the inconsistency" has to read this instead.
    expect(pkg('shared').license).toBeUndefined();
    expect(pkg('shared').type, "shared/'s load-bearing marker is gone").toBe('module');
  });

  it('every package.json in the tree is either licensed or the shim', () => {
    // Catches a NEW package added later without a license field, which is the
    // realistic way this decays.
    const dirs = readdirSync(REPO, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .filter((d) => existsSync(join(REPO, d.name, 'package.json')))
      .map((d) => d.name);
    for (const d of dirs) {
      const lic = pkg(d).license;
      expect(lic === SPDX || d === 'shared',
        `${d}/package.json declares license=${String(lic)} — expected ${SPDX}`).toBe(true);
    }
  });
});

describe('README states the notice, since no source file does', () => {
  // S8 rules out per-file headers, which makes this section the ONLY place the
  // copyright is asserted. That is a deliberate trade, and it only holds while
  // the section is actually there.
  const readme = (): string => read('README.md');

  it('has a License section naming the holder and the licence', () => {
    expect(readme()).toMatch(/^## License$/m);
    expect(readme()).toContain('Copyright (C) 2026 Synapsium Labs');
    expect(readme()).toContain('GNU Affero General Public License');
  });

  it('links the LICENSE file, so the full text is one click away', () => {
    expect(readme()).toContain('(LICENSE)');
  });

  it('explains §13 — the clause that is the whole reason for choosing AGPL', () => {
    // ccrc is a server reached over a network: the case a plain GPL does not
    // reach. A reader deciding whether they may deploy this needs that said
    // plainly, not left implicit in a 661-line legal text.
    expect(readme()).toMatch(/§13|section 13/i);
  });
});

describe('the release owner (S1)', () => {
  const OLD_ORG = 'example-org';
  const OWNER = /^CCRC_RELEASE_OWNER="([^"]+)"$/m;

  it.each(['install.sh', 'ccd/ccrc'])('%s builds its release URL from the ruled owner', (f) => {
    const m = OWNER.exec(read(f));
    expect(m, `${f} no longer spells CCRC_RELEASE_OWNER`).not.toBeNull();
    expect(m![1]).toBe('Synapsium-Labs');
  });

  it('the previous org survives nowhere in shipping code', () => {
    // The transfer's real hazard: the release URL is built from this literal,
    // so a stale copy anywhere sends install.sh and `ccrc update` to a URL
    // that lives only as long as GitHub's post-transfer redirect — which ends
    // the moment anyone recreates the old name. docs/ is excluded: the design
    // record legitimately describes the history, and the S2 sweep owns it.
    const shipped = ['install.sh', 'ccd/ccrc', 'ccd/ccd', 'deploy/deploy.sh', 'README.md'];
    for (const f of shipped) {
      if (!existsSync(join(REPO, f))) continue;
      expect(read(f), `${f} still names ${OLD_ORG}`).not.toContain(OLD_ORG);
    }
  });
});
