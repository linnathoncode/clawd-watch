import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AnimId, Frame, Scene, WaitItem } from '../types'
import { SPRITES } from './sprites'

const waiting = atom({ plugin: 'clawd-watch', key: 'waiting' } as const, [] as WaitItem[])
// When Claude last went quiet with work still running, and how that quiet stretch opens.
const scene = atom({ plugin: 'clawd-watch', key: 'scene' } as const, null as Scene | null)
const shown = atom({ plugin: 'clawd-watch', key: 'shown' } as const, 'listening' as Frame)

const CLAY = '#D97757'

// Timings for the animation Clawd shows while Claude waits, in milliseconds.
const OPENER_MS = 2500 // wave (or hop, if a task just finished) when the wait begins
const SLEEP_AFTER_MS = 3 * 60 * 1000 // a long wait sends Clawd to sleep
const BREAK_EVERY_MS = 30 * 1000 // now and then, a short break

// The break each task takes, and how long it lasts: the exit into it plus one whole
// cycle of the break animation. Listening is already at rest, so it takes none.
const BREAKS: Partial<Record<AnimId, { anim: AnimId; ms: number }>> = {
  writing: { anim: 'stretch', ms: 4000 }, // the laptop stays, so there is no exit
  thinking: { anim: 'idle', ms: 8000 },
  searching: { anim: 'idle', ms: 8000 },
}

// The laptop screen's flicker loop, in ms (the sheet's glow). Each frame at the laptop
// starts the flicker where the clock has it, so a switch keeps the light steady.
const GLOW_MS = 1100

export function inPhase(svg: string, now: number): string {
  if (!svg.includes('class="glow"')) return svg
  return svg.replace('</style>', `[id^=clawd-] .glow{animation-delay:-${now % GLOW_MS}ms !important}</style>`)
}

// Animations that share a prop switch straight to each other, the prop staying put.
const SHARED: readonly AnimId[] = ['writing', 'stretch']

const SEARCH = /\b(grep|rg|find|search\w*|look(ing)? for|locate|explore|scan)\b/i
const WRITE = /\b(writ\w*|implement\w*|edit\w*|fix\w*|refactor\w*|creat\w*|add\w*|updat\w*|build\w*|draft\w*)\b/i

// The animation for what is running, before timing is taken into account.
export function taskAnimation(item: WaitItem | undefined): AnimId {
  if (!item) return 'listening'
  if (SEARCH.test(item.hint)) return 'searching'
  if (item.kind === 'subagent') return WRITE.test(item.hint) ? 'writing' : 'thinking'
  return 'listening'
}

// The animation to show `elapsed` ms into a quiet stretch that opened with `opener`.
export function pickAnimation(items: readonly WaitItem[], elapsed: number, opener: Scene['opener']): AnimId {
  if (elapsed < OPENER_MS) return opener
  if (elapsed >= SLEEP_AFTER_MS) return 'sleeping'
  // The newest task leads: it is the one Claude most likely stopped to wait for.
  const task = taskAnimation(items[items.length - 1])
  // A break from writing is a stretch at the laptop; thinking and searching scratch their head.
  const pause = BREAKS[task]
  if (pause && elapsed >= BREAK_EVERY_MS && elapsed % BREAK_EVERY_MS < pause.ms) return pause.anim
  return task
}

// The frame to show next on the way from `current` to `target`. A switch never cuts
// from one loop into another: the current animation plays its exit first (one tick),
// then the target comes in with its entrance.
export function nextFrame(current: Frame, target: AnimId): Frame {
  if (current.endsWith('-out')) return target
  const playing = current.replace('~', '') as AnimId
  if (playing === target) return current
  if (SHARED.includes(playing) && SHARED.includes(target)) return `${target}~`
  return `${playing}-out`
}

const KIND: Record<string, string> = { shell: 'command', subagent: 'agent', monitor: 'monitor', workflow: 'workflow' }

export function describeWaiting(items: readonly WaitItem[]): string {
  const last = items[items.length - 1]
  if (!last) return 'Waiting on background work'
  const what = `${KIND[last.kind] ?? last.kind}: ${last.label}`
  const more = items.length > 1 ? ` (+${items.length - 1} more)` : ''
  return `Waiting on ${what}${more}`
}

