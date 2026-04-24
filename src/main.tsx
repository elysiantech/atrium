import { useEffect, useState } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Connect from './pages/Connect';
import './index.css';

function Router() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  if (path.startsWith('/connect')) return <Connect />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
);
