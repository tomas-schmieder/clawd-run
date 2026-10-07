import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { focusedAction, promptPress, readPost } from '../hooks/keys'

const band = (isWorking: boolean, maxRows = 20) => ({
  plugin: 'clawd-run',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: maxRows },
    view: {},
  },
})

const command = (args: string) => ({
  command: 'clawd-run',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

/** The engine beneath: its own band (nothing of ours) and a store in memory. */
function engine(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  mock.store(on)
}

type Node = { type: string; props?: { color?: unknown }; children?: unknown[] }

/** The game's drawing as lines of colored runs. */
function linesOf(tree: RenderElement): { text: string; color: unknown }[][] {
  const rows = ((tree as Node).children ?? []) as Node[]
  return rows.map(row =>
    ((row.children ?? []) as Node[]).map(run => ({ text: String(run.children?.[0] ?? ''), color: run.props?.color })),
  )
}

describe('prompt keys', () => {
  const shown = { isEnabled: true, isShown: true, phase: 'idle' as const }
  const running = { ...shown, phase: 'running' as const }
  const paused = { ...shown, phase: 'paused' as const }

  test('space plays from an empty box while the game shows, and only then', () => {
    expect(promptPress('space', '', shown)).toEqual({ action: 'jump', isConsumed: true })
    expect(promptPress('space', '', { ...shown, isShown: false })).toBeUndefined()
    expect(promptPress('space', '', { ...shown, isEnabled: false })).toBeUndefined()
    expect(promptPress('space', 'hi', shown)).toBeUndefined()
    expect(promptPress('a', '', shown)).toBeUndefined()
  })

  test('mid-run, s ducks and p pauses, and the box stays empty', () => {
    expect(promptPress('s', '', running)).toEqual({ action: 'duck', isConsumed: true })
    expect(promptPress('j', '', running)).toEqual({ action: 'duck', isConsumed: true })
    expect(promptPress('p', '', running)).toEqual({ action: 'pause', isConsumed: true })
  })

  test('typing anything else mid-run pauses the game and types', () => {
    expect(promptPress('h', '', running)).toEqual({ action: 'pause', isConsumed: false })
    expect(promptPress('space', 'hi', running)).toEqual({ action: 'pause', isConsumed: false })
    expect(promptPress('s', 'hi', running)).toEqual({ action: 'pause', isConsumed: false })
    expect(promptPress(undefined, '', running)).toEqual({ action: 'pause', isConsumed: false })
  })

  test('paused, space or p resumes and every other key just types', () => {
    expect(promptPress('space', '', paused)).toEqual({ action: 'jump', isConsumed: true })
    expect(promptPress('p', '', paused)).toEqual({ action: 'jump', isConsumed: true })
    expect(promptPress('s', '', paused)).toBeUndefined()
    expect(promptPress('h', 'say ', paused)).toBeUndefined()
  })

  test('a focused game takes the usual keys', () => {
    expect(focusedAction(' ')).toBe('jump')
    expect(focusedAction('up')).toBe('jump')
    expect(focusedAction('down')).toBe('duck')
    expect(focusedAction('p')).toBe('pause')
    expect(focusedAction('q')).toBeUndefined()
  })

  test("the game's posts are checked before they count", () => {
    expect(readPost({ phase: 'over', score: 41.7 })).toEqual({ phase: 'over', score: 41 })
    expect(readPost({ phase: 'over', score: -3 })).toBeUndefined()
    expect(readPost({ phase: 'over' })).toBeUndefined()
    expect(readPost({ phase: 'running' })).toEqual({ phase: 'running' })
    expect(readPost({ phase: 'paused' })).toEqual({ phase: 'paused' })
    expect(readPost('running')).toBeUndefined()
  })
})

describe('band', () => {
  test('is left to the engine while Claude is idle', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(band(false))

    expect((await ui.drawn()).type).toBe('engine')
  })

  test('shows Clawd waiting while Claude works', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(band(true))
    await ui.resize({ columns: 100, rows: 4, in: 'clawd' })

    expect(await ui.find({ type: 'Client', key: 'clawd' })).toBeDefined()
    expect(await ui.find({ in: 'clawd', text: /Press space to play while Claude works/ })).toBeDefined()
    expect(linesOf(await ui.drawn({ in: 'clawd' }))[0]?.[0]?.text).toContain('▐▛███▜▌')
  })

  test('asks for room in a short terminal rather than starting', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(band(true, 6))
    await ui.resize({ columns: 100, rows: 4, in: 'clawd' })
    await ui.key({ key: ' ', in: 'clawd' })
    await ui.advance(200)

    expect(await ui.find({ in: 'clawd', text: /Make the terminal taller/ })).toBeDefined()
  })

  test('space starts a run, Clawd jumps, and a crash records the best', { timeoutMs: 20000 }, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(band(true))
    await ui.resize({ columns: 100, rows: 9, in: 'clawd' })
    await ui.key({ key: ' ', in: 'clawd' })
    await ui.advance(200)

    const lines = linesOf(await ui.drawn({ in: 'clawd' }))
    expect(lines).toHaveLength(9)
    expect(lines[7]?.some(run => run.color === 'claude' && run.text.trim() !== '')).toBe(false)

    // Never jumping again, he runs into the first cactus.
    await ui.advance(8000)
    expect(await ui.find({ in: 'clawd', text: /G A M E {3}O V E R/ })).toBeDefined()

    // The score went back to the hooks module, which hands it to the next game.
    const best = /HI \d{5}/.exec((await ui.find({ in: 'clawd', type: 'Text', text: /HI / }))?.text ?? '')?.[0]
    expect(best).toMatch(/^HI 0*[1-9]\d*$/)
    await ui.unmount()
    const next = await $.ui.mount(band(true))
    await next.resize({ columns: 100, rows: 4, in: 'clawd' })
    expect(await next.find({ in: 'clawd', text: best })).toBeDefined()
  })

  test('the pause button and p freeze the run; space resumes after a count', { timeoutMs: 20000 }, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(band(true))
    await ui.resize({ columns: 100, rows: 9, in: 'clawd' })
    await ui.key({ key: ' ', in: 'clawd' })
    await ui.advance(1000)
    await ui.press({ key: 'pause' })

    const score = async () => /\d{5}$/.exec((await ui.find({ in: 'clawd', type: 'Text', text: /\d{5}\s*$/ }))?.text.trim() ?? '')?.[0]
    const frozen = await score()
    expect(await ui.find({ in: 'clawd', text: /P A U S E D/ })).toBeDefined()
    expect(await ui.find({ in: 'clawd', type: 'Button', key: 'pause' })).toMatchObject({ props: { label: 'Resume' } })
    await ui.advance(5000)
    expect(await score()).toBe(frozen)

    await ui.key({ key: ' ', in: 'clawd' })
    await ui.advance(300)
    expect(await ui.find({ in: 'clawd', text: /P A U S E D/ })).toBeUndefined()
    expect(await score()).toBe(frozen)
    await ui.advance(1000)
    expect(await score()).not.toBe(frozen)

    await ui.key({ key: 'p', in: 'clawd' })
    expect(await ui.find({ in: 'clawd', text: /P A U S E D/ })).toBeDefined()
  })

  test('closes a few seconds after Claude is done and the run is over', { timeoutMs: 20000 }, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(band(true))
    await ui.resize({ columns: 100, rows: 9, in: 'clawd' })
    await ui.key({ key: ' ', in: 'clawd' })
    await ui.advance(8000)
    await ui.redraw(band(false).props)

    expect(await ui.find({ in: 'clawd', text: /Claude is done/ })).toBeDefined()
    await ui.advance(4500)
    expect((await ui.drawn()).type).toBe('engine')
  })

  test('/clawd-run off keeps it away, /clawd-run opens it while idle', async ($, on) => {
    engine(on)
    await $.command.run(command('off'))
    const off = await $.ui.mount(band(true))
    expect((await off.drawn()).type).toBe('engine')

    await $.command.run(command(''))
    const idle = await $.ui.mount(band(false))
    await idle.resize({ columns: 100, rows: 4, in: 'clawd' })
    expect(await idle.find({ in: 'clawd', text: /Press space to play/ })).toBeDefined()
  })
})
