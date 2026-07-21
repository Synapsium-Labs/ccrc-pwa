import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/base.css';
import { App } from './app';
import { toast } from './components/Toast';
import { initTheme } from './lib/theme';

// Theme before first render (index.html pre-stamps the attribute so even the
// pre-bundle paint is right; this adds the live change listener + meta sync).
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA updates are prompt-style (vite.config.ts): the fresh service worker
// waits until the user opts in. Action toasts stick until answered (ToastHost),
// so the offer can't vanish mid-reach. In dev this is an inert stub.
const updateSW = registerSW({
  onNeedRefresh() {
    toast('Update ready — tap to refresh', 'info', {
      label: 'Refresh',
      onClick: () => void updateSW(true),
    });
  },
});
