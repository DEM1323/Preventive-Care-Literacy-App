import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const retirementMarker = 'prevcare_synthetic_only_v1';
if (localStorage.getItem(retirementMarker) !== 'complete') {
  for (const key of [
    'prevcare_isLoggedIn',
    'prevcare_user',
    'prevcare_intake',
    'prevcare_pending_submissions',
  ]) {
    localStorage.removeItem(key);
  }
  sessionStorage.removeItem('prevcare_student_session');
  sessionStorage.removeItem('prevcare_nurse_session');
  localStorage.setItem(retirementMarker, 'complete');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
