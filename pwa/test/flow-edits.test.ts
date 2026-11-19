// The Flows editor's edits (flows design 2026-11-19 §9): each keeps a publishable flow publishable, or says why not.
import { describe, expect, it } from 'vitest';
import { skeletonFlowDoc, validateFlow, type FlowDoc } from '../../shared/flows';
import {
  GRID, moveBlock,
  addOutcome, addStepAfter, flowFileName, freshId, outlineOrder, removeOutcome, removeStep, setBlock, setTarget, targetOf,
} from '../src/flows/flowEdits';

const sk = (): FlowDoc => skeletonFlowDoc('x');

describe('flow edits', () => {
  it('outlineOrder walks from the start, following outcomes, and keeps an unreachable block last', () => {
    const d = sk();
    d.blocks.push({ id: 'lost', kind: 'instruction', title: 'Lost', role: 'worker', outcomes: ['done'], at: { x: 0, y: 0 } });
    expect(outlineOrder(d).map((b) => b.id)).toEqual(['open-wave', 'dispatch', 'verify', 'review', 'close-wave', 'end', 'lost']);
  });

  it('a step added after dispatch takes its arrow and leads on, and the flow stays publishable', () => {
    const r = addStepAfter(sk(), 'dispatch')!;
    expect(targetOf(r.doc, 'dispatch', 'dispatched')).toBe(r.id);
    expect(targetOf(r.doc, r.id, 'done')).toBe('verify');
    expect(validateFlow(r.doc)).toEqual([]);
  });

  it('nothing is added after the end', () => {
    expect(addStepAfter(sk(), 'end')).toBeNull();
  });

  it('removing that step reconnects the arrow into it', () => {
    const r = addStepAfter(sk(), 'dispatch')!;
    const back = removeStep(r.doc, r.id);
    expect(targetOf(back, 'dispatch', 'dispatched')).toBe('verify');
    expect(validateFlow(back)).toEqual([]);
  });

  it('a protocol block is never edited, removed or given outcomes', () => {
    const d = sk();
    expect(setBlock(d, 'dispatch', { title: 'Skip it', prompt: 'x' })).toEqual(d);
    expect(removeStep(d, 'dispatch')).toEqual(d);
    expect(addOutcome(d, 'dispatch', 'skip')).toEqual(d);
    expect(removeOutcome(d, 'review', 'findings')).toEqual(d);
  });

  it('an approval gate is the operator\'s, and leaving the gate kind drops its check', () => {
    const r = addStepAfter(sk(), 'dispatch')!;
    const gate = setBlock(r.doc, r.id, { kind: 'gate' });
    expect(gate.blocks.find((b) => b.id === r.id)).toMatchObject({ kind: 'gate', gate: { kind: 'approval' }, role: 'operator' });
    const back = setBlock(gate, r.id, { kind: 'instruction' });
    expect(back.blocks.find((b) => b.id === r.id)?.gate).toBeUndefined();
  });

  it('an outcome added leads nowhere until pointed, and the validator says so', () => {
    const r = addStepAfter(sk(), 'dispatch')!;
    const more = addOutcome(r.doc, r.id, 'blocked');
    expect(validateFlow(more).some((p) => p.rule === 2)).toBe(true);
    expect(validateFlow(setTarget(more, r.id, 'blocked', 'verify'))).toEqual([]);
  });

  it('fresh ids never collide', () => {
    const r = addStepAfter(sk(), 'dispatch')!;
    expect(freshId(r.doc, 'New step')).toBe('new-step-2');
    expect(freshId(sk(), '!!!')).toBe('step');
  });

  it('a shared file is named from its title and version', () => {
    expect(flowFileName('My Flow: v2!', 3)).toBe('my-flow-v2-v3.flow.json');
    expect(flowFileName('!!!', 1)).toBe('flow-v1.flow.json');
  });
});

describe('moving a step on the canvas (wave 5a)', () => {
  it('snaps to the grid, never goes off the top or left, and leaves the original alone', () => {
    const doc = skeletonFlowDoc('x');
    const id = doc.blocks[0]!.id;
    const moved = moveBlock(doc, id, { x: 21, y: -30 });
    expect(moved.blocks[0]!.at).toEqual({ x: 24, y: 0 });
    expect(doc.blocks[0]!.at).not.toEqual({ x: 24, y: 0 });
    expect(GRID).toBe(8);
  });
  it('a move to an unknown id changes nothing', () => {
    const doc = skeletonFlowDoc('x');
    expect(moveBlock(doc, 'nope', { x: 8, y: 8 })).toBe(doc);
  });
});
