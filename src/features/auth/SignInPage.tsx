import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';

export function SignInPage() {
  const { isLoggedIn, login, intake } = useAppState();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  if (isLoggedIn) {
    return <Navigate to={intake.completed ? '/dashboard' : '/intake'} replace />;
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    login(name.trim(), email.trim());
    showToast('Access Authorized', `Welcome, ${name}!`, 'fa-key text-emerald-500');
    navigate('/intake');
  };

  return (
    <section className="max-w-md mx-auto my-8 bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 mb-3 text-xl">
          <i className="fa-solid fa-lock" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Sign in to continue</h2>
        <p className="text-slate-500 text-sm mt-1">Manage your health compliance modules</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Full Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          label="Email Address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" className="w-full">
          Proceed to Onboarding Form
        </Button>
      </form>
    </section>
  );
}
