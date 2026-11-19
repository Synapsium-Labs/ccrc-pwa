// The flow's diagram (flows design 2026-11-19 §9; mockup `docs/superpowers/specs/2026-11-19-flows-design/`). Ring L4: a
// component. Wave 1 draws it read-only: blocks at their stored places, every outcome an arrow drawn from the blocks' own
// geometry, a fix round (an arrow back to an earlier part of the wave) dashed in the attention hue. It takes no input:
// the outline selects a step, and the diagram marks it. Selecting and dragging on the canvas are the canvas wave's (§10, wave 5).
import type { ReactNode } from 'react';
import { flowPhases, type FlowBlock, type FlowDoc } from '../../../shared/flows';
import { KIND_WORD } from './flowEdits';

const W = 176;
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

export function FlowDiagram(p: { readonly doc: FlowDoc; readonly selected: string | null }): ReactNode {
  const byId = new Map(p.doc.blocks.map((b) => [b.id, b]));
  const phase = flowPhases(p.doc);
  const width = Math.max(320, ...p.doc.blocks.map((b) => b.at.x + W)) + PAD;
  const height = Math.max(160, ...p.doc.blocks.map((b) => b.at.y + H)) + PAD * 2;
  return (
    <div className="overflow-auto rounded-md border border-edge-subtle bg-well">
      <svg width={width} height={height} role="img" aria-label="The flow's diagram" className="block font-mono">
        <defs>
          <marker id="flow-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0L10,5L0,10z" style={{ fill: 'var(--edge-strong)' }} />
          </marker>
          <marker id="flow-ah-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0L10,5L0,10z" style={{ fill: 'var(--status-attention)' }} />
          </marker>
        </defs>
        {p.doc.edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (a === undefined || b === undefined) return null;
          const back = (phase.get(e.to) ?? 0) < (phase.get(e.from) ?? 0) && b.kind !== 'protocol';
          const [sa, sb] = a === b ? (['b', 'b'] as [Side, Side]) : sides(a, b);
          const A = port(a, sa);
          const B = port(b, sb);
          const k = back || a === b ? 60 : Math.max(30, Math.hypot(B[0] - A[0], B[1] - A[1]) / 2.5);
          const c1: [number, number] = [A[0] + DIR[sa][0] * k, A[1] + DIR[sa][1] * k];
          const c2: [number, number] = [B[0] + DIR[sb][0] * k, B[1] + DIR[sb][1] * k];
          const mid: [number, number] = [(A[0] + B[0] + c1[0] + c2[0]) / 4, (A[1] + B[1] + c1[1] + c2[1]) / 4];
          return (
            <g key={`${e.from}/${e.outcome}`}>
              <path d={`M${A} C${c1} ${c2} ${B}`} fill="none" strokeWidth={1.5} markerEnd={back ? 'url(#flow-ah-back)' : 'url(#flow-ah)'}
                    strokeDasharray={back ? '5 4' : undefined}
                    style={{ stroke: back ? 'var(--status-attention)' : 'var(--edge-strong)' }} />
              <text x={mid[0]} y={mid[1] - 4} textAnchor="middle" fontSize={11}
                    style={{ fill: back ? 'var(--status-attention-text)' : 'var(--ink-tertiary)' }}>{e.outcome}</text>
            </g>
          );
        })}
        {p.doc.blocks.map((b) => {
          const on = b.id === p.selected;
          const locked = b.kind === 'protocol';
          return (
            <g key={b.id} transform={`translate(${b.at.x},${b.at.y})`}>
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
