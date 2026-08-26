import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

const client = createBrowserApiClient();

type Problem = { code?: string };

function operatorLifecycleMessage(
  action: 'provision' | 'recover' | 'disable' | 'permissions',
  error: unknown,
): string {
  const code = (error as Problem | undefined)?.code;
  if (code === 'FIRST_ADMINISTRATOR_REQUIRED') {
    return 'The first Staff Identity must hold Administrative Permission so it can initialize School Configuration.';
  }
  if (code === 'LAST_ADMINISTRATOR_REQUIRED') {
    return 'A School Workspace must keep at least one Staff Identity with Administrative Permission.';
  }
  if (action === 'provision') {
    return 'The Staff Identity could not be provisioned.';
  }
  if (action === 'recover') {
    return 'The Staff Identity could not be recovered.';
  }
  if (action === 'disable') {
    return 'The Staff Identity could not be disabled.';
  }
  return 'Staff permissions could not be replaced.';
}

type WorkspaceSummary = {
  workspaceId: string;
  displayName: string;
  createdAt: string;
  staffCount: number;
  configurationState: 'uninitialized' | 'draft' | 'active';
  draftVersion: number | null;
  activeReleaseId: string | null;
  staffIdentities: {
    staffIdentityId: string;
    displayName: string;
    email: string;
    permissions: ('administrative' | 'clinical')[];
    status: 'active' | 'disabled';
    createdAt: string;
    activatedAt: string | null;
  }[];
};

