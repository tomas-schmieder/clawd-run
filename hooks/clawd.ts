// Clawd Run: Chromium's offline dino game, played by Clawd above the prompt.
//
// The scene is drawn in half-cell pixels: each terminal cell holds 2×2 of
// them and is painted with the quadrant glyph that matches (▘ ▝ ▀ ▖ ▌ … █),
// so Clawd below is the Claude Code logo pixel for pixel and everything moves
// in half-cell steps. Physics, spawning and scoring follow Chromium's dino
// (BSD-3, via github.com/wayou/t-rex-runner), scaled to a terminal: there is
// no key-up there, so a jump is always a full one and a duck lasts a moment
// rather than for as long as the key is held.

import type { Phase } from '../types'
import type { Action } from './keys'

// Sprites, as rows of `#` (set) and `.` (clear), top row first. ------------

type Sprite = readonly string[]

const widthOf = (sprite: Sprite) => sprite[0]?.length ?? 0

const mirror = (sprite: Sprite): Sprite => sprite.map(row => [...row].reverse().join(''))

// Clawd: the logo's two rows of body, eyes as holes, and legs that here reach
// the ground and take turns as he runs. In the air they tuck up as in the logo.
const EYES_OPEN = ['...############...', '...##.######.##...']
const EYES_SHUT = ['...############...', '...############...']
const EYES_WIDE = ['...############...', '...##..####..##...']
const TORSO = ['.################.', '...############...']
const LEGS_DOWN = ['....#.#....#.#....', '....#.#....#.#....']
const LEGS_LEFT = ['....#.#....#.#....', '....#......#......']
const LEGS_RIGHT = ['....#.#....#.#....', '......#......#....']
const LEGS_TUCKED = ['....#.#....#.#....', '..................']

const CLAWD_STAND: Sprite = [...EYES_OPEN, ...TORSO, ...LEGS_DOWN]
const CLAWD_BLINK: Sprite = [...EYES_SHUT, ...TORSO, ...LEGS_DOWN]
const CLAWD_LEFT: Sprite = [...EYES_OPEN, ...TORSO, ...LEGS_LEFT]
const CLAWD_RIGHT: Sprite = [...EYES_OPEN, ...TORSO, ...LEGS_RIGHT]
const CLAWD_AIR: Sprite = [...EYES_OPEN, ...TORSO, ...LEGS_TUCKED]
const CLAWD_CRASHED: Sprite = [...EYES_WIDE, ...TORSO, ...LEGS_DOWN]
const CLAWD_CRASHED_AIR: Sprite = [...EYES_WIDE, ...TORSO, ...LEGS_TUCKED]

// Ducking, he flattens and spreads his arms: four pixels tall, under a bird.
const DUCK_BODY = ['..##############..', '..###.######.###..', '##################']
const CLAWD_DUCK_LEFT: Sprite = [...DUCK_BODY, '...#........#.....']
const CLAWD_DUCK_RIGHT: Sprite = [...DUCK_BODY, '.....#........#...']

const CACTUS_SMALL: Sprite = ['..##..', '#.##.#', '######', '..##..']
const CACTUS_LARGE: Sprite = ['..##.#', '#.##.#', '#.####', '####..', '..##..', '..##..']
const CACTUS_SMALL_FLIPPED = mirror(CACTUS_SMALL)
const CACTUS_LARGE_FLIPPED = mirror(CACTUS_LARGE)

// A bird flying left, wings up and wings down; its bottom row is the lowest
// a wing reaches.
const BIRD_UP: Sprite = ['.....##...', '.##...##..', '#########.', '..######..', '..........']
const BIRD_DOWN: Sprite = ['..........', '.##.......', '#########.', '..######..', '.....##...']

const CLOUD: Sprite = ['....###..##...', '..##########..', '##############']

// The field. -----------------------------------------------------------------

export const FRAME_MS = 33

/** Rows the running game takes above the prompt: the field and the ground. */
export const FULL_ROWS = 9

