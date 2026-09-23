import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { clearTextCache } from './render/measure';
import { useStore } from './store/store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

document.fonts?.ready.then(() => {
  clearTextCache();
  useStore.getState().bumpFonts();
});
