import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PageBoundary } from './PageBoundary';
import { installErrorCapture } from './diagnostics';
import './style.css';
import './student-design.css';
import './course-design.css';
const stopErrorCapture = installErrorCapture();
if (import.meta.hot) import.meta.hot.dispose(stopErrorCapture);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PageBoundary scope="app">
      <App />
    </PageBoundary>
  </React.StrictMode>,
);
