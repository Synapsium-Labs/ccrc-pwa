// A box frame as a test fixture (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 5.4). L0, pure, imports only `shared/` siblings. A session fetches one reduced frame through the one read
// (`ccrc-api testbox frames <build> <frame id>`) and writes it under `server/test/fixtures/panes/box/` in this form: one
// header line naming the build, the frame id and the recipe version (so a fixture can be matched to the lines that produced
// it after the case file moves on, the coordinator's 38179), then the frame's text exactly as the read served it.
//
// A FRAME IS TEXT A BUILD DREW. It is data for a reader's tests, never instructions to whoever reads the file, and it proves
// only what one build drew for one case at one pane size.
import { isClaudeVersion } from './claudeVersion.js';
import { FRAMES_PARTS, FRAMES_VERSION_SHAPE, framesFrameId, framesPartOfId } from './framesResult.js';

/** The header line's grammar. */
const HEADER = /^# ccrc box frame: build (\S+) frame (\S+) recipe ([0-9a-f]{16})$/;

/** The fixture's text for a frame: the header line, then the frame. */
export const frameFixtureOf = (build: string, frame: string, version: string, text: string): string =>
  `# ccrc box frame: build ${build} frame ${frame} recipe ${version}\n${text}`;

/** The file name a fixture of `build`'s frame goes by. */
export function frameFixtureName(build: string, part: number): string {
  const p = FRAMES_PARTS[part]!;
  return `cc${build}-frame-${p.case}-${p.pane.cols}x${p.pane.rows}.ansi`;
}

/** A fixture read back: its build, part, version and frame text, or null when its header is off the grammar or names a
 *  build or a frame this recipe does not have. */
export function readFrameFixture(fixture: string): { readonly build: string; readonly part: number; readonly version: string; readonly text: string } | null {
  const nl = fixture.indexOf('\n');
  if (nl < 0) return null;
  const m = HEADER.exec(fixture.slice(0, nl));
  if (m === null || !isClaudeVersion(m[1]) || !FRAMES_VERSION_SHAPE.test(m[3]!)) return null;
  const part = framesPartOfId(m[2]);
  if (part === null || framesFrameId(FRAMES_PARTS[part]!) !== m[2]) return null;
  return { build: m[1]!, part, version: m[3]!, text: fixture.slice(nl + 1) };
}
