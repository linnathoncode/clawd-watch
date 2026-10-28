import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AnimId, Scene, WaitItem } from '../types'
import { SPRITES } from './sprites'

const waiting = atom({ plugin: 'clawd-watch', key: 'waiting' } as const, [] as WaitItem[])
// When Claude last went quiet with work still running, and how that quiet stretch opens.
const scene = atom({ plugin: 'clawd-watch', key: 'scene' } as const, null as Scene | null)
const shown = atom({ plugin: 'clawd-watch', key: 'shown' } as const, 'listening' as AnimId)

const CLAY = '#D97757'

// Timings for the animation Clawd shows while Claude waits, in milliseconds.
const OPENER_MS = 2500 // wave (or hop, if a task just finished) when the wait begins
const SLEEP_AFTER_MS = 3 * 60 * 1000 // a long wait sends Clawd to sleep
const BREAK_EVERY_MS = 30 * 1000 // now and then, a short idle break
const BREAK_FOR_MS = 4000

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
  if (elapsed >= BREAK_EVERY_MS && elapsed % BREAK_EVERY_MS < BREAK_FOR_MS) return 'idle'
  // The newest task leads: it is the one Claude most likely stopped to wait for.
  return taskAnimation(items[items.length - 1])
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

// The tool_use id of a task whose notification says it ended, else null.
export function finishedTask(text: string): string | null {
  const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1]
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]
  return id && status && /completed|failed|killed|stopped/.test(status) ? id : null
}

// Drops a task whose finished notice is in `text`; true when one was dropped.
async function finish($: EngineInterface, text: string): Promise<boolean> {
  const done = finishedTask(text)
  if (!done) return false
  await update($, waiting, items => items.filter(i => i.id !== done)).catch(() => {})
  return true
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
    } else if (e.tool === 'Agent' && e.run_in_background !== false) {
      item = { id: e.tool_use_id, kind: 'subagent', label: short(e.description), hint: `${e.description} ${e.subagent_type ?? ''}` }
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
      const current = await read($, scene)
      const items = await read($, waiting)
      if (!current || items.length === 0) return
      const anim = pickAnimation(items, (await $.clock.now()) - current.since, current.opener)
      // Write only on a change, so the drawing is not redrawn (and restarted) every second.
      if (anim !== (await read($, shown))) await update($, shown, () => anim)
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

    const anim = await read($, shown)
    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg source={SPRITES[anim]} alt={`Clawd: ${text}`} width={80} height={55} isInteractive />
        <Text color={CLAY} weight="medium">
          {text}…
        </Text>
      </Box>
    )
  })
}
