import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import type { SubmissionRow } from '../../types/submission';
import { fetchEncryptedSubmissions, flushPendingSubmissions } from '../../utils/sheets';

export function NurseDashboardPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [gatePasscode, setGatePasscode] = useState('');
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem('prevcare_nurse_session') === 'true'
  );
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const expectedGate = import.meta.env.VITE_NURSE_DASHBOARD_PASSCODE ?? 'nurse123';

  useEffect(() => {
    if (authenticated) {
      void flushPendingSubmissions();
    }
  }, [authenticated]);

  const handleGateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (gatePasscode === expectedGate) {
      sessionStorage.setItem('prevcare_nurse_session', 'true');
      setAuthenticated(true);
    } else {
      showToast('Access Denied', 'Invalid passcode', 'fa-lock text-rose-500');
    }
  };

  const loadSubmissions = async () => {
    setLoading(true);
    try {
      const data = await fetchEncryptedSubmissions();
      setRows(data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      if (data.length === 0) {
        showToast('Dashboard', t('noSubmissions'), 'fa-inbox text-slate-400');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    return (
      <section className="max-w-md mx-auto my-8 bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900">{t('nurseLoginTitle')}</h2>
        <p className="text-slate-500 text-sm mt-1 mb-6">{t('nurseLoginSubtitle')}</p>
        <form onSubmit={handleGateSubmit} className="space-y-4">
          <Input
            label={t('nursePasscode')}
            type="password"
            value={gatePasscode}
            onChange={(e) => setGatePasscode(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            {t('nurseEnter')}
          </Button>
        </form>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-2xl font-bold text-slate-900">Nurse Dashboard</h2>
        <p className="text-sm text-slate-500 mt-1">
          Encrypted submission registry only. Form contents are never stored or displayed in plaintext.
        </p>
        <div className="mt-4">
          <Button type="button" onClick={loadSubmissions} disabled={loading}>
            {loading ? 'Loading...' : 'Fetch Submissions'}
          </Button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Email ID</th>
                <th className="p-3">Student ID</th>
                <th className="p-3">Version</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.id}-${row.version}`} className="border-t border-slate-100">
                  <td className="p-3">{new Date(row.timestamp).toLocaleString()}</td>
                  <td className="p-3 font-mono text-xs">{row.emailHash}</td>
                  <td className="p-3 font-mono text-xs">{row.studentIdHash}</td>
                  <td className="p-3">v{row.version}</td>
                  <td className="p-3">
                    <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded">
                      {row.submissionStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
