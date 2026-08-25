export class NonRetryableGoldenJourneyError extends Error {
  readonly retryable = false;
  readonly code: string;

  constructor(message: string, code = 'UNEXPECTED_FAILURE') {
    super(message);
    this.name = 'NonRetryableGoldenJourneyError';
    this.code = code;
  }
}

export async function retryTransient<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    attempts: number;
    delayMs: number;
    backoffFactor?: number;
    maxDelayMs?: number;
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
      if (options.delayMs > 0) {
        const factor = options.backoffFactor ?? 1;
        const uncapped = options.delayMs * factor ** (attempt - 1);
        const delay =
          options.maxDelayMs === undefined
            ? uncapped
            : Math.min(uncapped, options.maxDelayMs);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
