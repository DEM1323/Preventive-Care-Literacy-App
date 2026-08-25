import { expect, test } from 'bun:test';
import { retryTransient } from '../../packages/golden-journey/src/index.ts';

test('retry helper retries transient failures then succeeds', async () => {
  const attempts: number[] = [];
  const result = await retryTransient(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new Error('temporarily unavailable');
      return 'ok';
    },
    { attempts: 3, delayMs: 0 },
  );

  expect(result).toBe('ok');
  expect(attempts).toEqual([1, 2, 3]);
});

test('retry helper does not retry a closed 4xx failure', async () => {
  let calls = 0;
  await expect(
    retryTransient(
      async () => {
        calls += 1;
        const error = new Error('Invitation was not accepted');
        (error as Error & { retryable?: boolean }).retryable = false;
        throw error;
      },
      { attempts: 4, delayMs: 0 },
    ),
  ).rejects.toThrow('Invitation was not accepted');
  expect(calls).toBe(1);
});

test('retry helper fails closed after the last transient attempt', async () => {
  let calls = 0;
  await expect(
    retryTransient(
      async () => {
        calls += 1;
        throw new Error('provider timeout');
      },
      { attempts: 2, delayMs: 0 },
    ),
  ).rejects.toThrow('provider timeout');
  expect(calls).toBe(2);
});