export const MIN_COLUMNS = 40

const MAX_COLUMNS = 140
const FIELD_ROWS = FULL_ROWS - 1
const IDLE_ROWS = 3
const CLAWD_X = 6
const HIT_INSET = 2 // Clawd's arm tips brush past things.

// Chromium counts its own pixels per 60 Hz frame, its "pace": 6 at the start,
// 13 at most. One of its pixels is CHROMIUM_PX of ours across (Clawd is 18
// wide where the T-rex is 44), and the ground runs at 3/4 of its speed.
const CHROMIUM_PX = 18 / 44
const START_PACE = 6
const MAX_PACE = 13
const START_SPEED = 110
const ACCELERATION = 0.06
const SCORE_COEFFICIENT = 0.025

// A jump rises APEX pixels and lasts AIR_TIME at the starting pace, a little
// less as the pace climbs, so that it never outruns the gaps.
const APEX = 9
const AIR_TIME = 0.72
const DROP_GRAVITY = 3
const DUCK_TIME = 0.6
const JUMP_BUFFER = 0.15
const STEPS_PER_SECOND = 12

const CLEAR_TIME = 3
const RESTART_DELAY = 0.6
const LINGER = 4
const IDLE_TIMEOUT = 20
const PAUSE_TIMEOUT = 120
const RESUME_TIME = 0.9
const REVEAL_TIME = 0.4
const FLASH_TIME = 1.5

type Kind = 'small' | 'large' | 'bird'

const KINDS: Record<Kind, { chromiumWidth: number; minGap: number; minPace: number; multiplePace: number }> = {
  small: { chromiumWidth: 17, minGap: 120, minPace: 0, multiplePace: 4 },
  large: { chromiumWidth: 25, minGap: 120, minPace: 0, multiplePace: 7 },
  bird: { chromiumWidth: 46, minGap: 150, minPace: 8.5, multiplePace: Infinity },
}
const KIND_NAMES: Kind[] = ['small', 'large', 'bird']
const GAP_COEFFICIENT = 0.6
const MAX_GAP_COEFFICIENT = 1.5
const GAP_SCALE = 1.3 // Full jumps only, so a little more room than Chromium leaves.
const MAX_GROUP = 3
const MAX_DUPLICATION = 2
const CACTUS_SPACING = 1

// A bird's lowest wing, in pixels off the ground: jump it, duck it, or stay put.
const BIRD_LIFTS = [2, 4, 7]
const BIRD_DRIFT = 0.8
const BIRD_FLAPS = 6

const MAX_CLOUDS = 6
const CLOUD_SPEED = 0.07
const CLOUD_LIFTS = [9, 10, 11, 12, 13]

const GROUND_LENGTH = 600
const SPINNER = '·✢✳✶✻✽'

// The game. ------------------------------------------------------------------

type Obstacle = {
  kind: Kind
  x: number
  size: number
  lift: number
  isFlipped: boolean
  drift: number
  gap: number
  hasFollower: boolean
}

type Cloud = { x: number; lift: number; gap: number }

export type Game = {
  phase: Phase
  clock: number
  runTime: number
  pace: number
  y: number
  vy: number
  isAirborne: boolean
  isDropping: boolean
  duckLeft: number
  bufferLeft: number
  distance: number
  score: number
  best: number
  flashAt: number
  crashAt: number
  quietFor: number
  isDone: boolean
  hasWorked: boolean
  resumeLeft: number
  obstacles: Obstacle[]
  history: Kind[]
  clouds: Cloud[]
  groundX: number
  ground: string
}

export type Context = { columns: number; isWorking: boolean }

/** What drawing needs besides: whether a run can start here, and room kept at the top right. */
export type DrawContext = Context & { isPlayable: boolean; hudInset: number }

const LONG_AGO = -1000

