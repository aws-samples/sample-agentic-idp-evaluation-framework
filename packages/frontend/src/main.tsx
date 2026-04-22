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

.docs-markdown { line-height: 1.65; font-size: 14px; color: var(--color-text-body-default, #16191f); }
.docs-markdown h1 { font-size: 28px; margin: 0 0 16px 0; font-weight: 700; line-height: 1.2; }
.docs-markdown h2 { font-size: 22px; margin: 32px 0 12px 0; font-weight: 700; line-height: 1.3; border-bottom: 1px solid rgba(0,0,0,0.08); padding-bottom: 6px; }
.docs-markdown h3 { font-size: 17px; margin: 24px 0 8px 0; font-weight: 600; }
.docs-markdown h4 { font-size: 15px; margin: 20px 0 6px 0; font-weight: 600; }
.docs-markdown p { margin: 0 0 14px 0; }
.docs-markdown ul, .docs-markdown ol { margin: 8px 0 14px 0; padding-left: 24px; }
.docs-markdown li { margin: 4px 0; }
.docs-markdown li > p { margin-bottom: 4px; }
.docs-markdown a { color: #0972d3; text-decoration: none; }
.docs-markdown a:hover { text-decoration: underline; }
.docs-markdown code { background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 3px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.docs-markdown pre { background: #1a1a2e; color: #e8e8e8; padding: 14px 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; font-size: 13px; line-height: 1.5; }
.docs-markdown pre code { background: none; padding: 0; color: inherit; font-size: 13px; }
.docs-markdown table { border-collapse: collapse; margin: 12px 0; font-size: 13px; width: 100%; }
.docs-markdown th, .docs-markdown td { border: 1px solid rgba(0,0,0,0.12); padding: 6px 10px; text-align: left; }
.docs-markdown th { background: rgba(0,0,0,0.04); font-weight: 600; }
.docs-markdown blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid #0972d3; background: rgba(9,114,211,0.06); color: inherit; }
.docs-markdown hr { border: none; border-top: 1px solid rgba(0,0,0,0.12); margin: 24px 0; }
.docs-markdown strong { font-weight: 600; }
.awsui-dark-mode .docs-markdown { color: #e9ebed; }
.awsui-dark-mode .docs-markdown h2 { border-bottom-color: rgba(255,255,255,0.12); }
.awsui-dark-mode .docs-markdown code { background: rgba(255,255,255,0.08); }
.awsui-dark-mode .docs-markdown th, .awsui-dark-mode .docs-markdown td { border-color: rgba(255,255,255,0.14); }
.awsui-dark-mode .docs-markdown th { background: rgba(255,255,255,0.06); }
.awsui-dark-mode .docs-markdown a { color: #539fe5; }
.awsui-dark-mode .docs-markdown blockquote { border-left-color: #539fe5; background: rgba(83,159,229,0.08); }
.awsui-dark-mode .docs-markdown hr { border-top-color: rgba(255,255,255,0.16); }
`;
document.head.appendChild(chatStyles);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
