/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string;
  readonly VITE_REPO_URL?: string;
  readonly VITE_REPO_LABEL?: string;
  readonly VITE_CHAT_URL?: string;
  readonly VITE_CHAT_LABEL?: string;
  readonly VITE_SHOW_LINKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