export function newGame(best: number): Game {
  return {
    phase: 'idle',
    clock: 0,
    runTime: 0,
    pace: START_PACE,
    y: 0,
    vy: 0,
    isAirborne: false,
    isDropping: false,
    duckLeft: 0,
    bufferLeft: 0,
    distance: 0,
    score: 0,
    best,
    flashAt: LONG_AGO,
    crashAt: LONG_AGO,
    quietFor: 0,
    isDone: false,
    hasWorked: false,
    resumeLeft: 0,
    obstacles: [],
    history: [],
    clouds: [{ x: 90, lift: 11, gap: 60 }],
    groundX: 0,
    ground: makeGround(),
  }
}

export const canPlay = (columns: number, maxRows: number) =>
  columns >= MIN_COLUMNS && maxRows >= FULL_ROWS

/**
 * A press: space starts a run, jumps, or resumes after a count of three;
 * ↓ ducks, or drops out of a jump; pause pauses, and stops a count.
 */
export function act(game: Game, action: Action, isPlayable: boolean): void {
  if (game.phase === 'paused') {
    if (action === 'pause') {
      game.resumeLeft = 0
    } else if (action === 'jump' && game.resumeLeft === 0) {
      game.resumeLeft = RESUME_TIME
    }
    return
  }
  if (game.phase === 'running') {
    if (action === 'pause') {
      game.phase = 'paused'
      game.resumeLeft = 0
    } else if (action === 'jump') {
      if (game.isAirborne) {
        game.bufferLeft = JUMP_BUFFER
      } else {
        jump(game)
      }
    } else if (game.isAirborne) {
      game.isDropping = true
      game.vy = Math.min(game.vy, 0)
    } else {
      game.duckLeft = DUCK_TIME
    }
    return
  }
  if (action !== 'jump' || !isPlayable) {
    return
  }
  if (game.phase === 'over' && game.clock - game.crashAt < RESTART_DELAY) {
    return
  }
  Object.assign(game, {
    phase: 'running',
    runTime: 0,
    pace: START_PACE,
    distance: 0,
    score: 0,
    flashAt: LONG_AGO,
    quietFor: 0,
    isDone: false,
    obstacles: [],
    history: [],
  })
  jump(game)
}

/** Moves the game on by `dt` seconds; answers whether its drawing changed. */
export function step(game: Game, dt: number, context: Context): boolean {
  const before = look(game, context)
  game.clock += dt
  if (context.isWorking) {
    game.quietFor = 0
    game.isDone = false
    game.hasWorked = true
  }
  if (game.phase === 'paused' && game.resumeLeft > 0) {
    game.resumeLeft = Math.max(0, game.resumeLeft - dt)
    if (game.resumeLeft === 0) {
      game.phase = 'running'
    }
    return true
  }
  if (game.phase === 'running') {
    run(game, dt, fieldColumns(context.columns) * 2)
    return true
  }
  if (!context.isWorking) {
    game.quietFor += dt
    game.isDone = game.quietFor >= REST_TIMEOUTS[game.phase]
  }

  return look(game, context) !== before
}

/** What a resting game's drawing depends on, so a tick redraws only on change. */
function look(game: Game, context: Context): string {
  if (game.phase === 'idle') {
    return `idle ${isBlinking(game)} ${context.isWorking}`
  }

  return `${game.phase} ${context.isWorking && spinnerAt(game)}`
}

const REST_TIMEOUTS: Record<Phase, number> = {
  idle: IDLE_TIMEOUT,
  running: Infinity,
  paused: PAUSE_TIMEOUT,
  over: LINGER,
}

function jump(game: Game): void {
  game.duckLeft = 0
  game.bufferLeft = 0
  game.isAirborne = true
  game.isDropping = false
  game.vy = Math.sqrt(2 * gravityAt(game.pace) * APEX)
}

const gravityAt = (pace: number) => ((8 * APEX) / AIR_TIME ** 2) * (pace / START_PACE) ** 0.8

const speedAt = (pace: number) => (pace * START_SPEED) / START_PACE

