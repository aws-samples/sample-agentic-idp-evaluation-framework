import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@cloudscape-design/global-styles/index.css';
import App from './App';

// Chat markdown styles
const chatStyles = document.createElement('style');
chatStyles.textContent = `
.chat-markdown { word-break: break-word; }
.chat-markdown p { margin: 0 0 8px 0; }
.chat-markdown p:last-child { margin-bottom: 0; }
.chat-markdown ul, .chat-markdown ol { margin: 4px 0; padding-left: 20px; }
.chat-markdown li { margin: 2px 0; }
.chat-markdown strong { font-weight: 600; }
.chat-markdown code { background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; font-size: 13px; }
.chat-markdown pre { background: rgba(0,0,0,0.06); padding: 8px 12px; border-radius: 6px; overflow-x: auto; margin: 8px 0; }
.chat-markdown pre code { background: none; padding: 0; }
.chat-markdown h1, .chat-markdown h2, .chat-markdown h3 { margin: 8px 0 4px 0; font-size: 15px; font-weight: 600; }
.chat-markdown hr { border: none; border-top: 1px solid rgba(0,0,0,0.12); margin: 8px 0; }
.chat-markdown table { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
.chat-markdown th, .chat-markdown td { border: 1px solid rgba(0,0,0,0.12); padding: 4px 8px; }
.chat-markdown th { background: rgba(0,0,0,0.04); font-weight: 600; }

/* ─── Docs page (SPA viewer with left sidebar) ───────────────────────────── */
.docs-layout { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; background: var(--docs-bg, #fafbfc); }
.awsui-dark-mode .docs-layout { --docs-bg: #0f1419; }
.docs-sidebar { position: sticky; top: 0; height: 100vh; overflow-y: auto; border-right: 1px solid rgba(0,0,0,0.08); background: #fff; padding: 16px 12px 32px 12px; }
.awsui-dark-mode .docs-sidebar { background: #161b22; border-right-color: rgba(255,255,255,0.08); }
.docs-sidebar-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; font-size: 12px; font-weight: 500; color: #5f6b7a; border-radius: 6px; cursor: pointer; user-select: none; }
.docs-sidebar-header:hover { background: rgba(9,114,211,0.08); color: #0972d3; }
.docs-sidebar-header:focus { outline: 2px solid #0972d3; outline-offset: 1px; }
.awsui-dark-mode .docs-sidebar-header { color: #a2a9b0; }
.awsui-dark-mode .docs-sidebar-header:hover { background: rgba(83,159,229,0.12); color: #539fe5; }
.docs-sidebar-title { padding: 14px 10px 8px 10px; font-size: 15px; font-weight: 700; color: var(--docs-title, #16191f); letter-spacing: -0.1px; }
.awsui-dark-mode .docs-sidebar-title { --docs-title: #e9ebed; }
.docs-nav { display: flex; flex-direction: column; gap: 4px; }
.docs-nav-section { margin-top: 16px; }
.docs-nav-section-title { padding: 6px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #95a5ba; }
.awsui-dark-mode .docs-nav-section-title { color: #5f6b7a; }
.docs-nav-link { display: block; padding: 7px 10px; margin: 1px 0; font-size: 13.5px; color: #414d5c; border-radius: 6px; text-decoration: none; transition: background 100ms; }
.docs-nav-link:hover { background: rgba(9,114,211,0.06); color: #0972d3; }
.docs-nav-link.is-active { background: rgba(9,114,211,0.1); color: #0972d3; font-weight: 600; }
.awsui-dark-mode .docs-nav-link { color: #d1d5da; }
.awsui-dark-mode .docs-nav-link:hover { background: rgba(83,159,229,0.1); color: #539fe5; }
.awsui-dark-mode .docs-nav-link.is-active { background: rgba(83,159,229,0.18); color: #539fe5; }
.docs-main { min-width: 0; }
.docs-content { max-width: 820px; margin: 0 auto; padding: 48px 32px 96px 32px; }
@media (max-width: 900px) { .docs-layout { grid-template-columns: 1fr; } .docs-sidebar { position: relative; height: auto; border-right: none; border-bottom: 1px solid rgba(0,0,0,0.08); } .docs-content { padding: 32px 20px 64px 20px; } }
.docs-markdown { line-height: 1.7; font-size: 14.5px; color: #16191f; }
.docs-markdown > :first-child { margin-top: 0; }
.docs-markdown h2 { font-size: 22px; margin: 40px 0 14px 0; font-weight: 700; line-height: 1.3; padding-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.08); }
.docs-markdown h3 { font-size: 17px; margin: 28px 0 10px 0; font-weight: 600; }
.docs-markdown h4 { font-size: 15px; margin: 22px 0 8px 0; font-weight: 600; }
.docs-markdown p { margin: 0 0 16px 0; }
.docs-markdown ul, .docs-markdown ol { margin: 10px 0 16px 0; padding-left: 28px; }
.docs-markdown li { margin: 6px 0; }
.docs-markdown li > p { margin-bottom: 4px; }
.docs-markdown a { color: #0972d3; text-decoration: none; border-bottom: 1px solid rgba(9,114,211,0.3); }
.docs-markdown a:hover { border-bottom-color: #0972d3; }
.docs-markdown code { background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 3px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.docs-markdown pre { background: #1a1a2e; color: #e8e8e8; padding: 16px 18px; border-radius: 8px; overflow-x: auto; margin: 14px 0; font-size: 13px; line-height: 1.55; }
.docs-markdown pre code { background: none; padding: 0; color: inherit; border: none; font-size: 13px; }
.docs-markdown table { border-collapse: collapse; margin: 14px 0; font-size: 13.5px; width: 100%; }
.docs-markdown th, .docs-markdown td { border: 1px solid rgba(0,0,0,0.12); padding: 8px 12px; text-align: left; vertical-align: top; }
.docs-markdown th { background: rgba(0,0,0,0.04); font-weight: 600; }
.docs-markdown blockquote { margin: 14px 0; padding: 10px 16px; border-left: 3px solid #0972d3; background: rgba(9,114,211,0.06); color: inherit; border-radius: 0 6px 6px 0; }
.docs-markdown hr { border: none; border-top: 1px solid rgba(0,0,0,0.12); margin: 28px 0; }
.docs-markdown strong { font-weight: 600; }
.awsui-dark-mode .docs-markdown { color: #e9ebed; }
.awsui-dark-mode .docs-markdown h2 { border-bottom-color: rgba(255,255,255,0.1); }
.awsui-dark-mode .docs-markdown code { background: rgba(255,255,255,0.08); }
.awsui-dark-mode .docs-markdown a { color: #539fe5; border-bottom-color: rgba(83,159,229,0.3); }
.awsui-dark-mode .docs-markdown a:hover { border-bottom-color: #539fe5; }
.awsui-dark-mode .docs-markdown th, .awsui-dark-mode .docs-markdown td { border-color: rgba(255,255,255,0.14); }
.awsui-dark-mode .docs-markdown th { background: rgba(255,255,255,0.06); }
.awsui-dark-mode .docs-markdown blockquote { border-left-color: #539fe5; background: rgba(83,159,229,0.08); }
.awsui-dark-mode .docs-markdown hr { border-top-color: rgba(255,255,255,0.14); }
`;
document.head.appendChild(chatStyles);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Fade out the HTML splash once React has mounted real content. The tiny delay
// gives the Cloudscape first paint a beat to finish so the handoff is seamless.
requestAnimationFrame(() => {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  splash.classList.add('hidden');
  setTimeout(() => splash.remove(), 250);
});
