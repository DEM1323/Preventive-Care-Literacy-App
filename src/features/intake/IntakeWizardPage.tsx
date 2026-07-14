import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Input } from '../../components/atoms/Input';
import { RadioYesNo } from '../../components/atoms/RadioYesNo';
import { Button } from '../../components/atoms/Button';
import { StepIndicator } from '../../components/molecules/StepIndicator';
import { useAppState } from '../../context/AppStateContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { EMPTY_INTAKE, type IntakeFormData, type IntakeStep } from '../../types/intake';
import { validateIntakeStep } from '../../utils/validation';
import { encryptPayload, hashStudentId } from '../../utils/crypto';
import { submitEncryptedIntake } from '../../utils/sheets';

const TOTAL_STEPS = 6;

export function IntakeWizardPage() {
  const { user, intake, completeIntake } = useAppState();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<IntakeStep>(1);
  const [data, setData] = useState<IntakeFormData>({
    ...EMPTY_INTAKE,
    name: user.name,
    email: user.email,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (intake.completed) {
    return <Navigate to="/dashboard" replace />;
  }

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

    setSubmitting(true);
    try {
      const passcode = import.meta.env.VITE_DISTRICT_ENCRYPTION_PASSCODE ?? 'district-default-key';
      const bundle = await encryptPayload(passcode, data);
      const studentIdHash = await hashStudentId(data.studentId);
      const result = await submitEncryptedIntake(bundle, studentIdHash);

      completeIntake(data);
      showToast(
        'Survey Uploaded',
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
        <h2 className="text-2xl font-bold">{t('intakeTitle')}</h2>
        <p className="text-emerald-100 text-sm mt-1">{t('intakeSubtitle')}</p>
      </div>

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
            <Input label="Email" type="email" value={data.email} onChange={(e) => update('email', e.target.value)} required />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <RadioYesNo
              name="medConditions"
              label="Do you have medical conditions requiring medication?"
              value={data.medConditions}
              onChange={(v) => update('medConditions', v)}
            />
            {data.medConditions === 'Yes' && (
              <Input
                label="Describe conditions"
                value={data.medConditionsDetail}
                onChange={(e) => update('medConditionsDetail', e.target.value)}
              />
            )}
            <RadioYesNo
              name="visionConcerns"
              label="Do you have vision or hearing concerns?"
              value={data.visionConcerns}
              onChange={(v) => update('visionConcerns', v)}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <RadioYesNo
              name="allergies"
              label="Do you have any known allergies?"
              value={data.allergies}
              onChange={(v) => update('allergies', v)}
            />
            {data.allergies === 'Yes' && (
              <Input
                label="Please list your allergies"
                value={data.allergiesDetail}
                onChange={(e) => update('allergiesDetail', e.target.value)}
              />
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <RadioYesNo
              name="medications"
              label="Are you currently taking any medications?"
              value={data.medications}
              onChange={(v) => update('medications', v)}
            />
            {data.medications === 'Yes' && (
              <Input
                label="Please list medications"
                value={data.medicationsDetail}
                onChange={(e) => update('medicationsDetail', e.target.value)}
              />
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
                <input
                  type="checkbox"
                  checked={data.consent}
                  onChange={(e) => update('consent', e.target.checked)}
                  className="mt-1 text-emerald-600 rounded"
                  required
                />
                <span className="text-xs text-slate-600 leading-relaxed">{t('consent')}</span>
              </label>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600 font-medium">{error}</p>}

        <div className="flex justify-between pt-2">
          {step > 1 ? (
            <Button type="button" onClick={goBack} className="bg-slate-200 text-slate-800 hover:bg-slate-300">
              {t('back')}
            </Button>
          ) : (
            <span />
          )}
          {step < TOTAL_STEPS ? (
            <Button type="button" onClick={goNext}>
              {t('next')}
            </Button>
          ) : (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : t('submit')}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
