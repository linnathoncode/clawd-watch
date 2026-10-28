import { expect, test } from 'claude-code/testing'
import { describeWaiting, finishedTask, pickAnimation, taskAnimation } from './register'

const shell = { id: 'a', kind: 'shell', label: 'npm test', hint: 'Run tests npm test' }
const search = { id: 'b', kind: 'shell', label: 'Find auth files', hint: 'Find auth files rg auth src' }
const agentWrite = { id: 'c', kind: 'subagent', label: 'Implement login', hint: 'Implement login general-purpose' }
const agentThink = { id: 'd', kind: 'subagent', label: 'Review the plan', hint: 'Review the plan Plan' }
const monitor = { id: 'e', kind: 'monitor', label: 'CI', hint: 'CI' }

test('describes the newest background wait', async () => {
  expect(describeWaiting([shell])).toBe('Waiting on command: npm test')
  expect(describeWaiting([agentThink, monitor])).toBe('Waiting on monitor: CI (+1 more)')
})

test('picks an animation from the task', () => {
  expect(taskAnimation(shell)).toBe('listening')
  expect(taskAnimation(search)).toBe('searching')
  expect(taskAnimation(agentWrite)).toBe('writing')
  expect(taskAnimation(agentThink)).toBe('thinking')
  expect(taskAnimation(monitor)).toBe('listening')
})

test('opens, takes idle breaks and falls asleep over time', () => {
  expect(pickAnimation([shell], 0, 'wave')).toBe('wave')
  expect(pickAnimation([shell], 1000, 'hop')).toBe('hop')
  expect(pickAnimation([shell], 10_000, 'wave')).toBe('listening')
  expect(pickAnimation([shell], 31_000, 'wave')).toBe('idle')
  expect(pickAnimation([shell], 36_000, 'wave')).toBe('listening')
  expect(pickAnimation([shell, agentWrite], 10_000, 'wave')).toBe('writing')
  expect(pickAnimation([shell], 4 * 60_000, 'wave')).toBe('sleeping')
})

test('spots a finished task in a notification', () => {
  const done = '<task-notification><tool-use-id>toolu_1</tool-use-id><status>completed</status></task-notification>'
  expect(finishedTask(done)).toBe('toolu_1')
  expect(finishedTask('<tool-use-id>toolu_2</tool-use-id><status>running</status>')).toBe(null)
})
