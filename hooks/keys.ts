import type { Phase, Post } from '../types'

/** What a press does: `jump` also starts, restarts and resumes; `pause` only ever pauses. */
export type Action = 'jump' | 'duck' | 'pause'

export type Situation = { isEnabled: boolean; isShown: boolean; phase: Phase }

/** A prompt edit's part in the game, and whether the key is the game's alone. */
export type PromptPress = { action: Action; isConsumed: boolean }

const isSpace = (key: string | undefined) => key === ' ' || key === 'space'

/**
 * What an edit of the prompt box does to the game, if anything.
 *
 * Over an empty box, space plays (starts, jumps, resumes) and, mid-run, s or
 * j ducks and p pauses: those keys are the game's and go no further. Any
 * other edit mid-run pauses the game and goes through, so typing and playing
 * never happen at once. (An empty box walks its history with the arrows and
 * never raises them as edits, so they are no use here; Esc interrupts Claude.)
 */
export function promptPress(key: string | undefined, draft: string, situation: Situation): PromptPress | undefined {
  if (!situation.isEnabled || !situation.isShown) {
    return undefined
  }
  const isEmpty = draft === ''
  if (isEmpty && (isSpace(key) || (situation.phase === 'paused' && key === 'p'))) {
    return { action: 'jump', isConsumed: true }
  }
  if (situation.phase !== 'running') {
    return undefined
  }
  if (isEmpty && (key === 's' || key === 'j')) {
    return { action: 'duck', isConsumed: true }
  }

  return { action: 'pause', isConsumed: isEmpty && key === 'p' }
}

/** What a key does while the game itself has the focus (after a click). */
export function focusedAction(key: string): Action | undefined {
  switch (key) {
    case ' ':
    case 'space':
    case 'up':
    case 'return':
    case 'w':
    case 'k':
      return 'jump'
    case 'down':
    case 's':
    case 'j':
      return 'duck'
    case 'p':
      return 'pause'
    default:
      return undefined
  }
}

/** The game's post, checked: it came from code, so it is input, not a fact. */
export function readPost(data: unknown): Post | undefined {
  if (typeof data !== 'object' || data === null || !('phase' in data)) {
    return undefined
  }
  const { phase } = data
  if (phase === 'idle' || phase === 'running' || phase === 'paused' || phase === 'done') {
    return { phase }
  }
  if (phase === 'over' && 'score' in data && typeof data.score === 'number' && data.score >= 0) {
    return { phase, score: Math.floor(data.score) }
  }

  return undefined
}