function run(game: Game, dt: number, width: number): void {
  game.runTime += dt
  game.pace = Math.min(MAX_PACE, game.pace + ACCELERATION * dt)

  if (game.isAirborne) {
    const gravity = gravityAt(game.pace) * (game.isDropping ? DROP_GRAVITY : 1)
    game.y += game.vy * dt - (gravity * dt * dt) / 2
    game.vy -= gravity * dt
    if (game.y <= 0) {
      game.y = 0
      game.vy = 0
      game.isAirborne = false
      game.isDropping = false
      if (game.bufferLeft > 0) {
        jump(game)
      }
    }
  }
  game.bufferLeft = Math.max(0, game.bufferLeft - dt)
  game.duckLeft = Math.max(0, game.duckLeft - dt)

  const travel = speedAt(game.pace) * dt
  game.groundX += travel
  moveClouds(game, travel * CLOUD_SPEED, width)
  moveObstacles(game, dt, width)

  const before = game.score
  game.distance += game.pace * 60 * dt
  game.score = Math.min(99999, Math.floor(game.distance * SCORE_COEFFICIENT))
  if (Math.floor(game.score / 100) > Math.floor(before / 100)) {
    game.flashAt = game.clock
  }

  if (isHit(game)) {
    game.phase = 'over'
    game.crashAt = game.clock
    game.quietFor = 0
    game.isDone = false
    game.best = Math.max(game.best, game.score)
  }
}

function moveClouds(game: Game, travel: number, width: number): void {
  for (const cloud of game.clouds) {
    cloud.x -= travel
  }
  game.clouds = game.clouds.filter(cloud => cloud.x + widthOf(CLOUD) > 0)
  const last = game.clouds.at(-1)
  if (game.clouds.length < MAX_CLOUDS && (last === undefined || last.x + widthOf(CLOUD) + last.gap < width)) {
    game.clouds.push({ x: width, lift: pick(CLOUD_LIFTS), gap: 40 + Math.random() * 120 })
  }
}

function moveObstacles(game: Game, dt: number, width: number): void {
  for (const obstacle of game.obstacles) {
    obstacle.x -= speedAt(game.pace + obstacle.drift) * dt
  }
  game.obstacles = game.obstacles.filter(obstacle => obstacle.x + obstacleWidth(obstacle) > 0)
  if (game.runTime < CLEAR_TIME) {
    return
  }
  const last = game.obstacles.at(-1)
  if (last === undefined) {
    game.obstacles.push(spawn(game, width))
  } else if (!last.hasFollower && last.x + obstacleWidth(last) + last.gap < width) {
    game.obstacles.push(spawn(game, width))
    last.hasFollower = true
  }
}

/** Chromium's pick: any kind the pace allows, but never three of one in a row. */
function spawn(game: Game, width: number): Obstacle {
  const kinds = KIND_NAMES.filter(
    kind =>
      game.pace >= KINDS[kind].minPace &&
      !(game.history.length >= MAX_DUPLICATION && game.history.every(seen => seen === kind)),
  )
  const kind = pick(kinds)
  const config = KINDS[kind]
  const size = game.pace >= config.multiplePace ? 1 + Math.floor(Math.random() * MAX_GROUP) : 1
  const minGap =
    GAP_SCALE * CHROMIUM_PX * (config.chromiumWidth * size * game.pace + config.minGap * GAP_COEFFICIENT)
  game.history = [kind, ...game.history].slice(0, MAX_DUPLICATION)

  return {
    kind,
    x: width,
    size,
    lift: kind === 'bird' ? pick(BIRD_LIFTS) : 0,
    isFlipped: Math.random() < 0.5,
    drift: kind === 'bird' ? pick([BIRD_DRIFT, -BIRD_DRIFT]) : 0,
    gap: minGap * (1 + Math.random() * (MAX_GAP_COEFFICIENT - 1)),
    hasFollower: false,
  }
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)]
  if (item === undefined) {
    throw new Error('pick from nothing')
  }

  return item
}

