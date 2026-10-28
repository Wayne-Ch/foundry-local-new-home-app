import type { DemoApi } from "../shared/contracts";

declare global {
  interface Window {
    demoApi: DemoApi;
  }
}
