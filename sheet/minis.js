// Abstract minis: no Clawd, just a clay mark per animation on a 16×11 grid (two screen pixels
// a cell at 32×22), each with one small motion. One per task animation; MINIS[id] is a whole SVG.
;(() => {
  const CLAY = '#D97757', LIGHT = '#EE9C80', DIM = '#B45A3C'
  const r = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`

  const svg = (id, inner, css) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 11" shape-rendering="crispEdges" class="mini-${id}"><style>
    .mini-${id} *{transform-box:fill-box;transform-origin:50% 50%}
    ${css.replaceAll('$', `.mini-${id}`)}
    @media (prefers-reduced-motion:reduce){.mini-${id} *{animation:none!important}}
  </style>${inner}</svg>`

  const MINIS = {
    // Idle: the block breathes.
    idle: svg('idle', r(6, 4, 4, 3, CLAY, ' class="b"'), `
      $ .b{animation:mi-br 2.4s ease-in-out infinite}
      @keyframes mi-br{0%,100%{opacity:.55;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`),

    // Listening: an equaliser.
    listening: svg('listening', [2, 5, 8, 11, 14].map((x, i) => r(x - 1, 2, 2, 7, CLAY, ` class="q q${i}"`)).join(''), `
      $ .q{transform-origin:50% 100%;animation:mi-q .9s ease-in-out infinite}
      $ .q1{animation-delay:-.45s} $ .q2{animation-delay:-.2s} $ .q3{animation-delay:-.65s} $ .q4{animation-delay:-.3s}
      @keyframes mi-q{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}`),

    // Thinking: three dots in turn.
    thinking: svg('thinking', [3, 7, 11].map((x, i) => r(x, 4, 2, 2, CLAY, ` class="d d${i}"`)).join(''), `
      $ .d{opacity:.3;animation:mi-d 1.2s ease-in-out infinite} $ .d1{animation-delay:.2s} $ .d2{animation-delay:.4s}
      @keyframes mi-d{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-1px)}}`),

    // Writing: lines fill in, a cursor blinks at the end.
    writing: svg('writing', `
      ${r(2, 2, 10, 1, CLAY, ' class="w w0"')}${r(2, 5, 8, 1, CLAY, ' class="w w1"')}${r(2, 8, 6, 1, CLAY, ' class="w w2"')}
      ${r(13, 7, 1, 3, LIGHT, ' class="cu"')}`, `
      $ .w{transform-origin:0 50%;animation:mi-w 2.4s steps(6) infinite} $ .w1{animation-delay:.4s} $ .w2{animation-delay:.8s}
      $ .cu{animation:mi-cu .8s steps(1) infinite}
      @keyframes mi-w{0%{transform:scaleX(0)}50%,100%{transform:scaleX(1)}}
      @keyframes mi-cu{0%{opacity:1}50%{opacity:0}}`),

    // Searching: a ring sweeps over a dotted row.
    searching: svg('searching', `
      ${[1, 4, 7, 10, 13].map(x => r(x, 5, 2, 1, DIM)).join('')}
      <g class="g">${r(2, 2, 4, 1, CLAY)}${r(2, 8, 4, 1, CLAY)}${r(1, 3, 1, 5, CLAY)}${r(6, 3, 1, 5, CLAY)}${r(3, 4, 2, 3, LIGHT, ' opacity=".35"')}</g>`, `
      $ .g{animation:mi-g 2.4s ease-in-out infinite}
      @keyframes mi-g{0%,100%{transform:translateX(0)}50%{transform:translateX(9px)}}`),

    // Scrolling: a phone outline, its lines sliding up past the screen's edges.
    scrolling: svg('scrolling', `
      ${r(5, 0, 6, 1, CLAY)}${r(5, 10, 6, 1, CLAY)}${r(4, 1, 1, 9, CLAY)}${r(11, 1, 1, 9, CLAY)}
      <svg x="5" y="1" width="6" height="9" viewBox="0 0 6 9"><g class="s">${[1, 3, 5, 7, 9, 11, 13].map((y, i) => r(1, y, i % 2 ? 3 : 4, 1, i % 3 ? DIM : LIGHT)).join('')}</g></svg>`, `
      $ .s{transform-box:view-box;animation:mi-s 1.6s steps(4) infinite}
      @keyframes mi-s{0%{transform:translateY(0)}100%{transform:translateY(-6px)}}`),

    // Sleeping: z's drift up and fade, one after another.
    sleeping: svg('sleeping', [0, 1, 2].map(i => `<g class="z z${i}">${r(0, 0, 4, 1, CLAY)}${r(2, 1, 1, 1, CLAY)}${r(1, 2, 1, 1, CLAY)}${r(0, 3, 4, 1, CLAY)}</g>`).join(''), `
      $ .z{opacity:0;animation:mi-z 3s linear infinite} $ .z1{animation-delay:1s} $ .z2{animation-delay:2s}
      @keyframes mi-z{0%{opacity:0;transform:translate(2px,7px) scale(.75)}15%{opacity:1}70%{opacity:.8}100%{opacity:0;transform:translate(10px,0) scale(1)}}`),

  }
  // The mini for an animation. Openers, breaks and exits have none: they come and go, and the
  // mark stays on the phase they interrupt.
  const miniFor = anim => MINIS[anim] ?? MINIS.idle
  window.MINIS = MINIS
  window.miniFor = miniFor
})()
