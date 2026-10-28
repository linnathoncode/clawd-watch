// The animations Clawd can show.
export type AnimId = 'idle' | 'listening' | 'thinking' | 'writing' | 'stretch' | 'hop' | 'sleeping' | 'searching' | 'wave'

// A frame on screen: an animation (`writing`), its exit (`writing-out`), or its loop
// without an entrance (`writing~`). hooks/sprites.ts holds the SVG for each.
export type Frame = string

// A background task Claude may be waiting on. `hint` is the text the animation is chosen from.
// `id` is the tool call that started it. `taskId` is the id its notices and TaskStop use
// (for an agent, its agent id, which is also `agentId`). `since` is when it started.
export type WaitItem = { id: string; kind: string; label: string; hint: string; since: number; taskId?: string; agentId?: string }

// A quiet stretch: when Claude went quiet with work running, and the animation it opens with.
export type Scene = { since: number; opener: 'wave' | 'hop' }

declare module 'claude-code' {
  interface PluginState {
    'clawd-watch': { waiting: WaitItem[]; scene: Scene | null; shown: Frame }
  }
}
