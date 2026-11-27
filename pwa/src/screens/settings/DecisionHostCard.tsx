// Settings › Overlord's decision-model host and its key (Overlord W2 Settings, plan `w2-settings.md` Task 2, SQ5; spec 2026-11-09
// §3.7 H6, §7.5). Ring L4, context K (a settings screen): it draws the decision model's one read (`DecisionModelCards`) and sends
// through the section's card door and its one step-up. Every word is `decisionModelWords.ts`' (L1) or the section's refusal table's.
//
// THE KEY (the brief's ruling 6, ruled call 1815). The key is typed into the accounts' secret field (`SecretField`), whose value
// lives only in its own DOM node, never in component state or a store. Save reads it without emptying it (`peek`), builds the
// body, and sends it; the field is emptied on the door's answer and on every refusal, never on a first `step-up-required`. That
// Save hands the section its retry, which the confirm sends (review 4139 F1, ruled call 1876): while the step shows, Save and the
// host's fields are held, so nothing else is sent to a door that will refuse it, and the retry sends the host as it was pressed.
// A press is always a first send; the retry's own `step-up-required` is final: worded for what was refused (a key, or the host
// alone, A4) and the field emptied (the coordinator's condition 4). The retry never sends less than the first send carried (F2):
// the Save keeps one boolean, whether a key was typed (never the key), and a retry that finds the field emptied (the page was
// hidden while the step showed) sends nothing and says so. The key is sent only when the field holds one, so a host change with
// no new key reaches the door's own `key-required`. The read never carries any part of the key: only when it was set, and whether
// the egress masker catches it.
//
// THE HOST. The kind, the endpoint and the model id are filled from the read (`host.endpoint`, ruled F4, so a change of the model
// id alone sends the endpoint as stored, path included), and an edit is kept until the door answers. A hosted kind says that each
// question is paid for and seen by its provider, and names no provider.
//
// REMOVE asks first ("Removing the key holds every armed gate"), then sends `DELETE`. The door asks no step-up for it (a narrowing);
// the console asks the door, never itself.
import { useRef, useState, type ReactNode } from 'react';
import { Button, QuickConfirm, Section, Select, TextInput } from '@ccrc/ui';
import { DECISION_HOST_KINDS, type DecisionHostKind, type DecisionModelView } from '../../../../shared/decisionModel';
import { SecretField, type SecretFieldHandle } from '../../accounts/SecretField';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { api } from '../../lib/api';
import { DECISION_HOST_KIND_LABELS, DECISION_WORDS as W, keyAnswerWords, keyRemoveWords } from '../../overlord/decisionModelWords';
import { CardField, DoorLines, settingsRefusal, useCardDoor, type SectionCtx } from './overlordCards';

