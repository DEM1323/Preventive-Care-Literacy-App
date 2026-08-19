import { expect, test } from 'bun:test';
import { assertNoProhibitedData } from '../../scripts/staging-data-policy.ts';

test('allows fixed application error codes', () => {
  expect(() =>
    assertNoProhibitedData(
      JSON.stringify({ code: 'TRUSTED_ORIGIN_REQUIRED' }),
      'Staging response',
    ),
  ).not.toThrow();
});

test('rejects sensitive authentication code fields', () => {
  for (const field of ['invitationCode', 'signInCode']) {
    expect(() =>
      assertNoProhibitedData(
        JSON.stringify({ [field]: 'sensitive-value' }),
        'Staging response',
      ),
    ).toThrow('Staging response contained a prohibited data class');
  }
});
