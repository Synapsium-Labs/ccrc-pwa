// Settings › Overlord's decision model (Overlord W2 Settings, plan `w2-settings.md` Task 2; spec 2026-11-09 §3.7 H6, §7.5, §11.2):
// the host and its key, then one row per catalogue question, both drawn from ONE read of `GET /api/decision-model`. Ring L4,
// context K (a settings screen): the read is the section's card read (`useCardRead`), every act goes through the section's card
// door (`useCardDoor`) and its one step-up, and every word is `decisionModelWords.ts`' (L1) or the section's refusal table's.
//
// DRAWN LIKE THE BACKSTOP AND THE RETENTION (the brief's ruling 3): not gated on a designation. A server without the read (404)
// draws no card; a read that failed draws its sentence and Read again; a read with no rows says so.
//
// EVERY ROW IS DRAWN FROM THE READ (plan SQ3, SQ4). Its radio set's checked choice is the stored mode, never the tap's, so a tap
// changes nothing until the door answers and the card reads again. Shadow and armed go through the arm door, off through the off
// door, the ceiling through the ceiling door, each with the row's side as read (`expected`). Resume, for a held row, is the arm
// door with the stored mode and no line; Approve, for an armed gate offered a newer line, is the arm door with that line. The
// console never asks which move widens: the door asks the step-up for a widening and lands a narrowing in one tap (ruling 2).
import { useState, type ReactNode } from 'react';
import { Button, RadioFieldset, Section, TextInput } from '@ccrc/ui';
import { DECISION_ROW_MODES, type DecisionModelView, type DecisionRowMode, type DecisionRowView } from '../../../../shared/decisionModel';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { api } from '../../lib/api';
import {
  DECISION_MODE_LABELS, DECISION_WORDS as W, ceilingOf, decisionRowLine, decisionViewOf, rowAnswerWords,
} from '../../overlord/decisionModelWords';
import { DecisionHostCard } from './DecisionHostCard';
import { CardField, DoorLines, NoteRow, ReadLine, settingsRefusal, useCardDoor, useCardRead, valueOf, type SectionCtx } from './overlordCards';

const CARDS = SETTINGS_CARDS.overlord;

/** One row: its question, its state as read, its controls. */
function DecisionRow({ ctx, row, reread }: { readonly ctx: SectionCtx; readonly row: DecisionRowView; readonly reread: () => Promise<void> }): ReactNode {
  const card = `decision:${row.id}`;
  const door = useCardDoor(ctx, card, settingsRefusal(ctx, 'decision-row'));
  const [ceilingText, setCeilingText] = useState<string | null>(null);
  const line = decisionRowLine(row);
  const side = row.side;
  const shown = ceilingText ?? String(side.ceiling);
  const ceiling = ceilingOf(shown);
  const after = async (): Promise<void> => { await reread(); };
  const move = (mode: DecisionRowMode): void => {
    if (mode === side.mode) return;
    void door.run(() => (mode === 'off' ? api.offDecisionRow(row.id, { expected: side }) : api.armDecisionRow(row.id, { mode, expected: side })),
      rowAnswerWords, after);
  };
  return (
    <li className="ovs-row" data-decision-row={row.id} data-decision-mode={side.mode} data-decision-held={side.held ? 'yes' : 'no'}>
      <p className="ovs-row-name">{row.id}</p>
      <p className="ovs-note">{line.question}</p>
      <p className="ovs-note" data-decision-direction>{line.direction}</p>
      {line.privateState !== null && <p className="ovs-note" data-decision-private>{line.privateState}</p>}
      <RadioFieldset
        legend={W.modeLegend} name={`settings-decision-${row.id}`} value={side.mode} onPick={move} disabled={door.busy}
        options={DECISION_ROW_MODES.map((m) => ({ value: m, label: DECISION_MODE_LABELS[m] }))}
      />
      {line.held !== null && (
        <NoteRow note={line.held} data={{ 'data-decision-hold': row.id }}>
          {side.mode !== 'off' && (
            <Button
              variant="ghost" size="fit" data-settings-control="decision-resume" disabled={door.busy}
              onClick={() => { void door.run(() => api.armDecisionRow(row.id, { mode: side.mode as 'shadow' | 'armed', expected: side }), rowAnswerWords, after); }}
            >
              {W.resume}
            </Button>
          )}
        </NoteRow>
      )}
      <p className="ovs-note" data-decision-today>{line.today}</p>
      <p className="ovs-note" data-decision-line>{line.line}</p>
      {line.armedOn !== null && <p className="ovs-note" data-decision-armed-on>{line.armedOn}</p>}
      {line.offered !== null && (() => {
        const offered = line.offered;
        return (
          <NoteRow note={offered.text} data={{ 'data-decision-offered': row.id }}>
            <Button
              variant="ghost" size="fit" data-settings-control="decision-approve" disabled={door.busy}
              onClick={() => { void door.run(() => api.armDecisionRow(row.id, { mode: 'armed', line: offered.id, expected: side }), rowAnswerWords, after); }}
            >
              {W.approve}
            </Button>
          </NoteRow>
        );
      })()}
      <div className="ovs-actions">
        <CardField label={W.ceilingLabel}>
          <TextInput
            inputMode="numeric" value={shown} disabled={door.busy} data-settings-input="decision-ceiling"
            onChange={(e) => setCeilingText(e.currentTarget.value)}
          />
        </CardField>
        <Button
          variant="primary" size="fit" data-settings-control="decision-ceiling-save" disabled={door.busy || ceiling === null || ceiling === side.ceiling}
          onClick={() => {
            if (ceiling === null) return;
            void door.run(() => api.setDecisionCeiling(row.id, { ceiling, expected: side }), rowAnswerWords,
              async (o) => { if (o === 'done') setCeilingText(null); await reread(); });
          }}
        >
          {W.saveCeiling}
        </Button>
      </div>
      {ctx.confirmFor(card)}
      <DoorLines said={door.said} refusal={door.refusal} card={card} />
    </li>
  );
}

/** The decision model's two cards over one read: the host and its key, then the rows. */
export function DecisionModelCards({ ctx }: { readonly ctx: SectionCtx }): ReactNode {
  const { read, reread } = useCardRead<DecisionModelView>(() => api.decisionModel(), decisionViewOf);
  if (read.state === 'absent') return null;
  const v = valueOf(read);
  return (
    <>
      <DecisionHostCard ctx={ctx} view={v} reread={reread}>
        {/* The one read's loading and failure line, once, in the first of its two cards. */}
        <ReadLine read={read} unread={W.unread} card="decision-host" reread={() => { void reread(); }} />
      </DecisionHostCard>
      {v !== null && <Section level={3} scope={CARDS.decisionRows.scope} title={CARDS.decisionRows.title} purpose={CARDS.decisionRows.purpose} data-settings-card="decision-rows">
        {v.rows.length === 0 ? (
          <p className="ovs-note" role="status" data-decision-empty>{W.noRows}</p>
        ) : (
          <>
            <p className="ovs-note" data-decision-fleet>{W.fleet(v.fleetToday, v.fleetCap)}</p>
            <ul className="ovs-rows">
              {v.rows.map((r) => <DecisionRow key={r.id} ctx={ctx} row={r} reread={reread} />)}
            </ul>
          </>
        )}
      </Section>}
    </>
  );
}
