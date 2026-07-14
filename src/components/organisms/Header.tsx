import { Link, useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useLanguage } from '../../context/LanguageContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getStudentSession } from '../../utils/studentSession';
import { LanguageToggle } from '../molecules/LanguageToggle';

export function Header() {
  const { isLoggedIn, logout, intake } = useAppState();
  const { t } = useLanguage();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const session = getStudentSession();
  const canAccessDashboard = intake.completed && (session?.hasSubmission ?? false);

  return (
    <header className="bg-emerald-700 text-white shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center space-x-3 text-left"
        >
          <div className="bg-white text-emerald-700 p-2 rounded-lg font-extrabold flex items-center justify-center shadow">
            <i className="fa-solid fa-heart-pulse text-lg" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight block">{t('appName')}</span>
            <span className="text-xs text-emerald-200 hidden sm:block font-medium">
              {t('appTagline')}
            </span>
          </div>
        </button>

        {isLoggedIn && (
          <nav className="hidden md:flex space-x-6">
            {canAccessDashboard && (
              <>
                <Link to="/dashboard" className="hover:text-emerald-100 transition font-medium flex items-center space-x-2">
                  <i className="fa-solid fa-house text-sm" />
                  <span>{t('navHome')}</span>
                </Link>
                <Link to="/profile" className="hover:text-emerald-100 transition font-medium flex items-center space-x-2">
                  <i className="fa-solid fa-user-astronaut text-sm" />
                  <span>{t('navProfile')}</span>
                </Link>
              </>
            )}
            <Link to="/intake" className="hover:text-emerald-100 transition font-medium flex items-center space-x-2">
              <i className="fa-solid fa-file-invoice text-sm" />
              <span>{t('navNurse')}</span>
            </Link>
          </nav>
        )}

        <div className="flex items-center space-x-4">
          <LanguageToggle />
          <div className="hidden sm:flex items-center text-xs bg-emerald-800 px-2.5 py-1 rounded-full text-emerald-200 space-x-1.5 border border-emerald-600">
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-400 animate-pulse' : 'bg-amber-300'}`} />
            <span>{online ? t('onlineMode') : t('offlineMode')}</span>
          </div>
          <Link
            to="/nurse"
            className="hidden lg:inline-flex text-xs bg-emerald-800 hover:bg-emerald-900 px-2.5 py-1 rounded-lg border border-emerald-600"
          >
            {t('navNurseDashboard')}
          </Link>
          {isLoggedIn && (
            <button
              type="button"
              onClick={logout}
              className="bg-emerald-800 hover:bg-emerald-900 text-white p-2 rounded-lg transition"
              title="Log Out"
            >
              <i className="fa-solid fa-right-from-bracket" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
