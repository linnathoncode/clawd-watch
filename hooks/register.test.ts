import { expect, test } from 'claude-code/testing'
import { isFinalAnswer, keepAnswer, among, between, describeTask, describeWaiting, drawing, eased, exitFrame, field, finishedTasks, inPhase, isAmbient, markFor, nextFrame, names, pickAnimation, queuedText, shownTask, slots, stepPick, taskAnimation } from './register'
import { EXITS, SPRITES } from './sprites'
import { MINIS } from './minis'

const shell = { id: 'a', kind: 'shell', label: 'Start the dev server', hint: 'Start the dev server npm run dev', since: 0 }
const search = { id: 'b', kind: 'shell', label: 'Find auth files', hint: 'Find auth files rg auth src', since: 0 }
const agentWrite = { id: 'c', kind: 'subagent', label: 'Implement login', hint: 'Implement login general-purpose', since: 0 }
const agentThink = { id: 'd', kind: 'subagent', label: 'Review the plan', hint: 'Review the plan Plan', since: 0 }
const monitor = { id: 'e', kind: 'monitor', label: 'CI', hint: 'CI', since: 0 }
const server = { ...shell, id: 'f', command: 'npm run dev' }

test('describes the newest background wait', async () => {
  expect(describeWaiting([shell])).toBe('Waiting on command: Start the dev server')
  expect(describeWaiting([agentThink, monitor])).toBe('Waiting on monitor: CI (+1 more)')
  expect(describeWaiting([server])).toBe('Running in background: Start the dev server')
  expect(describeWaiting([server, agentThink, monitor])).toBe('Waiting on monitor: CI (+1 more, +1 running)')
  expect(describeWaiting([monitor, server])).toBe('Waiting on monitor: CI (+1 running)')
})

test('servers and watchers run alongside; Claude does not wait on them', () => {
  for (const command of ['npm run dev', 'pnpm dev', 'npx wrangler dev', 'python -m http.server 8000', 'uvicorn app:app --reload', 'docker compose up', 'tail -f log.txt', 'jest --watch', 'npx vite'])
    expect(isAmbient({ ...shell, command })).toBe(true)
  for (const command of ['npm test', 'npm run build', 'cargo build --release', 'rg auth src', 'sleep 200 && echo done', 'npm install'])
    expect(isAmbient({ ...shell, command })).toBe(false)
  // Agents and monitors are always waited on; any command running past ten minutes is not.
  expect(isAmbient({ ...agentThink, command: 'npm run dev' })).toBe(false)
  expect(isAmbient({ ...shell, command: 'npm test' }, 11 * 60_000)).toBe(true)
  // Only servers running: Clawd idles after the opener, then gets bored and sleeps as usual.
  expect(pickAnimation([server], 1000, 'wave')).toBe('wave')
  expect(pickAnimation([server], 10_000, 'wave')).toBe('idle')
  expect(pickAnimation([server], 2 * 60_000, 'wave')).toBe('scrolling')
  // A wait alongside a server leads, even when the server started later.
  expect(pickAnimation([agentWrite, server], 10_000, 'wave')).toBe('writing')
})

test('picks an animation from the task', () => {
  expect(taskAnimation(shell)).toBe('listening')
  expect(taskAnimation(search)).toBe('searching')
  expect(taskAnimation(agentWrite)).toBe('writing')
  expect(taskAnimation(agentThink)).toBe('thinking')
  expect(taskAnimation(monitor)).toBe('listening')
  expect(taskAnimation({ ...shell, hint: 'Run the test suite npm test' })).toBe('thinking')
  expect(taskAnimation({ ...shell, hint: 'Build the app cargo build --release' })).toBe('thinking')
  expect(taskAnimation({ ...shell, hint: 'Wait for the release sleep 200' })).toBe('listening')
})

