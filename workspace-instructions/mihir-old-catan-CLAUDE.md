# CLAUDE.md — Catan Project

This is a 3-player Catan board game (localhost web app) with AI opponents powered by Claude CLI.

## Quick Start

```
python run.py
```

Installs deps, starts FastAPI/uvicorn on `localhost:8080`, opens browser.

## Tech Stack

- **Backend**: Python 3.14, FastAPI, uvicorn, Pydantic, WebSocket
- **Frontend**: Vanilla HTML/CSS/JS, SVG board rendering (no build step)
- **AI**: Claude CLI (`claude -p --output-format json`) via `asyncio.subprocess`

## Project Structure

```
backend/         Python game engine + API
  board.py       Hex grid (axial coords), vertices, edges, ports
  game.py        State machine: setup → main → game_over
  rules.py       Move validation, longest road, distance rule
  player.py      Player state (resources, dev cards, buildings)
  dev_cards.py   25-card deck + card effects
  trade.py       Bank/port/player trading
  ai_agent.py    Claude CLI subprocess wrapper
  app.py         FastAPI + WebSocket handler
  models.py      Pydantic schemas
frontend/        Static SPA served by FastAPI
  js/            Board renderer, game controller, UI, constants
  css/           Styles
  index.html     Entry point
tests/           Integration + rule parity tests
run.py           Single-command launcher
```

## Key Concepts

### Hex Coordinates (Axial)
- Hex ID: `"q,r"` (e.g. `"2,3"`)
- Vertex ID: sorted pipe-separated hex coords (e.g. `"0,0|0,1|1,0"`)
- Edge ID: sorted dot-separated vertex IDs

### Game Phases
- `setup` → snake draft (P0→P1→P2→P2→P1→P0)
- `main` → turn sub-phases: `pre_roll`, `robber_discard_pending`, `robber_move_pending`, `action_phase`
- `game_over` → winner determined

### Rules Enforced
- Distance rule, road connectivity for settlements
- One dev card per turn, can't play card bought same turn
- Multi-player discard queue on roll 7
- Robber must move to different hex, steal only from adjacent players with cards
- Port trade requires settlement/city on harbor edge
- Longest Road with opponent-building interruption
- Largest Army with strict-greater transfer
- Immediate win checks after every state change

## Running Tests

```
python tests/test_game_flow.py
python -c "from tests.test_rules_parity import *; test_settlement_requires_road_connection_in_main_phase(); test_robber_discard_queue_all_players(); test_dev_card_one_per_turn(); test_port_trade_requires_harbor_ownership(); print('OK')"
```

## Conventions

- Backend: Python dataclasses for models, no ORM, in-memory state
- Frontend: IIFE modules exposing globals (`BoardRenderer`, `GameController`, `UI`)
- WebSocket JSON protocol: `type` field routes messages
- All game logic is server-authoritative; client only renders and dispatches
