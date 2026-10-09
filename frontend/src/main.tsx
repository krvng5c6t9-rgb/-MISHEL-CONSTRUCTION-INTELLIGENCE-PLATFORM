import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// F-28: the Cairo font is bundled with the app (no third-party font host at runtime).
import '@fontsource/cairo/arabic-500.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/cairo/arabic-800.css';
import '@fontsource/cairo/latin-500.css';
import '@fontsource/cairo/latin-700.css';
import '@fontsource/cairo/latin-800.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
