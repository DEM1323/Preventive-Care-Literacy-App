export class NonRetryableGoldenJourneyError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableGoldenJourneyError';
  }
}

export async function retryTransient<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    attempts: number;
    delayMs: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Error &&
        'retryable' in error &&
        (error as { retryable?: boolean }).retryable === false
          ? false
          : true;
      if (!retryable || attempt === options.attempts) throw error;
      if (options.delayMs > 0) await sleep(options.delayMs);
    }
  }
  throw lastError;
}
