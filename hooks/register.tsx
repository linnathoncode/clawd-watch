import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AnimId, Frame, Motion, Scene, WaitItem } from '../types'
import type { Part } from './sprites'
import { EXITS, SPRITES } from './sprites'

const waiting = atom({ plugin: 'clawd-watch', key: 'waiting' } as const, [] as WaitItem[])
// When Claude last went quiet with work still running, and how that quiet stretch opens.
const scene = atom({ plugin: 'clawd-watch', key: 'scene' } as const, null as Scene | null)
const shown = atom({ plugin: 'clawd-watch', key: 'shown' } as const, 'listening' as Frame)
// When the frame on screen started, and for an exit, how far into its loop it cut in.
const motion = atom({ plugin: 'clawd-watch', key: 'motion' } as const, { since: 0, elapsed: 0 } as Motion)
// Whether Claude has been quiet long enough for Clawd to show.
const resting = atom({ plugin: 'clawd-watch', key: 'resting' } as const, false)

const CLAY = '#D97757'

// Timings for the animation Clawd shows while Claude waits, in milliseconds.
const OPENER_MS = 2500 // wave (or hop, if a task just finished) when the wait begins
const SCROLL_AFTER_MS = 90 * 1000 // a long wait bores Clawd: out comes the phone
const SLEEP_AFTER_MS = 3 * 60 * 1000 // a longer one sends Clawd to sleep
const FORGET_AFTER_MS = 2 * 60 * 60 * 1000 // a task this old lost its end notice: stop waiting on it
const BREAK_EVERY_MS = 30 * 1000 // now and then, a short break
// How long Claude stays quiet before Clawd shows. A turn that follows straight on (a queued
// prompt, a task's notice) starts inside it, so Clawd does not flash up between the two.
const SETTLE_QUIET_MS = 600

// The break each task takes, and how long it lasts: the exit into it plus one whole
// cycle of the break animation.
const BREAKS: Partial<Record<AnimId, { anim: AnimId; ms: number }>> = {
  writing: { anim: 'stretch', ms: 4000 }, // the laptop stays, so there is no exit
  thinking: { anim: 'idle', ms: 8000 },
  searching: { anim: 'idle', ms: 8000 },
  listening: { anim: 'idle', ms: 8000 },
}

// The laptop screen's flicker loop, in ms (the sheet's glow). Each frame at the laptop
// starts the flicker where the clock has it, so a switch keeps the light steady.
const GLOW_MS = 1100

// `since` is when the frame started, so the same frame always draws the same SVG.
export function inPhase(svg: string, since: number): string {
  if (!svg.includes('class="glow"')) return svg
  return svg.replace('</style>', `[id^=clawd-] .glow{animation-delay:-${since % GLOW_MS}ms !important}</style>`)
}

// Animations that share a prop switch straight to each other, the prop staying put.
const SHARED: readonly AnimId[] = ['writing', 'stretch']

const SEARCH = /\b(grep|rg|find|search\w*|look(ing)? for|locate|explore|scan)\b/i
// A command that works something out (tests, a build, an install) rather than one that just runs.
const WORK = /\b(test\w*|pytest|jest|vitest|build\w*|compil\w*|install\w*|deploy\w*|lint\w*|tsc|cargo|make|gradle|mvn)\b/i
const WRITE = /\b(writ\w*|implement\w*|edit\w*|fix\w*|refactor\w*|creat\w*|add\w*|updat\w*|build\w*|draft\w*)\b/i

// A command that runs alongside Claude rather than one Claude waits on: a dev server, a
// watcher, a tunnel. Matched on the command line alone, since a description like "Set up
// the tests" says nothing about whether it ends.
const SERVE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|watch)|(?:vite|next|nuxt|astro|remix|wrangler|netlify|vercel|hugo|jekyll)\s+(?:dev|serve)|webpack\s+serve|vite(?:\s|$)|nodemon|uvicorn|gunicorn|flask\s+run|rails\s+s(?:erver)?|manage\.py\s+runserver|php\s+-S|http\.server|http-server|ngrok|cloudflared|(?:docker[- ])?compose\s+up|tail\s+-[fF]|cargo\s+watch|watchexec|live-server)\b|\s--watch\b|\stsc\s+-w\b/i
// A command that has run this long without ending is treated the same way, whatever it is.
const AMBIENT_AFTER_MS = 10 * 60 * 1000

