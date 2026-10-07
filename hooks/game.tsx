import type { ClientModule, ClientSurface, TextProps } from 'claude-code'

import type { GameProps, Presses } from '../types'
import { act, canPlay, draw, FRAME_MS, newGame, step, type Game, type Style } from './clawd'
import { focusedAction, type Action } from './keys'

// The game's own loop, on the drawing thread: it ticks on the surface's frame
// clock and draws every frame itself, so the hooks module only hands it the
// presses taken from the prompt and hears back how a run went.

/** One instance's game, kept by reference; `frame` only makes each redraw a new state. */
type Instance = { game: Game; props: GameProps; seen: Presses; posted: string; frame: number }

type Local = { instance: Instance; frame: number }

type Surface = ClientSurface<Local>

const STYLES: Record<Style, TextProps> = {
  plain: {},
  clawd: { color: 'claude' },
  cactus: { color: 'success' },
  bird: { color: 'warning' },
  cloud: { color: 'subtle', dimColor: true },
  ground: { color: 'subtle' },
  quiet: { color: 'subtle' },
  loud: { bold: true },
  claude: { color: 'claude' },
  done: { color: 'success', bold: true },
}

// Room at the top right for `[ Resume ]` and a space before it.
const BUTTON_COLUMNS = 11

const ClawdRun: ClientModule<GameProps, Local> = (props, surface) => {
  const instance = surface.state?.instance ?? mount(props, surface)
  instance.props = props
  const { game } = instance
  const columns = columnsOf(surface, props)
  const isPlayable = canPlay(columns, props.maxRows)

  // Presses taken from the prompt box arrive as counts that went up.
  for (const action of ['pause', 'jump', 'duck'] as const) {
    if (props[action] > instance.seen[action]) {
      act(game, action, isPlayable)
    }
  }
  instance.seen = { jump: props.jump, duck: props.duck, pause: props.pause }

  const { Box, Button, Text } = surface.elements
  const hasButton = game.phase === 'running' || game.phase === 'paused'
  const lines = draw(game, {
    columns,
    isWorking: props.isWorking,
    isPlayable,
    hudInset: hasButton ? BUTTON_COLUMNS : 0,
  })

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box>
          {line.map(run => (
            <Text {...STYLES[run.style]}>{run.text}</Text>
          ))}
          {i === 0 && hasButton && (
            <Button
              key="pause"
              label={game.phase === 'paused' ? 'Resume' : 'Pause'}
              dimColor
              onPress={() => control(instance, surface, 'pause')}
            />
          )}
        </Box>
      ))}
    </Box>
  )
}

export default ClawdRun

function mount(props: GameProps, surface: Surface): Instance {
  const instance: Instance = {
    game: newGame(props.best),
    props,
    seen: { jump: props.jump, duck: props.duck, pause: props.pause },
    posted: '',
    frame: 0,
  }
  surface.setState({ instance, frame: instance.frame })

  surface.every(FRAME_MS, () => {
    const context = { columns: columnsOf(surface, instance.props), isWorking: instance.props.isWorking }
    const isChanged = step(instance.game, FRAME_MS / 1000, context)
    report(instance, surface)
    if (isChanged) {
      redraw(instance, surface)
    }
  })

  // Once a click gives the game the focus, keys come straight here (Esc hands
  // the focus back to the prompt), and a click on the field jumps; the top
  // row is the scores' and the button's.
  surface.onKey(key => {
    const action = focusedAction(key.key)
    if (action !== undefined) {
      control(instance, surface, action)
    }
  })
  surface.onPointer(event => {
    if (event.type === 'down' && event.y > 0) {
      control(instance, surface, 'jump')
    }
  })

  return instance
}

/** A press made on the game itself, where p and the button resume as well as pause. */
function control(instance: Instance, surface: Surface, action: Action): void {
  const { game, props } = instance
  const isResume = action === 'pause' && game.phase === 'paused'
  act(game, isResume ? 'jump' : action, canPlay(columnsOf(surface, props), props.maxRows))
  redraw(instance, surface)
}

function redraw(instance: Instance, surface: Surface): void {
  instance.frame += 1
  surface.setState({ instance, frame: instance.frame })
}

/** Tells the hooks module when a run starts, pauses or ends, and when the band may close. */
function report(instance: Instance, surface: Surface): void {
  const { game } = instance
  const phase = game.isDone ? 'done' : game.phase
  if (phase === instance.posted) {
    return
  }
  instance.posted = phase
  surface.post(phase === 'over' ? { phase, score: game.score } : { phase })
}

const columnsOf = (surface: Surface, props: GameProps) => surface.columns || props.columns
