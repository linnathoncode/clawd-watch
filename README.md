# clawd-watch

A Claude Code plugin that puts Clawd, a small animated pixel creature, above the prompt
while Claude is idle but still waiting on background work: a background command,
a background agent or a Monitor listener. The text beside it says what Claude is waiting on, for example
`Waiting on command: npm test… (+1 more)`, and it disappears when the work finishes
and Claude picks the conversation back up.

What Clawd does depends on the work and on how long the wait has run:

| When | Clawd |
| --- | --- |
| Claude goes quiet | waves (or hops, if a task just finished) |
| a command or Monitor is running | listens to music on headphones |
| the newest task is a search (`rg`, `grep`, `find`, "search…") | peers through a magnifier |
| a background agent is writing or fixing code | types on a laptop |
| a background agent is doing anything else | thinks |
| every 30 seconds | takes a 4-second idle break and scratches its head |
| after 3 minutes | falls asleep |

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

The hooks module is `hooks/register.tsx`; the animations are standalone SVGs in `hooks/sprites.ts`.

## License

MIT
