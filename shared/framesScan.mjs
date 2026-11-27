// The box frames recipe's private-name scan (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.2, rule 9): the committed matcher
// (`private-names.mjs`, its hashed list and its exemptions) asked of a whole frame, line by line and across each line
// break, as the tree's own public-text class asks it of a file (`server/src/linking/publicTextClasses.ts`). It lives here,
// a `shared/*.mjs` the console never imports, because both of its callers need it and neither can import the other: the
// runner reduces on the test box (`agent/`), and the lane and the read check again on the server (`server/`). The reducer
// (`framesReduce.ts`) takes it as an argument and stays pure.
import { PRIVATE_NAMES, hitsIn, pairHits } from './private-names.mjs';

/** The file name the matcher's exemptions are judged against: a frame is no file of the tree, so none applies. */
const FRAME_FILE = 'box-frame';

/** Whether the committed matcher hits anything in `text`: any line, or any phrase broken across two adjacent lines.
 *  @param {string} text @returns {boolean} */
export function framesScan(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (hitsIn(lines[i], FRAME_FILE, PRIVATE_NAMES).length > 0) return true;
    if (i > 0 && pairHits(lines[i - 1], lines[i], FRAME_FILE, PRIVATE_NAMES).length > 0) return true;
  }
  return false;
}
