/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_DIRECTOR?: string;
  readonly VITE_BUILD_FLAVOR?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