const CARD = SETTINGS_CARDS.overlord.decisionHost;
const dateOf = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function DecisionHostCard({ ctx, view, reread, children }: {
  readonly ctx: SectionCtx; readonly view: DecisionModelView | null; readonly reread: () => Promise<void>; readonly children?: ReactNode;
}): ReactNode {
  const door = useCardDoor(ctx, 'decision-host', settingsRefusal(ctx, 'decision-key'));
  const removeDoor = useCardDoor(ctx, 'decision-host', settingsRefusal(ctx, 'decision-key-remove'));
  const [kind, setKind] = useState<DecisionHostKind | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [final, setFinal] = useState<string | null>(null);
  const key = useRef<SecretFieldHandle>(null);
  const held = ctx.stepShows('decision-host', 'save');
  const busy = door.busy || removeDoor.busy;
  const host = view?.host ?? null;
  const k = kind ?? host?.kind ?? null;
  const e = endpoint ?? host?.endpoint ?? '';
  const m = modelId ?? host?.modelId ?? '';
  const unchanged = host !== null && k === host.kind && e === host.endpoint && m === host.modelId;
  /** One send of the host and, when `carried`, the key the field holds now. `retry` is the send the confirm starts. */
  const send = (to: { kind: DecisionHostKind; endpoint: string; modelId: string }, carried: boolean, retry: boolean): void => {
    setFinal(null);
    const typed = carried ? (key.current?.peek() ?? '') : '';
    if (retry && carried && typed === '') { ctx.ask(null); setFinal(W.keyGone); return; }
    void door.run(
      () => api.setDecisionKey({ ...to, ...(typed === '' ? {} : { key: typed }) }),
      keyAnswerWords,
      async (o) => {
        if (o === 'step-up' && retry) {
          // The retry's own step-up: final. The step is put away and the key leaves the field.
          ctx.ask(null);
          setFinal(carried ? W.stepUpFinal : W.stepUpFinalHost);
          key.current?.clear();
        } else if (o !== 'step-up') {
          // The answer or a refusal: the key leaves the field.
          key.current?.clear();
          if (o === 'done') { setKind(null); setEndpoint(null); setModelId(null); }
        }
        await reread();
      },
      retry ? undefined : { act: 'save', send: () => send(to, carried, true) },
    );
  };
  const save = (): void => {
    if (k === null) return;
    send({ kind: k, endpoint: e, modelId: m }, (key.current?.peek() ?? '') !== '', false);
  };
  return (
    <Section level={3} scope={CARD.scope} title={CARD.title} purpose={CARD.purpose} data-settings-card="decision-host">
      {children}
      {view !== null && (
        <>
          <p className="ovs-note" data-decision-host-state>{host === null ? W.noHost : `${DECISION_HOST_KIND_LABELS[host.kind]}: ${host.endpoint}, ${host.modelId}`}</p>
          <p className="ovs-note" data-decision-key-state>{view.key === null ? W.noKey : W.keySet(dateOf(view.key.setAt))}</p>
          {view.key !== null && !view.key.masked && <p className="ovs-note" data-decision-key-unmasked>{W.keyNotMasked}</p>}
          <div className="ovs-fields">
            <CardField label={W.hostKindLabel}>
              <Select value={k ?? ''} disabled={busy || held} data-settings-input="decision-kind" onChange={(ev) => setKind(ev.currentTarget.value as DecisionHostKind)}>
                {k === null && <option value="" disabled>{W.chooseKind}</option>}
                {DECISION_HOST_KINDS.map((x) => <option key={x} value={x}>{DECISION_HOST_KIND_LABELS[x]}</option>)}
              </Select>
            </CardField>
            {k === 'hosted' && <p className="ovs-note" data-decision-hosted>{W.hosted}</p>}
            <CardField label={W.endpointLabel}>
              <TextInput value={e} disabled={busy || held} inputMode="url" data-settings-input="decision-endpoint" onChange={(ev) => setEndpoint(ev.currentTarget.value)} />
            </CardField>
            <CardField label={W.modelIdLabel}>
              <TextInput value={m} disabled={busy || held} data-settings-input="decision-model-id" onChange={(ev) => setModelId(ev.currentTarget.value)} />
            </CardField>
            <SecretField label={W.keyLabel} handle={key} onPresence={setHasKey} />
          </div>
          <div className="ovs-actions">
            <Button
              variant="primary" size="fit" data-settings-control="decision-host-save"
              disabled={busy || held || k === null || e === '' || m === '' || (unchanged && !hasKey)} onClick={save}
            >
              {door.busy ? W.saving : W.saveHost}
            </Button>
            {view.key !== null && (
              <Button variant="danger-ghost" size="fit" data-settings-control="decision-key-remove" disabled={busy} onClick={() => setAskRemove(true)}>
                {removeDoor.busy ? W.removing : W.removeKey}
              </Button>
            )}
          </div>
          <QuickConfirm
            open={askRemove} onClose={() => setAskRemove(false)} title={W.removeTitle} consequence={W.removeWhy} confirmLabel={W.removeKey}
            tone="danger" defaultFocus="cancel"
            onConfirm={() => { setAskRemove(false); void removeDoor.run(() => api.removeDecisionKey(), keyRemoveWords, reread); }}
          />
        </>
      )}
      {ctx.confirmFor('decision-host')}
      <DoorLines said={[]} refusal={final} card="decision-host-final" />
      <DoorLines said={door.said} refusal={door.refusal} card="decision-host" />
      <DoorLines said={removeDoor.said} refusal={removeDoor.refusal} card="decision-key-remove" />
    </Section>
  );
}