function oneTimePassword(): string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function OperatorConsolePage() {
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [token, setToken] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [schoolApprover, setSchoolApprover] = useState('');
  const [reason, setReason] = useState('Initial workspace administrator');
  const [administrative, setAdministrative] = useState(true);
  const [clinical, setClinical] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string>();
  const [passwordKind, setPasswordKind] = useState<'provision' | 'recovery'>(
    'provision',
  );
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState('');
  const workspaceCommand = useRef<
    { operationId: string; workspaceId: string } | undefined
  >(undefined);
  const staffCommand = useRef<
    | { operationId: string; staffIdentityId: string; password: string }
    | undefined
  >(undefined);
  const recoveryCommand = useRef<
    | { operationId: string; staffIdentityId: string; password: string }
    | undefined
  >(undefined);

  async function loadWorkspaces() {
    const result = await client.GET('/api/v1/operator/workspaces');
    if (result.response.status === 401) {
      setAuthenticated(false);
      setWorkspaces([]);
      return;
    }
    if (result.response.status !== 200 || !result.data) {
      setStatus('Workspace catalog is temporarily unavailable.');
      return;
    }
    setAuthenticated(true);
    setWorkspaces(result.data);
    setSelectedWorkspaceId(
      (current) => current || result.data[0]?.workspaceId || '',
    );
  }

  useEffect(() => {
    void loadWorkspaces().catch(() => setAuthenticated(false));
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy('sign-in');
    setStatus('');
    try {
      const result = await client.POST('/api/v1/auth/operator/sign-in', {
        body: { token },
      });
      setToken('');
      if (result.response.status !== 200) {
        setStatus('The operator credential was not accepted.');
        return;
      }
      setAuthenticated(true);
      await loadWorkspaces();
    } catch {
      setStatus('Operator sign-in is temporarily unavailable.');
    } finally {
      setBusy(undefined);
    }
  }

  async function signOut() {
    await client.POST('/api/v1/auth/operator/sign-out');
    setAuthenticated(false);
    setWorkspaces([]);
    setCreatedPassword(undefined);
  }

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    setBusy('workspace');
    setStatus('');
    const command =
      workspaceCommand.current ??
      (workspaceCommand.current = {
        operationId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
      });
    try {
      const result = await client.POST(
        '/api/v1/administration/school-workspaces',
        {
          params: { header: { 'x-prevcare-csrf': '1' } },
          body: { ...command, displayName: workspaceName },
        },
      );
      if (result.response.status !== 201) {
        setStatus('The workspace could not be created.');
        return;
      }
      setWorkspaceName('');
      workspaceCommand.current = undefined;
      setSelectedWorkspaceId(command.workspaceId);
      staffCommand.current = undefined;
      setCreatedPassword(undefined);
      setAdministrative(true);
      setStatus(
        'Workspace created. It has no School Configuration yet. Provision the first School Administrator next.',
      );
      await loadWorkspaces().catch(() =>
        setStatus(
          'Workspace created, but the catalog could not be refreshed. Reload the page.',
        ),
      );
      setSelectedWorkspaceId(command.workspaceId);
    } catch {
      setStatus('Workspace creation failed. Retry preserves this operation.');
    } finally {
      setBusy(undefined);
    }
  }

  async function provisionStaff(event: FormEvent) {
    event.preventDefault();
    if (!selectedWorkspaceId || (!administrative && !clinical)) return;
    setBusy('staff');
    setStatus('');
    setCreatedPassword(undefined);
    const command =
      staffCommand.current ??
      (staffCommand.current = {
        operationId: crypto.randomUUID(),
        staffIdentityId: crypto.randomUUID(),
        password: oneTimePassword(),
      });
    const permissions = [
      ...(administrative ? (['administrative'] as const) : []),
      ...(clinical ? (['clinical'] as const) : []),
    ];
    try {
      const result = await client.POST(
        '/api/v1/administration/staff-identities',
        {
          params: { header: { 'x-prevcare-csrf': '1' } },
          body: {
            operationId: command.operationId,
            staffIdentityId: command.staffIdentityId,
            workspaceId: selectedWorkspaceId,
            displayName: staffName,
            email: staffEmail,
            permissions,
            schoolApprover,
            reason,
            initialPassword: command.password,
          },
        },
      );
      if (result.response.status !== 201) {
        setStatus(operatorLifecycleMessage('provision', result.error));
        return;
      }
      setPasswordKind('provision');
      setCreatedPassword(command.password);
      staffCommand.current = undefined;
      setStaffName('');
      setStaffEmail('');
      setStatus(
        'Staff Identity provisioned. Deliver the password securely, then they sign in at /staff/sign-in to enroll TOTP and activate access. School Configuration can be initialized after that first Administrator signs in.',
      );
      await loadWorkspaces().catch(() =>
        setStatus(
          'Staff Identity provisioned, but the catalog could not be refreshed. Deliver the password shown below, then reload.',
        ),
      );
    } catch {
      setStatus('Staff provisioning failed. Retry preserves this operation.');
    } finally {
      setBusy(undefined);
    }
  }

  async function recoverStaff(staffIdentityId: string) {
    if (!selectedWorkspaceId) return;
    setBusy(`recover:${staffIdentityId}`);
    setStatus('');
    setCreatedPassword(undefined);
    const command =
      recoveryCommand.current?.staffIdentityId === staffIdentityId
        ? recoveryCommand.current
        : (recoveryCommand.current = {
            operationId: crypto.randomUUID(),
            staffIdentityId,
            password: oneTimePassword(),
          });
    try {
      const result = await client.POST(
        '/api/v1/administration/staff-identities/recoveries',
        {
          params: { header: { 'x-prevcare-csrf': '1' } },
          body: {
            operationId: command.operationId,
            workspaceId: selectedWorkspaceId,
            staffIdentityId,
            newPassword: command.password,
            schoolApprover,
            reason: reason || 'Credential recovery requested by the school',
          },
        },
      );
      if (result.response.status !== 200) {
        setStatus(operatorLifecycleMessage('recover', result.error));
        return;
      }
      setPasswordKind('recovery');
      setCreatedPassword(command.password);
      recoveryCommand.current = undefined;
      setStatus(
        'Credentials recovered. Deliver the new password securely. All Staff Sessions were revoked.',
      );
      await loadWorkspaces();
    } catch {
      setStatus('Staff recovery failed. Retry preserves this operation.');
    } finally {
      setBusy(undefined);
    }
  }

  async function disableStaff(staffIdentityId: string) {
    if (!selectedWorkspaceId) return;
    setBusy(`disable:${staffIdentityId}`);
    setStatus('');
    try {
      const result = await client.POST(
        '/api/v1/administration/staff-identities/disablements',
        {
          params: { header: { 'x-prevcare-csrf': '1' } },
          body: {
            operationId: crypto.randomUUID(),
            workspaceId: selectedWorkspaceId,
            staffIdentityId,
            schoolApprover,
            reason: reason || 'Staff disablement requested by the school',
          },
        },
      );
      if (result.response.status !== 200) {
        setStatus(operatorLifecycleMessage('disable', result.error));
        return;
      }
      setStatus('Staff Identity disabled. All Staff Sessions were revoked.');
      await loadWorkspaces();
    } catch {
      setStatus('Staff disablement failed. Retry the same request.');
    } finally {
      setBusy(undefined);
    }
  }

  async function replaceStaffPermissions(
    staffIdentityId: string,
    permissions: ('administrative' | 'clinical')[],
  ) {
    if (!selectedWorkspaceId) return;
    setBusy(`permissions:${staffIdentityId}`);
    setStatus('');
    try {
      const result = await client.POST(
        '/api/v1/administration/staff-identities/permission-replacements',
        {
          params: { header: { 'x-prevcare-csrf': '1' } },
          body: {
            operationId: crypto.randomUUID(),
            workspaceId: selectedWorkspaceId,
            staffIdentityId,
            permissions,
            schoolApprover,
            reason: reason || 'Permission change requested by the school',
          },
        },
      );
      if (result.response.status !== 200) {
        setStatus(operatorLifecycleMessage('permissions', result.error));
        return;
      }
      setStatus(
        'Permissions replaced. All Staff Sessions were revoked so the next sign-in uses current grants.',
      );
      await loadWorkspaces();
    } catch {
      setStatus('Permission replacement failed. Retry the same request.');
    } finally {
      setBusy(undefined);
    }
  }

  if (authenticated === undefined) {
    return (
      <main className="min-h-full bg-[#111827] p-8 text-slate-200">
        Checking operator session...
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-full bg-[#111827] px-5 py-16 text-slate-100">
        <form
          onSubmit={signIn}
          className="mx-auto max-w-md border border-cyan-400 bg-slate-950 p-8 shadow-[8px_8px_0_#22d3ee]"
        >
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">
            Technical operator
          </p>
          <h1 className="mt-3 text-4xl font-black">Workspace control</h1>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            The credential is exchanged for a one-hour secure browser session
            and is not stored in browser storage.
          </p>
          <label className="mt-7 block text-sm font-bold">
            Operator provisioning token
            <input
              type="password"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="mt-2 w-full border border-slate-600 bg-slate-900 px-3 py-3"
            />
          </label>
          <button
            disabled={busy === 'sign-in'}
            className="mt-5 w-full bg-cyan-300 px-4 py-3 font-black text-slate-950"
          >
            {busy === 'sign-in' ? 'Signing in...' : 'Open operator console'}
          </button>
          {status ? (
            <p role="alert" className="mt-5 text-sm font-bold text-rose-300">
              {status}
            </p>
          ) : null}
        </form>
      </main>
    );
  }

  const selected = workspaces.find(
    (workspace) => workspace.workspaceId === selectedWorkspaceId,
  );
  const provisioningFirstStaff = selected?.staffCount === 0;
  const resetStaffCommand = () => {
    staffCommand.current = undefined;
    setCreatedPassword(undefined);
  };
  const selectWorkspace = (workspace: WorkspaceSummary) => {
    setSelectedWorkspaceId(workspace.workspaceId);
    resetStaffCommand();
    if (workspace.staffCount === 0) setAdministrative(true);
  };

  return (
    <main className="min-h-full bg-[#eef2e6] text-[#15251f]">
      <header className="border-b-4 border-[#15251f] bg-[#d9ff68] px-5 py-6">
        <div className="mx-auto flex max-w-7xl items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.24em]">
              Technical operator
            </p>
            <h1 className="mt-1 text-4xl font-black tracking-tight">
              School workspace control
            </h1>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="border-2 border-[#15251f] bg-white px-4 py-2 font-black"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black">Workspace catalog</h2>
            <span className="font-mono text-sm">
              showing {workspaces.length}, newest first
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            {workspaces.map((workspace) => (
              <button
                key={workspace.workspaceId}
                type="button"
                onClick={() => selectWorkspace(workspace)}
                className={`grid gap-2 border-2 p-5 text-left sm:grid-cols-[1fr_auto] ${selectedWorkspaceId === workspace.workspaceId ? 'border-[#15251f] bg-white shadow-[5px_5px_0_#15251f]' : 'border-[#9aaa99] bg-[#f8faf3]'}`}
              >
                <div>
                  <strong className="text-lg">{workspace.displayName}</strong>
                  <p className="mt-1 break-all font-mono text-xs text-slate-600">
                    {workspace.workspaceId}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-black uppercase">
                    {workspace.configurationState}
                  </p>
                  <p className="text-sm">{workspace.staffCount} staff</p>
                </div>
              </button>
            ))}
            {workspaces.length === 0 ? (
              <p className="border-2 border-dashed border-[#9aaa99] p-8">
                No School Workspaces exist yet.
              </p>
            ) : null}
          </div>
        </section>

        <div className="grid content-start gap-6">
          <form
            onSubmit={createWorkspace}
            className="border-2 border-[#15251f] bg-white p-6"
          >
            <p className="font-mono text-xs font-bold uppercase">Step 01</p>
            <h2 className="mt-1 text-2xl font-black">Create workspace</h2>
            <label className="mt-5 block font-bold">
              School display name
              <input
                required
                maxLength={200}
                value={workspaceName}
                onChange={(event) => {
                  setWorkspaceName(event.target.value);
                  workspaceCommand.current = undefined;
                }}
                className="mt-2 w-full border-2 border-[#15251f] px-3 py-2 font-normal"
              />
            </label>
            <button
              disabled={busy !== undefined}
              className="mt-4 w-full bg-[#15251f] px-4 py-3 font-black text-white"
            >
              {busy === 'workspace' ? 'Creating...' : 'Create School Workspace'}
            </button>
          </form>

          <form
            onSubmit={provisionStaff}
            className="border-2 border-[#15251f] bg-white p-6"
          >
            <p className="font-mono text-xs font-bold uppercase">Step 02</p>
            <h2 className="mt-1 text-2xl font-black">Provision staff</h2>
            <p className="mt-2 text-sm text-slate-600">
              {selected
                ? `${selected.displayName} · configuration ${selected.configurationState}`
                : 'Select a workspace first.'}
            </p>
            {selected?.configurationState === 'uninitialized' ? (
              <p className="mt-2 text-sm">
                This workspace has no School Configuration yet. Grant the first
                School Administrator access, then they sign in at /staff/sign-in
                to initialize it.
              </p>
            ) : null}
            <label className="mt-4 block font-bold">
              Display name
              <input
                required
                value={staffName}
                onChange={(event) => {
                  setStaffName(event.target.value);
                  resetStaffCommand();
                }}
                className="mt-2 w-full border-2 border-[#15251f] px-3 py-2 font-normal"
              />
            </label>
            <label className="mt-4 block font-bold">
              Work email
              <input
                required
                type="email"
                value={staffEmail}
                onChange={(event) => {
                  setStaffEmail(event.target.value);
                  resetStaffCommand();
                }}
                className="mt-2 w-full border-2 border-[#15251f] px-3 py-2 font-normal"
              />
            </label>
            <label className="mt-4 block font-bold">
              School approver
              <input
                required
                value={schoolApprover}
                onChange={(event) => {
                  setSchoolApprover(event.target.value);
                  resetStaffCommand();
                }}
                className="mt-2 w-full border-2 border-[#15251f] px-3 py-2 font-normal"
              />
            </label>
            <label className="mt-4 block font-bold">
              Provisioning reason
              <textarea
                required
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  resetStaffCommand();
                }}
                className="mt-2 min-h-20 w-full border-2 border-[#15251f] px-3 py-2 font-normal"
              />
            </label>
            <fieldset className="mt-4">
              <legend className="font-bold">Permissions</legend>
              <label className="mt-2 flex gap-2">
                <input
                  type="checkbox"
                  checked={administrative}
                  disabled={provisioningFirstStaff}
                  onChange={(event) => {
                    setAdministrative(event.target.checked);
                    resetStaffCommand();
                  }}
                />{' '}
                Administrative
              </label>
              {provisioningFirstStaff ? (
                <p className="mt-2 text-xs text-slate-600">
                  The first Staff Identity must hold Administrative Permission
                  so it can initialize School Configuration.
                </p>
              ) : null}
              <label className="mt-2 flex gap-2">
                <input
                  type="checkbox"
                  checked={clinical}
                  onChange={(event) => {
                    setClinical(event.target.checked);
                    resetStaffCommand();
                  }}
                />{' '}
                Clinical
              </label>
            </fieldset>
            <button
              disabled={
                !selectedWorkspaceId ||
                (!administrative && !clinical) ||
                busy !== undefined
              }
              className="mt-5 w-full bg-[#d9ff68] px-4 py-3 font-black disabled:opacity-50"
            >
              {busy === 'staff'
                ? 'Provisioning...'
                : 'Provision Staff Identity'}
            </button>
          </form>

          {selected && selected.staffIdentities.length > 0 ? (
            <section className="border-2 border-[#15251f] bg-white p-6">
              <p className="font-mono text-xs font-bold uppercase">Step 03</p>
              <h2 className="mt-1 text-2xl font-black">Staff identities</h2>
              <p className="mt-2 text-sm text-slate-600">
                Recovery and disablement keep the named identity. Permission
                changes take effect on the next sign-in.
              </p>
              <ul className="mt-4 grid gap-3">
                {selected.staffIdentities.map((staff) => (
                  <li
                    key={staff.staffIdentityId}
                    className="border-2 border-[#9aaa99] p-4"
                  >
                    <strong>{staff.displayName}</strong>
                    <p className="font-mono text-xs">{staff.email}</p>
                    <p className="mt-1 text-sm">
                      {staff.permissions.join(', ') || 'no permissions'} ·{' '}
                      {staff.status}
                      {staff.activatedAt
                        ? ' · activated'
                        : ' · awaiting first sign-in'}
                    </p>
                    {staff.status === 'active' ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy !== undefined || !schoolApprover}
                          onClick={() => void recoverStaff(staff.staffIdentityId)}
                          className="border-2 border-[#15251f] bg-white px-3 py-1 font-bold disabled:opacity-50"
                        >
                          {busy === `recover:${staff.staffIdentityId}`
                            ? 'Recovering...'
                            : 'Recover credentials'}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== undefined || !schoolApprover}
                          onClick={() => void disableStaff(staff.staffIdentityId)}
                          className="border-2 border-[#15251f] bg-white px-3 py-1 font-bold disabled:opacity-50"
                        >
                          {busy === `disable:${staff.staffIdentityId}`
                            ? 'Disabling...'
                            : 'Disable'}
                        </button>
                        {staff.permissions.includes('clinical') ? (
                          <button
                            type="button"
                            disabled={
                              busy !== undefined ||
                              !schoolApprover ||
                              !staff.permissions.includes('administrative')
                            }
                            onClick={() =>
                              void replaceStaffPermissions(
                                staff.staffIdentityId,
                                ['administrative'],
                              )
                            }
                            className="border-2 border-[#15251f] bg-white px-3 py-1 font-bold disabled:opacity-50"
                          >
                            Remove clinical
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy !== undefined || !schoolApprover}
                            onClick={() =>
                              void replaceStaffPermissions(
                                staff.staffIdentityId,
                                staff.permissions.includes('administrative')
                                  ? ['administrative', 'clinical']
                                  : ['clinical'],
                              )
                            }
                            className="border-2 border-[#15251f] bg-white px-3 py-1 font-bold disabled:opacity-50"
                          >
                            Grant clinical
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {createdPassword ? (
            <section className="border-2 border-amber-700 bg-amber-50 p-6">
              <h2 className="font-black">
                {passwordKind === 'recovery'
                  ? 'Replacement password'
                  : 'One-time initial password'}
              </h2>
              <p className="mt-2 text-sm">
                Deliver this securely. It is not stored by the console and
                disappears when you leave or change the form.
                {passwordKind === 'recovery'
                  ? ' They enroll TOTP again at /staff/sign-in.'
                  : ''}
              </p>
              <code className="mt-4 block break-all border border-amber-700 bg-white p-3 text-lg font-bold">
                {createdPassword}
              </code>
            </section>
          ) : null}
          {status ? (
            <p
              role="status"
              className="border-l-4 border-[#15251f] bg-white p-4 font-bold"
            >
              {status}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
