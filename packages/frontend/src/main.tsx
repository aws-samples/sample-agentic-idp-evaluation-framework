import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@cloudscape-design/global-styles/index.css';
import { handleOidcCallback, hasValidToken, redirectToMidway } from '@idp/midway';
import App from './App';

(async () => {
  // ─── Midway auth pre-check ────────────────────────────────────────────────
  // Must complete BEFORE React renders so the app never flashes anonymous UI
  // before redirecting to Midway. @idp/midway resolves to the real module when
  // present, or a no-op stub in the public distribution (vite.config alias).
  if (import.meta.env.VITE_AUTH_PROVIDER === 'midway') {
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalDev) {
      handleOidcCallback();
      if (!hasValidToken()) {
        redirectToMidway();
        return;
      }
    }
  }

  // ─── Chat / docs styles ───────────────────────────────────────────────────
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

/* ─── Streaming result animations ────────────────────────────────────────────
   Preview fans every method out in parallel and streams each result back over
   SSE as it lands. These make that arrival visible instead of having rows appear
   instantly with no indication that anything progressed. Deliberately short
   (~240ms) and transform/opacity only, so they never delay interaction, and fully
   disabled under prefers-reduced-motion. */
@keyframes idp-rise-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
.idp-chip-resolved { animation: idp-rise-in 240ms ease-out both; }
.idp-stream-in { animation: idp-rise-in 260ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .idp-chip-resolved, .idp-stream-in { animation: none; }
}

/* ─── Extracted tables ───────────────────────────────────────────────────────
   Model output rendered as a real table instead of raw <table><thead><tr><th>
   markup. Colours use rgba/currentColor so the same rules work in both themes
   (Cloudscape hashes its CSS variable names, so a hand-written var() would not
   resolve — see theme/tokens.ts). A sticky header keeps the column names visible
   in a 200-row quotation, which is the case that made the old view unusable. */
.idp-extracted-table table,
table.idp-extracted-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12.5px;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
}
.idp-extracted-table th,
.idp-extracted-table td {
  border: 1px solid rgba(128,128,128,0.32);
  padding: 5px 8px;
  text-align: left;
  vertical-align: top;
}
.idp-extracted-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  font-weight: 600;
  background: #f2f3f7;
  color: #0f141a;
}
.awsui-dark-mode .idp-extracted-table th { background: #232b37; color: #e9ebed; }
.idp-extracted-table tbody tr:nth-child(even) { background: rgba(128,128,128,0.06); }

/* ─── Capability x method support matrix ─────────────────────────────────────
   33 rows x up to 22 columns. Column headers are rotated so 22 of them fit
   without a 3000px-wide table, and both the header row and the capability column
   are sticky because a cell is meaningless once you have scrolled its labels off
   screen. Colours use rgba/currentColor so one rule set serves both themes. */
.idp-matrix { border-collapse: separate; border-spacing: 0; font-size: 12px; }
.idp-matrix th, .idp-matrix td {
  border-bottom: 1px solid rgba(128,128,128,0.22);
  padding: 3px 6px;
}
/*
  Stacking order, and why it matters: the capability popover is rendered inside a
  sticky row header, and the sticky THEAD used to sit at z-index 3 above it — so
  hovering a capability name opened a popover the header painted over, hiding the
  description the popover exists to show. Sticky layers now sit BELOW 1, and the
  hovered row header is lifted above them, so the popover always wins.
    thead th        1   (above cells, below any popover)
    corner cell     2   (above thead, it is both sticky-top and sticky-left)
    row header      1   (sticky-left, above cells)
    row header:hover 20 (above every sticky layer, so its popover is not clipped)
*/
.idp-matrix thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--idp-matrix-head-bg, #f2f3f7);
  height: 118px; vertical-align: bottom;
  border-bottom: 1px solid rgba(128,128,128,0.45);
}
.awsui-dark-mode .idp-matrix thead th { --idp-matrix-head-bg: #232b37; }
.idp-matrix-collabel {
  display: inline-block;
  writing-mode: vertical-rl; transform: rotate(180deg);
  white-space: nowrap; font-weight: 600; text-align: left;
  max-height: 108px; overflow: hidden;
}
/* Group separator: a hairline every time the method FAMILY changes, so the eye
   can tell "all five BDA columns" from "all seven Claude columns" without
   reading 22 rotated labels. */
.idp-matrix .idp-matrix-groupstart { border-left: 2px solid rgba(128,128,128,0.38); }
.idp-matrix-corner {
  left: 0; z-index: 2 !important;
  writing-mode: horizontal-tb; vertical-align: bottom !important;
  text-align: left; min-width: 210px;
}
.idp-matrix-row {
  position: sticky; left: 0; z-index: 1;
  background: var(--idp-matrix-row-bg, #ffffff);
  text-align: left; font-weight: 400; white-space: nowrap;
  min-width: 210px; max-width: 260px;
}
/* Lift the hovered row header above every sticky layer so its popover is never
   clipped by the sticky header or the corner cell. */
.idp-matrix-row:hover, .idp-matrix-row:focus-within { z-index: 20; }
.awsui-dark-mode .idp-matrix-row { --idp-matrix-row-bg: #0f1419; }
.idp-matrix td { text-align: center; font-size: 15px; line-height: 1.1; }
/* An unrunnable capability is dimmed as a whole row rather than being left as an
   unexplained line of grey dots — the row header carries the reason. */
.idp-matrix tr.idp-matrix-unavailable td { opacity: 0.45; }
.idp-matrix-catrow th {
  position: sticky; left: 0; z-index: 1;
  text-align: left; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.4px;
  padding-top: 12px;
  background: rgba(128,128,128,0.10);
}
/* Cross-hair reading aid: a 33x22 grid is hard to read across, so highlight the
   whole row on hover and give the row header a stronger tint than its cells. */
.idp-matrix tbody tr:hover td { background: rgba(9,114,211,0.10); }
.idp-matrix tbody tr:hover .idp-matrix-row { background: rgba(9,114,211,0.16); }
.idp-matrix tbody tr:hover td.idp-matrix-cell-hl { background: rgba(9,114,211,0.18); }

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

  // ─── Render React ─────────────────────────────────────────────────────────
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );

  // Fade out the HTML splash once React has mounted real content.
  requestAnimationFrame(() => {
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 250);
  });
})();
