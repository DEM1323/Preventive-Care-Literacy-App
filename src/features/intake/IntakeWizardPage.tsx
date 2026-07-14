import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '../../components/atoms/Input';
import { RadioYesNo } from '../../components/atoms/RadioYesNo';
import { Button } from '../../components/atoms/Button';
import { StepIndicator } from '../../components/molecules/StepIndicator';
import { useAppState } from '../../context/AppStateContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useStudentFormData } from '../../hooks/useStudentFormData';
import { EMPTY_INTAKE, type IntakeFormData, type IntakeStep } from '../../types/intake';
import { validateIntakeStep } from '../../utils/validation';
import { encryptPayload, hashStudentId } from '../../utils/crypto';
import { submitFormUpdate } from '../../utils/sheets';
import { getStudentSession, saveStudentSession } from '../../utils/studentSession';

const TOTAL_STEPS = 6;

export function IntakeWizardPage() {
  const { user, intake, markIntakeSubmitted } = useAppState();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const session = getStudentSession();
  const canLoadExisting = session?.hasSubmission ?? false;
  const { formData: existingData, loading: loadingExisting, reload } = useStudentFormData(canLoadExisting);
  const [step, setStep] = useState<IntakeStep>(1);
  const [data, setData] = useState<IntakeFormData>({
    ...EMPTY_INTAKE,
    email: user.email,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Returning students with a prior submission: load encrypted answers on demand only
  useEffect(() => {
    if (canLoadExisting && existingData && !prefilled) {
      setData({ ...existingData, email: user.email, consent: false });
      setPrefilled(true);
    }
  }, [canLoadExisting, existingData, prefilled, user.email]);

  // First-time students: keep email only, never autofill other fields from local state
  useEffect(() => {
    if (!canLoadExisting) {
      setData({ ...EMPTY_INTAKE, email: user.email });
      setPrefilled(false);
    }
  }, [canLoadExisting, user.email]);

  const isUpdate = canLoadExisting && intake.completed;
  const submitLabel = isUpdate ? 'Save Form Update' : t('submit');

  const update = <K extends keyof IntakeFormData>(key: K, value: IntakeFormData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const goNext = () => {
    const validationError = validateIntakeStep(step, data);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep((s) => Math.min(TOTAL_STEPS, s + 1) as IntakeStep);
  };

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1) as IntakeStep);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationError = validateIntakeStep(6, data);
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
      const studentIdHash = await hashStudentId(data.studentId);
      const result = await submitFormUpdate(activeSession, bundle, studentIdHash);

      saveStudentSession({ ...activeSession, hasSubmission: true });
      markIntakeSubmitted(result.version);
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
              Update mode v{intake.version || 1}
            </span>
          )}
        </div>
      </div>

      {canLoadExisting && loadingExisting && (
        <p className="px-8 pt-4 text-sm text-slate-500">Loading your encrypted form...</p>
      )}

      <form onSubmit={step === 6 ? handleSubmit : (e) => e.preventDefault()} className="p-8 space-y-6">
        <StepIndicator
          current={step}
          total={TOTAL_STEPS}
          label={t('stepOf', { current: step, total: TOTAL_STEPS })}
        />

        {step === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Full Name" value={data.name} onChange={(e) => update('name', e.target.value)} required />
            <Input label="Date of Birth" type="date" value={data.dob} onChange={(e) => update('dob', e.target.value)} required />
            <Input label="Student ID Number" value={data.studentId} onChange={(e) => update('studentId', e.target.value)} required />
            <Input label="Address" value={data.address} onChange={(e) => update('address', e.target.value)} required />
            <Input label="Phone Number" type="tel" value={data.phone} onChange={(e) => update('phone', e.target.value)} required />
            <Input label="Email" type="email" value={data.email} disabled />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <RadioYesNo name="medConditions" label="Do you have medical conditions requiring medication?" value={data.medConditions} onChange={(v) => update('medConditions', v)} />
            {data.medConditions === 'Yes' && (
              <Input label="Describe conditions" value={data.medConditionsDetail} onChange={(e) => update('medConditionsDetail', e.target.value)} />
            )}
            <RadioYesNo name="visionConcerns" label="Do you have vision or hearing concerns?" value={data.visionConcerns} onChange={(v) => update('visionConcerns', v)} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <RadioYesNo name="allergies" label="Do you have any known allergies?" value={data.allergies} onChange={(v) => update('allergies', v)} />
            {data.allergies === 'Yes' && (
              <Input label="Please list your allergies" value={data.allergiesDetail} onChange={(e) => update('allergiesDetail', e.target.value)} />
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <RadioYesNo name="medications" label="Are you currently taking any medications?" value={data.medications} onChange={(v) => update('medications', v)} />
            {data.medications === 'Yes' && (
              <Input label="Please list medications" value={data.medicationsDetail} onChange={(e) => update('medicationsDetail', e.target.value)} />
            )}
          </div>
        )}

        {step === 5 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Primary Care Provider Name" value={data.pcpName} onChange={(e) => update('pcpName', e.target.value)} required />
            <Input label="PCP Phone" type="tel" value={data.pcpPhone} onChange={(e) => update('pcpPhone', e.target.value)} required />
            <Input label="Clinic Name" value={data.clinicName} onChange={(e) => update('clinicName', e.target.value)} required />
            <Input label="Clinic Phone" type="tel" value={data.clinicPhone} onChange={(e) => update('clinicPhone', e.target.value)} required />
            <div className="md:col-span-2">
              <Input label="Last Checkup Date" type="date" value={data.lastCheckup} onChange={(e) => update('lastCheckup', e.target.value)} required />
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <RadioYesNo name="safeAtHome" label="Do you feel safe at home and in relationships?" value={data.safeAtHome} onChange={(v) => update('safeAtHome', v)} />
            <RadioYesNo name="stableHousing" label="Do you have stable housing?" value={data.stableHousing} onChange={(v) => update('stableHousing', v)} />
            <RadioYesNo name="reliableFood" label="Do you have reliable access to food?" value={data.reliableFood} onChange={(v) => update('reliableFood', v)} />
            <RadioYesNo name="insuranceStatus" label="Do you currently have health insurance coverage?" value={data.insuranceStatus} onChange={(v) => update('insuranceStatus', v)} />
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input type="checkbox" checked={data.consent} onChange={(e) => update('consent', e.target.checked)} className="mt-1 text-emerald-600 rounded" required />
                <span className="text-xs text-slate-600 leading-relaxed">{t('consent')}</span>
              </label>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

        <div className="flex justify-between pt-2">
          {step > 1 ? (
            <Button type="button" onClick={goBack} className="bg-slate-200 text-slate-800 hover:bg-slate-300">{t('back')}</Button>
          ) : (
            <span />
          )}
          {step < TOTAL_STEPS ? (
            <Button type="button" onClick={goNext}>{t('next')}</Button>
          ) : (
            <Button type="submit" disabled={submitting}>{submitting ? 'Submitting...' : submitLabel}</Button>
          )}
        </div>
      </form>

      {isUpdate && (
        <div className="px-8 pb-6">
          <button type="button" onClick={() => void reload()} className="text-xs text-emerald-700 font-bold hover:underline">
            Reload latest encrypted answers
          </button>
        </div>
      )}
    </section>
  );
}
