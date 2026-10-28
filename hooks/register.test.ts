import { expect, test } from 'claude-code/testing'
import { describeWaiting, exitFrame, field, finishedTasks, homeTimes, inPhase, nextFrame, names, pickAnimation, taskAnimation } from './register'
import { EXITS, SPRITES } from './sprites'

const shell = { id: 'a', kind: 'shell', label: 'Start the dev server', hint: 'Start the dev server npm run dev', since: 0 }
const search = { id: 'b', kind: 'shell', label: 'Find auth files', hint: 'Find auth files rg auth src', since: 0 }
const agentWrite = { id: 'c', kind: 'subagent', label: 'Implement login', hint: 'Implement login general-purpose', since: 0 }
const agentThink = { id: 'd', kind: 'subagent', label: 'Review the plan', hint: 'Review the plan Plan', since: 0 }
const monitor = { id: 'e', kind: 'monitor', label: 'CI', hint: 'CI', since: 0 }

test('describes the newest background wait', async () => {
  expect(describeWaiting([shell])).toBe('Waiting on command: Start the dev server')
  expect(describeWaiting([agentThink, monitor])).toBe('Waiting on monitor: CI (+1 more)')
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

test('opens, takes idle breaks and falls asleep over time', () => {
  expect(pickAnimation([shell], 0, 'wave')).toBe('wave')
  expect(pickAnimation([shell], 1000, 'hop')).toBe('hop')
  expect(pickAnimation([shell], 10_000, 'wave')).toBe('listening')
  expect(pickAnimation([shell], 31_000, 'wave')).toBe('idle')
  expect(pickAnimation([agentThink], 31_000, 'wave')).toBe('idle')
  expect(pickAnimation([agentThink], 37_000, 'wave')).toBe('idle')
  expect(pickAnimation([agentThink], 39_000, 'wave')).toBe('thinking')
  expect(pickAnimation([shell, agentWrite], 10_000, 'wave')).toBe('writing')
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

test('an exit plays its loop on until each part is home, parts on one beat together', () => {
  // Cut in at the loop's start: everything is already home.
  expect(homeTimes(EXITS['listening-out'] ?? [], 0).every(t => t === 0)).toBe(true)
  // Searching cut in while Clawd stands forward at the glass: it walks back to the
  // middle (96%), its steps and lean stopping with it.
  expect(new Set(homeTimes(EXITS['searching-out'] ?? [], 2000))).toEqual(new Set([2800]))
  // Thinking's bob, sway and chin keep beats of their own: each stops at its next home.
  expect(homeTimes(EXITS['thinking-out'] ?? [], 1000)).toEqual([600, 1400, 200])
})

test('every exit is filled in, wherever it cuts in', () => {
  for (const frame of Object.keys(EXITS)) {
    for (const elapsed of [0, 333, 1250, 2900, 6100, 47_123]) {
      const { svg, ms } = exitFrame(frame, elapsed)
      expect(svg).not.toContain('__')
      expect(ms).toBeGreaterThanOrEqual(700)
      expect(ms).toBeLessThanOrEqual(8000 + 350)
    }
  }
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

test('an agent hand-back message is its end', () => {
  const handback = `Another Claude session sent a message:
<agent-message from="a2d636191cc997101">
[Subagent hand-back] The text below is the final report of a subagent this session delegated to.
  done
</agent-message>`
  expect(finishedTasks(handback)).toEqual(['a2d636191cc997101'])
})
