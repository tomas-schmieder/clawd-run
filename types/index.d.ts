/** Where a run stands, as the game reports it to the hooks module. */
export type Phase = 'idle' | 'running' | 'paused' | 'over'

/** Presses taken from the prompt box, counted; the game acts on each increase. */
export type Presses = { jump: number; duck: number; pause: number }

/** What the band hands the game (the `Client` in game.tsx). */
export type GameProps = {
  isWorking: boolean
  jump: number
  duck: number
  pause: number
  best: number
  columns: number
  maxRows: number
}

/** What the game posts back: a change of phase, or that it is done and the band may close. */
export type Post =
  | { phase: 'idle' | 'running' | 'paused' }
  | { phase: 'over'; score: number }
  | { phase: 'done' }

declare module 'claude-code' {
  interface PluginState {
    'clawd-run': {
      presses: Presses
      phase: Phase
      isOpen: boolean
      isWorking: boolean
      isEnabled: boolean
      isFaulted: boolean
      best: number
    }
  }
}