test('opens, takes idle breaks, gets bored and falls asleep over time', () => {
  expect(pickAnimation([shell], 0, 'wave')).toBe('wave')
  expect(pickAnimation([shell], 1000, 'hop')).toBe('hop')
  expect(pickAnimation([shell], 10_000, 'wave')).toBe('listening')
  expect(pickAnimation([shell], 31_000, 'wave')).toBe('idle')
  expect(pickAnimation([agentThink], 31_000, 'wave')).toBe('idle')
  expect(pickAnimation([agentThink], 37_000, 'wave')).toBe('idle')
  expect(pickAnimation([agentThink], 39_000, 'wave')).toBe('thinking')
  expect(pickAnimation([shell, agentWrite], 10_000, 'wave')).toBe('writing')
  expect(pickAnimation([shell], 80_000, 'wave')).toBe('listening')
  expect(pickAnimation([shell], 90_000, 'wave')).toBe('scrolling')
  expect(pickAnimation([agentWrite], 2 * 60_000, 'wave')).toBe('scrolling')
  expect(pickAnimation([shell], 4 * 60_000, 'wave')).toBe('sleeping')
})

test('a break from writing is a stretch at the laptop', () => {
  expect(pickAnimation([agentWrite], 31_000, 'wave')).toBe('stretch')
  expect(pickAnimation([agentWrite], 35_000, 'wave')).toBe('writing')
})

test('every switch passes through an exit, except between shared props', () => {
  expect(nextFrame('listening', 'listening')).toBe('listening')
  expect(nextFrame('wave', 'listening')).toBe('wave-out')
  expect(nextFrame('wave-out', 'listening')).toBe('listening')
  expect(nextFrame('writing', 'stretch')).toBe('stretch~')
  expect(nextFrame('stretch~', 'writing')).toBe('writing~')
  expect(nextFrame('writing~', 'writing')).toBe('writing~')
  expect(nextFrame('writing~', 'sleeping')).toBe('writing-out')
})

test('spots every finished task in a turn', () => {
  const note = (id: string, status: string) =>
    `<task-notification><tool-use-id>${id}</tool-use-id><status>${status}</status></task-notification>`
  expect(finishedTasks(note('toolu_1', 'completed'))).toEqual(['toolu_1'])
  expect(finishedTasks(note('toolu_1', 'completed') + note('toolu_2', 'failed'))).toEqual(['toolu_1', 'toolu_2'])
  expect(finishedTasks(note('toolu_3', 'running'))).toEqual([])
  const interim = note('toolu_4', 'completed').replace('</status>', '</status><summary>Agent "x" is waiting on its own background work</summary>')
  expect(finishedTasks(interim)).toEqual([])
  const agentEnd = '<task-notification><task-id>a9</task-id><status>completed</status><summary>Agent "x" finished</summary></task-notification>'
  expect(finishedTasks(agentEnd)).toEqual(['a9'])
})

test('the laptop glow picks up where the clock had it when the frame started', () => {
  for (const f of ['writing', 'writing~', 'stretch', 'stretch~']) expect(inPhase(SPRITES[f] ?? '', 2300)).toContain('animation-delay:-100ms')
  expect(inPhase(SPRITES.listening ?? '', 2300)).toBe(SPRITES.listening ?? '')
})

test('poses between keyframes follow the CSS timing', () => {
  expect(Math.abs(eased('linear', 0.3) - 0.3)).toBeLessThan(0.001)
  expect(Math.abs(eased('ease-in-out', 0.5) - 0.5)).toBeLessThan(0.001)
  expect(eased('ease-out', 0.5)).toBeGreaterThan(0.5)
  expect(eased('steps(2)', 0.7)).toBe(0.5)
  expect(eased('steps(1)', 0.99)).toBe(0)
  expect(between('translate(0,0)', 'translate(2px,-4px)', 0.5)).toBe('translate(1px,-2px)')
  expect(between('none', 'rotate(10deg)', 0.5)).toBe('rotate(5deg)')
  expect(between('scale(1)', 'scale(1.04,.94)', 0.5)).toBe('scale(1.02,0.97)')
  expect(between('1', '0', 0.25)).toBe('0.75')
})

test('an exit eases each part from where the loop had it, straight to standing', () => {
  // Cut in at the loop's start: every part is already standing.
  const standing = (t: string) => [...t.matchAll(/(\w+)\(([^)]*)\)/g)].every(([, f, args]) => (args ?? '').split(',').every(a => parseFloat(a) === (f?.startsWith('scale') ? 1 : 0)))
  const poses = [...exitFrame('listening-out', 0).svg.matchAll(/from\{transform:([^}]*)\}/g)].map(m => m[1] ?? '')
  expect(poses.length).toBeGreaterThan(5)
  expect(poses.every(standing)).toBe(true)
  // Searching cut in while Clawd stands forward at the glass (32% to 66%): it eases back from there.
  expect(exitFrame('searching-out', 2000).svg).toContain('from{transform:translateX(4px)}')
  // Doom scrolling's thumb is mid-flick at 12%: the arm comes back from there, not from its grip.
  expect(exitFrame('scrolling-out', 480).svg).toContain('from{transform:translate(-3px,1px)}')
})

