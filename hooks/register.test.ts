import { expect, test } from 'claude-code/testing'
import { describeWaiting, finishedTask } from './register'

test('describes background waits', async () => {
  expect(describeWaiting([{ id: 'a', kind: 'shell', label: 'npm test' }])).toBe('Waiting on command: npm test')
  expect(
    describeWaiting([
      { id: 'b', kind: 'subagent', label: 'Review code' },
      { id: 'c', kind: 'monitor', label: 'CI' },
    ]),
  ).toBe('Waiting on agent: Review code (+1 more)')
})

test('spots a finished task in a notification', () => {
  const done = '<task-notification><tool-use-id>toolu_1</tool-use-id><status>completed</status></task-notification>'
  expect(finishedTask(done)).toBe('toolu_1')
  expect(finishedTask('<tool-use-id>toolu_2</tool-use-id><status>running</status>')).toBe(null)
})