const short = (text: string) => {
  const line = (text.split(/\r?\n/)[0] ?? '').trim()
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

// The tool_use ids of the tasks whose notifications in `text` say they ended.
// One turn can carry several notifications, so each one is read on its own.
export function finishedTasks(text: string): string[] {
  const blocks = text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? [text]
  const done: string[] = []
  for (const block of blocks) {
    // An agent that stops while its own background work runs sends a "completed"
    // notice that is not its end; its real end comes as another notice later.
    if (/background work of its own still running|is waiting on its own background work/.test(block)) continue
    const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(block)?.[1]
    const status = /<status>([^<]+)<\/status>/.exec(block)?.[1]
    if (id && status && ENDED.test(status)) done.push(id)
  }
  return done
}

const ENDED = /completed|failed|killed|stopped/

// Drops the tasks whose finished notices are in `text`; true when any was dropped.
async function finish($: EngineInterface, text: string): Promise<boolean> {
  const done = finishedTasks(text)
  if (done.length === 0) return false
  await update($, waiting, items => items.filter(i => !done.includes(i.id))).catch(() => {})
  return true
}

// Drops background agents the session no longer lists as working. This catches
// an agent whose end never came as a notification Clawd could read.
async function sweepAgents($: EngineInterface, items: readonly WaitItem[]): Promise<void> {
  if (!items.some(i => i.agentId)) return
  const agents = await $.agent.list()
  const gone = new Set(agents.filter(a => ENDED.test(a.status)).map(a => a.id))
  const stale = (i: WaitItem) => !!i.agentId && gone.has(i.agentId)
  if (items.some(stale)) await update($, waiting, all => all.filter(i => !stale(i)))
}

export const register: Register = on => {
  // Set when a task finishes, so the next quiet stretch opens with a hop instead of a wave.
  let finishedSinceQuiet = false

  // Track background work ourselves: a launch adds it, its completion notice removes it.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.isError) return result

    let item: WaitItem | null = null
    if ((e.tool === 'Bash' || e.tool === 'PowerShell') && e.run_in_background) {
      item = { id: e.tool_use_id, kind: 'shell', label: short(e.description ?? e.command), hint: `${e.description ?? ''} ${e.command}` }
    } else if (e.tool === 'Agent' && 'result' in result && result.result?.status === 'async_launched') {
      const { agentId } = result.result
      item = { id: e.tool_use_id, kind: 'subagent', label: short(e.description), hint: `${e.description} ${e.subagent_type ?? ''}`, agentId }
    } else if (e.tool === 'Monitor') {
      item = { id: e.tool_use_id, kind: 'monitor', label: short(e.description), hint: e.description }
    }
    if (item) {
      const added = item
      // Bookkeeping only: never let it fail the tool call.
      await update($, waiting, items => [...items.filter(i => i.id !== added.id), added]).catch(() => {})
    }
    return result
  })

  // A fresh or resumed session has none of our work in flight. The clock that
  // moves Clawd between animations starts here and runs for the session.
  on('session.start', async ($, e, next) => {
    await update($, waiting, () => [])
    await update($, scene, () => null)

    $.clock.every(1000, async () => {
      await sweepAgents($, await read($, waiting)).catch(() => {})
      const current = await read($, scene)
      const items = await read($, waiting)
      if (!current || items.length === 0) return
      const target = pickAnimation(items, (await $.clock.now()) - current.since, current.opener)
      const now = await read($, shown)
      const frame = nextFrame(now, target)
      // Write only on a change, so the drawing is not redrawn (and restarted) every second.
      if (frame !== now) await update($, shown, () => frame)
    })
    return next(e)
  })

  // A finished task's notice can arrive as a delivery or as the text of the turn it wakes.
  on('session.receive', async ($, e, next) => {
    if (e.origin.kind === 'task-notification' && (await finish($, e.text))) finishedSinceQuiet = true
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      if (await finish($, e.text)) finishedSinceQuiet = true
      await update($, scene, () => null).catch(() => {})
    }
    return next(e)
  })

  // Claude went quiet. If work is still running, a new quiet stretch begins.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A background agent's turn ending is not its end: it may be waiting on work of
    // its own. The clock's sweep of the agent list drops it once it is really done.
    if (e.agentId) return result

    const items = await read($, waiting).catch(() => [] as WaitItem[])
    if (items.length > 0) {
      const opener: Scene['opener'] = finishedSinceQuiet ? 'hop' : 'wave'
      finishedSinceQuiet = false
      const since = await $.clock.now()
      await update($, scene, () => ({ since, opener })).catch(() => {})
      await update($, shown, () => opener).catch(() => {})
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const items = await read($, waiting)
    if (e.props.hasSurvey || e.props.isWorking || items.length === 0) return next(e)

    const text = describeWaiting(items)
    if (e.surface === 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text color={CLAY}>[o_o] {text}…</Text>
    }

    const frame = await read($, shown)
    const source = inPhase(SPRITES[frame] ?? SPRITES.listening ?? '', await $.clock.now())
    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg source={source} alt={`Clawd: ${text}`} width={80} height={55} isInteractive />
        <Text color={CLAY} weight="medium">
          {text}…
        </Text>
      </Box>
    )
  })
}
