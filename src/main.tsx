import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// The popover window is transparent, so a silent frontend crash renders as
// "nothing opens". Paint fatal errors into the page instead (see 2026-07-05
// blank-panel incident: a hook-order bug unmounted the root invisibly).
function reportFatalError(source: string, error: unknown) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  console.error(`[fatal:${source}]`, error);
  try {
    const pre = document.createElement('pre');
    pre.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;color:#c00;font-size:11px;white-space:pre-wrap;padding:8px;margin:0;overflow:auto;';
    pre.textContent = `[${source}] ${message}`;
    document.body.appendChild(pre);
  } catch {}
}

window.addEventListener('error', (event) => reportFatalError('window', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportFatalError('promise', event.reason));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  onUncaughtError: (error) => reportFatalError('react', error),
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
