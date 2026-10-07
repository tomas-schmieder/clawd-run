import { expect, test } from 'claude-code/testing'

import { act, newGame, step, type Game } from '../hooks/clawd'

// An autopilot that plays the way a person would: it jumps cacti and low
// birds as they come close, ducks birds at head height, and lets high ones
// fly over. If it keeps dying, the game is unfair somewhere.

const DT = 1 / 30
const CLAWD_FRONT = 6 + 18 - 2
const CLAWD_BACK = 6 + 2

type Seen = Game['obstacles'][number]

const widthOf = (o: Seen) => (o.kind === 'bird' ? 10 : o.size * 6 + (o.size - 1))

function pilot(game: Game): void {
  const speed = (game.pace * 110) / 6
  const ahead = game.obstacles
    .filter(o => o.x + widthOf(o) > CLAWD_BACK && !(o.kind === 'bird' && o.lift === 7))
    .sort((a, b) => a.x - b.x)[0]
  if (ahead === undefined) {
    return
  }
  const distance = ahead.x - CLAWD_FRONT
  if (ahead.kind === 'bird' && ahead.lift === 4) {
    if (distance < speed * 0.25 && game.duckLeft < 0.1 && !game.isAirborne) {
      act(game, 'duck', true)
    }
    return
  }
  if (distance > 0 && distance < speed * 0.25) {
    act(game, 'jump', true)
  }
}

function play(seconds: number): { score: number; death?: string } {
  const game = newGame(0)
  act(game, 'jump', true)
  for (let t = 0; t < seconds; t += DT) {
    pilot(game)
    step(game, DT, { columns: 120, isWorking: true })
    if (game.phase === 'over') {
      const near = game.obstacles
        .filter(o => o.x < CLAWD_FRONT + 4 && o.x + widthOf(o) > CLAWD_BACK - 4)
        .map(o => `${o.kind}×${o.size}@${o.lift}`)
      return { score: game.score, death: `pace ${game.pace.toFixed(1)} on ${near.join(', ')}` }
    }
  }

  return { score: game.score }
}

test('a careful player can keep going at every pace', { timeoutMs: 60000 }, () => {
  const deaths = Array.from({ length: 40 }, () => play(180)).flatMap(run =>
    run.death === undefined ? [] : [`died at ${run.score}, ${run.death}`],
  )

  expect(deaths).toEqual([])
})
