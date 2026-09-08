// shared/litellm.mjs — §6.3's renderer: a Codex catalogue plus the template in
// `deploy/` become `~/.handoff/litellm-config.yaml`.
//
// PURE, and that is why it is a module rather than a block of `ccrc`: the whole
// render can be measured without writing into `~/.handoff`, which is a live
// directory on the box this suite runs on.
//
// `.mjs` because its caller is `deploy/models-op.mjs`, under a bare `node`.
// It imports nothing at all.
//
// WHY THE MODEL LIST IS GENERATED. The shipped config drifted: measured
// 2026-09-08 it still listed `gpt-5.5-mini` and `gpt-5.4`, both gone from the
// account's catalogue, and lacked four of the nine models the backend
// advertises. A hand-kept list of somebody else's catalogue is a list that is
// wrong the day after it is written.
//
// WHY THERE IS NO `[1m]` ALIAS (amended 2026-09-08, Task 16c). A fleet-host
// measurement found the catalogue's advertised context is not the usable one:
// the largest prompt ever accepted on gpt-5.6-sol, over 2,339 transcripts, was
// 196,341 tokens, against an advertised 272000/872000, with 30 refusals past
// that wall. A `[1m]` name would route a request Claude Code believes has 1M
// of room to a backend with no such id; the generator stopped emitting it, so
// `/model <id>[1m]` fails at LiteLLM with an invalid model name instead.

/** The one line the template reserves for the generated entries. Its own line,
 *  exactly once: a marker that appeared twice would make the destination
 *  ambiguous, and one that appeared nowhere would send the entries to the end
 *  of the file, past `general_settings`. Both are refusals. */
export const MODEL_LIST_MARKER = '# ccrc:model-list';

export class LitellmTemplateInvalid extends Error {
  constructor(message) { super(message); this.name = 'LitellmTemplateInvalid'; }
}

/** A model id safe to write as an UNQUOTED YAML scalar. `: ` opens a mapping,
 *  ` #` opens a comment and a leading `-` opens a sequence item — a catalogue
 *  carrying any of them would produce a config LiteLLM parses into something
 *  else, silently. Narrower than `shared/models.ts`'s MODEL_ID_RE, which every
 *  id in a catalogue already satisfies; this is the second gate, on the
 *  writer's side, because the catalogue is a generated file and a probe bug
 *  must not become a config bug. */
const YAML_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/;

/**
 * `(templateText: string, catalogue: Catalogue) => string`
 *
 * One `chatgpt/<id>` entry per VISIBLE model, and NO `[1m]` alias (§6.3,
 * amended 2026-09-08, Task 16c): a fleet-host measurement found the
 * catalogue's advertised context is not the usable one (§6.1's amendment —
 * 272000/872000 advertised, 196,341 the largest prompt ever accepted, 30
 * refusals past that wall), so a `[1m]` name would route a request Claude
 * Code believes has 1M of room to a backend with no such name; a `/model
 * <id>[1m]` now fails at LiteLLM with an invalid model name, loudly, instead.
 * Hidden models are excluded, matching what a `"catalogue"` discovery list
 * offers (§4.2, decision 6).
 *
 * NO `reasoning` KEY, for any model. Effort has exactly one owner — the shim
 * (§6.4) — so config-versus-request precedence inside LiteLLM never decides
 * anything.
 *
 * @throws {LitellmTemplateInvalid}
 */
export function renderLitellmConfig(templateText, catalogue) {
  const lines = templateText.split('\n');
  const at = lines.reduce((acc, l, i) => (l.trim() === MODEL_LIST_MARKER ? [...acc, i] : acc), []);
  if (at.length === 0) {
    throw new LitellmTemplateInvalid(
      `the template carries no ${MODEL_LIST_MARKER} line, so there is nowhere to put the generated `
      + 'model list — appending it to the end would put it past general_settings');
  }
  if (at.length > 1) {
    throw new LitellmTemplateInvalid(
      `the template carries ${at.length} ${MODEL_LIST_MARKER} lines; the destination must be one place`);
  }
  const visible = catalogue.models.filter((m) => !m.hidden);
  if (visible.length === 0) {
    throw new LitellmTemplateInvalid(
      'this catalogue has no visible models, and a LiteLLM config with an empty model_list serves '
      + 'nothing — the lane would 404 every request. Nothing was rendered.');
  }
  const entries = [];
  for (const m of visible) {
    if (!YAML_SAFE_ID.test(m.id)) {
      throw new LitellmTemplateInvalid(
        `model id ${JSON.stringify(m.id)} is not safe to write as an unquoted YAML scalar, so this `
        + 'catalogue cannot be rendered. Nothing was written.');
    }
    entries.push(`  - model_name: ${m.id}`);
    entries.push('    model_info: {mode: responses}');
    entries.push(`    litellm_params: {model: chatgpt/${m.id}}`);
  }
  return [...lines.slice(0, at[0]), ...entries, ...lines.slice(at[0] + 1)].join('\n');
}
