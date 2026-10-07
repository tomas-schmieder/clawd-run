import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GameProps } from '../types'
import { promptPress, readPost } from './keys'

const presses = atom({ plugin: 'clawd-run', key: 'presses' } as const, { jump: 0, duck: 0, pause: 0 })
const phase = atom({ plugin: 'clawd-run', key: 'phase' } as const, 'idle')
const isOpen = atom({ plugin: 'clawd-run', key: 'isOpen' } as const, false)
const isWorking = atom({ plugin: 'clawd-run', key: 'isWorking' } as const, false)
const isEnabled = atom({ plugin: 'clawd-run', key: 'isEnabled' } as const, true)
const isFaulted = atom({ plugin: 'clawd-run', key: 'isFaulted' } as const, false)
const best = atom({ plugin: 'clawd-run', key: 'best' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clawd-run',
      description: 'Play Clawd Run above the prompt now; on or off to show it while Claude works',
      argumentHint: '[on|off]',
      immediate: true,
    })
    const [storedBest, storedEnabled] = await Promise.all([$.store.get('best'), $.store.get('isEnabled')])
    if (typeof storedBest === 'number') {
      await update($, best, n => Math.max(n, storedBest))
    }
    if (typeof storedEnabled === 'boolean') {
      await update($, isEnabled, () => storedEnabled)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, isWorking, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => false)
    }

    return next(e)
  })

  // The game's keys in the empty prompt box play and go no further, so the
  // box stays empty; any other edit mid-run pauses the game and goes through.
  on('prompt.edit', async ($, e, next) => {
    const [enabled, working, open, current] = await Promise.all([
      read($, isEnabled),
      read($, isWorking),
      read($, isOpen),
      read($, phase),
    ])
    const press = promptPress(e.key?.key, e.text, { isEnabled: enabled, isShown: working || open, phase: current })
    if (press === undefined) {
      return next(e)
    }
    await update($, presses, counts => ({ ...counts, [press.action]: counts[press.action] + 1 }))

    return press.isConsumed ? { text: e.text, cursor: e.cursor } : next(e)
  })

  on('command.run', { command: 'clawd-run' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'off') {
      await update($, isEnabled, () => false)
      await update($, isOpen, () => false)
      await $.store.set('isEnabled', false)
      return { text: 'Clawd Run is off. /clawd-run on brings it back.' }
    }
    if (arg !== '' && arg !== 'on') {
      return { text: 'Usage: /clawd-run to play now, /clawd-run on or off to show it while Claude works.' }
    }
    await update($, isEnabled, () => true)
    await update($, isFaulted, () => false)
    await $.store.set('isEnabled', true)
    if (arg === 'on') {
      return { text: 'Clawd Run is on: it shows above the prompt while Claude works.' }
    }
    await update($, isOpen, () => true)

    return { text: 'Clawd is waiting above the prompt. Press space to play.' }
  })

  on('ui.message', async ($, e) => {
    const post = e.element === 'clawd' ? readPost(e.data) : undefined
    if (post === undefined) {
      return {}
    }
    if (post.phase === 'done') {
      await update($, isOpen, () => false)
      await update($, phase, () => 'idle')
      return {}
    }
    // A run keeps the band open past the turn until the game says it is done.
    // Posts coalesce within a frame, so an end may arrive without its start.
    await update($, phase, () => post.phase)
    if (post.phase !== 'idle') {
      await update($, isOpen, () => true)
    }
    if (post.phase === 'over' && post.score > (await read($, best))) {
      await update($, best, () => post.score)
      await $.store.set('best', post.score)
    }

    return {}
  })

  // The game failed on the surface: say so once and leave it out from here on.
  on('ui.fault', async ($, e, next) => {
    if (e.element === 'clawd') {
      $.ui.log(`Clawd Run stopped: ${e.reason}. /clawd-run starts it again.`)
      await update($, isFaulted, () => true)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }
    const [enabled, faulted, open, pressed, top] = await Promise.all([
      read($, isEnabled),
      read($, isFaulted),
      read($, isOpen),
      read($, presses),
      read($, best),
    ])
    if (!enabled || faulted || e.props.hasSurvey || !(e.props.isWorking || open)) {
      return next(e)
    }
    const { Client } = $.ui.resolve(e)
    const props: GameProps = {
      isWorking: e.props.isWorking,
      jump: pressed.jump,
      duck: pressed.duck,
      pause: pressed.pause,
      best: top,
      columns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
    }

    return <Client key="clawd" module="./game.tsx" width={e.props.bodyColumns} props={props} />
  })
}
