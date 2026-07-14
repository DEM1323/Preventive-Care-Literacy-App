import { useLanguage } from '../../context/LanguageContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function OfflineBanner() {
  const online = useOnlineStatus();
  const { t } = useLanguage();

  if (online) return null;

  return (
    <div className="bg-amber-500 text-amber-950 text-center py-2 px-4 text-sm font-semibold">
      <i className="fa-solid fa-wifi-slash mr-2" />
      {t('offlineMode')}
    </div>
  );
}