function obstacleWidth(obstacle: Obstacle): number {
  if (obstacle.kind === 'bird') {
    return widthOf(BIRD_UP)
  }

  return obstacle.size * widthOf(CACTUS_SMALL) + (obstacle.size - 1) * CACTUS_SPACING
}

type Placed = { sprite: Sprite; x: number; bottom: number }

/** An obstacle's sprites, its birds' wings as they are `runTime` into the run. */
function obstacleSprites(obstacle: Obstacle, runTime: number): Placed[] {
  const x = Math.round(obstacle.x)
  if (obstacle.kind === 'bird') {
    const isUp = Math.floor(runTime * BIRD_FLAPS) % 2 === 0
    return [{ sprite: isUp ? BIRD_UP : BIRD_DOWN, x, bottom: obstacle.lift }]
  }
  const isSmall = obstacle.kind === 'small'

  return Array.from({ length: obstacle.size }, (_, i) => {
    const isFlipped = obstacle.isFlipped !== (i % 2 === 1)
    const sprite = isSmall
      ? isFlipped ? CACTUS_SMALL_FLIPPED : CACTUS_SMALL
      : isFlipped ? CACTUS_LARGE_FLIPPED : CACTUS_LARGE
    return { sprite, x: x + i * (widthOf(CACTUS_SMALL) + CACTUS_SPACING), bottom: 0 }
  })
}

function clawdSprite(game: Game): Sprite {
  if (game.phase === 'over') {
    return game.isAirborne ? CLAWD_CRASHED_AIR : CLAWD_CRASHED
  }
  if (game.phase === 'idle') {
    return isBlinking(game) ? CLAWD_BLINK : CLAWD_STAND
  }
  if (game.isAirborne) {
    return CLAWD_AIR
  }
  const isLeft = Math.floor(game.runTime * STEPS_PER_SECOND) % 2 === 0
  if (game.duckLeft > 0) {
    return isLeft ? CLAWD_DUCK_LEFT : CLAWD_DUCK_RIGHT
  }

  return isLeft ? CLAWD_LEFT : CLAWD_RIGHT
}

const isBlinking = (game: Game) => game.clock % 3.2 > 3.05

const spinnerAt = (game: Game) => SPINNER[Math.floor(game.clock * 8) % SPINNER.length] ?? '·'

/** Calls `visit` with each set pixel's column and its height off the ground. */
function eachPixel(sprite: Sprite, x: number, bottom: number, visit: (x: number, lift: number) => void): void {
  sprite.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#') {
        visit(x + c, bottom + sprite.length - 1 - r)
      }
    }
  })
}

/** Pixel against pixel, as drawn: a crash is two sprites sharing a pixel. */
function isHit(game: Game): boolean {
  const clawd = clawdSprite(game)
  const width = widthOf(clawd)
  const own = new Set<number>()
  eachPixel(clawd, CLAWD_X, Math.round(game.y), (x, lift) => {
    if (x - CLAWD_X >= HIT_INSET && x - CLAWD_X < width - HIT_INSET) {
      own.add(lift * 10000 + x)
    }
  })

  return game.obstacles.some(obstacle => {
    if (obstacle.x > CLAWD_X + width || obstacle.x + obstacleWidth(obstacle) < CLAWD_X) {
      return false
    }
    let isTouching = false
    for (const { sprite, x, bottom } of obstacleSprites(obstacle, game.runTime)) {
      eachPixel(sprite, x, bottom, (px, lift) => {
        isTouching ||= own.has(lift * 10000 + px)
      })
    }
    return isTouching
  })
}

function makeGround(): string {
  let ground = ''
  for (let i = 0; i < GROUND_LENGTH; i++) {
    const roll = Math.random()
    ground += roll < 0.02 ? '▁' : roll < 0.035 ? ' ' : '▔'
  }

  return ground
}

// Drawing. -------------------------------------------------------------------

export type Style = 'plain' | 'clawd' | 'cactus' | 'bird' | 'cloud' | 'ground' | 'quiet' | 'loud' | 'claude' | 'done'

