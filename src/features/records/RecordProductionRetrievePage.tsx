import { type FormEvent, useState } from 'react';

type RetrievedPackage = {
  productionId: string;
  purpose: string;
  portions: string[];
  package: Record<string, unknown>;
};

export function RecordProductionRetrievePage() {
  const [capability, setCapability] = useState('');
  const [retrieved, setRetrieved] = useState<RetrievedPackage>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setRetrieved(undefined);
    const submitted = capability.trim();
    setCapability('');
    try {
      const response = await fetch('/api/v1/records/productions/retrievals', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'x-prevcare-csrf': '1',
        },
        body: JSON.stringify({ capability: submitted }),
      });
      if (response.status !== 200) {
        setError(
          'That retrieval capability could not be used. It may already have been used or expired.',
        );
        return;
      }
      const body = (await response.json()) as RetrievedPackage;
      setRetrieved(body);
    } catch {
      setError('Record Production retrieval is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-950 px-6 py-20 text-slate-100">
      <section className="mx-auto max-w-2xl border-l-4 border-amber-400 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-amber-300">
          Record Production
        </p>
        <h1 className="mt-4 text-4xl font-black tracking-tight">
          Retrieve authorized records
        </h1>
        <p className="mt-5 text-lg leading-8 text-slate-300">
          Enter the one-time retrieval capability from your message. It can be
          used once and then the package is removed. Nothing is stored in this
          browser.
        </p>
        <form className="mt-8 grid gap-4" onSubmit={submit}>
          <label className="grid gap-2 font-bold" htmlFor="production-capability">
            Retrieval capability
            <input
              id="production-capability"
              type="text"
              required
              autoComplete="off"
              value={capability}
              onChange={(event) => setCapability(event.target.value)}
              className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-mono font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-amber-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
          >
            Retrieve Record Production
          </button>
        </form>
        {error ? (
          <p className="mt-6 text-sm text-amber-200" role="status">
            {error}
          </p>
        ) : null}
        {retrieved ? (
          <div className="mt-8 grid gap-3 text-sm">
            <p>
              Purpose {retrieved.purpose} · portions{' '}
              {retrieved.portions.join(', ')}
            </p>
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-950 p-4 text-slate-200">
              {JSON.stringify(retrieved.package, null, 2)}
            </pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}
