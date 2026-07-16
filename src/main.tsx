import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

type FatalErrorSource = 'window' | 'promise' | 'react';

const FATAL_ERROR_MESSAGE =
  'Quotabar encountered an unexpected interface error. Restart the app.';
const FATAL_SURFACE_ERROR_MESSAGE = 'Failed to display fatal frontend error.';
const FATAL_SURFACE_ID = 'quotabar-fatal-error';
const FATAL_SURFACE_STYLE =
  'position:fixed;inset:0;z-index:99999;background:#fff;color:#c00;font-size:11px;white-space:pre-wrap;padding:8px;margin:0;overflow:auto;';

// The popover window is transparent, so a silent frontend crash renders as
// "nothing opens". Paint fatal errors into the page instead (see 2026-07-05
// blank-panel incident: a hook-order bug unmounted the root invisibly).
function report_fatal_error(source: FatalErrorSource): void {
  console.error(`[fatal:${source}] ${FATAL_ERROR_MESSAGE}`);
  try {
    const existing_surface = document.getElementById(FATAL_SURFACE_ID);
    const surface_text = `[${source}] ${FATAL_ERROR_MESSAGE}`;
    if (existing_surface) {
      existing_surface.textContent = surface_text;
      return;
    }

    const surface = document.createElement('pre');
    surface.id = FATAL_SURFACE_ID;
    surface.style.cssText = FATAL_SURFACE_STYLE;
    surface.textContent = surface_text;
    document.body.appendChild(surface);
  } catch {
    console.error(FATAL_SURFACE_ERROR_MESSAGE);
  }
}

window.addEventListener('error', (event) => {
  event.preventDefault();
  report_fatal_error('window');
});
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  report_fatal_error('promise');
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  onUncaughtError: () => report_fatal_error('react'),
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