export type Run = { text: string; style: Style }

export type Line = Run[]

type Cells = { chars: string[]; styles: Style[] }

// Indexed by the four pixels of a cell: upper left 1, upper right 2, lower
// left 4, lower right 8.
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

// What a pixel is, in drawing order: a later ink wins a shared cell's color.
const INKS: Style[] = ['plain', 'cloud', 'cactus', 'bird', 'clawd']
const INK_CLOUD = 1
const INK_CACTUS = 2
const INK_BIRD = 3
const INK_CLAWD = 4

type Inked = Placed & { ink: number }

const fieldColumns = (columns: number) => Math.min(columns, MAX_COLUMNS)

const pad = (score: number) => String(score).padStart(5, '0')

export function draw(game: Game, context: DrawContext): Line[] {
  const columns = fieldColumns(context.columns)
  if (columns < MIN_COLUMNS) {
    return [[{ text: 'Clawd Run needs a wider terminal', style: 'quiet' }]]
  }

  return (game.phase === 'idle' ? drawIdle(game, columns, context) : drawField(game, columns, context)).map(
    compress,
  )
}

/** Before the first run: Clawd on a scrap of ground, and what to press. */
function drawIdle(game: Game, columns: number, context: DrawContext): Cells[] {
  const clawd = clawdSprite(game)
  const lines = rasterize(columns, IDLE_ROWS, [{ sprite: clawd, x: CLAWD_X, bottom: 0, ink: INK_CLAWD }])
  const besideClawd = (CLAWD_X + widthOf(clawd)) / 2 + 3
  const ground = blank(columns)
  put(ground, 0, '▔'.repeat(besideClawd - 2), 'ground')
  const hint = !context.isPlayable
    ? `Make the terminal taller to play: Clawd needs ${FULL_ROWS} rows above the prompt`
    : context.isWorking
      ? 'Press space to play while Claude works'
      : 'Press space to play'
  put(lines[1], besideClawd, hint, 'quiet')
  if (context.isPlayable) {
    const best = game.best > 0 ? `   HI ${pad(game.best)}` : ''
    put(lines[2], besideClawd, `space jumps · s ducks${best}`, 'quiet')
  }

  return [...lines, ground]
}

/** A run, or how it ended: sky, obstacles, Clawd, ground, and the scores. */
function drawField(game: Game, columns: number, context: DrawContext): Cells[] {
  const placed: Inked[] = [
    ...game.clouds.map(cloud => ({ sprite: CLOUD, x: Math.round(cloud.x), bottom: cloud.lift, ink: INK_CLOUD })),
    ...game.obstacles.flatMap(obstacle =>
      obstacleSprites(obstacle, game.runTime).map(placed => ({
        ...placed,
        ink: obstacle.kind === 'bird' ? INK_BIRD : INK_CACTUS,
      })),
    ),
    { sprite: clawdSprite(game), x: CLAWD_X, bottom: Math.round(game.y), ink: INK_CLAWD },
  ]
  const lines = rasterize(columns, FIELD_ROWS, placed)

  // The ground unrolls from under Clawd as the first run starts, as in Chromium.
  const ground = blank(columns)
  const offset = Math.floor(game.groundX / 2)
  const reveal = game.phase === 'running' ? Math.min(1, game.runTime / REVEAL_TIME) : 1
  const shown = Math.round(CLAWD_X / 2 + 10 + (columns - CLAWD_X / 2 - 10) * reveal)
  for (let cx = 0; cx < shown; cx++) {
    ground.chars[cx] = game.ground[(offset + cx) % game.ground.length] ?? '▔'
    ground.styles[cx] = 'ground'
  }

  const top = lines[0]
  if (top !== undefined && context.hudInset > 0) {
    top.chars.length = Math.max(0, columns - context.hudInset)
    top.styles.length = top.chars.length
  }
  drawScores(top, game, context)
  if (game.phase === 'over') {
    center(lines[2], 'G A M E   O V E R', 'loud')
    center(lines[4], 'space to retry', 'quiet')
  }
  if (game.phase === 'paused' && game.resumeLeft > 0) {
    center(lines[3], String(Math.ceil((game.resumeLeft / RESUME_TIME) * 3)), 'loud')
  } else if (game.phase === 'paused') {
    center(lines[2], 'P A U S E D', 'loud')
    center(lines[4], 'space to resume', 'quiet')
  }

  return [...lines, ground]
}

