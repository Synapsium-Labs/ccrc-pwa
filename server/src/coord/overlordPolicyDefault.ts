// The `OverlordPolicy` port's default adapter (Overlord spec §3.6: "It allows everything by default"; plan Task B4). Context
// C5; it imports no I/O, so the rings read it L1. It is named for what it is: every allowed act passes. Nothing in W2 replaces
// it; the spec's outside authoriser (§3.6, #279) is the adapter that would, and it can only refuse what `overlordMayAct`
// allowed. The composition builds it with the first door that asks the port.
import type { OverlordPolicy } from './overlordPolicy.js';

export const allowAllPolicy: OverlordPolicy = { check: () => ({ ok: true }) };
