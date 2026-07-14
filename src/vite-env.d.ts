/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_PATH?: string;
  readonly VITE_GAS_SUBMIT_URL?: string;
  readonly VITE_GAS_EXECUTION_TOKEN?: string;
  readonly VITE_MODULES_SHEET_URL?: string;
  readonly VITE_NURSE_DASHBOARD_PASSCODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
