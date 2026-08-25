export const goldenJourneySteps = [
  'idle',
  'preflighted',
  'gated',
  'staff_authenticated',
  'release_published',
  'invitation_created',
  'invitation_delivered',
  'invitation_redeemed',
  'intake_drafted',
  'intake_submitted',
  'learning_acknowledged',
  'clinical_revealed',
  'student_restored',
  'browser_checked',
  'completed',
  'failed',
] as const;

export type GoldenJourneyStep = (typeof goldenJourneySteps)[number];

const nextStep: Partial<Record<GoldenJourneyStep, GoldenJourneyStep>> = {
  idle: 'preflighted',
  preflighted: 'gated',
  gated: 'staff_authenticated',
  staff_authenticated: 'release_published',
  release_published: 'invitation_created',
  invitation_created: 'invitation_delivered',
  invitation_delivered: 'invitation_redeemed',
  invitation_redeemed: 'intake_drafted',
  intake_drafted: 'intake_submitted',
  intake_submitted: 'learning_acknowledged',
  learning_acknowledged: 'clinical_revealed',
  clinical_revealed: 'student_restored',
  student_restored: 'browser_checked',
  browser_checked: 'completed',
};

export class GoldenJourneyStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldenJourneyStateError';
  }
}

export function createGoldenJourneyState() {
  let step: GoldenJourneyStep = 'idle';
  return {
    step(): GoldenJourneyStep {
      return step;
    },
    advance(next: GoldenJourneyStep) {
      if (step === 'failed' || step === 'completed') {
        throw new GoldenJourneyStateError(
          `Golden journey cannot advance from ${step}`,
        );
      }
      if (nextStep[step] !== next) {
        throw new GoldenJourneyStateError(
          `Golden journey cannot move from ${step} to ${next}`,
        );
      }
      step = next;
    },
    fail() {
      if (step === 'failed' || step === 'completed') {
        throw new GoldenJourneyStateError(
          `Golden journey cannot fail from ${step}`,
        );
      }
      step = 'failed';
    },
  };
}
