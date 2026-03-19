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
`;
document.head.appendChild(chatStyles);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
