// Character — the Overlord's two faces, drawn from the generated art, in any of fourteen moods.
//
// NO COLOUR HERE. Every leaf carries one `chr-t-<tone>` class, and `characters.css` maps that tone to a token, so a
// character follows the palette and both skins. A `fill`, a `style` or a hex in this file would be a second owner of
// the colour, and `characters-component.test.tsx` refuses the first two.
//
// NO MARKUP STRING. The children are made by `createElement` from `ART`'s nodes, in `Icon`'s way. One `createElement`
// call draws a `g`, a `path` or a `rect`, so the tree is walked by one function and nothing is written twice.
//
// MOTION. The animations are steps-only CSS (`characters.css`). `data-still` holds the resting pose: by the caller
// (`play={false}`) or by the viewer (reduced motion, followed mid-session by `usePrefersReducedMotion`).
import { createElement, type ReactNode } from 'react';
import type { Character as CharacterName, Mood } from '../../../shared/face';
import { cn } from '../lib/cn';
import { usePrefersReducedMotion } from '../lib/use-reduced-motion';
import { ART, type ArtNode } from './art';
import './characters.css';

export interface CharacterProps {
  readonly character: CharacterName;
  readonly mood: Mood;
  /** Whole multiples only: 32, 64 or 128 CSS pixels. Default 1. */
  readonly scale?: 1 | 2 | 4;
  /** False holds the still frame (`data-still`). Default true. Reduced motion holds it whatever this says. */
  readonly play?: boolean;
  /** Overrides the drawn label, for a caller that names the mood's cause. */
  readonly label?: string;
  readonly className?: string;
}

const CELL = 32;

/** One node, and its children, as an element. A `g` has no tone; every leaf has one. */
function draw(node: ArtNode, key: number): ReactNode {
  return createElement(
    node.tag,
    {
      key,
      className: cn(node.tone && `chr-t-${node.tone}`, node.cls),
      d: node.d,
      x: node.x,
      y: node.y,
      width: node.w,
      height: node.h,
      fillOpacity: node.alpha,
      transform: node.at ? `translate(${node.at[0]} ${node.at[1]})` : undefined,
    },
    node.kids?.map(draw),
  );
}

export function Character({ character, mood, scale = 1, play = true, label, className }: CharacterProps): ReactNode {
  const reduced = usePrefersReducedMotion();
  const art = ART[character][mood];
  const size = CELL * scale;
  return (
    <svg
      className={cn('chr', className)}
      viewBox={`0 0 ${CELL} ${CELL}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label ?? art.label}
      data-still={play && !reduced ? undefined : ''}
    >
      {art.nodes.map(draw)}
    </svg>
  );
}