// True when `item` is running alongside Claude, not something Claude is waiting on.
export function isAmbient(item: WaitItem, now?: number): boolean {
  if (item.kind !== 'shell') return false
  return SERVE.test(` ${item.command ?? ''}`) || (now !== undefined && now - item.since > AMBIENT_AFTER_MS)
}

// The animation for what is running, before timing is taken into account.
export function taskAnimation(item: WaitItem | undefined): AnimId {
  if (!item) return 'listening'
  if (SEARCH.test(item.hint)) return 'searching'
  if (item.kind === 'subagent') return WRITE.test(item.hint) ? 'writing' : 'thinking'
  if (item.kind === 'shell' && WORK.test(item.hint)) return 'thinking'
  return 'listening'
}

// The animation to show `elapsed` ms into a quiet stretch that opened with `opener`.
// `now` lets a long-running command count as running alongside.
export function pickAnimation(items: readonly WaitItem[], elapsed: number, opener: Scene['opener'], now?: number): AnimId {
  if (elapsed < OPENER_MS) return opener
  if (elapsed >= SLEEP_AFTER_MS) return 'sleeping'
  if (elapsed >= SCROLL_AFTER_MS) return 'scrolling'
  // The newest task Claude waits on leads: it is the one Claude most likely stopped for.
  // With only servers and watchers running, Clawd just idles.
  const awaited = items.filter(i => !isAmbient(i, now))
  if (awaited.length === 0) return 'idle'
  const task = taskAnimation(awaited[awaited.length - 1])
  // A break from writing is a stretch at the laptop; the others take the headphones off or
  // put the magnifier down and scratch their head.
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

// An exit brings Clawd back to standing from wherever the loop it cut into had him (see
// scripts/build-sprites.mjs): each part eases from its pose at that moment, worked out here
// from the loop's keyframes, while the props leave.
const LEAVE_MS = 500 // an exit with nothing to settle: the props leaving
const EXIT_SLACK_MS = 50 // the drawing starts a moment after the frame is written

const mod = (x: number, m: number) => ((x % m) + m) % m

// CSS timing functions, as the share of the way from one keyframe to the next at `t`.
const CURVES: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}
export function eased(timing: string, t: number): number {
  const steps = /steps\(\s*(\d+)/.exec(timing)
  if (steps) return Math.floor(t * Number(steps[1])) / Number(steps[1])
  const bezier = /cubic-bezier\(([^)]*)\)/.exec(timing)
  const [x1, y1, x2, y2] = bezier ? (bezier[1] ?? '').split(',').map(Number) : (CURVES[timing] ?? CURVES.ease ?? [0, 0, 1, 1])
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3
  // The curve's x runs one way from 0 to 1: find where it is `t`, then read y there.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (at(x1 ?? 0, x2 ?? 1, mid) < t) lo = mid
    else hi = mid
  }
  return at(y1 ?? 0, y2 ?? 1, (lo + hi) / 2)
}

// A transform as its functions, two-argument ones always given both: `translate(1px)` is
// `translate(1px,0)`, `scale(.9)` is `scale(.9,.9)`; `none` is no functions.
type Fn = { name: string; args: { n: number; unit: string }[] }
function functions(value: string): Fn[] {
  return [...value.matchAll(/([\w]+)\(([^)]*)\)/g)].map(([, name = '', list = '']) => {
    const args = list.split(',').map(s => {
      const m = /(-?[\d.]+)([a-z%]*)/.exec(s.trim())
      return { n: Number(m?.[1] ?? 0), unit: m?.[2] ?? '' }
    })
    if ((name === 'translate' || name === 'scale') && args.length === 1) args.push(name === 'scale' ? { ...args[0]! } : { n: 0, unit: '' })
    return { name, args }
  })
}
const still = (fn: Fn): Fn => ({ name: fn.name, args: fn.args.map(a => ({ n: fn.name.startsWith('scale') ? 1 : 0, unit: a.unit })) })

