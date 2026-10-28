// The animations Clawd can show (hooks/sprites.ts holds one SVG for each).
export type AnimId = 'idle' | 'listening' | 'thinking' | 'writing' | 'hop' | 'sleeping' | 'searching' | 'wave'

// A background task Claude may be waiting on. `hint` is the text the animation is chosen from.
// `agentId` is set for a background agent, so its end can be spotted in the agent list.
export type WaitItem = { id: string; kind: string; label: string; hint: string; agentId?: string }

// A quiet stretch: when Claude went quiet with work running, and the animation it opens with.
export type Scene = { since: number; opener: 'wave' | 'hop' }

declare module 'claude-code' {
  interface PluginState {
    'clawd-watch': { waiting: WaitItem[]; scene: Scene | null; shown: AnimId }
  }
}
