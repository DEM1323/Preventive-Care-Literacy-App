import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

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

type ClassDirectoryEntry = {
  classId: string;
  name: string;
  createdAt: string;
  invitations: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    status:
      | 'pending_delivery'
      | 'delivered'
      | 'delivery_failed'
      | 'expired'
      | 'completed';
    expiresAt: string;
  }[];
};

export function StaffHomePage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<StaffSession | undefined>();
  const [directory, setDirectory] = useState<
    StaffDirectoryEntry[] | undefined
  >();
  const [classes, setClasses] = useState<ClassDirectoryEntry[] | undefined>();
  const [className, setClassName] = useState('');
  const [recipient, setRecipient] = useState('');
  const [invitationOutcome, setInvitationOutcome] = useState<
    'idle' | 'sending' | 'sent' | 'failed'
  >('idle');
  const pendingCommand = useRef<
    | {
        operationId: string;
        classId: string;
        invitationId: string;
        name: string;
        recipient: string;
      }
    | undefined
  >(undefined);

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
    await client.POST('/api/v1/auth/staff/sign-out');
    navigate('/staff/sign-in');
  }

  async function createClassInvitation(event: FormEvent) {
    event.preventDefault();
    setInvitationOutcome('sending');
    const command =
      pendingCommand.current ??
      (pendingCommand.current = {
        operationId: crypto.randomUUID(),
        classId: crypto.randomUUID(),
        invitationId: crypto.randomUUID(),
        name: className,
        recipient,
      });
    let result;
    try {
      result = await client.POST('/api/v1/administration/classes', {
        body: command,
      });
    } catch {
      setInvitationOutcome('failed');
      return;
    }
    if (result.response.status !== 201) {
      setInvitationOutcome('failed');
      return;
    }
    setClassName('');
    setRecipient('');
    pendingCommand.current = undefined;
    setInvitationOutcome('sent');
    await loadClasses();
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

        {directory ? (
          <div className="mt-10">
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
          <div className="mt-10 border-t border-slate-700 pt-8">
            <h2 className="text-xl font-black tracking-tight">Classes</h2>
            <form className="mt-4 grid gap-4" onSubmit={createClassInvitation}>
              <label className="grid gap-2 font-bold" htmlFor="class-name">
                Class name
                <input
                  id="class-name"
                  required
                  maxLength={200}
                  value={className}
                  onChange={(event) => {
                    setClassName(event.target.value);
                    pendingCommand.current = undefined;
                    setInvitationOutcome('idle');
                  }}
                  className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                />
              </label>
              <label
                className="grid gap-2 font-bold"
                htmlFor="invitation-recipient"
              >
                Invitation email
                <input
                  id="invitation-recipient"
                  required
                  type="email"
                  maxLength={320}
                  value={recipient}
                  onChange={(event) => {
                    setRecipient(event.target.value);
                    pendingCommand.current = undefined;
                    setInvitationOutcome('idle');
                  }}
                  className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                />
              </label>
              <button
                type="submit"
                disabled={invitationOutcome === 'sending'}
                className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
              >
                {invitationOutcome === 'sending'
                  ? 'Creating…'
                  : 'Create class and send invitation'}
              </button>
              <p aria-live="polite" className="text-sm text-slate-300">
                {invitationOutcome === 'sent'
                  ? 'Class created. Invitation delivery is pending.'
                  : invitationOutcome === 'failed'
                    ? 'The class and invitation could not be created.'
                    : ''}
              </p>
            </form>

            <div className="mt-8 grid gap-4">
              {classes.map((classEntry) => (
                <article
                  key={classEntry.classId}
                  className="border border-slate-700 bg-slate-950 p-4"
                >
                  <h3 className="font-black">{classEntry.name}</h3>
                  {classEntry.invitations.map((invitation) => (
                    <p
                      key={invitation.invitationId}
                      className="mt-2 text-sm text-slate-300"
                    >
                      Invitation delivery:{' '}
                      {invitation.status.replaceAll('_', ' ')}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
