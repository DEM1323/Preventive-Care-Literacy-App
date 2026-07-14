import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';

export function HeroPage() {
  const { t } = useLanguage();

  return (
    <section className="bg-white rounded-2xl shadow-xl overflow-hidden max-w-4xl mx-auto my-6 border border-slate-100">
      <div className="md:flex">
        <div className="p-8 md:p-12 md:w-3/5 flex flex-col justify-center">
          <div className="inline-flex items-center space-x-2 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-sm font-bold mb-6 w-fit">
            <i className="fa-solid fa-graduation-cap" />
            <span>Student Empowerment App</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
            {t('heroTitle')}
          </h1>
          <p className="mt-4 text-slate-600 leading-relaxed">{t('heroSub')}</p>
          <div className="mt-8 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4">
            <Link
              to="/sign-in"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3.5 rounded-xl shadow-lg text-center"
            >
              {t('ctaGetStarted')}
            </Link>
            <Link
              to="/sign-in"
              className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-6 py-3.5 rounded-xl text-center"
            >
              {t('ctaSignIn')}
            </Link>
          </div>
        </div>
        <div className="hidden md:block md:w-2/5 bg-emerald-50 relative min-h-[400px]">
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <svg viewBox="0 0 200 200" className="w-full h-full text-emerald-600 animate-pulse">
              <circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="8,8" />
              <path d="M60 100 L90 130 L140 70" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
