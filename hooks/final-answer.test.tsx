import { expect, test } from 'claude-code/testing'
test('the final answer is drawn in a clay border on every surface', async ($, on) => {
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.turn.complete({ answer: 'Here is the answer.', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-watch', component: 'AssistantMessage', requestId: 'm', surface, props: { text: 'Here is the answer.', isFirstOfReply: true } })
    const box = await ui.find({ type: 'Box' })
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeTruthy()
    expect(box?.props.borderStyle).toBe('round')
    expect(box?.props.borderColor).toBe('#D97757')
    await ui.unmount()
  }
})
