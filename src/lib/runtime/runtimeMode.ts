export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any)?.runtime);
}

export function isWebBrowserRuntime(): boolean {
  return !isElectronRuntime();
}
