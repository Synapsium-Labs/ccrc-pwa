// Text the Settings screen and its sections share. This module imports nothing from either screen, so a section can
// take a shared line without importing the screen that mounts it.

/** A write that answered 2xx but unreadably (`postJsonOr`'s `unreadable`, D-1150): it may have landed. */
export const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";

/** The classes a section's "now" lines wear, by tone: one map, so the Stall watch and Temp root collector sections
 *  cannot drift apart. */
export const SETTINGS_NOW_CLASS = {
  head: 'settings-catalogue',
  note: 'settings-note',
  warn: 'settings-catalogue settings-catalogue--amber',
} as const;

/** A section's amber note: a stale read, an inline refusal, a pause that failed. */
export const SETTINGS_AMBER_NOTE = 'settings-note settings-catalogue--amber';