// The pose `share` of the way from transform (or opacity) `a` to `b`.
export function between(a: string, b: string, share: number): string {
  if (!/\(/.test(a + b) && a !== 'none' && b !== 'none') return String(Number(a) + (Number(b) - Number(a)) * share)
  let fa = functions(a)
  let fb = functions(b)
  if (fa.length === 0) fa = fb.map(still)
  if (fb.length === 0) fb = fa.map(still)
  // Different functions do not blend: take the nearer pose.
  if (fa.length !== fb.length || fa.some((f, i) => f.name !== fb[i]?.name || f.args.length !== fb[i]?.args.length)) return share < 0.5 ? a : b
  const num = (n: number) => String(Math.round(n * 1000) / 1000)
  return fa
    .map((f, i) => `${f.name}(${f.args.map((x, j) => {
      const y = fb[i]?.args[j] ?? x
      return num(x.n + (y.n - x.n) * share) + (x.unit || y.unit)
    }).join(',')})`)
    .join(' ')
}

// Where `part` has Clawd `elapsed` ms into its loop.
export function poseAt(part: Part, elapsed: number): string {
  const frames = part.frames
  const first = frames[0]?.value ?? 'none'
  // Before a delayed part starts, it has its pose at the start.
  if (elapsed < part.delay) return first
  const run = elapsed - part.delay
  let at = (mod(run, part.ms) / part.ms) * 100
  if (part.alternate && Math.floor(run / part.ms) % 2 === 1) at = 100 - at
  const j = Math.max(0, frames.findLastIndex(f => f.at <= at))
  const from = frames[j]
  const to = frames[j + 1]
  if (!from) return first
  if (!to || to.at === from.at) return from.value
  return between(from.value, to.value, eased(from.ease ?? part.timing, (at - from.at) / (to.at - from.at)))
}

// The exit `frame`, cut in `elapsed` ms into its loop, and how long it takes.
export function exitFrame(frame: Frame, elapsed: number): { svg: string; ms: number } {
  const exit = EXITS[frame]
  let svg = SPRITES[frame] ?? ''
  if (!exit) return { svg, ms: LEAVE_MS }
  exit.parts.forEach((p, i) => {
    svg = svg.replace(`__P${i}__`, poseAt(p, elapsed))
  })
  return { svg, ms: exit.ms }
}

const KIND: Record<string, string> = { shell: 'command', subagent: 'agent', monitor: 'monitor', workflow: 'workflow' }

export function describeWaiting(items: readonly WaitItem[], now?: number): string {
  const awaited = items.filter(i => !isAmbient(i, now))
  const alongside = items.length - awaited.length
  const last = awaited[awaited.length - 1]
  if (!last) {
    const server = items[items.length - 1]
    if (!server) return 'Waiting on background work'
    return `Running in background: ${server.label}${items.length > 1 ? ` (+${items.length - 1} more)` : ''}`
  }
  const what = `${KIND[last.kind] ?? last.kind}: ${last.label}`
  const extra = [awaited.length > 1 ? `+${awaited.length - 1} more` : '', alongside ? `+${alongside} running` : ''].filter(Boolean)
  return `Waiting on ${what}${extra.length ? ` (${extra.join(', ')})` : ''}`
}

const short = (text: string) => {
  const line = (text.split(/\r?\n/)[0] ?? '').trim()
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

// The ids (tool_use ids, and task ids) of the tasks whose notifications in `text` say they ended.
// One turn can carry several notifications, so each one is read on its own.
export function finishedTasks(text: string): string[] {
  const done: string[] = []
  // A background agent's final report can come as a hand-back message from the agent.
  for (const m of text.matchAll(/<agent-message from="([^"]+)">\s*\[Subagent hand-back\]/g)) if (m[1]) done.push(m[1])
  const blocks = text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? (done.length ? [] : [text])
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

// Drops what can no longer be running: an agent the session lists as ended (one paused on
// work of its own is listed as `waiting`, not ended), and anything so old its end notice
// must have been lost.
async function sweep($: EngineInterface, now: number): Promise<void> {
  const items = await read($, waiting)
  if (items.length === 0) return
  const dead = items.some(i => i.agentId) ? (await $.agent.list()).filter(a => /completed|failed|killed/.test(a.status)).map(a => a.id) : []
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
  if (!current) {
    await update($, shown, () => opener)
    await update($, motion, () => ({ since, elapsed: 0 }))
  }
}

// A trace for testing: while a `.clawd-trace` file sits in the working directory, every
// change in what Clawd waits on and shows goes to `.clawd-trace.log` beside it.
const TRACE_LOG = '.clawd-trace.log'
const traced = { on: false, start: 0, last: '', lines: [] as string[] }

async function trace($: EngineInterface, note?: string): Promise<void> {
  if (!traced.on) return
  const now = await $.clock.now()
  const items = await read($, waiting)
  const current = await read($, scene)
  const state = `frame=${await read($, shown)} scene=${current ? `${current.opener}@${Math.round((now - current.since) / 1000)}s` : 'none'} waiting=[${items.map(i => i.label).join(' | ')}]`
  // The scene's age moves every tick: only the rest of the state counts as a change.
  const key = state.replace(/@\d+s/, '')
  if (!note && key === traced.last) return
  // Short helper runs in the same folder (with nothing in flight) must not overwrite the log.
  if (traced.lines.length === 0 && items.length === 0) return
  traced.last = key
  if (!traced.start) traced.start = now
  traced.lines.push(`${((now - traced.start) / 1000).toFixed(0).padStart(4)}s  ${note ? `${note}  ` : ''}${state}`)
  await $.fs.write(TRACE_LOG, `${traced.lines.join('\n')}\n`)
}

// Where a prompt the person typed comes from: the terminal, a phone or web client, the desktop app.
const PERSON: readonly string[] = ['composer', 'bridge', 'sdk']

export const register: Register = on => {
  // Set when a task ends, so the next quiet moment opens with a hop instead of a wave.
  let taskEnded = false
  // Set while Claude works: Clawd is hidden then, so it holds its frame until Claude is quiet.
  let busy = false
  // The wait between Claude going quiet and Clawd showing.
  let settling: Timer | null = null

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
      item = { id: e.tool_use_id, kind: 'shell', label: short(e.description ?? e.command), hint: `${e.description ?? ''} ${e.command}`, since, taskId, command: e.command }
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

    // Moves Clawd on to its next frame, if it is time.
    const step = async (): Promise<void> => {
      const current = await read($, scene)
      const items = await read($, waiting)
      // Nothing left to wait on: the quiet stretch is over.
      if (current && items.length === 0) await update($, scene, () => null)
      if (!current || items.length === 0 || busy) return
      const t = await $.clock.now()
      const target = pickAnimation(items, t - current.since, current.opener, t)
      const now = await read($, shown)
      const playing = await read($, motion)
      // An exit runs until its loop has come home and its props have left.
      if (now.endsWith('-out') && t < playing.since + exitFrame(now, playing.elapsed).ms) return
      const frame = nextFrame(now, target)
      // Write only on a change, so the drawing is not redrawn (and restarted) every second.
      if (frame === now) return
      const elapsed = frame.endsWith('-out') ? t - playing.since : 0
      await update($, motion, () => ({ since: t, elapsed }))
      await update($, shown, () => frame)
      // The next animation comes in the moment the exit is over, not at the next tick,
      // so Clawd never stands about between the two.
      if (frame.endsWith('-out')) $.clock.after(exitFrame(frame, elapsed).ms + EXIT_SLACK_MS, () => void step().catch(() => {}))
    }

    $.clock.every(1000, async () => {
      await trace($).catch(() => {})
      await sweep($, await $.clock.now()).catch(() => {})
      await step()
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
    if (e.agentId) return next(e)
    busy = true
    settling?.cancel()
    settling = null
    await update($, resting, () => false).catch(() => {})
    if (await finish($, e.text)) taskEnded = true
    return next(e)
  })

  // A local task's notice, and an agent's hand-back, come in as a submission of their own.
  // Only the person's own prompt starts the next quiet moment fresh, with its own wave and timers.
  on('prompt.submit', async ($, e, next) => {
    // The desktop app hands the person's prompts over as an SDK host's.
    if (PERSON.includes(e.origin.kind)) await update($, scene, () => null).catch(() => {})
    else if (await finish($, e.text)) taskEnded = true
    await trace($, `prompt.submit(${e.origin.kind})`).catch(() => {})
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A background agent's turn ending is not its end: it may be waiting on work of
    // its own. Its end notice drops it.
    if (e.agentId) return result

    traced.on = await $.fs.exists('.clawd-trace').catch(() => false)
    settling?.cancel()
    settling = $.clock.after(SETTLE_QUIET_MS, () => {
      settling = null
      void (async () => {
        const items = await read($, waiting)
        if (items.length > 0) await quiet($, taskEnded)
        taskEnded = false
        busy = false
        await update($, resting, () => true)
      })().catch(() => {})
    })
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const items = await read($, waiting)
    if (e.props.hasSurvey || e.props.isWorking || items.length === 0 || !(await read($, resting))) return next(e)

    const text = describeWaiting(items, await $.clock.now())
    if (e.surface === 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text color={CLAY}>[o_o] {text}…</Text>
    }

    const frame = await read($, shown)
    const { since, elapsed } = await read($, motion)
    const svg = frame.endsWith('-out') ? exitFrame(frame, elapsed).svg : (SPRITES[frame] ?? SPRITES.listening ?? '')
    const source = inPhase(svg, since)
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
