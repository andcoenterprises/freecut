/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'alumi' when embedded in AlumiAI Studio (see src/config/hosting.ts). */
  readonly VITE_HOSTED?: string
  /** Product name shown in the logo (defaults to FreeCut). */
  readonly VITE_BRAND_NAME?: string
}
