import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { requestAccessCode, verifyAccessCode } from '../../utils/sheets';
import { getStudentSession, saveStudentSession } from '../../utils/studentSession';

type Step = 'email' | 'code';

export function SignInPage() {
  const { isLoggedIn, login, intake, syncIntakeOnLogin } = useAppState();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const session = getStudentSession();
  if (isLoggedIn && session) {
    const destination = session.hasSubmission && intake.completed ? '/dashboard' : '/intake';
    return <Navigate to={destination} replace />;
  }

  const handleRequestCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const result = await requestAccessCode(email.trim());
      if (!result.success) {
        showToast('Error', result.error ?? 'Could not send code', 'fa-circle-xmark text-rose-500');
        return;
      }
      showToast('Code Sent', 'Check your email for a single-use access code.', 'fa-envelope text-emerald-500');
      setStep('code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !code.trim()) return;
    setLoading(true);
    try {
      const result = await verifyAccessCode(email.trim(), code.trim());
      if (!result.success) {
        showToast('Invalid Code', result.error, 'fa-lock text-rose-500');
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const hasSubmission = result.data.hasSubmission;

      saveStudentSession({
        sessionToken: result.data.sessionToken,
        email: normalizedEmail,
        emailHash: result.data.emailHash,
        dataKeySalt: result.data.dataKeySalt,
        hasSubmission,
      });

      syncIntakeOnLogin(hasSubmission, result.data.submission?.version);
      login(normalizedEmail.split('@')[0], normalizedEmail);

      if (hasSubmission) {
        showToast('Welcome Back', 'Signed in successfully.', 'fa-key text-emerald-500');
        navigate('/dashboard');
      } else {
        showToast('Welcome', 'Please complete your health history form to continue.', 'fa-file-medical text-emerald-500');
        navigate('/intake');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="max-w-md mx-auto my-8 bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 mb-3 text-xl">
          <i className="fa-solid fa-lock" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Student Sign In</h2>
        <p className="text-slate-500 text-sm mt-1">
          {step === 'email'
            ? 'Enter your school email to receive a single-use access code'
            : 'Enter the 6-digit code sent to your email'}
        </p>
      </div>

      {step === 'email' ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          <Input
            label="School Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Sending...' : 'Send Access Code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <Input label="Email" type="email" value={email} disabled />
          <Input
            label="6-Digit Access Code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            required
          />
          <Button type="submit" className="w-full" disabled={loading || code.length < 6}>
            {loading ? 'Verifying...' : 'Verify & Sign In'}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-slate-500 hover:text-slate-700"
            onClick={() => {
              setStep('email');
              setCode('');
            }}
          >
            Use a different email
          </button>
        </form>
      )}
    </section>
  );
}
