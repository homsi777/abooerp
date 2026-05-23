declare module '*.cjs' {
  export function ensureDatabase(): Promise<void>;
}
