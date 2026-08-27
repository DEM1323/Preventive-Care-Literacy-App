import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';
import { ClinicalReviewSection } from './ClinicalReviewSection';
import {
  ClassWorkspace,
  type ClassDirectoryEntry,
} from './ClassWorkspace';
import { StudentRecordLifecycleSection } from './StudentRecordLifecycleSection';

const client = createBrowserApiClient();

type StaffSession = {
  staffIdentityId: string;
  workspaceId: string;
  displayName: string;
  permissions: ('administrative' | 'clinical')[];
  authenticatedAt: string;
};

type StaffDirectoryEntry = {
  staffIdentityId: string;
  displayName: string;
  email: string;
  permissions: ('administrative' | 'clinical')[];
  status: 'active' | 'disabled';
  createdAt: string;
};

export function StaffHomePage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<StaffSession | undefined>();
  const [directory, setDirectory] = useState<
    StaffDirectoryEntry[] | undefined
  >();
  const [classes, setClasses] = useState<ClassDirectoryEntry[] | undefined>();

  async function loadClasses() {
    const listing = await client.GET('/api/v1/administration/classes');
    if (listing.response.status === 200 && listing.data) {
      setClasses(listing.data.classes);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, response } = await client.GET('/api/v1/staff/session');
      if (cancelled) return;
      if (response.status !== 200 || !data) {
        navigate('/staff/sign-in');
        return;
      }
      setSession(data);
      if (data.permissions.includes('administrative')) {
        const listing = await client.GET(
          '/api/v1/administration/staff-identities',
        );
        if (!cancelled && listing.response.status === 200 && listing.data) {
          setDirectory(listing.data.staffIdentities);
        }
        await loadClasses();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function signOut() {
    setDirectory(undefined);
    setClasses(undefined);
    setSession(undefined);
    await client.POST('/api/v1/auth/staff/sign-out');
    navigate('/staff/sign-in');
  }

  if (!session) {
    return (
      <main className="min-h-full bg-slate-950 px-6 py-20 text-slate-100">
        <p className="mx-auto max-w-md text-slate-400">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-slate-950 px-6 py-20 text-slate-100">
      <section className="mx-auto max-w-2xl border-l-4 border-sky-400 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-sky-300">
          School staff
        </p>
        <h1 className="mt-4 text-3xl font-black tracking-tight">
          {session.displayName}
        </h1>
        <p className="mt-2 text-slate-300">
          Permissions: {session.permissions.join(', ')}
        </p>
        <button
          type="button"
          onClick={signOut}
          className="mt-6 rounded border border-slate-600 px-4 py-2 font-bold text-slate-200"
        >
          Sign out
        </button>

        {session.permissions.includes('clinical') ? (
          <ClinicalReviewSection
            onSessionLost={() => {
              setDirectory(undefined);
              setClasses(undefined);
              setSession(undefined);
            }}
          />
        ) : null}

        {directory ? (
          <div className="mt-10">
            <button
              type="button"
              onClick={() => navigate('/staff/configuration')}
              className="mb-6 rounded bg-emerald-400 px-4 py-2 font-black text-slate-950"
            >
              Manage School Configuration
            </button>
            <h2 className="text-xl font-black tracking-tight">
              Staff identities
            </h2>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="text-slate-400">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Permissions</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {directory.map((entry) => (
                  <tr
                    key={entry.staffIdentityId}
                    className="border-t border-slate-800"
                  >
                    <td className="py-2 pr-4">{entry.displayName}</td>
                    <td className="py-2 pr-4">{entry.email}</td>
                    <td className="py-2 pr-4">
                      {entry.permissions.join(', ')}
                    </td>
                    <td className="py-2">{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {classes ? (
          <>
            <ClassWorkspace classes={classes} onReload={loadClasses} />
            <StudentRecordLifecycleSection />
          </>
        ) : null}
      </section>
    </main>
  );
}
