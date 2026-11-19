// The flow's diagram (flows design 2026-11-19 §9): two opposite arrows between the same blocks run in their own lanes,
// so neither line nor label is drawn over the other (measured on a phone, 2026-11-19).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { skeletonFlowDoc } from '../../shared/flows';
import { FlowDiagram } from '../src/flows/FlowDiagram';
import { addStepAfter, setTarget } from '../src/flows/flowEdits';

afterEach(cleanup);

describe('the flow diagram', () => {
  it('draws a pair of opposite arrows apart, each label beside its own arrow', () => {
    const doc = skeletonFlowDoc('x');
    doc.blocks.push(
      { id: 'a', kind: 'instruction', title: 'A', role: 'worker', outcomes: ['go'], at: { x: 0, y: 400 } },
      { id: 'b', kind: 'gate', title: 'B', role: 'operator', gate: { kind: 'approval' }, outcomes: ['back'], at: { x: 300, y: 400 } },
    );
    doc.edges.push({ from: 'a', outcome: 'go', to: 'b' }, { from: 'b', outcome: 'back', to: 'a' });
    const { container } = render(<FlowDiagram doc={doc} selected={null} />);
    const groups = [...container.querySelectorAll('g')].filter((g) => ['go', 'back'].includes(g.querySelector('text')?.textContent ?? ''));
    expect(groups).toHaveLength(2);
    const [go, back] = groups.map((g) => ({ d: g.querySelector('path')!.getAttribute('d'), y: Number(g.querySelector('text')!.getAttribute('y')) }));
    expect(go!.d).not.toBe(back!.d?.split(/[ ,MC]+/).filter(Boolean).reverse().join(' '));
    expect(Math.abs(go!.y - back!.y)).toBeGreaterThanOrEqual(20);
  });

  it('sits on the page background, never the terminal well', () => {
    const { container } = render(<FlowDiagram doc={skeletonFlowDoc('x')} selected={null} />);
    expect(container.firstElementChild!.className).toContain('bg-page');
    expect(container.firstElementChild!.className).not.toContain('bg-well');
  });

  it('loops a fix round in one row under the blocks, never across them', () => {
    const r = addStepAfter(skeletonFlowDoc('x'), 'dispatch')!;
    const doc = setTarget(r.doc, 'review', 'findings', r.id);
    for (const b of doc.blocks) b.at = { ...b.at, y: 100 };
    const { container } = render(<FlowDiagram doc={doc} selected={null} />);
    const findings = [...container.querySelectorAll('g')].find((g) => g.querySelector('text')?.textContent === 'findings')!;
    const [, y0] = findings.querySelector('path')!.getAttribute('d')!.slice(1).split(/[ C]/)[0]!.split(',').map(Number);
    expect(y0).toBe(100 + 64);
  });
});

describe('moving steps on the diagram (wave 5a)', () => {
  const doc = skeletonFlowDoc('x');
  const first = doc.blocks[0]!;

  it('takes no input without a move handler: the read-only diagram of wave 1', () => {
    render(<FlowDiagram doc={doc} selected={null} />);
    expect(screen.queryByRole('button', { name: new RegExp(first.title) })).toBeNull();
  });

  it('moves a step with the arrow keys, a grid step at a time, five with Shift', () => {
    const onMove = vi.fn();
    render(<FlowDiagram doc={doc} selected={null} onMove={onMove} onSelect={() => undefined} />);
    const step = screen.getByRole('button', { name: `${first.title}: arrow keys move it` });
    fireEvent.keyDown(step, { key: 'ArrowRight' });
    expect(onMove).toHaveBeenLastCalledWith(first.id, { x: first.at.x + 8, y: first.at.y });
    fireEvent.keyDown(step, { key: 'ArrowDown', shiftKey: true });
    expect(onMove).toHaveBeenLastCalledWith(first.id, { x: first.at.x, y: first.at.y + 40 });
  });

  it('drags a step by the pointer; a click without a drag, Enter or Space selects it', () => {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    render(<FlowDiagram doc={doc} selected={null} onMove={onMove} onSelect={onSelect} />);
    const step = screen.getByRole('button', { name: `${first.title}: arrow keys move it` });
    fireEvent.pointerDown(step, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(step, { clientX: 50, clientY: 26, pointerId: 1 });
    fireEvent.pointerUp(step, { clientX: 50, clientY: 26, pointerId: 1 });
    expect(onMove).toHaveBeenCalledWith(first.id, { x: first.at.x + 40, y: first.at.y + 16 });
    fireEvent.click(step);   // the click a drag ends with selects nothing
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(step, { clientX: 10, clientY: 10, pointerId: 2, button: 0 });
    fireEvent.pointerUp(step, { clientX: 11, clientY: 10, pointerId: 2 });
    expect(onMove).toHaveBeenCalledTimes(1);
    fireEvent.click(step);
    expect(onSelect).toHaveBeenCalledWith(first.id);
    fireEvent.keyDown(step, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
