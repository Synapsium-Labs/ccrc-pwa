// The templates ccrc ships (flows design §6). Ring: L1 (data, imports only L0), context Coordination (C5).
//
// `ccrc@1` is DESCRIPTIVE: its prompts summarise today's method in one line each and say so, because
// nothing reads them before the engine wave, and a word-for-word copy of the skills' pinned clauses would
// be a second copy of that text. The wave that moves the method out of the skills ships it as `ccrc@2`,
// and an operator's copy of v1 then shows "template moved to v2".
//
// A plugin's templates never live here: this repository is public (§6).
import { FLOW_SCHEMA, type FlowDoc, type FlowTemplateView } from '../../../shared/flows.js';

export type FlowTemplate = FlowTemplateView;

const DESCRIPTIVE = '(Descriptive in ccrc@1 — the running method is still the ccrc skills.) ';

const ccrc1: FlowDoc = {
  schema: FLOW_SCHEMA,
  title: 'ccrc',
  start: 'brainstorm',
  blocks: [
    { id: 'brainstorm', kind: 'skill', title: 'Brainstorm the spec', role: 'coordinator', skill: 'superpowers:brainstorming',
      prompt: `${DESCRIPTIVE}Turn the operator's ask into a written spec, asking before deciding.`, outcomes: ['done'], at: { x: 24, y: 96 } },
    { id: 'spec-approved', kind: 'gate', title: 'Spec approved', role: 'operator', gate: { kind: 'approval' },
      outcomes: ['approved', 'changes'], at: { x: 264, y: 96 } },
    { id: 'write-plan', kind: 'skill', title: 'Write the plan', role: 'coordinator', skill: 'superpowers:writing-plans',
      prompt: `${DESCRIPTIVE}Write the plan the waves follow, with its deviation ledger.`, outcomes: ['done'], at: { x: 504, y: 96 } },
    { id: 'open-wave', kind: 'protocol', title: 'Open the wave', role: 'coordinator', step: 'open-wave', outcomes: ['opened'], at: { x: 744, y: 96 } },
    { id: 'dispatch', kind: 'protocol', title: 'Dispatch the wave', role: 'coordinator', step: 'dispatch', outcomes: ['dispatched'], at: { x: 744, y: 270 } },
    { id: 'build', kind: 'skill', title: 'Build, test first', role: 'worker', skill: 'superpowers:subagent-driven-development',
      prompt: `${DESCRIPTIVE}Implement the wave's tasks of {{plan.path}}, a failing test first, then report wave-done.`,
      outcomes: ['done'], at: { x: 504, y: 270 } },
    { id: 'verify', kind: 'protocol', title: 'Wave done, re-measured', role: 'coordinator', step: 'verify', outcomes: ['verified'], at: { x: 264, y: 270 } },
    { id: 'review', kind: 'protocol', title: 'Review run', role: 'reviewer', step: 'review', outcomes: ['clean', 'findings'], at: { x: 24, y: 270 } },
    { id: 'merged', kind: 'gate', title: 'PR merged', role: 'coordinator', gate: { kind: 'pr-state', prState: 'merged' },
      outcomes: ['merged'], at: { x: 24, y: 450 } },
    { id: 'close-wave', kind: 'protocol', title: 'Close the wave', role: 'coordinator', step: 'close-wave', outcomes: ['next-wave', 'last'], at: { x: 264, y: 450 } },
    { id: 'end', kind: 'protocol', title: 'Programme ends', role: 'coordinator', step: 'end', outcomes: [], at: { x: 504, y: 450 } },
  ],
  edges: [
    { from: 'brainstorm', outcome: 'done', to: 'spec-approved' },
    { from: 'spec-approved', outcome: 'approved', to: 'write-plan' },
    { from: 'spec-approved', outcome: 'changes', to: 'brainstorm' },
    { from: 'write-plan', outcome: 'done', to: 'open-wave' },
    { from: 'open-wave', outcome: 'opened', to: 'dispatch' },
    { from: 'dispatch', outcome: 'dispatched', to: 'build' },
    { from: 'build', outcome: 'done', to: 'verify' },
    { from: 'verify', outcome: 'verified', to: 'review' },
    { from: 'review', outcome: 'findings', to: 'build' },
    { from: 'review', outcome: 'clean', to: 'merged' },
    { from: 'merged', outcome: 'merged', to: 'close-wave' },
    { from: 'close-wave', outcome: 'next-wave', to: 'open-wave' },
    { from: 'close-wave', outcome: 'last', to: 'end' },
  ],
};

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  { id: 'ccrc', version: 1, title: 'ccrc', note: 'ccrc\'s own method: spec, plan, waves, review, merge. Descriptive in v1.', doc: ccrc1 },
];

export function findTemplate(id: string, version?: number): FlowTemplate | undefined {
  const all = FLOW_TEMPLATES.filter((t) => t.id === id);
  return version === undefined ? all.at(-1) : all.find((t) => t.version === version);
}
