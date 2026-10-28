// The class chooser (routing spec, slice 5, Task 6; one component since T2f, D-6371): the `<select>` that forecasts
// EVERY card's placement for one class at a time. It takes no props and reads the fleet chrome's `projects` plane
// (`classFilter`, `chooseClass`), whose own readers are the two things the class changes: the project cards' placement
// forecast and Add workspace's route body (`useProjectRows.ts`). Two homes, never both at once at one width: the fleet
// screen's runs line (a phone, Refined, and any column that draws that line), and Instrument's table toggle row at a
// desk in project mode, where it has an effect (T2f, D-6371). It takes one optional `className`, merged over its own
// width utilities: the toggle row passes `min-h-row` so the chooser is as tall as the toggle's options (`--row-h`, 32
// under a fine pointer and 44 under a coarse one), because the select's own `min-h-tap` (44) would grow that row in
// project mode and move the toggle and the list by the difference on every mode switch.
import type { ReactNode } from 'react';
import { cn, Select } from '@ccrc/ui';
import { CLASSES, type ModelClass } from '../../../shared/models';
import { AUTOMATIC_CLASS } from './classWords';
import { useFleetChrome } from './FleetChrome';

export function ClassChooser({ className }: { className?: string } = {}): ReactNode {
  const { projects } = useFleetChrome();
  return (
    <>
      {/* The class chooser (routing spec, slice 5, Task 6): forecasts
          EVERY card's placement for one class at a time, the same
          `GET /api/projects?class=` this build has carried since slice 4
          but with no caller until now. "Automatic" (unset) is the
          class-blind fetch every build before this task has always sent;
          "Default" asks explicitly for the record's own "no override"
          word — the projects handler (`server.ts`) treats it identically
          to the unset fetch (no per-class shares read, byte-identical
          answer), so choosing it changes nothing about what renders, only
          what the `+` posts. The four classes are `CLASSES` reversed —
          the same capability order `NewSessionSheet`'s own routing row
          uses — never a hand-typed list, so a class this build adds or
          drops shows up here for free. */}
      {/* `w-auto flex-none max-w-full`: a control sized to its own option
          list, not to the row. These REPLACE `Select`'s own `w-full`
          rather than outranking it — `cn` is tailwind-merge, so one width
          utility reaches the DOM and it is this one. The rule that shipped
          here instead (`.fleet-class-select { width: auto }`, one class
          against `.route-select`'s one, 650 lines earlier in the same
          sheet) lost the tie to source order and never applied once: the
          control rendered 286px instead of the 167px its widest option
          asks for, and the head overflowed the viewport by 225px at 390px.
          `fleet-css.test.ts` pins the mechanism that replaced it. */}
      <Select
        className={cn('w-auto flex-none max-w-full', className)}
        aria-label="Class"
        value={projects.classFilter}
        onChange={(e) => projects.chooseClass(e.target.value as '' | 'default' | ModelClass)}
      >
        <option value="" title={AUTOMATIC_CLASS.title}>{AUTOMATIC_CLASS.word}</option>
        <option value="default">Default</option>
        {[...CLASSES].reverse().map((c) => (
          <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
        ))}
      </Select>
    </>
  );
}
