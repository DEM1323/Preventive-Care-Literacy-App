import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { OfflineBanner } from '../molecules/OfflineBanner';
import { ToastNotification } from '../molecules/ToastNotification';

export function Layout() {
  return (
    <div className="h-full flex flex-col font-sans text-slate-800 antialiased selection:bg-emerald-100 selection:text-emerald-950">
      <Header />
      <OfflineBanner />
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 custom-scrollbar overflow-y-auto">
        <Outlet />
      </main>
      <ToastNotification />
    </div>
  );
}