/** The top right corner: whether Claude is still working, the best, the score. */
function drawScores(line: Cells | undefined, game: Game, context: Context): void {
  const parts: Run[] = []
  if (context.isWorking) {
    parts.push({ text: spinnerAt(game), style: 'claude' }, { text: ' Claude is working   ', style: 'quiet' })
  } else if (game.hasWorked) {
    parts.push({ text: '✓ Claude is done', style: 'done' }, { text: '   ', style: 'plain' })
  }
  if (game.best > 0) {
    parts.push({ text: `HI ${pad(game.best)}   `, style: 'quiet' })
  }
  const sinceFlash = game.clock - game.flashAt
  const isFlashedOut = sinceFlash < FLASH_TIME && Math.floor(sinceFlash * 4) % 2 === 0
  parts.push({ text: isFlashedOut ? '     ' : pad(game.score), style: 'plain' })

  const length = parts.reduce((sum, part) => sum + [...part.text].length, 0)
  let column = line === undefined ? 0 : line.chars.length - length - 1
  for (const part of parts) {
    put(line, column, part.text, part.style)
    column += [...part.text].length
  }
}

function rasterize(columns: number, rows: number, placed: Inked[]): Cells[] {
  const width = columns * 2
  const height = rows * 2
  const pixels = new Uint8Array(width * height)
  for (const { sprite, x, bottom, ink } of placed) {
    eachPixel(sprite, x, bottom, (px, lift) => {
      const py = height - 1 - lift
      if (px >= 0 && px < width && py >= 0 && py < height) {
        pixels[py * width + px] = ink
      }
    })
  }

  return Array.from({ length: rows }, (_, cy) => {
    const line = blank(columns)
    for (let cx = 0; cx < columns; cx++) {
      const at = cy * 2 * width + cx * 2
      const quarters = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + width] ?? 0, pixels[at + width + 1] ?? 0]
      const mask = quarters.reduce((sum, ink, i) => sum + (ink > 0 ? 1 << i : 0), 0)
      line.chars[cx] = QUADRANTS[mask] ?? ' '
      line.styles[cx] = INKS[Math.max(...quarters)] ?? 'plain'
    }
    return line
  })
}

function blank(columns: number): Cells {
  return { chars: Array<string>(columns).fill(' '), styles: Array<Style>(columns).fill('plain') }
}

function put(line: Cells | undefined, column: number, text: string, style: Style): void {
  if (line === undefined) {
    return
  }
  ;[...text].forEach((char, i) => {
    const cx = column + i
    if (cx >= 0 && cx < line.chars.length) {
      line.chars[cx] = char
      line.styles[cx] = style
    }
  })
}

function center(line: Cells | undefined, text: string, style: Style): void {
  if (line !== undefined) {
    put(line, Math.floor((line.chars.length - [...text].length) / 2), text, style)
  }
}

/** A line of cells as runs of one style each; blanks join whatever run they are in. */
function compress({ chars, styles }: Cells): Line {
  const runs: Run[] = []
  let text = ''
  let style: Style = 'plain'
  let isBlank = true
  chars.forEach((char, i) => {
    if (char === ' ') {
      text += char
      return
    }
    const next = styles[i] ?? 'plain'
    if (next !== style) {
      if (!isBlank) {
        runs.push({ text, style })
        text = ''
      }
      style = next
    }
    text += char
    isBlank = false
  })
  runs.push({ text, style })

  return runs
}
