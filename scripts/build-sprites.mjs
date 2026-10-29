// Builds hooks/sprites.ts from the animation sheet (sheet/clawd-animations.html).
//
//   node scripts/build-sprites.mjs
//
// Every animation the plugin uses gets three kinds of frame:
//   <id>      the loop, entered with a short squash-and-settle while its props pop in
//   <id>-out  the exit: Clawd eases back to a plain standing pose while its props leave
//   <id>~     the loop with no entrance, for a switch between two animations that
//             share a prop (writing and stretch keep the laptop in place)
// A switch from A to B plays A-out, then B, so every pair moves through the same
// standing pose instead of cutting from one motion straight into another.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'sheet/clawd-animations.html'), 'utf8')

// The sheet's own definitions: everything in its script before it touches the page.
const script = html.slice(html.indexOf('(() => {') + '(() => {'.length, html.indexOf('const sheet ='))
const sheet = new Function(`${script}; return { ANIMS, base, blink, sprite, d };`)()
const { ANIMS, base, blink, sprite } = sheet

const USED = ['idle', 'listening', 'thinking', 'writing', 'stretch', 'hop', 'sleeping', 'searching', 'scrolling', 'wave']
const SHARED = ['writing', 'stretch']

// What each animation takes away when it ends, and where it goes.
// `keep` picks the props that stay visible as they leave; `from` is extra CSS for an
// exit that starts from a pose other than standing.
const OUT = {
  idle: {},
  hop: {},
  wave: {},
  listening: { keep: a => ({ front: a.sprite.front }), to: 'translateY(-3px)', from: closedEyes },
  thinking: { keep: a => ({ fx: a.sprite.fx }), to: 'translate(2px,-2px) scale(.5)' },
  writing: { keep: a => ({ over: a.sprite.over }), to: 'translateY(2px)' },
  stretch: { keep: a => ({ over: a.sprite.over }), to: 'translateY(2px)' },
  searching: { keep: a => ({ front: a.sprite.front }), to: 'translate(1px,3px) rotate(20deg)', from: () => '$ .bigeye{opacity:0}' },
  scrolling: { keep: a => ({ front: a.sprite.front }), to: 'translateY(4px)' },
  sleeping: { from: id => `${closedEyes(id)}
    $ .eyes-c{animation:${id}-oc .7s steps(1) both,${id}-we .35s ease-out both}
    @keyframes ${id}-we{from{transform:translateY(1px)}to{transform:none}}
    $ .jumper{animation:${id}-wj .7s ease-out both} $ .leg{animation:${id}-wl .7s ease-out both} $ .tilt{animation:${id}-wt .7s ease-out both}
    @keyframes ${id}-wj{from{transform:translateY(1px)}to{transform:none}}
    @keyframes ${id}-wl{from{transform:scaleY(.5)}to{transform:none}}
    @keyframes ${id}-wt{from{transform:rotate(-4deg)}to{transform:none}}` },
}

// Eyes that start shut and open halfway through the exit.
function closedEyes(id) {
  return `$ .eyes-n{animation:${id}-on .5s steps(1) both} $ .eyes-c{animation:${id}-oc .5s steps(1) both}
    @keyframes ${id}-on{0%{opacity:0}50%{opacity:1}} @keyframes ${id}-oc{0%{opacity:1}50%{opacity:0}}`
}

const ENTER = (id, squash = true) => `${squash ? `$ .enter{transform-origin:50% 100%;animation:${id}-in .4s ease-out both}` : ''}
  $ .pin{transform-origin:50% 50%;animation:${id}-pin .45s ease-out both}
  @keyframes ${id}-in{0%{transform:scale(1.08,.88)}45%{transform:scale(.96,1.05)}100%{transform:none}}
  @keyframes ${id}-pin{0%{opacity:0;transform:scale(.5)}100%{opacity:1;transform:none}}`

// Clawd stands still while the props leave: no squash, so an exit never reads as a new start.
const LEAVE = (id, to) => `$ .prop{transform-origin:50% 50%;animation:${id}-lv .5s ease-in both}
  @keyframes ${id}-lv{0%{opacity:1;transform:none}100%{opacity:0;transform:${to}}}`

// Every loop starts and ends on the same standing pose, and an exit brings Clawd back to
// it: each part of Clawd eases from the pose it was in when the exit cut in, straight
// to standing, all at once and while the props leave. Where the loop was is only known
// when the exit starts, so the exit's CSS carries placeholders (__P0__, ...) that the
// plugin fills in from `EXITS` with each part's pose at that moment.
const BODY = /^(mover|flip|jumper|squash|tilt|legs?|l[1-4]|armL|armR|look|face|shadowg|eyes-[nhcws])$/
const SETTLE_MS = 450
const LEAVE_MS = 500 // the props leaving (LEAVE below)
const TIMING = /\b(ease(?:-in-out|-in|-out)?|linear|steps\([^)]*\)|cubic-bezier\([^)]*\))/

