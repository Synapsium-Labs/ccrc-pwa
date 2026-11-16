import { useId, type ReactNode } from 'react';
import { Button, RadioFieldset, TextInput } from '@ccrc/ui';
import { HUES, newLaneConfigSuffix, type Hue } from '../../../shared/roster';
import type { RosterWire } from '../../../shared/api';
import {
  PICK_ANOTHER_NAME, USE_WHATS_THERE, configDirFoundText, derivedLine, hueAlso, idProblemText, labelProblemText,
} from '../fleet/accountWords';
import { hueWearers, idProblem, labelProblem } from './connectFlow';
import { FrameFoot } from './FrameFoot';

/** What `config-dir-exists` measured (G20): whether the folder it found is signed in, when the box could tell. */
export interface ConfigDirFound { readonly signedIn?: boolean }

export interface NameFrameProps {
  id: string;
  label: string;
  hue: Hue;
  roster: readonly RosterWire[];
  /** The folder the add found, when it refused `config-dir-exists`; `null` otherwise. */
  found: ConfigDirFound | null;
  /** The sentence a refusal sent the sheet back here with, or `null`. */
  notice: string | null;
  blocked: boolean;
  onId: (v: string) => void;
  onLabel: (v: string) => void;
  onHue: (h: Hue) => void;
  onBack: () => void;
  onContinue: () => void;
  onPickAnother: () => void;
  onUseThere: () => void;
}

/**
 * "Name it" (spec §5's identity step, §12.3 frame 2; accounts plan Task A18): the id (mono, live against the roster
 * parser's rule, the reserved ids and the roster the server holds), the label, the hue, and the derived config folder
 * and wrapper, read-only. A taken hue stays selectable, marked with who wears it: lanes may share a hue, and a seventh
 * lane must never be blocked here. When the add found the lane's config folder already there, the frame offers
 * **Pick another name** (the default) or **Use what's there**.
 */
export function NameFrame(p: NameFrameProps): ReactNode {
  const idField = useId();
  const labelField = useId();
  const idNote = useId();
  const idIssue = idProblem(p.id, p.roster);
  const labelIssue = labelProblem(p.label);
  const worn = hueWearers(p.roster);
  const ok = idIssue === null && labelIssue === null && p.found === null;
  return (
    <div className="acct-frame" data-frame="name">
      <div className="acct-field">
        <label htmlFor={idField}>Name</label>
        <TextInput
          id={idField}
          className="font-mono"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={p.id}
          aria-invalid={idIssue !== null && p.id !== '' ? true : undefined}
          aria-describedby={idNote}
          onChange={(e) => p.onId(e.target.value)}
        />
        {idIssue !== null && p.id !== '' ? (
          <p className="acct-field-note" id={idNote}>{idProblemText(p.id, idIssue)}</p>
        ) : (
          // The derived folder and wrapper, read-only: one mono line that ellipsises at 360 rather than wrapping.
          <p className="acct-derived" id={idNote} title={derivedLine(newLaneConfigSuffix(p.id || '<name>'), p.id || '<name>')}>
            {derivedLine(newLaneConfigSuffix(p.id || '<name>'), p.id || '<name>')}
          </p>
        )}
      </div>
      <div className="acct-field">
        <label htmlFor={labelField}>Label</label>
        <TextInput id={labelField} value={p.label} maxLength={64} onChange={(e) => p.onLabel(e.target.value)} />
        {labelIssue !== null && p.label !== '' && <p className="acct-field-note">{labelProblemText(labelIssue)}</p>}
      </div>
      <RadioFieldset<Hue>
        legend="Hue"
        name="acct-hue"
        className="acct-hues"
        optionClassName="acct-hue"
        value={p.hue}
        onPick={p.onHue}
        options={HUES.map((h) => {
          const by = worn.get(h) ?? [];
          return {
            value: h,
            // The swatch is what shows (six in one row at 44px each); its name, and who else wears it, are the
            // radio's accessible name, and the selected hue's are written out under the row.
            label: (
              <span className="acct-hue-body" title={by.length > 0 ? `${h} · ${hueAlso(by)}` : h}>
                <span className="acct-swatch" aria-hidden="true" data-worn={by.length > 0 ? 'true' : undefined} style={{ background: `var(--acct-${h})` }} />
                <span className="sr-only">{h}{by.length > 0 ? ` · ${hueAlso(by)}` : ''}</span>
              </span>
            ),
          };
        })}
      />
      <p className="acct-field-note">
        Hue {p.hue}{(worn.get(p.hue) ?? []).length > 0 ? ` · ${hueAlso(worn.get(p.hue)!)}` : ''}
      </p>
      {p.found !== null && (
        <div className="acct-found" role="group" aria-label="The config folder is already there">
          <p className="m-0">{configDirFoundText(p.id, p.found.signedIn)}</p>
          <Button variant="primary" disabled={p.blocked} onClick={p.onPickAnother}>{PICK_ANOTHER_NAME}</Button>
          <Button variant="ghost" disabled={p.blocked} onClick={p.onUseThere}>{USE_WHATS_THERE}</Button>
        </div>
      )}
      {p.notice !== null && <p className="acct-notice">{p.notice}</p>}
      {p.found === null && (
        <FrameFoot quiet={[{ label: 'Back', onClick: p.onBack }]} primary={{ label: 'Continue', onClick: p.onContinue, disabled: !ok || p.blocked }} />
      )}
    </div>
  );
}
