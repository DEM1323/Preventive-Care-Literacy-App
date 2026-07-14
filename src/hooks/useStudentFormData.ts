import { useCallback, useEffect, useState } from 'react';
import type { IntakeFormData } from '../types/intake';
import type { EncryptedBundle } from '../types/submission';
import { decryptPayload } from '../utils/crypto';
import { fetchStudentSubmission } from '../utils/sheets';
import { getStudentSession } from '../utils/studentSession';

function getDistrictPasscode(): string {
  return import.meta.env.VITE_DISTRICT_ENCRYPTION_PASSCODE ?? 'district-default-key';
}

export function useStudentFormData() {
  const [formData, setFormData] = useState<IntakeFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getStudentSession();
    if (!session) {
      setFormData(null);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const submission = await fetchStudentSubmission(session);
      if (!submission?.encryptedPayload) {
        setFormData(null);
        return null;
      }

      const bundle = JSON.parse(submission.encryptedPayload) as EncryptedBundle;
      const data = await decryptPayload<IntakeFormData>(getDistrictPasscode(), bundle);
      setFormData(data);
      return data;
    } catch {
      setError('Could not load your encrypted form');
      setFormData(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { formData, loading, error, reload: load, clearLocal: () => setFormData(null) };
}