test('every exit is filled in and short, wherever it cuts in', () => {
  for (const frame of Object.keys(EXITS)) {
    for (const elapsed of [0, 333, 1250, 2900, 6100, 47_123]) {
      const { svg, ms } = exitFrame(frame, elapsed)
      expect(svg).not.toContain('__')
      expect(svg).not.toContain('NaN')
      expect(ms).toBeGreaterThanOrEqual(450)
      expect(ms).toBeLessThanOrEqual(700)
    }
  }
})

test('a switch keeps the old frame underneath, untouched, while the new one loads', () => {
  const before = { frame: 'listening', since: 1000, elapsed: 0, slot: 0 as const }
  const after = { frame: 'listening-out', since: 5000, elapsed: 4000, slot: 1 as const }
  expect(slots(before)).toEqual([drawing(before), null])
  // The old frame keeps its layer and its exact SVG, so the app keeps its drawing running.
  expect(slots({ ...after, prior: before })).toEqual([drawing(before), drawing(after)])
  expect(slots(after)).toEqual([null, drawing(after)])
})

test('reads a field from a result, whatever else it carries', () => {
  expect(field({ agentId: 'a1' }, 'agentId')).toBe('a1')
  expect(field({ status: 'async_launched', agentId: 'a2', description: 'x' }, 'agentId')).toBe('a2')
  expect(field({ backgroundTaskId: 'b7' }, 'backgroundTaskId')).toBe('b7')
  expect(field('Async agent launched', 'agentId')).toBe(undefined)
  expect(field(undefined, 'agentId')).toBe(undefined)
})

test('a task is named by its tool call, task id or agent id', () => {
  const agent = { id: 'toolu_1', kind: 'subagent', label: 'x', hint: 'x', since: 0, taskId: 'a9', agentId: 'a9' }
  const cmd = { id: 'toolu_2', kind: 'shell', label: 'x', hint: 'x', since: 0, taskId: 'bnlzmv5ql' }
  expect(names(agent, ['toolu_1'])).toBe(true)
  expect(names(agent, ['a9'])).toBe(true)
  expect(names(cmd, ['bnlzmv5ql'])).toBe(true)
  expect(names(cmd, ['a9', 'toolu_1'])).toBe(false)
})

test('a task stopped while Claude is idle ends when its notice is queued', () => {
  const killed = '<task-notification>\n<task-id>brihimgev</task-id>\n<tool-use-id>toolu_011</tool-use-id>\n<status>killed</status>\n<summary>Task "Run local server" was stopped</summary>\n</task-notification>'
  const text = queuedText([{ type: 'text', text: killed }, { type: 'image' }])
  expect(finishedTasks(text)).toEqual(['toolu_011', 'brihimgev'])
})

test('an agent hand-back message is its end', () => {
  const handback = `Another Claude session sent a message:
<agent-message from="a2d636191cc997101">
[Subagent hand-back] The text below is the final report of a subagent this session delegated to.
  done
</agent-message>`
  expect(finishedTasks(handback)).toEqual(['a2d636191cc997101'])
})

test('the band shows the picked task until the tasks change', () => {
  const items = [agentThink, monitor, server]
  // Nothing picked: the newest task Claude waits on, not the server.
  expect(shownTask(items, null)?.id).toBe('e')
  expect(shownTask([server], null)?.id).toBe('f')
  // ‹ › go round all the tasks, servers included.
  const back = stepPick(items, null, -1)
  expect(back).toEqual({ id: 'd', among: among(items) })
  expect(shownTask(items, back)?.id).toBe('d')
  expect(shownTask(items, stepPick(items, back, -1))?.id).toBe('f')
  expect(shownTask(items, stepPick(items, null, 1))?.id).toBe('f')
  // A task starting or ending drops the pick.
  expect(shownTask([...items, agentWrite], back)?.id).toBe('c')
  expect(shownTask([agentThink, monitor], back)?.id).toBe('e')
  // One task: nothing to step through.
  expect(stepPick([monitor], null, 1)).toBe(null)
})

