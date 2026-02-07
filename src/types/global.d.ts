import type { ShellManagerApi } from "../shared/preload-api";

declare global {
  interface Window {
    shellManager: ShellManagerApi;
  }
}

export {};
