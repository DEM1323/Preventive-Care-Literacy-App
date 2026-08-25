import { isRecord } from './http.ts';
import { NonRetryableGoldenJourneyError } from './retry.ts';

export function assertExactSubmittedAnswers(
  revealedAnswers: unknown,
  submitted: Record<string, string>,
): void {
  if (!isRecord(revealedAnswers)) {
    throw new NonRetryableGoldenJourneyError(
      'Clinical reveal answers did not match the submitted answers',
      'CLINICAL_ANSWER_MISMATCH',
    );
  }
  const revealedKeys = Object.keys(revealedAnswers).sort();
  const submittedKeys = Object.keys(submitted).sort();
  if (revealedKeys.length !== submittedKeys.length) {
    throw new NonRetryableGoldenJourneyError(
      'Clinical reveal answers did not match the submitted answers',
      'CLINICAL_ANSWER_MISMATCH',
    );
  }
  for (const key of submittedKeys) {
    if (revealedAnswers[key] !== submitted[key]) {
      throw new NonRetryableGoldenJourneyError(
        'Clinical reveal answers did not match the submitted answers',
        'CLINICAL_ANSWER_MISMATCH',
      );
    }
  }
}

export function discardClinicalRevealAnswers(
  body: Record<string, unknown>,
): void {
  delete body.answers;
  delete body.intakeForm;
}
