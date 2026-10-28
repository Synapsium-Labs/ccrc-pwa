// The fleet list's doors, as module constants (C9, D-6441): one function each, so a memo'd row or card is handed the
// same callback on every render. Both skins' lists import them: Refined's `FleetScreen` and Instrument's `FleetTable`
// open a session through the one `openSession`, never two copies.
import { navigate } from '../lib/router';

/** Open a session's page. */
export const openSession = (id: string): void => navigate(`/s/${encodeURIComponent(id)}`);

/** A row's hold-reason door: the runs board, unfocused (`ProjectCard`'s `openRunFor` says why there is no per-run
 *  route). `null` where the board holds no run for the row is the caller's answer, not this door's. */
export const OPEN_RUNS = (): void => navigate('/runs');
