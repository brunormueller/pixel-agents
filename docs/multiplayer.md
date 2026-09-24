# Multiplayer

Multiplayer lets several offices share their agents. Each office — a VS Code
window or an `npx pixel-agents` server — joins a **room** on a **relay**. It
publishes a summary of its own agents there and draws everyone else's agents as
characters in its own office.

It is off unless you configure it.

## What leaves your machine

Each office publishes this per agent, and nothing else:

| Field           | Example   | Purpose                                                   |
| --------------- | --------- | --------------------------------------------------------- |
| `id`            | `3`       | Keeps the same character between updates                  |
| `palette`       | `2`       | Which character sprite to draw                            |
| `hueShift`      | `90`      | Sprite hue variation                                      |
| `status`        | `active`  | `active` or `waiting` (idle)                              |
| `activity`      | `reading` | `typing`, `reading` or `null`: which animation is playing |
| `permission`    | `false`   | A permission prompt is open (amber bubble)                |
| `awaitingInput` | `false`   | The agent is idle and waiting for its user                |

Your office also sends the **display name** you pick, which is shown above your
characters in other offices.

Tool names, tool arguments, file paths, shell commands, prompts, transcript
content and workspace folder names are **never** sent. The relay keeps no
history: it holds each connected office's latest summary in memory and drops
it as soon as that office disconnects.

## Run a relay

```bash
npx pixel-agents relay                          # ws://127.0.0.1:4100/
npx pixel-agents relay --host 0.0.0.0 --port 4100
```

- The relay binds to `127.0.0.1` by default. Use `--host 0.0.0.0` to reach it
  from other machines on your network.
- **The room name is the only access control.** Anyone who can reach the relay
  and knows the room name can see the summaries in that room and add
  characters to it. Use a long random room name, for example
  `openssl rand -hex 16`.
- When the relay is reachable from outside a trusted network, put it behind a
  TLS reverse proxy (Caddy, nginx) and have peers use `wss://`. The relay
  itself speaks plain `ws://`.
- Limits: 32 offices per room, 32 agents per office, 16 KB per frame, 20
  updates per second per office. Offices that stop answering pings are
  dropped after 30–60 s.
- `GET /health` returns `{ ok, protocol, rooms }`.

## Join a room

### Standalone (`npx pixel-agents`)

```bash
npx pixel-agents --relay wss://relay.example.com --room 3f9c…e1 --name "Ana"
```

`--name` defaults to your OS user name. The flags take precedence over
`multiplayer.json`.

With `--relay`, the command always starts its own server and office page, even
when another `pixel-agents` server is already running. That lets you run two
offices on one machine to try multiplayer. Start each one from a different
folder, because an office adopts the Claude Code sessions of the folder it was
started in. Without `--relay`, a second `npx pixel-agents` reuses the running
server, and only that server's `config.json` setting decides whether it joins a
room.

### VS Code, or standalone without flags

Create `~/.pixel-agents/multiplayer.json` (on Windows,
`%USERPROFILE%\.pixel-agents\multiplayer.json`):

```json
{
  "relayUrl": "wss://relay.example.com",
  "room": "3f9c…e1",
  "displayName": "Ana"
}
```

It is a separate file rather than a key in `config.json` on purpose.
Pixel Agents rewrites `config.json` from the fields it knows, and released
versions that predate multiplayer, such as the Marketplace extension running in
another window, would drop the key on their next write.

Reload the VS Code window, or restart `npx pixel-agents`, to apply the change.
Each VS Code window joins the room as its own office. To leave the room,
delete the file.

If the file is invalid, multiplayer stays off and a warning is logged. The URL must start with
`ws://` or `wss://`, and the room must not be empty.

## How it looks

- Remote characters appear with the spawn effect and take free seats in
  **your** layout. Positions never travel, because every office has its own
  layout. They only take seats that are free when they arrive, so they never move
  your own agents.
- Hover or select a remote character to see its office's name and its coarse
  activity: _Working_, _Reading_, _Thinking_, _Needs approval_, _Waiting for
  input_ or _Idle_.
- Clicking a remote character does not focus a terminal, because that
  terminal is on someone else's machine. It has no close button and is never
  saved to your seat assignments.
- If the relay connection drops, remote characters leave. The office
  reconnects with backoff (1 s up to 30 s), and they return on reconnect.

## Protocol

The relay speaks JSON frames over one WebSocket at `/`. Each frame has a `t`
discriminator. `server/src/multiplayer/protocol.ts` is the reference
implementation, and both ends sanitize every frame they receive.

| Direction      | Frame                                            |
| -------------- | ------------------------------------------------ |
| office → relay | `{ t: 'hello', v: 1, room, name }` (first frame) |
| office → relay | `{ t: 'state', agents: RemoteAgent[] }`          |
| relay → office | `{ t: 'welcome', peerId, peers: Peer[] }`        |
| relay → office | `{ t: 'peer', peer: Peer }`                      |
| relay → office | `{ t: 'leave', peerId }`                         |
| relay → office | `{ t: 'error', reason }`                         |

The office forwards the relay's picture to its UI as the `remotePeers`
ServerMessage in `core/asyncapi.yaml`, where `RemoteAgent` is defined.
