import { expect, test } from 'bun:test';
import {
  GoldenJourneyStateError,
  createGoldenJourneyState,
} from '../../packages/golden-journey/src/index.ts';

test('journey state advances only through the golden path', () => {
  const state = createGoldenJourneyState();
  expect(state.step()).toBe('idle');

  state.advance('preflighted');
  state.advance('gated');
  state.advance('staff_authenticated');
  state.advance('release_published');
  state.advance('invitation_created');
  state.advance('invitation_delivered');
  state.advance('invitation_redeemed');
  state.advance('intake_drafted');
  state.advance('intake_submitted');
  state.advance('learning_acknowledged');
  state.advance('clinical_revealed');
  state.advance('student_restored');
  state.advance('browser_checked');
  state.advance('completed');

  expect(state.step()).toBe('completed');
});

test('journey state rejects skipped and backward transitions', () => {
  const state = createGoldenJourneyState();
  expect(() => state.advance('staff_authenticated')).toThrow(
    GoldenJourneyStateError,
  );

  state.advance('preflighted');
  expect(() => state.advance('idle')).toThrow(GoldenJourneyStateError);
  expect(() => state.advance('completed')).toThrow(GoldenJourneyStateError);
  expect(state.step()).toBe('preflighted');
});

test('failed is a terminal state from any in-progress step', () => {
  const state = createGoldenJourneyState();
  state.advance('preflighted');
  state.fail();
  expect(state.step()).toBe('failed');
  expect(() => state.advance('gated')).toThrow(GoldenJourneyStateError);
  expect(() => state.fail()).toThrow(GoldenJourneyStateError);
});

test('browser_checked can fail without passing through completed', () => {
  const state = createGoldenJourneyState();
  state.advance('preflighted');
  state.advance('gated');
  state.advance('staff_authenticated');
  state.advance('release_published');
  state.advance('invitation_created');
  state.advance('invitation_delivered');
  state.advance('invitation_redeemed');
  state.advance('intake_drafted');
  state.advance('intake_submitted');
  state.advance('learning_acknowledged');
  state.advance('clinical_revealed');
  state.advance('student_restored');
  state.advance('browser_checked');
  expect(state.step()).toBe('browser_checked');
  state.fail();
  expect(state.step()).toBe('failed');
  expect(state.step()).not.toBe('completed');
});
