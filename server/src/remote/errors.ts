/**
 * D-7507 (ARCH-05): the agent link's two error classes, moved verbatim out of `remote/client.ts` so the files that
 * match them by `instanceof` (`update/converge.ts`, `token/link.ts`, `accounts/ops.ts`) import them from an L1 file
 * instead of the L4 client. `remote/client.ts` creates its errors from these, so every `instanceof` sees one class.
 */

/**
 * A `ResErr` the AGENT SENT (design 2026-09-20 §10, D-3373), as
 * opposed to a request the LINK failed. A link failure AFTER the send stays a
 * plain `Error` whose message is `disconnected`, `timeout` or `aborted`; one
 * before the send is a `LinkNotSentError` (below, D-3555) carrying
 * `disconnected` or `aborted`, or — for a synchronous `JSON.stringify`/`ws.send`
 * throw — the thrown message; `timeout` is never pre-send. The dispatcher must
 * tell "the node answered busy" from "the node could not be asked", and a
 * message string cannot do that, because nothing stops an agent word from being
 * spelled `timeout`. `instanceof` can.
 *
 * `message` is `err`, exactly what `new Error(err)` carried before this class
 * existed, so the one existing `.message` reader (`createRunner`'s catch arm,
 * which reports it as stderr) is unchanged; `caps()` and the io adapter catch
 * without reading the error at all. `detail` is `ResErr`'s ADDITIVE field. Absence
 * permits: an agent that sends none reads `null`. `FleetClient#onMessage` (`remote/client.ts`) is its ONE
 * reader, and it cuts the text to `UPDATE_OP_DETAIL_MAX`
 * (D-3391), because a peer that ignores the agent's
 * own bound must not write an unbounded string into an inventory row.
 */
export class AgentOpError extends Error {
  readonly code: string;
  readonly detail: string | null;
  constructor(code: string, detail: string | null) {
    super(code);
    this.name = 'AgentOpError';
    this.code = code;
    this.detail = detail;
  }
}

/** D-3555: a request this client never handed to `ws`'s sender — no ready link at the call
 *  (`disconnected`), a signal already aborted (`aborted`), or a synchronous throw from `JSON.stringify` or `ws.send`
 *  (the thrown message). `ws.send`'s measured throw sites are before it queues the frame (its `CONNECTING` check, which
 *  the OPEN test in `FleetClient#request` excludes in the same tick); nothing below it was found to throw synchronously. Every other
 *  rejection of `request()` — `timeout`, an abort after the send, `disconnected` when the socket closes or `close()`
 *  runs with the request pending — comes AFTER `ws.send` returned, when the frame may already be with the agent, and
 *  stays a plain `Error`. `message` is the word a plain `Error` carried before this class existed, so every `.message`
 *  reader is unchanged; only `instanceof` tells the two apart (the dispatcher's `linkAnswer`). A `send` that returns
 *  proves the frame reached `ws`'s sender, not the agent: that is all "handed to the link" means. */
export class LinkNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkNotSentError';
  }
}