test('describes one task, and Clawd follows the task shown', () => {
  expect(describeTask(agentThink)).toBe('Waiting on agent: Review the plan')
  expect(describeTask(server)).toBe('Running in background: Start the dev server')
  expect(pickAnimation([agentWrite, search], 10_000, 'wave', undefined, agentWrite)).toBe('writing')
  expect(pickAnimation([agentWrite, search], 10_000, 'wave')).toBe('searching')
  expect(pickAnimation([agentWrite, server], 10_000, 'wave', undefined, server)).toBe('idle')
  // The opener, boredom and sleep do not depend on the task.
  expect(pickAnimation([agentWrite], 1000, 'hop', undefined, agentWrite)).toBe('hop')
  expect(pickAnimation([agentWrite], 4 * 60_000, 'wave', undefined, agentWrite)).toBe('sleeping')
})

test('the slim band has a mark for every kind of task', async () => {
  for (const item of [agentThink, agentWrite, monitor]) {
    expect(MINIS[markFor(item)]).toBeTruthy()
  }
  expect(markFor(agentWrite)).toBe('writing')
  expect(markFor(monitor)).toBe('listening')
})

test('the desktop band draws, opens and shrinks, and steps through tasks', async ($, on) => {
  // Two tasks running and Claude quiet, answered beneath the plugin (a call on $ is answered
  // as { value: <its result> }).
  on('state.get', async ($, e, next) => {
    if (e.plugin === 'clawd-watch' && e.key === 'waiting') return { value: { value: [agentThink, monitor], version: 1 } } as never
    if (e.plugin === 'clawd-watch' && e.key === 'resting') return { value: { value: true, version: 1 } } as never
    return next(e)
  })
  on('clock.now', async () => ({ value: 100_000 }) as never)
  const ui = await $.ui.mount({
    plugin: 'clawd-watch', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0 } as never, view: {} as never },
  })
  const text = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(await text()).toContain('Waiting on monitor: CI…')
  expect(await text()).toContain('2/2')
  await ui.press({ key: 'prev' })
  expect(await text()).toContain('Waiting on agent: Review the plan…')
  expect(await text()).toContain('1/2')
  // Full by default: the arrow shrinks it, and the mini Clawd takes the place of the big one.
  const sizes = async () => (await ui.findAll({ type: 'Svg' })).map(s => s.props.width)
  expect(await sizes()).toContain(80)
  await ui.press({ key: 'toggle' })
  expect(await sizes()).toContain(32)
  expect(await sizes()).not.toContain(80)
  // The slim band draws the shown task's abstract mark, not Clawd, and it follows the task.
  const sources = async () => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source)).join(' ')
  expect(await sources()).toContain('mini-thinking')
  expect(await sources()).not.toContain('clawd-')
  await ui.press({ key: 'next' })
  expect(await sources()).toContain('mini-listening')
  await ui.press({ key: 'toggle' })
  expect(await sizes()).toContain(80)
})

test('keeps final answers and marks only their blocks', () => {
  let list = keepAnswer([], 'Here is the\n\nanswer.')
  list = keepAnswer(list, '   ')
  expect(list).toEqual(['Here is the answer.'])
  expect(isFinalAnswer(list, 'Here is the answer.')).toBe(true)
  expect(isFinalAnswer(list, 'Checking the files now.')).toBe(false)
  expect(isFinalAnswer(list, '')).toBe(false)
  // An answer drawn over several blocks: its long closing block is marked, a short tail is not.
  const long = 'Intro paragraph. ' + 'The closing paragraph explains everything that changed today.'
  expect(isFinalAnswer(keepAnswer([], long), 'The closing paragraph explains everything that changed today.')).toBe(true)
  expect(isFinalAnswer(list, 'answer.')).toBe(false)
  // The same answer twice is kept once, newest last, and the list stays bounded.
  expect(keepAnswer(['a', 'b'], 'a')).toEqual(['b', 'a'])
  expect(Array.from({ length: 150 }, (_, i) => `n${i}`).reduce(keepAnswer, [] as string[]).length).toBe(100)
})
