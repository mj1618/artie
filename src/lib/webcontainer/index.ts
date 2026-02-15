import { WebContainer } from "@webcontainer/api";

let webcontainerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

/**
 * Get or boot a WebContainer instance.
 * WebContainer is a singleton — only one can exist per page.
 */
export async function getWebContainer(): Promise<WebContainer> {
  if (webcontainerInstance) return webcontainerInstance;
  if (bootPromise) return bootPromise;

  bootPromise = WebContainer.boot().then((instance) => {
    webcontainerInstance = instance;
    return instance;
  });

  return bootPromise;
}

/**
 * Tear down the current WebContainer instance.
 */
export function teardownWebContainer() {
  if (webcontainerInstance) {
    webcontainerInstance.teardown();
    webcontainerInstance = null;
    bootPromise = null;
  }
}
