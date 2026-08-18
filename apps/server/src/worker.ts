export type Worker = {
  close(): Promise<void>;
};

export async function startWorker(): Promise<Worker> {
  return { close: async () => undefined };
}

if (import.meta.main) await startWorker();
