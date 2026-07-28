import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '../../components/atoms/Input';
import { RadioYesNo } from '../../components/atoms/RadioYesNo';
import { Button } from '../../components/atoms/Button';
import { StepIndicator } from '../../components/molecules/StepIndicator';
import { useAppState } from '../../context/AppStateContext';
import { useIntakeSchema } from '../../context/IntakeSchemaContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useStudentFormData } from '../../hooks/useStudentFormData';
import { buildEmptyIntake } from '../../data/intake.fallback';
import type { IntakeFieldConfig, IntakeFormData } from '../../types/intakeSchema';
import {
  getEnabledSteps,
  getFieldsForStep,
  isFieldShown,
  validateIntakeStep,
} from '../../utils/validation';
import { encryptPayload, hashStudentId } from '../../utils/crypto';
import { submitFormUpdate } from '../../utils/sheets';
import { getStudentSession, saveStudentSession } from '../../utils/studentSession';

function fieldLabel(field: IntakeFieldConfig, language: string, consentFallback: string): string {
  if (field.fieldId === 'consent') {
    return field.labels[language as keyof typeof field.labels] ?? consentFallback;
  }
  return (
    field.labels[language as keyof typeof field.labels] ??
    field.labels.en ??
    field.fieldId
  );
}

export function IntakeWizardPage() {
  const { user, intake, markIntakeSubmitted } = useAppState();
  const { schema } = useIntakeSchema();
  const { language, t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const session = getStudentSession();
  const canLoadExisting = session?.hasSubmission ?? false;
  const { formData: existingData, loading: loadingExisting, reload } = useStudentFormData(canLoadExisting);

  const steps = useMemo(() => getEnabledSteps(schema.fields), [schema.fields]);
  const totalSteps = steps.length || 1;
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = steps[stepIndex] ?? 1;

  const [data, setData] = useState<IntakeFormData>(() =>
    buildEmptyIntake(schema.fields, user.email)
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!canLoadExisting) {
      setData(buildEmptyIntake(schema.fields, user.email));
      setPrefilled(false);
    }
  }, [canLoadExisting, user.email, schema.fields]);

  useEffect(() => {
    if (canLoadExisting && existingData && !prefilled) {
      setData({
        ...buildEmptyIntake(schema.fields, user.email),
        ...existingData,
        email: user.email,
        consent: false,
      });
      setPrefilled(true);
    }
  }, [canLoadExisting, existingData, prefilled, user.email, schema.fields]);

  const isUpdate = canLoadExisting && intake.completed;
  const submitLabel = isUpdate ? 'Save Form Update' : t('submit');
  const stepFields = getFieldsForStep(schema.fields, currentStep);

  const update = (key: string, value: string | boolean) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const goNext = () => {
    const validationError = validateIntakeStep(currentStep, data, schema.fields);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStepIndex((i) => Math.min(totalSteps - 1, i + 1));
  };

  const goBack = () => {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationError = validateIntakeStep(currentStep, data, schema.fields);
    if (validationError) {
      setError(validationError);
      return;
    }

    const activeSession = getStudentSession();
    if (!activeSession) {
      showToast('Session Expired', 'Please sign in again.', 'fa-lock text-rose-500');
      navigate('/sign-in');
      return;
    }

    setSubmitting(true);
    try {
      const passcode = import.meta.env.VITE_DISTRICT_ENCRYPTION_PASSCODE ?? 'district-default-key';
      const payload = { ...data, email: activeSession.email };
      const bundle = await encryptPayload(passcode, payload);
      const studentIdHash = await hashStudentId(String(data.studentId ?? ''));
      const result = await submitFormUpdate(activeSession, bundle, studentIdHash);

      saveStudentSession({ ...activeSession, hasSubmission: true });
      markIntakeSubmitted(result.queued ? new Date().toISOString() : result.timestamp);
      showToast(
        isUpdate ? 'Update Saved' : 'Survey Uploaded',
        result.queued ? t('submitQueued') : t('submitSuccess'),
        'fa-circle-check text-green-500'
      );
      navigate('/dashboard');
    } catch {
      showToast('Error', 'Could not submit form. Please try again.', 'fa-circle-xmark text-rose-500');
    } finally {
      setSubmitting(false);
    }
  };

  const isLastStep = stepIndex >= totalSteps - 1;

  const renderField = (field: IntakeFieldConfig) => {
    if (!isFieldShown(field, data)) return null;

    const label = fieldLabel(field, language, t('consent'));
    const value = data[field.fieldId];

    if (field.type === 'yesno') {
      return (
        <RadioYesNo
          key={field.fieldId}
          name={field.fieldId}
          label={label}
          value={(value === 'Yes' || value === 'No' ? value : 'No') as 'Yes' | 'No'}
          onChange={(v) => update(field.fieldId, v)}
        />
      );
    }

    if (field.type === 'checkbox') {
      return (
        <div key={field.fieldId} className="bg-slate-50 p-4 rounded-xl border border-slate-100">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => update(field.fieldId, e.target.checked)}
              className="mt-1 text-emerald-600 rounded"
              required={field.required}
            />
            <span className="text-xs text-slate-600 leading-relaxed">{label}</span>
          </label>
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <div key={field.fieldId}>
          <label className="block text-xs font-bold text-slate-600 uppercase mb-1">{label}</label>
          <textarea
            value={String(value ?? '')}
            onChange={(e) => update(field.fieldId, e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 min-h-24"
            required={field.required && isFieldShown(field, data)}
          />
        </div>
      );
    }

    const inputType =
      field.type === 'date' || field.type === 'tel' || field.type === 'email' ? field.type : 'text';

    return (
      <Input
        key={field.fieldId}
        label={label}
        type={inputType}
        value={String(value ?? '')}
        onChange={(e) => update(field.fieldId, e.target.value)}
        required={field.required}
        disabled={field.fieldId === 'email'}
      />
    );
  };

  const useGrid = stepFields.every(
    (f) => f.type === 'text' || f.type === 'date' || f.type === 'tel' || f.type === 'email'
  );

  return (
    <section className="max-w-3xl mx-auto my-6 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
      <div className="bg-emerald-700 text-white px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">{t('intakeTitle')}</h2>
            <p className="text-emerald-100 text-sm mt-1">
              {isUpdate
                ? 'Update your health history form below.'
                : 'Complete this form to access your learning dashboard.'}
            </p>
          </div>
          {isUpdate && (
            <span className="bg-emerald-800/50 text-emerald-100 text-xs font-bold px-3 py-1 rounded-full shrink-0">
              {intake.lastUpdatedAt
                ? `Last updated ${new Date(intake.lastUpdatedAt).toLocaleDateString()}`
                : 'Update mode'}
            </span>
          )}
        </div>
      </div>

      {canLoadExisting && loadingExisting && (
        <p className="px-8 pt-4 text-sm text-slate-500">Loading your encrypted form...</p>
      )}

      <form
        onSubmit={isLastStep ? handleSubmit : (e) => e.preventDefault()}
        className="p-8 space-y-6"
      >
        <StepIndicator
          current={stepIndex + 1}
          total={totalSteps}
          label={t('stepOf', { current: stepIndex + 1, total: totalSteps })}
        />

        <div className={useGrid ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-4'}>
          {stepFields.map(renderField)}
        </div>

        {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

        <div className="flex justify-between pt-2">
          {stepIndex > 0 ? (
            <Button type="button" onClick={goBack} className="bg-slate-200 text-slate-800 hover:bg-slate-300">
              {t('back')}
            </Button>
          ) : (
            <span />
          )}
          {!isLastStep ? (
            <Button type="button" onClick={goNext}>
              {t('next')}
            </Button>
          ) : (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : submitLabel}
            </Button>
          )}
        </div>
      </form>

      {isUpdate && (
        <div className="px-8 pb-6">
          <button
            type="button"
            onClick={() => void reload()}
            className="text-xs text-emerald-700 font-bold hover:underline"
          >
            Reload latest encrypted answers
          </button>
        </div>
      )}
    </section>
  );
}
