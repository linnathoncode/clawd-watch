export type WaitItem = { id: string; kind: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    'pixel-buddy': { waiting: WaitItem[] }
  }
}
