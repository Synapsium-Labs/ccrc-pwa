// The organization label on the Accounts card (plan 2026-11-16-account-organization.md Task B1, #2909): the operator's
// name for the Claude organization an account belongs to, written through PR A's facts door
// (`POST /api/accounts/:id/set {org}`, `ccrc account set --org <label>|none`). It is never the organization's id: the
// door refuses an id-shaped label `org-looks-like-an-id`, and the toast says so in its own words.
//
// The line reads "Organization: org-a" or "Organization: not set", whenever the lane is on the roster; Set, drawn only
// where the screen can act at all (`connect`), opens a sheet with the hint, the field, Save and, for a labelled lane,
// Clear. Save stays held back while the roster's own gate (`orgLabelVerdict`) reads the field off the name shape; an
// id-shaped name is the door's to refuse, by name. THE LINE MOVES ONLY ON THE SERVER'S ACK, to the label the route's
// roster read back, and the sheet closes on that ack; a refusal leaves both as they were, with the toast. While any act
// runs on the lane, or when the screen cannot act (`blocked`), Set is drawn disabled, named by the knob row's reason.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Sheet, TextInput, TEXT_INPUT_INLINE } from '@ccrc/ui';
import { ORG_CLEAR_WORD, orgLabelVerdict } from '../../../shared/roster';
import { ORG_CLEAR, ORG_FIELD, ORG_HINT, ORG_SAVE, ORG_SET, orgRow, orgSetName, orgSheetTitle } from './accountOrgWords';
import type { LaneActKind } from './AccountKnob';

export interface AccountOrgRowProps {
  id: string;
  /** The lane's label, which the sheet's title names. */
  label: string;
  /** The label as the roster has it (or as an ack read it back); `null` is not set. */
  org: string | null;
  /** Whether Set is drawn: the screen can run account acts at all (a `connect` answer). */
  canSet: boolean;
  /** Why the screen cannot run any lane act, or `null`. */
  blocked: string | null;
  busy: LaneActKind | undefined;
  /** Sends a label, or `none`; resolves `true` on the server's ack. */
  onSave: (org: string) => Promise<boolean>;
}

export function AccountOrgRow({ id, label, org, canSet, blocked, busy, onSave }: AccountOrgRowProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const sending = busy === 'org';
  const save = (value: string): void => { void onSave(value).then((acked) => { if (acked) setOpen(false); }); };
  return (
    <div className="acct-org acct-resume-line" data-org={org ?? undefined}>
      <span>{orgRow(org)}</span>
      {canSet && (
        <Button
          variant="ghost" size="fit" disabled={busy !== undefined || blocked !== null}
          aria-describedby={blocked !== null ? `acct-knob-reason-${id}` : undefined}
          aria-label={orgSetName(label)}
          onClick={() => { setName(org ?? ''); setOpen(true); }}
        >
          {ORG_SET}
        </Button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} eyebrow="account organization" title={orgSheetTitle(label)}>
        <p className="sheet-copy">{ORG_HINT}</p>
        <div className="pool-new-row">
          <label className="pool-new-label" htmlFor={`account-org-${id}`}>{ORG_FIELD}</label>
          <TextInput
            id={`account-org-${id}`}
            className={`${TEXT_INPUT_INLINE} font-mono`}
            value={name}
            placeholder="org-a"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="acct-fold">
            <Button variant="primary" size="fit" disabled={sending || orgLabelVerdict(trimmed) === 'off-shape'} aria-busy={sending || undefined} onClick={() => save(trimmed)}>
              {ORG_SAVE}
            </Button>
            {org !== null && (
              <Button variant="ghost" size="fit" disabled={sending} onClick={() => save(ORG_CLEAR_WORD)}>{ORG_CLEAR}</Button>
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
