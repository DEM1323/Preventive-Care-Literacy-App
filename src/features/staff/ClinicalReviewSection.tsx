import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';
import type { paths } from '../../../packages/api-client/src/schema.ts';
import { renderIntakeAnswer } from '../../../modules/intake-answers/index.ts';
import {
  clinicalHttpFailureLocksAllState,
  ignoreStaleClinicalGeneration,
} from './clinical-review-fail-closed.ts';

const client = createBrowserApiClient();
const clinicalAuthorizationBackstopMs = 2000;

type ClinicalDirectory =
  paths['/api/v1/clinical/review-directory']['get']['responses']['200']['content']['application/json'];
type ClinicalStudent = ClinicalDirectory['students'][number];
type RevealedRecord =
  paths['/api/v1/clinical/intake-records/current']['post']['responses']['200']['content']['application/json'];
type Problem = { code?: string };

function emptyClinicalView() {
  return {
    directory: undefined as ClinicalDirectory['students'] | undefined,
    filter: '',
    selectedStudentId: undefined as string | undefined,
    revealed: undefined as RevealedRecord | undefined,
    error: undefined as string | undefined,
  };
}

export function ClinicalReviewSection(props: { onSessionLost: () => void }) {
  const navigate = useNavigate();
  const [view, setView] = useState(emptyClinicalView);
  const [busy, setBusy] = useState<'directory' | 'reveal' | undefined>(
    'directory',
  );
  const [freshnessEpoch, setFreshnessEpoch] = useState(0);
  const freshUntilMs = useRef<number | undefined>(undefined);
  const clearedRef = useRef(false);
  const busyRef = useRef<'directory' | 'reveal' | undefined>('directory');
  const generationRef = useRef(0);
  const abortRef = useRef(new AbortController());
  const refreshDirectoryRef = useRef<
    (mode: 'initial' | 'silent' | 'revalidate') => Promise<void>
  >(async () => {});

  function rememberFreshUntil(value: string) {
    freshUntilMs.current = Date.parse(value);
    setFreshnessEpoch((current) => current + 1);
  }

  function clearSensitiveClinicalState(error?: string) {
    generationRef.current += 1;
    abortRef.current.abort();
    abortRef.current = new AbortController();
    freshUntilMs.current = undefined;
    busyRef.current = undefined;
    setBusy(undefined);
    setView({ ...emptyClinicalView(), error });
  }

  function lockOutClinical(error?: string) {
    clearedRef.current = true;
    clearSensitiveClinicalState(error);
  }

  function handleClinicalFailure(status: number, problem: Problem | undefined) {
    if (status === 401) {
      lockOutClinical();
      props.onSessionLost();
      navigate('/staff/sign-in');
      return;
    }
    if (
      problem?.code === 'STAFF_AUTHENTICATION_STALE' ||
      problem?.code === 'STAFF_PERMISSION_REQUIRED' ||
      problem?.code === 'STAFF_SESSION_EXPIRED' ||
      problem?.code === 'STAFF_SESSION_REVOKED'
    ) {
      lockOutClinical(
        problem.code === 'STAFF_AUTHENTICATION_STALE'
          ? 'Authentication freshness expired. Sensitive values were cleared.'
          : 'Clinical access is no longer available. Sensitive values were cleared.',
      );
      return;
    }
    if (status === 404 && !clinicalHttpFailureLocksAllState(status, problem)) {
      setView((current) => ({
        ...current,
        revealed: undefined,
        error: 'The Intake Record could not be revealed.',
      }));
      return;
    }
    lockOutClinical(
      status >= 500
        ? 'Clinical access could not be confirmed. Sensitive values were cleared.'
        : 'Clinical access could not be confirmed. Sensitive values were cleared.',
    );
  }

  async function refreshDirectory(
    mode: 'initial' | 'silent' | 'revalidate',
  ) {
    if (clearedRef.current) return;
    const generation = generationRef.current;
    const signal = abortRef.current.signal;
    if (mode === 'initial') {
      busyRef.current = 'directory';
      setBusy('directory');
    }
    try {
      const listing = await client.GET('/api/v1/clinical/review-directory', {
        signal,
      });
      if (
        ignoreStaleClinicalGeneration(generation, generationRef.current) ||
        clearedRef.current
      ) {
        return;
      }
      if (listing.response.status !== 200 || !listing.data) {
        handleClinicalFailure(
          listing.response.status,
          listing.error as Problem | undefined,
        );
        return;
      }
      rememberFreshUntil(listing.data.freshUntil);
      const students = listing.data.students;
      setView((current) => {
        const selected = students.find(
          (student) => student.studentId === current.selectedStudentId,
        );
        const keepSelection = selected?.currentIntakeRecordVersion;
        return {
          ...current,
          directory: students,
          selectedStudentId: keepSelection
            ? current.selectedStudentId
            : undefined,
          revealed: keepSelection ? current.revealed : undefined,
          error: undefined,
        };
      });
    } catch {
      if (ignoreStaleClinicalGeneration(generation, generationRef.current))
        return;
      lockOutClinical(
        'Clinical access could not be confirmed. Sensitive values were cleared.',
      );
    } finally {
      if (mode === 'initial' && generation === generationRef.current) {
        busyRef.current = undefined;
        setBusy(undefined);
      }
    }
  }

  refreshDirectoryRef.current = refreshDirectory;

  useEffect(() => {
    void refreshDirectoryRef.current('initial');
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshDirectoryRef.current('silent');
    }, clinicalAuthorizationBackstopMs);
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        clearSensitiveClinicalState(
          'Clinical access is being rechecked. Sensitive values were cleared.',
        );
        void refreshDirectoryRef.current('revalidate');
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    const deadline = freshUntilMs.current;
    if (!deadline) return;
    const delay = Math.max(0, deadline - Date.now());
    const timer = window.setTimeout(() => {
      lockOutClinical(
        'Authentication freshness expired. Sensitive values were cleared.',
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [freshnessEpoch]);

  const visibleStudents = useMemo(() => {
    const directory = view.directory ?? [];
    const query = view.filter.trim().toLowerCase();
    if (!query) return directory;
    return directory.filter((student) =>
      student.studentId.toLowerCase().includes(query),
    );
  }, [view.directory, view.filter]);

  async function reveal(student: ClinicalStudent) {
    const generation = generationRef.current;
    busyRef.current = 'reveal';
    setBusy('reveal');
    setView((current) => ({
      ...current,
      selectedStudentId: student.studentId,
      revealed: undefined,
      error: undefined,
    }));
    try {
      const result = await client.POST(
        '/api/v1/clinical/intake-records/current',
        {
          body: { studentId: student.studentId },
          signal: abortRef.current.signal,
        },
      );
      if (
        ignoreStaleClinicalGeneration(generation, generationRef.current) ||
        clearedRef.current
      ) {
        return;
      }
      if (result.response.status !== 200 || !result.data) {
        handleClinicalFailure(
          result.response.status,
          result.error as Problem | undefined,
        );
        return;
      }
      rememberFreshUntil(result.data.freshUntil);
      setView((current) => ({
        ...current,
        revealed: result.data,
        error: undefined,
      }));
    } catch {
      if (ignoreStaleClinicalGeneration(generation, generationRef.current))
        return;
      lockOutClinical(
        'Clinical access could not be confirmed. Sensitive values were cleared.',
      );
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = undefined;
        setBusy(undefined);
      }
    }
  }

  return (
    <section className="clinical-sensitive mt-10 border-t border-slate-700 pt-8">
      <h2 className="text-xl font-black tracking-tight">Intake review</h2>
      <p className="mt-2 text-sm text-slate-400">
        Directory loading and Intake Record reveal are separate. Answers stay in
        this session only.
      </p>
      <label
        className="mt-4 grid gap-2 text-sm font-bold"
        htmlFor="student-filter"
      >
        Filter
        <input
          id="student-filter"
          value={view.filter}
          onChange={(event) =>
            setView((current) => ({ ...current, filter: event.target.value }))
          }
          className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
        />
      </label>
      {busy === 'directory' ? (
        <p className="mt-4 text-slate-400">Loading directory…</p>
      ) : null}
      {view.directory ? (
        <ul className="mt-4 grid gap-3">
          {visibleStudents.map((student) => (
            <li
              key={student.studentId}
              className={`flex items-center justify-between gap-4 border bg-slate-950 p-4 ${
                view.selectedStudentId === student.studentId
                  ? 'border-sky-400'
                  : 'border-slate-700'
              }`}
            >
              <div>
                <p className="font-bold">Student</p>
                <p className="text-sm text-slate-400">
                  {student.currentIntakeRecordVersion
                    ? `Current record ${student.currentIntakeRecordVersion.acceptedAt}`
                    : 'No current Intake Record Version'}
                </p>
              </div>
              <button
                type="button"
                disabled={
                  busy !== undefined || !student.currentIntakeRecordVersion
                }
                onClick={() => void reveal(student)}
                className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
              >
                Reveal current record
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {view.revealed ? (
        <article className="mt-8 border border-amber-400 bg-slate-950 p-4">
          <h3 className="font-black">Current Intake Record</h3>
          <dl className="mt-4 grid gap-3">
            {view.revealed.intakeForm.fields.map((field) => {
              const value = view.revealed?.answers[field.id];
              if (value === undefined) return null;
              const displayed = renderIntakeAnswer(field, value);
              if (displayed === undefined) return null;
              return (
                <div key={field.id}>
                  <dt className="text-sm text-slate-400">{field.label}</dt>
                  <dd className="font-bold">{displayed}</dd>
                </div>
              );
            })}
          </dl>
        </article>
      ) : null}
      {view.error ? (
        <p role="alert" className="mt-4 text-sm font-bold text-rose-300">
          {view.error}
        </p>
      ) : null}
    </section>
  );
}