const seconds = text => Number(/([\d.]+)s/.exec(text)?.[1] ?? 0) * 1000
const identity = t => t === 'none' || [...t.matchAll(/(\w+)\(([^)]*)\)/g)].every(([, f, args]) => {
  const v = args.split(',').map(s => parseFloat(s))
  return f.startsWith('scale') ? v.every(x => x === 1) : v.every(x => x === 0)
})

function keyframes(css) {
  const all = {}
  for (const m of css.matchAll(/@keyframes (\S+)\{((?:[^{}]*\{[^}]*\})*)\}/g)) {
    all[m[1]] = { text: m[0], frames: [...m[2].matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, at, body]) => ({
      at: at.split(',').map(s => (s.trim() === 'from' ? 0 : s.trim() === 'to' ? 100 : parseFloat(s))),
      body,
    })) }
  }
  return all
}

// The other way in: a pose held for the whole loop (sleep's slump, a hand gripping the
// phone) eases in from standing as the animation starts, instead of snapping to it.
function arriving(a, id) {
  const rules = []
  for (const m of a.css(id).matchAll(/\$ ([^{}@]+?)\{([^{}]*)\}/g)) {
    const classes = m[1].split(',').map(s => s.trim().replace(/^(\$ )?\./, ''))
    if (!classes.every(c => BODY.test(c))) continue
    const decls = m[2].split(';').map(s => s.trim()).filter(Boolean)
    const still = decls.find(s => s.startsWith('transform:'))?.slice('transform:'.length)
    if (decls.some(s => s.startsWith('animation:')) || !still || identity(still)) continue
    const name = `${id}-a${rules.length}`
    rules.push(`${classes.map(c => `$ .${c}`).join(',')}{animation:${name} ${SETTLE_MS}ms ease-out both} @keyframes ${name}{from{transform:none}to{transform:${still}}}`)
  }
  return rules.join('\n')
}

function finishing(a, oid, skip) {
  const css = a.css(oid)
  const kf = keyframes(css)
  const rules = []
  const extra = []
  const parts = []
  for (const m of css.matchAll(/\$ ([^{}@]+?)\{([^{}]*)\}/g)) {
    const classes = m[1].split(',').map(s => s.trim().replace(/^(\$ )?\./, ''))
    if (!classes.every(c => BODY.test(c)) || classes.some(c => skip.test(c))) continue
    const decls = m[2].split(';').map(s => s.trim()).filter(Boolean)
    const anim = decls.find(s => s.startsWith('animation:'))?.slice('animation:'.length)
    const still = decls.find(s => s.startsWith('transform:'))?.slice('transform:'.length)
    const keep = decls.filter(s => !/^(animation(-delay)?|transform):/.test(s))
    const sel = classes.map(c => `$ .${c}`).join(',')
    if (!anim) {
      // A pose held for the whole loop eases back to standing.
      if (!still || identity(still)) continue
      const name = `${oid}-z${extra.length}`
      extra.push(`@keyframes ${name}{from{transform:${still}}to{transform:none}}`)
      rules.push(`${sel}{${[...keep, `animation:${name} ${SETTLE_MS}ms ease-out both`].join(';')}}`)
      continue
    }
    const name = anim.split(' ')[0]
    const k = kf[name]
    if (!k) continue
    const prop = /opacity:/.test(k.frames.at(-1)?.body ?? '') && !/transform:/.test(k.frames.at(-1)?.body ?? '') ? 'opacity' : 'transform'
    const rest = prop === 'transform' ? 'none' : classes[0] === 'eyes-n' ? '1' : '0'
    const value = f => new RegExp(`${prop}:([^;]+)`).exec(f.body)?.[1]?.trim()
    // The part's keyframes, each with the timing it moves on to the next one by. A loop
    // with no 0% or 100% keyframe takes the part's own pose there, as CSS does.
    const base = prop === 'transform' ? (still ?? 'none') : rest
    const frames = k.frames.flatMap(f => {
      const v = value(f)
      const ease = /animation-timing-function:([^;]+)/.exec(f.body)?.[1]?.trim()
      return v === undefined ? [] : f.at.map(at => ({ at, value: v, ...(ease ? { ease } : {}) }))
    })
    if (!frames.some(f => f.at === 0)) frames.push({ at: 0, value: base })
    if (!frames.some(f => f.at === 100)) frames.push({ at: 100, value: base })
    frames.sort((x, y) => x.at - y.at)
    const delay = seconds(decls.find(s => s.startsWith('animation-delay:')) ?? '')
    const i = parts.length
    parts.push({ ms: seconds(anim), delay, timing: TIMING.exec(anim)?.[1] ?? 'ease', alternate: /alternate/.test(anim), frames })
    // An eye shape swaps in at once (halfway through); the body eases.
    const timing = prop === 'opacity' ? `${SETTLE_MS / 2}ms steps(1,end)` : `${SETTLE_MS}ms ease-out`
    extra.push(`@keyframes ${oid}-s${i}{from{${prop}:__P${i}__}to{${prop}:${rest}}}`)
    rules.push(`${sel}{${[...keep, `animation:${oid}-s${i} ${timing} both`].join(';')}}`)
  }
  return { css: [...rules, ...extra].join('\n'), parts }
}

