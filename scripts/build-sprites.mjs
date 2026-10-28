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

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'sheet/clawd-animations.html'), 'utf8')

// The sheet's own definitions: everything in its script before it touches the page.
const script = html.slice(html.indexOf('(() => {') + '(() => {'.length, html.indexOf('const sheet ='))
const sheet = new Function(`${script}; return { ANIMS, base, blink, sprite, d };`)()
const { ANIMS, base, blink, sprite } = sheet

const USED = ['idle', 'listening', 'thinking', 'writing', 'stretch', 'hop', 'sleeping', 'searching', 'wave']
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
  sleeping: { from: id => `${closedEyes(id)}
    $ .jumper{animation:${id}-wj .7s ease-out both} $ .leg{animation:${id}-wl .7s ease-out both} $ .tilt{animation:${id}-wt .7s ease-out both}
    @keyframes ${id}-wj{from{transform:translateY(1px)}to{transform:none}}
    @keyframes ${id}-wl{from{transform:scaleY(.5)}to{transform:none}}
    @keyframes ${id}-wt{from{transform:rotate(-4deg)}to{transform:none}}` },
}

// Eyes that start shut and open halfway through the exit.
function closedEyes(id) {
  return `$ .eyes-n{animation:${id}-on .7s steps(1) both} $ .eyes-c{animation:${id}-oc .7s steps(1) both}
    @keyframes ${id}-on{0%{opacity:0}50%{opacity:1}} @keyframes ${id}-oc{0%{opacity:1}50%{opacity:0}}`
}

const ENTER = id => `$ .enter{transform-origin:50% 100%;animation:${id}-in .4s ease-out both}
  $ .pin{transform-origin:50% 50%;animation:${id}-pin .45s ease-out both}
  @keyframes ${id}-in{0%{transform:scale(1.08,.88)}45%{transform:scale(.96,1.05)}100%{transform:none}}
  @keyframes ${id}-pin{0%{opacity:0;transform:scale(.5)}100%{opacity:1;transform:none}}`

// Clawd stands still while the props leave: no squash, so an exit never reads as a new start.
const LEAVE = (id, to) => `$ .prop{transform-origin:50% 50%;animation:${id}-lv .5s ease-in both}
  @keyframes ${id}-lv{0%{opacity:1;transform:none}100%{opacity:0;transform:${to}}}`

// Every loop starts and ends on the same standing pose, and an exit finishes the loop
// it cuts into: each part of Clawd plays on from where it was to its next standing
// moment, then stops. A part holding an item (a hand on the chin or the magnifier) has
// a home pose of its own instead: it plays on to that pose, then eases back to standing.
// Where the loop was is only known when the exit starts, so the exit's CSS carries
// placeholders (__D0__, __C0__, __F0__) that the plugin fills in from `EXITS`.
const BODY = /^(mover|flip|jumper|squash|tilt|legs?|l[1-4]|armL|armR|look|face|shadowg|eyes-[nhcws])$/
const SETTLE_MS = 350

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
    if (/alternate|reverse/.test(anim)) throw new Error(`${a.id}: ${classes} plays back and forth, so it has no last frame`)
    const name = anim.split(' ')[0]
    const k = kf[name]
    if (!k) continue
    const prop = /opacity:/.test(k.frames.at(-1)?.body ?? '') && !/transform:/.test(k.frames.at(-1)?.body ?? '') ? 'opacity' : 'transform'
    const rest = prop === 'transform' ? 'none' : classes[0] === 'eyes-n' ? '1' : '0'
    const value = f => new RegExp(`${prop}:([^;]+)`).exec(f.body)?.[1]?.trim()
    const end = k.frames.find(f => f.at.includes(100))
    const pose = (end && value(end)) ?? rest
    const atHome = v => (prop === 'transform' && identity(pose) ? identity(v) : v.replace(/\s/g, '') === pose.replace(/\s/g, ''))
    // The stretches of the loop the part spends at home: between two keyframes that are
    // both home, or after one that is home when the loop moves in steps.
    const points = k.frames.flatMap(f => f.at.map(at => ({ at, home: value(f) !== undefined && atHome(value(f)) })))
    if (!points.some(p => p.at === 0)) points.push({ at: 0, home: atHome(rest) })
    if (!end) points.push({ at: 100, home: true })
    points.sort((x, y) => x.at - y.at)
    const stepped = /steps\(/.test(anim)
    const ms = seconds(anim)
    const spans = []
    points.forEach((p, j) => {
      if (!p.home) return
      const next = points[j + 1]
      const to = next && (next.home || stepped) ? next.at : p.at
      const last = spans.at(-1)
      if (last && last[1] >= p.at) last[1] = Math.max(last[1], to)
      else spans.push([p.at, to])
    })
    const settle = prop === 'transform' ? !identity(pose) : pose !== rest
    const delay = seconds(decls.find(s => s.startsWith('animation-delay:')) ?? '')
    const i = parts.length
    parts.push({ ms, delay, home: spans.map(([x, y]) => [x, y].map(p => Math.round((p / 100) * ms))), settle })
    extra.push(k.text)
    let rule = [...keep, `animation:${anim}`, `animation-delay:__D${i}__`, `animation-iteration-count:__C${i}__`]
    if (settle) {
      extra.push(`@keyframes ${oid}-s${i}{from{${prop}:${pose}}to{${prop}:${rest}}}`)
      rule = [...keep, `animation:${anim},${oid}-s${i} ${SETTLE_MS}ms ease-out forwards`, `animation-delay:__D${i}__,__F${i}__`, `animation-iteration-count:__C${i}__,1`]
    }
    rules.push(`${sel}{${rule.join(';')}}`)
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

  frames[id] = svg(id, name, `${a.css(id)}\n${ENTER(id)}`, `<g class="enter">${sprite(wrap(props, 'pin'))}</g>`)
  if (SHARED.includes(id)) frames[`${id}~`] = svg(`${id}~`, name, a.css(`${id}-on`), sprite(props))

  const out = OUT[id]
  const kept = out.keep ? wrap(out.keep(a), 'prop') : {}
  const oid = `${id}-out`
  const from = out.from ? out.from(oid) : ''
  // Parts the exit already moves on its own are left out of the finishing.
  const own = [...from.matchAll(/\.([\w-]+)\{/g)].map(m => m[1])
  const finish = finishing(a, oid, new RegExp(`^(${own.join('|') || '$^'})$`))
  exits[oid] = finish.parts
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

// For each exit, the loop parts it finishes, in the order of its placeholders: the loop's
// length and the part's own delay (ms), the stretches of the loop (ms) it spends at its
// home pose, and whether it eases from that pose back to standing afterwards.
export type Part = { ms: number; delay: number; home: [number, number][]; settle: boolean }

export const EXITS: Record<string, Part[]> = {
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
console.log(`wrote ${Object.keys(frames).length} frames: ${Object.keys(frames).join(' ')}`)
