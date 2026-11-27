// The flow's diagram (flows design 2026-11-19 §9; mockup `docs/design/2026-11-19-flows-design/`). Ring L4: a
// component. Wave 1 draws it read-only: blocks at their stored places, every outcome an arrow drawn from the blocks' own
// geometry, a fix round (an arrow back to an earlier part of the wave) dashed in the attention hue. Wave 5a adds moving: with
// `onMove`, a step is dragged by the pointer or moved by the arrow keys, and a press selects it. Connecting by dragging and
// live positions on the canvas are wave 5b.
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { flowPhases, type FlowBlock, type FlowDoc } from '../../../shared/flows';
import { GRID, KIND_WORD } from './flowEdits';

const W = 176;
/** How far apart the two arrows of a pair (a → b and b → a) run, and how far each label sits off its own arrow. */
const LANE = 10;
const LABEL_OFF = 14;
const H = 64;
const PAD = 24;

type Side = 'l' | 'r' | 't' | 'b';
const DIR: Record<Side, [number, number]> = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

function port(b: FlowBlock, side: Side): [number, number] {
  const { x, y } = b.at;
  return side === 'l' ? [x, y + H / 2] : side === 'r' ? [x + W, y + H / 2] : side === 't' ? [x + W / 2, y] : [x + W / 2, y + H];
}

/** Which sides an arrow leaves and enters by: across when the blocks sit side by side, down or up otherwise. */
function sides(a: FlowBlock, b: FlowBlock): [Side, Side] {
  const dx = b.at.x - a.at.x;
  const dy = b.at.y - a.at.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['r', 'l'] : ['l', 'r'];
  return dy >= 0 ? ['b', 't'] : ['t', 'b'];
}