const wrap = (parts, cls) =>
  Object.fromEntries(Object.entries(parts).filter(([, v]) => v).map(([k, v]) => [k, `<g class="${cls}">${v}</g>`]))

function svg(key, name, css, body) {
  const scope = `#clawd-${key.replace('~', '-on')}`
  const style = `${base}\n${css}`.replace(/\$/g, scope).replace(/\s+/g, ' ')
  return `<svg id="${scope.slice(1)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 22" shape-rendering="crispEdges" role="img" aria-label="Clawd ${name}"><style>${style}</style>${body}</svg>`
    .replace(/\s{2,}/g, ' ')
}

const frames = {}
const exits = {}
for (const id of USED) {
  const a = ANIMS.find(x => x.id === id)
  if (!a) throw new Error(`the sheet has no animation "${id}"`)
  const name = a.name.toLowerCase()
  const props = a.sprite ?? {}

  // Idle and sleep start without the entrance squash: idle brings nothing in, and Clawd
  // sinks into sleep rather than bouncing into it.
  frames[id] = svg(id, name, `${a.css(id)}\n${ENTER(id, !['idle', 'sleeping'].includes(id))}\n${arriving(a, id)}`, `<g class="enter">${sprite(wrap(props, 'pin'))}</g>`)
  if (SHARED.includes(id)) frames[`${id}~`] = svg(`${id}~`, name, a.css(`${id}-on`), sprite(props))

  const out = OUT[id]
  const kept = out.keep ? wrap(out.keep(a), 'prop') : {}
  const oid = `${id}-out`
  const from = out.from ? out.from(oid) : ''
  // Parts the exit already moves on its own are left out of the finishing.
  const own = [...from.matchAll(/\.([\w-]+)\{/g)].map(m => m[1])
  const finish = finishing(a, oid, new RegExp(`^(${own.join('|') || '$^'})$`))
  // The exit is over once the props are gone, every part stands and its own moves are done.
  const ms = Math.max(SETTLE_MS, out.keep ? LEAVE_MS : 0, ...[...from.matchAll(/([\d.]+)s\b/g)].map(m => Number(m[1]) * 1000))
  exits[oid] = { ms, parts: finish.parts }
  frames[oid] = svg(oid, name, `${blink(oid, 4)}\n${LEAVE(oid, out.to ?? 'none')}\n${from}\n${finish.css}`, sprite(kept))
}

const lines = Object.entries(frames).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
const exitLines = Object.entries(exits).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
writeFileSync(
  join(root, 'hooks/sprites.ts'),
  `// Generated by scripts/build-sprites.mjs from sheet/clawd-animations.html. Do not edit by hand.
// Each value is a standalone animated SVG, its CSS scoped to its own id.

export const SPRITES: Record<string, string> = {
${lines.join('\n')}
}

// For each exit, how long it runs (ms), and the loop parts it brings back to standing, in
// the order of its placeholders: each one's loop length and delay (ms), its timing, whether
// it plays back and forth, and its keyframes (at: % of the loop; ease: the keyframe's own timing).
export type Keyframe = { at: number; value: string; ease?: string }
export type Part = { ms: number; delay: number; timing: string; alternate: boolean; frames: Keyframe[] }
export type Exit = { ms: number; parts: Part[] }

export const EXITS: Record<string, Exit> = {
${exitLines.join('\n')}
}
`,
)
// The same frames for the transitions page (sheet/transitions.html), which plays them in a browser.
writeFileSync(
  join(root, 'sheet/frames.js'),
  `// Generated by scripts/build-sprites.mjs. Do not edit by hand.
window.SPRITES = {
${lines.join('\n')}
}
window.EXITS = {
${exitLines.join('\n')}
}
`,
)
// The README's previews: each animation on a light tile, so it reads on GitHub's light and
// dark themes alike, and a banner of Clawd asleep beside the band's text.
const TILE = '#F4EFE8'
mkdirSync(join(root, 'docs/previews'), { recursive: true })
for (const id of USED) {
  writeFileSync(
    join(root, `docs/previews/${id}.svg`),
    frames[id]
      .replace('viewBox="0 0 32 22"', 'viewBox="0 0 32 22" width="128" height="88"')
      .replace('</style>', `</style><rect x="0" y="0" width="32" height="22" rx="2" fill="${TILE}"/>`),
  )
}
const asleep = frames.sleeping.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
writeFileSync(
  join(root, 'docs/previews/banner.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 96" width="480" height="96" role="img" aria-label="Clawd asleep while Claude waits on npm test">
<rect x="0.5" y="0.5" width="479" height="95" rx="10" fill="${TILE}" stroke="#E2DACF"/>
<svg id="clawd-sleeping" x="16" y="12" width="104" height="72" viewBox="0 0 32 22" shape-rendering="crispEdges">${asleep}</svg>
<text x="132" y="54" font-family="ui-sans-serif, -apple-system, 'Segoe UI', sans-serif" font-size="17" font-weight="500" fill="#C8613F">Waiting on command: npm test… (+1 more)</text>
</svg>
`,
)
console.log(`wrote ${Object.keys(frames).length} frames: ${Object.keys(frames).join(' ')}`)
