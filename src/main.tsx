import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { AuthProvider } from './context/AuthProvider';
import { EscapeRegistryProvider } from './context/EscapeRegistryContext';
import RuntimeConnectivityBootstrap from './components/RuntimeConnectivityBootstrap';
import { isWebBrowserRuntime } from './lib/runtime/runtimeMode';

// HashRouter is required for Electron file:// loading.
// BrowserRouter relies on History API which needs a web server.
// HashRouter uses #/route which works in any protocol (file://, http://).

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <EscapeRegistryProvider>
        <AuthProvider>
          <RuntimeConnectivityBootstrap />
          <App />
        </AuthProvider>
      </EscapeRegistryProvider>
    </HashRouter>
  </React.StrictMode>
);

// خدمة عامل بسيطة لجعل التطبيق قابلاً للتثبيت كتطبيق ويب (PWA) من المتصفح
// بأيقونة الشركة — لا تُسجَّل في وضع Electron (file://) حيث لا معنى لها.
if (isWebBrowserRuntime() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
