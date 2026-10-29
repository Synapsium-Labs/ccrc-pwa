// The ask sheets' injected answer seam (`DialogSheet`'s `answers`, D-7183), as fresh mocks for one test. Each writer
// delegates to `lib/api.ts`'s `api` until a test gives it a value, so a test that sets none sends what the sheet's default
// seam would. A test re-points a writer with `answers.answerDialog.mockReturnValue(…)` where it once spied on `api`.
import { vi, type Mock } from 'vitest';
import { api } from '../src/lib/api';
import type { AnswerSeam } from '../src/session/answerLifecycle';

export type AnswerSeamMocks = { [K in keyof AnswerSeam]: Mock<AnswerSeam[K]> };

export function answerSeam(): AnswerSeamMocks {
  return {
    answerDialog: vi.fn<AnswerSeam['answerDialog']>((...a) => api.answerDialog(...a)),
    answerDialogText: vi.fn<AnswerSeam['answerDialogText']>((...a) => api.answerDialogText(...a)),
    answerDialogMulti: vi.fn<AnswerSeam['answerDialogMulti']>((...a) => api.answerDialogMulti(...a)),
    answerDialogTab: vi.fn<AnswerSeam['answerDialogTab']>((...a) => api.answerDialogTab(...a)),
    interrupt: vi.fn<AnswerSeam['interrupt']>((...a) => api.interrupt(...a)),
  };
}
