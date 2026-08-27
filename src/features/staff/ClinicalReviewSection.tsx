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
type ClinicalSelection =
  paths['/api/v1/clinical/students/selection']['post']['responses']['200']['content']['application/json'];
type RevealedRecord =
  paths['/api/v1/clinical/intake-records/current']['post']['responses']['200']['content']['application/json'];
type ClinicalAccessPurpose = 'care_coordination' | 'historical_comparison';
type Problem = { code?: string };

function emptyClinicalView() {
  return {
    directory: undefined as ClinicalDirectory['students'] | undefined,
    classes: [] as ClinicalDirectory['classes'],
    classFilter: '',
    filter: '',
    purpose: 'care_coordination' as ClinicalAccessPurpose,
    selectedStudentId: undefined as string | undefined,
    selectedCurrentVersionId: undefined as string | undefined,
    selectedVersions: undefined as ClinicalSelection['versions'] | undefined,
    revealed: undefined as RevealedRecord | undefined,
    error: undefined as string | undefined,
  };
}

function statusReasonLabel(reason: ClinicalStudent['statusReasons'][number]) {
  if (reason === 'disabled') return 'Student access disabled';
  return 'No active Class Membership';
}

export function ClinicalReviewSection(props: { onSessionLost: () => void }) {
  const navigate = useNavigate();
  const [view, setView] = useState(emptyClinicalView);
  const [busy, setBusy] = useState<
    'directory' | 'select' | 'reveal' | undefined
  >('directory');
  const [freshnessEpoch, setFreshnessEpoch] = useState(0);
  const freshUntilMs = useRef<number | undefined>(undefined);
  const clearedRef = useRef(false);
  const busyRef = useRef<'directory' | 'select' | 'reveal' | undefined>(
    'directory',
  );
  const generationRef = useRef(0);
  const abortRef = useRef(new AbortController());
  const classFilterRef = useRef('');
  const selectedStudentIdRef = useRef<string | undefined>(undefined);
  const selectedCurrentVersionIdRef = useRef<string | undefined>(undefined);
  const refreshDirectoryRef = useRef<
    (mode: 'initial' | 'silent' | 'revalidate') => Promise<void>
  >(async () => {});

  function rememberFreshUntil(value: string) {
    freshUntilMs.current = Date.parse(value);
    setFreshnessEpoch((current) => current + 1);
  }

  function rememberSelectedStudent(
    studentId: string | undefined,
    currentVersionId: string | undefined,
  ) {
    selectedStudentIdRef.current = studentId;
    selectedCurrentVersionIdRef.current = currentVersionId;
  }

  function invalidateInFlightClinicalWork() {
    generationRef.current += 1;
    abortRef.current.abort();
    abortRef.current = new AbortController();
    return generationRef.current;
  }

  function clearSensitiveClinicalState(error?: string) {
    invalidateInFlightClinicalWork();
    rememberSelectedStudent(undefined, undefined);
    freshUntilMs.current = undefined;
    busyRef.current = undefined;
    setBusy(undefined);
    setView((current) => ({
      ...emptyClinicalView(),
      purpose: current.purpose,
      error,
    }));
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

  async function refreshDirectory(mode: 'initial' | 'silent' | 'revalidate') {
    if (clearedRef.current) return;
    const generation = generationRef.current;
    const signal = abortRef.current.signal;
    if (mode === 'initial') {
      busyRef.current = 'directory';
      setBusy('directory');
    }
    try {
      const classId = classFilterRef.current;
      const listing = await client.GET('/api/v1/clinical/review-directory', {
        signal,
        ...(classId ? { params: { query: { classId } } } : {}),
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
      const classes = listing.data.classes;
      const selected = students.find(
        (student) => student.studentId === selectedStudentIdRef.current,
      );
      const nextCurrentId =
        selected?.currentIntakeRecordVersion?.intakeRecordVersionId;
      const supersededRequest =
        selectedCurrentVersionIdRef.current !== undefined &&
        nextCurrentId !== selectedCurrentVersionIdRef.current;
      if (selectedStudentIdRef.current && (!selected || supersededRequest)) {
        invalidateInFlightClinicalWork();
      }
      rememberSelectedStudent(
        selected ? selected.studentId : undefined,
        nextCurrentId,
      );
      setView((current) => ({
        ...current,
        directory: students,
        classes,
        selectedStudentId: selected ? selected.studentId : undefined,
        selectedCurrentVersionId: nextCurrentId,
        selectedVersions:
          selected && !supersededRequest ? current.selectedVersions : undefined,
        revealed: selected && !supersededRequest ? current.revealed : undefined,
        error: undefined,
      }));
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

  async function selectStudent(student: ClinicalStudent) {
    const generation = invalidateInFlightClinicalWork();
    rememberSelectedStudent(
      student.studentId,
      student.currentIntakeRecordVersion?.intakeRecordVersionId,
    );
    busyRef.current = 'select';
    setBusy('select');
    setView((current) => ({
      ...current,
      selectedStudentId: student.studentId,
      selectedCurrentVersionId:
        student.currentIntakeRecordVersion?.intakeRecordVersionId,
      selectedVersions: undefined,
      revealed: undefined,
      error: undefined,
    }));
    try {
      const result = await client.POST('/api/v1/clinical/students/selection', {
        body: { studentId: student.studentId, purpose: view.purpose },
        signal: abortRef.current.signal,
      });
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
      setView((current) =>
        current.selectedStudentId === student.studentId
          ? {
              ...current,
              selectedVersions: result.data?.versions,
              error: undefined,
            }
          : current,
      );
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

  async function revealCurrent(student: ClinicalStudent) {
    const generation = invalidateInFlightClinicalWork();
    rememberSelectedStudent(
      student.studentId,
      student.currentIntakeRecordVersion?.intakeRecordVersionId,
    );
    busyRef.current = 'reveal';
    setBusy('reveal');
    setView((current) => ({
      ...current,
      selectedStudentId: student.studentId,
      selectedCurrentVersionId:
        student.currentIntakeRecordVersion?.intakeRecordVersionId,
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
      setView((current) =>
        current.selectedStudentId === student.studentId &&
        current.selectedStudentId === result.data?.studentId
          ? {
              ...current,
              revealed: result.data,
              error: undefined,
            }
          : current,
      );
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

  async function revealVersion(intakeRecordVersionId: string) {
    if (!view.selectedStudentId) return;
    const studentId = view.selectedStudentId;
    const generation = invalidateInFlightClinicalWork();
    busyRef.current = 'reveal';
    setBusy('reveal');
    setView((current) => ({
      ...current,
      revealed: undefined,
      error: undefined,
    }));
    try {
      const result = await client.POST(
        '/api/v1/clinical/intake-records/versions',
        {
          body: {
            studentId,
            intakeRecordVersionId,
            purpose: 'historical_comparison',
          },
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
      setView((current) =>
        current.selectedStudentId === studentId &&
        current.selectedStudentId === result.data?.studentId
          ? {
              ...current,
              revealed: result.data,
              error: undefined,
            }
          : current,
      );
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

  function preventCopy(event: { preventDefault(): void }) {
    event.preventDefault();
  }

  return (
    <section
      className="clinical-sensitive mt-10 border-t border-slate-700 pt-8"
      onCopy={preventCopy}
      onCut={preventCopy}
    >
      <h2 className="text-xl font-black tracking-tight">Intake Records</h2>
      <p className="mt-2 text-sm text-slate-400">
        The directory is for locating a Student. Revealing an Intake Record
        Version is a separate request. Answers stay in this session only.
      </p>
      <label
        className="mt-4 grid gap-2 text-sm font-bold"
        htmlFor="access-purpose"
      >
        Access purpose
        <select
          id="access-purpose"
          value={view.purpose}
          onChange={(event) =>
            setView((current) => ({
              ...current,
              purpose: event.target.value as ClinicalAccessPurpose,
            }))
          }
          className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="care_coordination">Care coordination</option>
          <option value="historical_comparison">Historical comparison</option>
        </select>
      </label>
      <label
        className="mt-4 grid gap-2 text-sm font-bold"
        htmlFor="class-filter"
      >
        Class
        <select
          id="class-filter"
          value={view.classFilter}
          onChange={(event) => {
            const classFilter = event.target.value;
            classFilterRef.current = classFilter;
            invalidateInFlightClinicalWork();
            rememberSelectedStudent(undefined, undefined);
            setView((current) => ({
              ...current,
              classFilter,
              selectedStudentId: undefined,
              selectedCurrentVersionId: undefined,
              selectedVersions: undefined,
              revealed: undefined,
            }));
            void refreshDirectoryRef.current('revalidate');
          }}
          className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="">All Classes</option>
          {view.classes.map((entry) => (
            <option key={entry.classId} value={entry.classId}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
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
          className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
                <p className="text-sm text-slate-400">{student.studentId}</p>
                {student.statusReasons.length > 0 ? (
                  <p className="mt-1 text-sm text-slate-400">
                    {student.statusReasons.map(statusReasonLabel).join(' · ')}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== undefined}
                  onClick={() => void selectStudent(student)}
                  className="rounded border border-slate-500 px-4 py-2 font-bold disabled:opacity-50"
                >
                  Open Student
                </button>
                <button
                  type="button"
                  disabled={
                    busy !== undefined || !student.currentIntakeRecordVersion
                  }
                  onClick={() => void revealCurrent(student)}
                  className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
                >
                  Reveal current record
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {view.selectedVersions ? (
        <section className="mt-8 border border-slate-700 bg-slate-950 p-4">
          <h3 className="font-black">Intake Record Versions</h3>
          <ul className="mt-4 grid gap-3">
            {view.selectedVersions.map((version) => (
              <li
                key={version.intakeRecordVersionId}
                className="flex items-center justify-between gap-4 border border-slate-800 p-3"
              >
                <div>
                  <p className="font-bold">
                    Version {version.versionNumber} · {version.status}
                  </p>
                  <p className="text-sm text-slate-400">
                    {version.locale} · {version.acceptedAt}
                  </p>
                </div>
                {version.status === 'superseded' ? (
                  <button
                    type="button"
                    disabled={busy !== undefined}
                    onClick={() =>
                      void revealVersion(version.intakeRecordVersionId)
                    }
                    className="rounded border border-amber-400 px-4 py-2 font-bold disabled:opacity-50"
                  >
                    Reveal this version
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {view.revealed ? (
        <article className="mt-8 border border-amber-400 bg-slate-950 p-4">
          <h3 className="font-black">
            {view.revealed.status === 'current'
              ? 'Current Intake Record'
              : 'Historical Intake Record Version'}
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Source release {view.revealed.schoolConfigurationReleaseId} ·{' '}
            {view.revealed.locale} · {view.revealed.status}
          </p>
          {view.revealed.changedFields.length > 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              Changed fields: {view.revealed.changedFields.length}
            </p>
          ) : null}
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
