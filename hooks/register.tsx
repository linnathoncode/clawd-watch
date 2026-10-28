import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { WaitItem } from '../types'

const waiting = atom({ plugin: 'pixel-buddy', key: 'waiting' } as const, [] as WaitItem[])

const CLAY = '#D97757'
const INK = '#1F1E1D'

// The creature on a 14x8 grid (body, side arms, four legs, two eyes), placed at
// (5, 6) in a 24x16 view. While background work runs it sits still, eyes
// glancing left and right, with signal arcs pulsing above its head.
const arcs = [0, 1, 2]
  .map(
    i => `<rect x="${11 - i * 2}" y="${4 - i * 2}" width="${2 + i * 4}" height="1" fill="${CLAY}" opacity="0">
      <animate attributeName="opacity" values="0;1;0" dur="1.5s" begin="${i * 0.3}s" repeatCount="indefinite"/>
    </rect>`,
  )
  .join('')

const glance = `<animateTransform attributeName="transform" type="translate"
  values="0 0;-1 0;-1 0;1 0;1 0;0 0" keyTimes="0;0.15;0.4;0.55;0.8;1" dur="3s" repeatCount="indefinite"/>`

const legs = [3, 5, 8, 10].map(x => `<rect x="${x}" y="6" width="1" height="2" fill="${CLAY}"/>`).join('')

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" shape-rendering="crispEdges">${arcs}
  <g transform="translate(5 6)">
    <rect x="2" y="0" width="10" height="6" fill="${CLAY}"/>
    <rect x="0" y="3" width="2" height="2" fill="${CLAY}"/>
    <rect x="12" y="3" width="2" height="2" fill="${CLAY}"/>
    <g>${glance}<rect x="4" y="2" width="1" height="2" fill="${INK}"/><rect x="9" y="2" width="1" height="2" fill="${INK}"/></g>
    ${legs}
  </g>
</svg>`

const KIND: Record<string, string> = { shell: 'command', subagent: 'agent', monitor: 'monitor', workflow: 'workflow' }

export function describeWaiting(items: readonly WaitItem[]): string {
  const [first] = items
  if (!first) return 'Waiting on background work'
  const what = `${KIND[first.kind] ?? first.kind}: ${first.label}`
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

export const register: Register = on => {
  // Track background work ourselves: a launch adds it, its completion notice removes it.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.isError) return result

    let item: WaitItem | null = null
    if ((e.tool === 'Bash' || e.tool === 'PowerShell') && e.run_in_background) {
      item = { id: e.tool_use_id, kind: 'shell', label: short(e.description ?? e.command) }
    } else if (e.tool === 'Agent' && e.run_in_background !== false) {
      item = { id: e.tool_use_id, kind: 'subagent', label: short(e.description) }
    } else if (e.tool === 'Monitor') {
      item = { id: e.tool_use_id, kind: 'monitor', label: short(e.description) }
    }
    if (item) {
      const added = item
      // Bookkeeping only: never let it fail the tool call.
      await update($, waiting, items => [...items.filter(i => i.id !== added.id), added]).catch(() => {})
    }
    return result
  })

  // A fresh or resumed session has none of our work in flight.
  on('session.start', async ($, e, next) => {
    await update($, waiting, () => [])
    return next(e)
  })

  // A finished task's notice can arrive as a delivery or as the text of the turn it wakes.
  on('session.receive', async ($, e, next) => {
    const done = e.origin.kind === 'task-notification' ? finishedTask(e.text) : null
    if (done) await update($, waiting, items => items.filter(i => i.id !== done)).catch(() => {})
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const done = e.agentId ? null : finishedTask(e.text)
    if (done) await update($, waiting, items => items.filter(i => i.id !== done)).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const items = await read($, waiting)
    if (e.props.hasSurvey || e.props.isWorking || items.length === 0) return next(e)

    const text = describeWaiting(items)
    if (e.surface === 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text color={CLAY}>[o_o] {text}…</Text>
    }

    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg source={SVG} alt={`Pixel buddy: ${text}`} width={72} height={48} isInteractive />
        <Text color={CLAY} weight="medium">
          {text}…
        </Text>
      </Box>
    )
  })
}
