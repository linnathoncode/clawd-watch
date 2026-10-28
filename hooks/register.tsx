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
const FORGET_AFTER_MS = 2 * 60 * 60 * 1000 // a task this old lost its end notice: stop waiting on it
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

// The ids (tool_use ids, and task ids) of the tasks whose notifications in `text` say they ended.
// One turn can carry several notifications, so each one is read on its own.
export function finishedTasks(text: string): string[] {
  const blocks = text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? [text]
  const done: string[] = []
  for (const block of blocks) {
    // An agent that stops while its own background work runs sends a "completed"
    // notice that is not its end; its real end comes as another notice later.
    if (/background work of its own still running|is waiting on its own background work/.test(block)) continue
    const status = /<status>([^<]+)<\/status>/.exec(block)?.[1]
    if (!status || !ENDED.test(status)) continue
    // A notice names the call that started the task, the task itself, or both.
    // For an agent, the task id is its agent id.
    for (const tag of ['tool-use-id', 'task-id']) {
      const id = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(block)?.[1]
      if (id) done.push(id)
    }
  }
  return done
}

const ENDED = /completed|failed|killed|stopped/

// True when `item` is the task one of `ids` names: by its tool call, task id or agent id.
export function names(item: WaitItem, ids: readonly string[]): boolean {
  return [item.id, item.taskId, item.agentId].some(id => id !== undefined && ids.includes(id))
}

// Drops the tasks whose finished notices are in `text`; true when any was dropped.
async function finish($: EngineInterface, text: string): Promise<boolean> {
  const done = finishedTasks(text)
  if (done.length === 0) return false
  const before = await read($, waiting)
  if (!before.some(i => names(i, done))) return false
  await update($, waiting, items => items.filter(i => !names(i, done))).catch(() => {})
  return true
}

// A string field of a tool's result, whatever else the result carries.
export function field(result: unknown, key: string): string | undefined {
  const value = (result as Record<string, unknown> | null | undefined)?.[key]
  return typeof value === 'string' ? value : undefined
}

// Drops what can no longer be running: an agent the session lists as failed or killed
// ("completed" is left to its end notice, since an agent paused on work of its own is
// listed that way too), and anything so old its end notice must have been lost.
async function sweep($: EngineInterface, now: number): Promise<void> {
  const items = await read($, waiting)
  if (items.length === 0) return
  const dead = items.some(i => i.agentId) ? (await $.agent.list()).filter(a => /failed|killed/.test(a.status)).map(a => a.id) : []
  const gone = (i: WaitItem) => now - i.since > FORGET_AFTER_MS || (!!i.agentId && dead.includes(i.agentId))
  if (items.some(gone)) await update($, waiting, all => all.filter(i => !gone(i)))
}

// Claude went quiet with work running. A quiet stretch already under way carries on, so
// a wake-up does not replay the opener or restart the break and sleep timers; a task
// ending inside one gives a hop, then Clawd moves on to what is left.
async function quiet($: EngineInterface, taskEnded: boolean): Promise<void> {
  const current = await read($, scene)
  if (current && !taskEnded) return
  const since = await $.clock.now()
  const opener: Scene['opener'] = taskEnded ? 'hop' : 'wave'
  await update($, scene, () => ({ since, opener }))
  // A fresh stretch shows its opener at once; one carried on reaches it through an exit.
  if (!current) await update($, shown, () => opener)
}

export const register: Register = on => {
  // Set when a task ends, so the next quiet moment opens with a hop instead of a wave.
  let taskEnded = false

  // Track background work ourselves: a launch adds it, its completion notice removes it.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.isError) return result
    // Work a background agent starts inside itself is the agent's to wait on, not Claude's.
    if (e.agentId) return result

    if (e.tool === 'TaskStop') {
      // A stopped task sends no end notice, so it is dropped here.
      const stopped = [field(result.result, 'task_id'), e.task_id, e.shell_id].filter((id): id is string => !!id)
      if (stopped.length > 0) await update($, waiting, items => items.filter(i => !names(i, stopped))).catch(() => {})
      return result
    }

    const since = await $.clock.now()
    let item: WaitItem | null = null
    if ((e.tool === 'Bash' || e.tool === 'PowerShell') && e.run_in_background) {
      const taskId = field(result.result, 'backgroundTaskId')
      item = { id: e.tool_use_id, kind: 'shell', label: short(e.description ?? e.command), hint: `${e.description ?? ''} ${e.command}`, since, taskId }
    } else if (e.tool === 'Agent' && e.run_in_background !== false) {
      // The launch answers with the agent's id: its notices and the agent list use it.
      const agentId = field(result.result, 'agentId')
      item = { id: e.tool_use_id, kind: 'subagent', label: short(e.description), hint: `${e.description} ${e.subagent_type ?? ''}`, since, taskId: agentId, agentId }
    } else if (e.tool === 'Monitor') {
      const taskId = field(result.result, 'taskId')
      item = { id: e.tool_use_id, kind: 'monitor', label: short(e.description), hint: e.description, since, taskId }
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
    await $.command.register({ name: 'clawd-reset', description: 'Clear the background work Clawd is waiting on' })

    $.clock.every(1000, async () => {
      await sweep($, await $.clock.now()).catch(() => {})
      const current = await read($, scene)
      const items = await read($, waiting)
      // Nothing left to wait on: the quiet stretch is over.
      if (current && items.length === 0) await update($, scene, () => null)
      if (!current || items.length === 0) return
      const target = pickAnimation(items, (await $.clock.now()) - current.since, current.opener)
      const now = await read($, shown)
      const frame = nextFrame(now, target)
      // Write only on a change, so the drawing is not redrawn (and restarted) every second.
      if (frame !== now) await update($, shown, () => frame)
    })
    return next(e)
  })

  // A way out when a task's end was missed: /clawd-reset forgets everything in flight.
  on('command.run', { command: 'clawd-reset' }, async $ => {
    await update($, waiting, () => [])
    await update($, scene, () => null)
    return { text: 'Clawd is no longer waiting on anything.' }
  })

  // A finished task's notice can arrive as a delivery or as the text of the turn it wakes.
  on('session.receive', async ($, e, next) => {
    if (e.origin.kind === 'task-notification' && (await finish($, e.text))) taskEnded = true
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId && (await finish($, e.text))) taskEnded = true
    return next(e)
  })

  // The person is back: the next quiet moment starts fresh, with its own wave and timers.
  on('prompt.submit', async ($, e, next) => {
    await update($, scene, () => null).catch(() => {})
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A background agent's turn ending is not its end: it may be waiting on work of
    // its own. Its end notice drops it.
    if (e.agentId) return result

    const items = await read($, waiting).catch(() => [] as WaitItem[])
    if (items.length > 0) await quiet($, taskEnded).catch(() => {})
    taskEnded = false
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
