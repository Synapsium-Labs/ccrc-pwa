// The part a Markdown body is rendering (X2 P6.1 Step 0c (b), Changes since on the current part). Ring L4: a React context
// the parts bar provides around each part it mounts (`MarkdownParts.tsx`) and the reader frame reads (`ReaderFrame.tsx`), so
// the frame's history can answer "what changed in this part" against the whole text the leaf read, without a second read of
// the head. Nothing here decides: the decision is `reader/partChanges.ts`'s.
import { createContext } from 'react';
import type { MdPart } from './mdParts';

/** The part on screen: `whole`, the whole text the leaf read (the bytes the parts are cut from); `part`, its cut. */
export interface PartContextValue {
  readonly whole: string;
  readonly part: MdPart;
}

/** `null`, the default, has ONE meaning: the body is not a part of a longer text (a text read whole under the render gate, or
 *  a body outside the parts bar). */
export const PartContext = createContext<PartContextValue | null>(null);
