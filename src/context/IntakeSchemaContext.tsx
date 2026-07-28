import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getFallbackIntake, fetchIntakeSchemaFromSheet } from '../utils/sheets';
import type { IntakeSchema } from '../types/intakeSchema';

interface IntakeSchemaContextValue {
  schema: IntakeSchema;
  loading: boolean;
  refreshSchema: () => Promise<void>;
}

const IntakeSchemaContext = createContext<IntakeSchemaContextValue | null>(null);

const CACHE_KEY = 'prevcare_intake_schema_cache';

export function IntakeSchemaProvider({ children }: { children: ReactNode }) {
  const [schema, setSchema] = useState<IntakeSchema>(getFallbackIntake);
  const [loading, setLoading] = useState(false);

  const refreshSchema = useCallback(async () => {
    setLoading(true);
    try {
      const remote = await fetchIntakeSchemaFromSheet();
      if (remote) {
        setSchema(remote);
        localStorage.setItem(CACHE_KEY, JSON.stringify(remote));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        setSchema(JSON.parse(cached) as IntakeSchema);
      } catch {
        setSchema(getFallbackIntake());
      }
    }
    void refreshSchema();
  }, [refreshSchema]);

  const value = useMemo(
    () => ({ schema, loading, refreshSchema }),
    [schema, loading, refreshSchema]
  );

  return <IntakeSchemaContext.Provider value={value}>{children}</IntakeSchemaContext.Provider>;
}

export function useIntakeSchema() {
  const ctx = useContext(IntakeSchemaContext);
  if (!ctx) throw new Error('useIntakeSchema must be used within IntakeSchemaProvider');
  return ctx;
}
