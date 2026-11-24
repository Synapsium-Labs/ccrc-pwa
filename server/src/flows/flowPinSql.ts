// The flow a programme pins (Flows wave 2, plan `2026-11-19-flows-w2.md`). Ring: L1, context Coordination (C5): SQL text
// only, no I/O, so both `programs` inserters (`CoordStore.openRun`, L3, and `planStore.applyPlanChanges`, L1) share one
// spelling. The pin is the default flow's newest published version, evaluated inside the INSERT itself, so the version
// is the one standing at the row's first write; `ON CONFLICT(slug) DO NOTHING` on both inserts makes it write-once. No
// default, or a default with no version (which `setDefaultFlow` refuses anyway), leaves both columns NULL.

/** The two columns, in the order `PROGRAM_FLOW_PIN_VALUES` fills them. */
export const PROGRAM_FLOW_PIN_COLUMNS = 'flowId, flowVersion';

const LATEST = '(SELECT MAX(v.version) FROM flow_versions v JOIN flow_settings s ON v.flowId = s.defaultFlowId WHERE s.id = 1)';

/** Two SQL expressions for the VALUES list: the default flow's id when it has a version, then that version. */
export const PROGRAM_FLOW_PIN_VALUES =
  `(SELECT s.defaultFlowId FROM flow_settings s WHERE s.id = 1 AND ${LATEST} IS NOT NULL), ${LATEST}`;
