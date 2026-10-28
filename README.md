# clawd-watch

A Claude Code plugin that puts Clawd, a small animated pixel creature, above the prompt
while Claude is idle but still waiting on background work: a background command,
a background agent or a Monitor listener. Clawd glances around with signal
waves pulsing over its head, and the text beside it says what Claude is waiting on,
for example `Waiting on command: npm test… (+1 more)`. It disappears when the work
finishes and Claude picks the conversation back up.

It draws as an animated SVG in the Claude desktop app and as a one-line text badge
in the terminal.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clawd-watch --marketplace furkangocuk/clawd-watch
```

From a shell:

```bash
claude plugin install clawd-watch --marketplace furkangocuk/clawd-watch
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace**
with `furkangocuk/clawd-watch`, then **Add plugin**.

## Development

```bash
claude --plugin-dir .
```

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

The hooks module is `hooks/register.tsx`; the creature's drawing is the `SVG` constant at the top.

## License

MIT
