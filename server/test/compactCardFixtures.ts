// The compaction card's fixtures, shared by the hook's tests
// (session-hook.test.ts) and the helper's (compact-card.test.ts) so the two
// suites cannot drift apart on what a transcript line or a graph looks like.
//
// Every shape here was MEASURED, not remembered (2026-09-10, Claude Code
// 2.1.266, this repo's own graphify 0.9.9 graph): an assistant row carries
// `message.content[]` items of `type:"tool_use"` with `name` and `input`; the
// harness's boundary row is `{type:"system", subtype:"compact_boundary"}`;
// the compact summary is a `user` row with `isCompactSummary:true` and a
// STRING `message.content` (1,307 of 1,307 summaries across every lane on the
// fleet box); graph.json is networkx node-link JSON — `nodes[]` with `id`,
// `label`, `source_file`, `source_location` (`L<n>`), `community`, and the
// edges under `links[]` as `{source, target, relation}` — with
// `built_at_commit` as its LAST key.

export const tl = {
  toolUse: (name: string, input: object): string =>
    JSON.stringify({ type: 'assistant', message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name, input }] } }),
  boundary: (): string =>
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted',
      compactMetadata: { trigger: 'manual', preTokens: 100, postTokens: 10 } }),
  summary: (text: string): string =>
    JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: text } }),
  user: (text: string): string =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
};

export interface GraphNodeFx {
  id: string; label: string; norm_label: string; file_type: string; source_file: string;
  source_location: string; community: number; _origin: string; metadata?: { kind: string };
}
export interface GraphLinkFx {
  source: string; target: string; relation: string; weight: number; confidence: string; confidence_score: number;
}
export interface GraphContent { nodes: GraphNodeFx[]; links: GraphLinkFx[]; labels: Record<string, string> }

export const node = (id: string, label: string, file: string, line: number, community: number,
  kind?: string): GraphNodeFx => ({
  id, label, norm_label: label, file_type: 'code', source_file: file, source_location: `L${line}`,
  community, _origin: 'ast', ...(kind ? { metadata: { kind } } : {}),
});
export const link = (source: string, target: string, relation: string): GraphLinkFx =>
  ({ source, target, relation, weight: 1.0, confidence: 'EXTRACTED', confidence_score: 1.0 });

/** Twelve files. `statusline.ts` is depended on by `watch.ts` (in-set in
 *  most tests) and `fleet.ts` (outside); `models.ts` by `ModelSheet.tsx`.
 *  `big.ts` carries SIX symbols and FOUR outside dependents (`d1`–`d4`), so
 *  the five-symbol cap, the three-dependent cap and the `(+n)` rest all fire;
 *  `shared/api.ts` has no `metadata.kind` and no `L1` node named `api.ts`, so
 *  the file node is the degree fallback. Community 0 is labelled `watch.ts`,
 *  1 `SessionScreen.tsx`, 3 `api.ts`, 4 `big.ts`; community 2 (the hook) has
 *  NO label, which is the "omitted" branch. */
export const GRAPH: GraphContent = {
  nodes: [
    node('f_statusline', 'statusline.ts', 'server/src/pane/statusline.ts', 1, 0, 'file'),
    node('parseStatusline', 'parseStatusline', 'server/src/pane/statusline.ts', 132, 0),
    node('parseCtxPct', 'parseCtxPct', 'server/src/pane/statusline.ts', 105, 0),
    node('f_watch', 'watch.ts', 'server/src/watch.ts', 1, 0, 'file'),
    node('sweepMail', 'sweepMail', 'server/src/watch.ts', 40, 0),
    node('f_fleet', 'fleet.ts', 'server/src/fleet.ts', 1, 0, 'file'),
    node('f_models', 'models.ts', 'pwa/src/lib/models.ts', 1, 1, 'file'),
    node('modelOptions', 'modelOptions', 'pwa/src/lib/models.ts', 29, 1),
    node('f_sheet', 'ModelSheet.tsx', 'pwa/src/session/ModelSheet.tsx', 1, 1, 'file'),
    node('f_hook', 'session-hook.sh', 'ccd/session-hook.sh', 1, 2, 'file'),
    node('FleetSession', 'FleetSession', 'shared/api.ts', 10, 3),
    node('FLEET_PROTO', 'FLEET_PROTO', 'shared/api.ts', 5, 3),
    node('f_big', 'big.ts', 'server/src/big.ts', 1, 4, 'file'),
    node('s1', 's1', 'server/src/big.ts', 10, 4), node('s2', 's2', 'server/src/big.ts', 20, 4),
    node('s3', 's3', 'server/src/big.ts', 30, 4), node('s4', 's4', 'server/src/big.ts', 40, 4),
    node('s5', 's5', 'server/src/big.ts', 50, 4), node('s6', 's6', 'server/src/big.ts', 60, 4),
    node('f_d1', 'd1.ts', 'server/src/d1.ts', 1, 4, 'file'), node('f_d2', 'd2.ts', 'server/src/d2.ts', 1, 4, 'file'),
    node('f_d3', 'd3.ts', 'server/src/d3.ts', 1, 4, 'file'), node('f_d4', 'd4.ts', 'server/src/d4.ts', 1, 4, 'file'),
  ],
  links: [
    link('f_statusline', 'parseStatusline', 'contains'),
    link('f_statusline', 'parseCtxPct', 'contains'),
    link('f_watch', 'sweepMail', 'contains'),
    link('sweepMail', 'parseStatusline', 'calls'),
    link('f_watch', 'f_statusline', 'imports_from'),
    link('f_fleet', 'parseCtxPct', 'calls'),
    link('f_models', 'modelOptions', 'contains'),
    link('f_sheet', 'modelOptions', 'imports_from'),
    link('f_fleet', 'FleetSession', 'imports_from'),
    link('f_sheet', 'FleetSession', 'imports_from'),
    ...['s1', 's2', 's3', 's4', 's5', 's6'].map((x) => link('f_big', x, 'contains')),
    link('f_d1', 's1', 'calls'), link('f_d2', 's1', 'calls'), link('f_d3', 's1', 'calls'), link('f_d4', 's1', 'calls'),
    link('f_d1', 's2', 'calls'), link('f_d2', 's3', 'calls'),
  ],
  labels: { '0': 'watch.ts', '1': 'SessionScreen.tsx', '3': 'api.ts', '4': 'big.ts' },
};

/** graph.json text as graphify writes it — `built_at_commit` LAST. */
export const graphJson = (content: GraphContent, built: string): string =>
  JSON.stringify({ directed: false, multigraph: false, graph: {}, nodes: content.nodes,
    links: content.links, hyperedges: [], built_at_commit: built });