/** A press that travels less than this (pixels) is a click, not a drag. */
const DRAG_SLOP = 4;
const KEY_STEP: Readonly<Record<string, [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

interface Drag { id: string; pointer: number; x0: number; y0: number; dx: number; dy: number }

/** The flow's diagram. With `onMove` (wave 5a) each step is a button: dragged by the pointer, or moved by the arrow keys a
 *  grid step at a time (five with Shift); a click, Enter or Space selects it. Without it the diagram takes no input. */
export function FlowDiagram(p: {
  readonly doc: FlowDoc; readonly selected: string | null;
  readonly onMove?: (id: string, at: { x: number; y: number }) => void; readonly onSelect?: (id: string) => void;
}): ReactNode {
  const [drag, setDrag] = useState<Drag | null>(null);
  // The click a drag ends with is not a selection.
  const dragged = useRef(false);
  const live = (b: FlowBlock): FlowBlock => (drag !== null && drag.id === b.id ? { ...b, at: { x: b.at.x + drag.dx, y: b.at.y + drag.dy } } : b);
  const doc: FlowDoc = drag === null ? p.doc : { ...p.doc, blocks: p.doc.blocks.map(live) };
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const phase = flowPhases(doc);
  const width = Math.max(320, ...doc.blocks.map((b) => b.at.x + W)) + PAD;
  const height = Math.max(160, ...doc.blocks.map((b) => b.at.y + H)) + PAD * 2;
  return (
    <div className="overflow-auto rounded-md border border-edge-subtle bg-page">
      <svg width={width} height={height} role="img" aria-label="The flow's diagram" className="block font-mono">
        <defs>
          <marker id="flow-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0L10,5L0,10z" style={{ fill: 'var(--edge-strong)' }} />
          </marker>
          <marker id="flow-ah-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0L10,5L0,10z" style={{ fill: 'var(--status-attention)' }} />
          </marker>
        </defs>
        {doc.edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (a === undefined || b === undefined) return null;
          const back = (phase.get(e.to) ?? 0) < (phase.get(e.from) ?? 0) && b.kind !== 'protocol';
          // A fix round between blocks in one row loops under them, never across the blocks between.
          const under = a === b || (back && Math.abs(a.at.y - b.at.y) < H);
          const [sa, sb] = under ? (['b', 'b'] as [Side, Side]) : sides(a, b);
          // A pair of opposite arrows would draw one line twice: each runs in its own lane, to the left of its direction.
          const paired = a !== b && doc.edges.some((x) => x.from === e.to && x.to === e.from);
          const perp: [number, number] = [DIR[sa][1], -DIR[sa][0]];
          const lane = (q: [number, number], d: number): [number, number] => (paired ? [q[0] + perp[0] * d, q[1] + perp[1] * d] : q);
          const A = lane(port(a, sa), LANE);
          const B = lane(port(b, sb), LANE);
          const k = back || a === b ? 60 : Math.max(30, Math.hypot(B[0] - A[0], B[1] - A[1]) / 2.5);
          const c1: [number, number] = [A[0] + DIR[sa][0] * k, A[1] + DIR[sa][1] * k];
          const c2: [number, number] = [B[0] + DIR[sb][0] * k, B[1] + DIR[sb][1] * k];
          const curve: [number, number] = [(A[0] + B[0] + c1[0] + c2[0]) / 4, (A[1] + B[1] + c1[1] + c2[1]) / 4];
          const mid: [number, number] = paired ? lane(curve, LABEL_OFF) : [curve[0], curve[1] - 4];
          return (
            <g key={`${e.from}/${e.outcome}`}>
              <path d={`M${A} C${c1} ${c2} ${B}`} fill="none" strokeWidth={1.5} markerEnd={back ? 'url(#flow-ah-back)' : 'url(#flow-ah)'}
                    strokeDasharray={back ? '5 4' : undefined}
                    style={{ stroke: back ? 'var(--status-attention)' : 'var(--edge-strong)' }} />
              <text x={mid[0]} y={mid[1]} textAnchor="middle" dominantBaseline={paired ? 'middle' : undefined} fontSize={11}
                    style={{ fill: back ? 'var(--status-attention-text)' : 'var(--ink-tertiary)' }}>{e.outcome}</text>
            </g>
          );
        })}
        {doc.blocks.map((b) => {
          const on = b.id === p.selected;
          const locked = b.kind === 'protocol';
          return (
            <g key={b.id} transform={`translate(${b.at.x},${b.at.y})`}
               {...(p.onMove === undefined ? {} : {
                 role: 'button', tabIndex: 0, 'aria-label': `${b.title}: arrow keys move it`, className: 'flow-movable',
                 onClick: () => { if (dragged.current) dragged.current = false; else p.onSelect?.(b.id); },
                 onKeyDown: (ev: KeyboardEvent<SVGGElement>) => {
                   if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); p.onSelect?.(b.id); return; }
                   const k = KEY_STEP[ev.key];
                   if (k === undefined) return;
                   ev.preventDefault();
                   const step = GRID * (ev.shiftKey ? 5 : 1);
                   p.onMove!(b.id, { x: b.at.x + k[0] * step, y: b.at.y + k[1] * step });
                 },
                 onPointerDown: (ev: PointerEvent<SVGGElement>) => {
                   if (ev.button !== 0) return;
                   ev.currentTarget.setPointerCapture?.(ev.pointerId);
                   setDrag({ id: b.id, pointer: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, dy: 0 });
                 },
                 onPointerMove: (ev: PointerEvent<SVGGElement>) => {
                   if (drag === null || drag.pointer !== ev.pointerId) return;
                   setDrag({ ...drag, dx: ev.clientX - drag.x0, dy: ev.clientY - drag.y0 });
                 },
                 onPointerUp: (ev: PointerEvent<SVGGElement>) => {
                   if (drag === null || drag.pointer !== ev.pointerId) return;
                   const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
                   setDrag(null);
                   const base = p.doc.blocks.find((x) => x.id === drag.id)!;
                   dragged.current = Math.abs(dx) + Math.abs(dy) >= DRAG_SLOP;
                   if (dragged.current) p.onMove!(drag.id, { x: base.at.x + dx, y: base.at.y + dy });
                 },
                 onPointerCancel: () => setDrag(null),
               })}>
              <rect width={W} height={H} rx={10} strokeWidth={on ? 2 : 1} strokeDasharray={locked ? '4 3' : undefined}
                    style={{ fill: locked ? 'var(--bg-raised)' : 'var(--bg-surface)', stroke: on ? 'var(--accent)' : 'var(--edge-strong)' }} />
              <text x={12} y={20} fontSize={10} style={{ fill: 'var(--ink-tertiary)', letterSpacing: '0.08em' }}>
                {`${KIND_WORD[b.kind].toUpperCase()}${locked ? ' · LOCKED' : ''}`}
              </text>
              <text x={12} y={40} fontSize={13} className="font-ui"
                    style={{ fill: locked ? 'var(--ink-secondary)' : 'var(--ink-primary)' }}>{b.title.length > 22 ? `${b.title.slice(0, 21)}…` : b.title}</text>
              <text x={12} y={56} fontSize={10} style={{ fill: 'var(--ink-tertiary)' }}>{b.role}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
