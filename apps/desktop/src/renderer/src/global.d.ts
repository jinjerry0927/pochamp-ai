import type { PochampApi } from '../../shared/contracts';

declare global {
  interface Window {
    pochamp: PochampApi;
  }
}

export {};

