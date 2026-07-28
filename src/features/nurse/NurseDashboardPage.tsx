import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useIntakeSchema } from '../../context/IntakeSchemaContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import type { IntakeFormData } from '../../types/intakeSchema';
import type { EncryptedBundle, SubmissionRow } from '../../types/submission';
import { decryptPayload } from '../../utils/crypto';
import { fetchEncryptedSubmissions, flushPendingSubmissions } from '../../utils/sheets';

interface DecryptedRow {
  row: SubmissionRow;
  data: IntakeFormData | null;
  error: boolean;
}

function displayAnswer(value: string | boolean | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

export function NurseDashboardPage() {
  const { t } = useLanguage();
  const { schema } = useIntakeSchema();
  const { showToast } = useToast();
  const [gatePasscode, setGatePasscode] = useState('');
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem('prevcare_nurse_session') === 'true'
  );
  const [decryptKey, setDecryptKey] = useState('');
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [decrypted, setDecrypted] = useState<DecryptedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const expectedGate = import.meta.env.VITE_NURSE_DASHBOARD_PASSCODE ?? 'nurse123';

  const summaryFields = useMemo(
    () =>
      schema.fields
        .filter((f) => f.enabled && f.nurseSummary)
        .sort((a, b) => a.step - b.step || a.sortOrder - b.sortOrder),
    [schema.fields]
  );

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
      setDecrypted([]);
      if (data.length === 0) {
        showToast('Dashboard', t('noSubmissions'), 'fa-inbox text-slate-400');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDecrypt = async () => {
    if (!decryptKey.trim()) return;
    const results: DecryptedRow[] = [];

    for (const row of rows) {
      try {
        const bundle = JSON.parse(row.encryptedPayload) as EncryptedBundle;
        const data = await decryptPayload<IntakeFormData>(decryptKey, bundle);
        results.push({ row, data, error: false });
      } catch {
        results.push({ row, data: null, error: true });
      }
    }

    setDecrypted(results);
    if (results.length > 0 && results.every((r) => r.error)) {
      showToast('Decrypt Failed', t('invalidPasscode'), 'fa-key text-rose-500');
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
          Submissions are stored encrypted. Enter your district decrypt key locally to view student profiles.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          <Button type="button" onClick={loadSubmissions} disabled={loading}>
            {loading ? 'Loading...' : 'Fetch Submissions'}
          </Button>
          <Input
            label={t('decryptKey')}
            type="password"
            value={decryptKey}
            onChange={(e) => setDecryptKey(e.target.value)}
          />
          <Button type="button" onClick={handleDecrypt} className="self-end">
            {t('decryptDashboard')}
          </Button>
        </div>
      </div>

      {decrypted.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-3">Last Updated</th>
                {summaryFields.map((f) => (
                  <th key={f.fieldId} className="p-3">
                    {f.labels.en ?? f.fieldId}
                  </th>
                ))}
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {decrypted.map(({ row, data, error }) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="p-3 whitespace-nowrap">
                    {new Date(row.timestamp).toLocaleString()}
                  </td>
                  {summaryFields.map((f) => (
                    <td key={f.fieldId} className="p-3">
                      {error ? '—' : displayAnswer(data?.[f.fieldId])}
                    </td>
                  ))}
                  <td className="p-3">
                    {!error && data && (
                      <button
                        type="button"
                        className="text-emerald-600 font-bold text-xs"
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      >
                        {expanded === row.id ? 'Hide' : 'View'}
                      </button>
                    )}
                    {error && <span className="text-rose-500 text-xs">{t('invalidPasscode')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {expanded && (
            <pre className="p-4 bg-slate-50 text-xs overflow-auto border-t border-slate-100">
              {JSON.stringify(decrypted.find((d) => d.row.id === expanded)?.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
