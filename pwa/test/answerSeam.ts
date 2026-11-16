// The ask sheets' injected answer seam (`DialogSheet`'s `answers`, D-7183), as fresh mocks for one test. Each writer
// delegates to `lib/api.ts`'s `api` until a test gives it a value, so a test that sets none sends what the sheet's default
// seam would. A test re-points a writer with `answers.answerDialog.mockReturnValue(…)` where it once spied on `api`.
//
// W7 C7g (D-7185, D-7485): the sheets answer through ONE writer, `answerQuestion(id, body)`, whose body names the
// answer (`answerLifecycle.ts#questionBodyOf`). `answerDialog`, `answerDialogText` and `answerDialogMulti` below are
// that writer's three per-kind VIEWS, not writers of `api`: `answerQuestion` hands each call to the view its body
// names, with the arguments that kind of answer carries (the session, the dialog id, then the row, the row and its text,
// or the set), and answers what the view answers. So every suite's assertions over a kind of answer read as they did
// before C7g, byte for byte; `answer-questions-door.test.ts` pins the bodies themselves. A body of no known shape
// throws, so a view can never record an answer the sheet did not send.
import { vi, type Mock } from 'vitest';
import type { DialogAnswered, QuestionAnswerBody } from '../../shared/api';
import { api } from '../src/lib/api';
import type { AnswerSeam } from '../src/session/answerLifecycle';

type RowView = (id: string, dialogId: string, optionIndex: number) => Promise<DialogAnswered>;
type TextView = (id: string, dialogId: string, optionIndex: number, text: string) => Promise<DialogAnswered>;
type MultiView = (id: string, dialogId: string, optionIndexes: readonly number[]) => Promise<DialogAnswered>;

export type AnswerSeamMocks = { [K in keyof AnswerSeam]: Mock<AnswerSeam[K]> } & {
  /** `answerQuestion`'s option-row answers, `{kind:'dialog', dialogId, optionIndex}`. */
  answerDialog: Mock<RowView>;
  /** `answerQuestion`'s own-words answers, the same with `text`. */
  answerDialogText: Mock<TextView>;
  /** `answerQuestion`'s multiSelect sets, `{kind:'dialog', multi:true, dialogId, optionIndexes}`. */
  answerDialogMulti: Mock<MultiView>;
};

export function answerSeam(): AnswerSeamMocks {
  const answerDialog = vi.fn<RowView>((id, dialogId, optionIndex) => api.answerQuestion(id, { kind: 'dialog', dialogId, optionIndex }));
  const answerDialogText = vi.fn<TextView>((id, dialogId, optionIndex, text) => api.answerQuestion(id, { kind: 'dialog', dialogId, optionIndex, text }));
  const answerDialogMulti = vi.fn<MultiView>((id, dialogId, optionIndexes) =>
    api.answerQuestion(id, { kind: 'dialog', multi: true, dialogId, optionIndexes: [...optionIndexes] }));
  const answerQuestion = vi.fn<AnswerSeam['answerQuestion']>((id: string, body: QuestionAnswerBody) => {
    if (body.kind === 'dialog' && 'multi' in body && body.multi === true) return answerDialogMulti(id, body.dialogId, body.optionIndexes);
    if (body.kind === 'dialog' && 'optionIndex' in body && body.text !== undefined) return answerDialogText(id, body.dialogId, body.optionIndex, body.text);
    if (body.kind === 'dialog' && 'optionIndex' in body) return answerDialog(id, body.dialogId, body.optionIndex);
    throw new Error(`answerSeam: the sheets send no answer of this shape: ${JSON.stringify(body)}`);
  });
  return {
    answerQuestion,
    answerDialog,
    answerDialogText,
    answerDialogMulti,
    answerDialogTab: vi.fn<AnswerSeam['answerDialogTab']>((...a) => api.answerDialogTab(...a)),
    interrupt: vi.fn<AnswerSeam['interrupt']>((...a) => api.interrupt(...a)),
  };
}

/** The kinds of answer a suite can watch on `api` (the views above). */
export type AnswerView = 'answerDialog' | 'answerDialogText' | 'answerDialogMulti';
interface ViewOf { answerDialog: RowView; answerDialogText: TextView; answerDialogMulti: MultiView }

const realAnswerQuestion = api.answerQuestion.bind(api);
let viewing: { [K in AnswerView]?: Mock<ViewOf[K]> } = {};

/** Where a suite once wrote `vi.spyOn(api, 'answerDialog')` (or `…Text`, `…Multi`) over a sheet mounted on its default
 *  seam (`api` itself): a fresh view of that kind of answer, over ONE spy on `api.answerQuestion`, which the first view
 *  in a test installs (and `vi.restoreAllMocks()` removes). A call whose kind no view watches goes to the real
 *  `answerQuestion`, as an unspied writer did; an un-mocked view calls through to it too, as `vi.spyOn` does. */
export function spyApiAnswer<K extends AnswerView>(kind: K): Mock<ViewOf[K]> {
  if (!vi.isMockFunction(api.answerQuestion)) {
    viewing = {};
    vi.spyOn(api, 'answerQuestion').mockImplementation((id, body) => {
      if (body.kind === 'dialog' && 'multi' in body && body.multi === true) {
        return viewing.answerDialogMulti ? viewing.answerDialogMulti(id, body.dialogId, body.optionIndexes) : realAnswerQuestion(id, body);
      }
      if (body.kind === 'dialog' && 'optionIndex' in body && body.text !== undefined) {
        return viewing.answerDialogText ? viewing.answerDialogText(id, body.dialogId, body.optionIndex, body.text) : realAnswerQuestion(id, body);
      }
      if (body.kind === 'dialog' && 'optionIndex' in body) {
        return viewing.answerDialog ? viewing.answerDialog(id, body.dialogId, body.optionIndex) : realAnswerQuestion(id, body);
      }
      return realAnswerQuestion(id, body);
    });
  }
  const through: { [J in AnswerView]: ViewOf[J] } = {
    answerDialog: (id, dialogId, optionIndex) => realAnswerQuestion(id, { kind: 'dialog', dialogId, optionIndex }),
    answerDialogText: (id, dialogId, optionIndex, text) => realAnswerQuestion(id, { kind: 'dialog', dialogId, optionIndex, text }),
    answerDialogMulti: (id, dialogId, optionIndexes) => realAnswerQuestion(id, { kind: 'dialog', multi: true, dialogId, optionIndexes: [...optionIndexes] }),
  };
  const view = vi.fn(through[kind]) as unknown as Mock<ViewOf[K]>;
  (viewing as Record<AnswerView, unknown>)[kind] = view;
  return view;
}
