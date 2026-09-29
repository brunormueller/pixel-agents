# Multiplayer

Multiplayer turns offices into one shared place. Each office — a VS Code window
or an `npx pixel-agents` server — joins a **room** on a **relay**. Everyone in
the room sees the same office map, with one character per person: you walk it
with the keyboard, and when your Claude agent starts working, that same
character goes to your desk and types.

It is off unless you configure a relay.

## What leaves your machine

Each office publishes this per character, and nothing else:

| Field           | Example   | Purpose                                                         |
| --------------- | --------- | --------------------------------------------------------------- |
| `id`            | `3`       | Keeps the same character between updates (`0` = you, no agent)  |
| `palette`       | `2`       | Which character sprite to draw                                  |
| `hueShift`      | `90`      | Sprite hue variation                                            |
| `status`        | `active`  | `active` or `waiting` (idle)                                    |
| `activity`      | `reading` | `typing`, `reading` or `null`: which animation is playing       |
| `permission`    | `false`   | A permission prompt is open (amber bubble)                      |
| `awaitingInput` | `false`   | The agent is idle and waiting for its user                      |
| `isAvatar`      | `true`    | This character is the person                                    |
| `pose`          | `{x,y,…}` | Where it stands on the shared map, and whether it walks or sits |

Your office also sends:

- the **display name** you type on the join screen, shown under your character;
- the **desk** you chose (a chair's id on the shared map);
- the **chat messages you type** (see [Chat](#chat)), carrying only their text;
- your **profile** (see [You in the room](#you-in-the-room)): the look you picked
  for your character, your status (`available`, `busy`, `meeting`, `away`) and
  status message, your desk decoration (catalog ids placed relative to your
  desk), and — only while you turn sharing on — the title and artist of the song
  playing on Spotify, with its public `open.spotify.com/track/…` link;
- if you **created** a room that had no map yet, your **office layout** (tiles,
  furniture, colors), and afterwards every **edit you make to the room's map**.
  Area labels, which are named after your workspace folders, and pets are
  stripped before it leaves;
- while you are in a **meeting** (see [Meetings](#meetings)): the meeting's id
  and title, whether your mic and camera are on, the ids of the screens you
  share, a raised hand, whether you record or are transcribed, the meeting's
  music choice, and what you say in it on purpose (its chat, your reactions, the
  sentences transcribed from your own voice if you agreed, notes you share). The
  audio, video and screens themselves go **browser to browser** and never pass
  through the relay;
- while you play a **match** (see [Games](#games)): the match's id, title and
  setup (map, bots, limits), your character's palette, and — to the other players
  of that match only — where your player stands and faces, its health, weapon and
  shots, who you hit, and when you die. The match's host also sends its bots'
  positions, the score and, on an office map, the map (walls, floors, desks and
  furniture types of the floor on its screen, the same tiles the room map has).

Tool names, tool arguments, file paths, shell commands, prompts, transcript
content and workspace folder names are **never** sent. Neither are your calendar
events, your calendar addresses or your Spotify sign-in: the most a calendar
tells the room is the `meeting` status while an event is in progress. The relay keeps no
history: it holds each connected office's latest summary and the room's layout
in memory, and forgets them once the room is empty. Chat messages pass straight
through the relay and are not stored there at all.

## Run a relay

```bash
npx pixel-agents relay                          # ws://127.0.0.1:4100/
npx pixel-agents relay --host 0.0.0.0 --port 4100
```

- The relay binds to `127.0.0.1` by default. Use `--host 0.0.0.0` to reach it
  from other machines on your network.
- `--ice-servers turn.json` hands every office a STUN/TURN list for meetings
  (see [Meetings → Networks](#networks-stun-and-turn)).
- **Room maps are kept on disk**, so a room keeps its map after everyone left
  and across relay restarts: one file per room in `~/.pixel-agents/relay-rooms/`
  (mode 0600), named by a hash of the room name. Only the map is kept — never
  who was in the room, what was said or what anyone's agents did. At most 500
  maps are kept; the ones edited longest ago go first. `--rooms-dir <dir>` keeps
  them elsewhere; `--no-save-rooms` keeps them in memory only (a room forgets its
  map once everyone left). Delete a file to reset that room's map.
- **The room name is the only access control.** Anyone who can reach the relay
  and knows the room name can see the summaries in that room and add
  characters to it. Use a long random room name, for example
  `openssl rand -hex 16`.
- When the relay is reachable from outside a trusted network, put it behind a
  TLS reverse proxy (Caddy, nginx) and have peers use `wss://`. The relay
  itself speaks plain `ws://`.
- Limits: 32 offices per room, 32 characters per office, 16 KB per frame (512 KB
  for a layout), 20 updates per second per office, 8 map edits per 2 s per
  office, 5 chat messages per 10 s per office, 280 characters per chat message.
  Offices that
  stop answering pings are dropped after 30–60 s.
- `GET /health` returns `{ ok, protocol, rooms }`.

### Run a relay in Docker

`Dockerfile.relay` builds the relay from source (no webview, no VS Code parts).
It listens on `ws://0.0.0.0:4100/` and keeps room maps in the `/data` volume:

```bash
docker build -f Dockerfile.relay -t pixel-agents-relay .
docker run -d -p 4100:4100 -v pixel-relay-data:/data pixel-agents-relay
```

Behind an nginx that already serves other things on one host and port, give
the relay a path of its own. The trailing `/` on `proxy_pass` strips the
prefix, since the relay answers on `/` (and `/health`):

```nginx
# in http {}: map $http_upgrade $connection_upgrade { default upgrade; '' close; }
location /pixel-relay/ {
  proxy_pass http://pixel-relay:4100/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Host $host;
  proxy_buffering off;
  proxy_read_timeout 300s;   # the relay pings every 30 s
  proxy_send_timeout 300s;
}
```

Offices then use `wss://your.host/pixel-relay/` — **with the trailing slash**:
nginx answers `/pixel-relay` with a redirect, and WebSocket clients don't follow
redirects. For meetings across strict networks, mount a TURN list and pass it
on (`command:` replaces the default arguments, so repeat them):
`--host 0.0.0.0 --port 4100 --rooms-dir /data/relay-rooms --ice-servers /config/ice-servers.json`.

## Join a room

Every office can join a room: the toolbar's **Join room** opens the **join
screen**, which asks for your name, the room and — when the office knows no relay
yet — the relay's address (**Server**). Everything is prefilled with what you
typed last time (remembered in `~/.pixel-agents/multiplayer-profile.json`).
When the office already knows a relay, the join screen opens by itself at
start and shows it as one line with a **change** link; **Work alone** skips it.

The relay comes from, newest first: `--relay` (standalone), the one typed on the
join screen, `~/.pixel-agents/multiplayer.json`, and the build's default. Joining
never happens by itself (except with `--room`): configuring a relay only
prefills the screen.

### A team build (VS Code extension with the relay built in)

Build the extension with the team's relay, and people only install it and type
their name and the room:

```bash
PIXEL_AGENTS_DEFAULT_RELAY=wss://relay.example.com npx @vscode/vsce package --no-dependencies -o pixel-agents-team.vsix
```

Install it with **Extensions → … → Install from VSIX…** (or
`code --install-extension pixel-agents-team.vsix`). It has the same id as the
Marketplace extension, so it replaces that one; turn off **Auto Update** for it
so the Marketplace does not put the other one back. The same variable works for
`npm pack` (the standalone package) and, unbundled, at run time.

### Standalone (`npx pixel-agents`)

```bash
npx pixel-agents --relay wss://relay.example.com
```

Add `--room 3f9c…e1` (and optionally `--name "Ana"`) to join right away without
the join screen. The flags take precedence over `multiplayer.json`.

With `--relay`, the command always starts its own server and office page, even
when another `pixel-agents` server is already running. That lets you run two
offices on one machine to try multiplayer. Start each one from a different
folder, because an office adopts the Claude Code sessions of the folder it was
started in. Without `--relay`, a second `npx pixel-agents` reuses the running
server, and only that server's settings decide whether it offers a room.

### multiplayer.json

Instead of typing it, a relay can be set in `~/.pixel-agents/multiplayer.json` (on Windows,
`%USERPROFILE%\.pixel-agents\multiplayer.json`):

```json
{
  "relayUrl": "wss://relay.example.com"
}
```

`room` and `displayName` may be added too; they only prefill the join screen.

It is a separate file rather than a key in `config.json` on purpose.
Pixel Agents rewrites `config.json` from the fields it knows, and released
versions that predate multiplayer, such as the Marketplace extension running in
another window, would drop the key on their next write.

Reload the VS Code window, or restart `npx pixel-agents`, to apply the change.
Each VS Code window is its own office. A relay typed on the join screen wins over
the file.

If the file is invalid, it is ignored and a warning is logged. The URL must
start with `ws://` or `wss://`. `iceServers` (STUN/TURN for meetings) can only be
set here.

## How it works in the room

- **One map, everyone edits it.** A room that has no map yet starts with the
  layout of whoever creates it; from then on everyone in the room sees the
  room's map instead of their own, and their own `layout.json` is never touched.
  Anyone in the room can open **Layout** and change it: every edit shows up for
  everyone at once, and whoever joins later gets the map as it is now — even
  after everyone left, since the relay keeps it (see
  [Run a relay](#run-a-relay)). While you are in a room, **Save** in the editor
  only moves the point **Reset** goes back to: your edits are already in the
  room. **Undo** takes back your own edits, never someone else's.
- **Editing at the same time** works: the relay numbers the map's versions and
  refuses an edit made on a version that has moved on, and the office then
  merges the newer map into yours and sends again, so nobody's change is lost.
  Two edits of the same thing (the same tile, the same piece of furniture) keep
  the later one. Reshaping the grid (growing a floor, adding or removing one)
  wins over a tile painted at the same moment somewhere else.
- **Your character.** Joining puts you in the office, and a desk picker marks
  every chair: green is free, red is taken. Pick one, or **Later**; the **Desk**
  button reopens it. Your name shows under your character.
- **You and Claude share the character.** While Claude is idle, the arrow keys
  (or WASD) walk it. When Claude starts working, the character goes to your desk
  and types or reads; the keys do nothing then, and a hint says so. When Claude
  finishes, the character stays at the desk until you walk away. If you have more
  Claude agents, the extra ones sit at the free chairs closest to your desk.
- **Other people** walk and sit where their own office puts them, on the same
  map. Their desks are taken for you. If two people grab the same desk at once,
  whoever joined the room first keeps it, and the other is asked to pick again.
- Clicking another person's character does not focus a terminal, because that
  terminal is on someone else's machine. It has no close button and is never
  saved to your seat assignments.
- **Leave** takes you out of the room: your own layout comes back and the other
  people's characters go.
- If the relay connection drops, other people's characters leave and your own
  layout comes back. The office reconnects with backoff (1 s up to 30 s).

An office on an older version still shows up: it sends no positions, so its
agents take free chairs on your map as before, and it keeps its own layout.
With an **older relay**, rooms work as before: the room's creator is the only
one who edits the map (it keeps showing its own layout), everyone else sees it
read-only, and the room forgets it once empty. Update the relay to let everyone
edit.

### Floors

A room's map can have several floors. Anyone in the room builds them in the layout
editor: **+ Up** / **+ Down** in the **Floors** panel (top left) adds a floor
with the same walls and floors as the one on screen, double-click renames it,
▲ ▼ reorder it, **x** removes it. Place **Stairs** (Furniture → Misc) and their
other end appears on the floor above (or below), at the same spot; place an
**Elevator** (Furniture → Wall) on a wall and a door appears on every floor.
Select one to choose where the stairs lead, or which floors the elevator stops
at. Up or down follows the floors' order.

Everyone sees one floor at a time; the **Floors** panel shows how many people
are on each and where you are (●). Walk up to the stairs or the elevator door
and keep pushing toward it to ride; an elevator with several stops asks which
floor. Your view goes with you. Claude takes the stairs on its own when your
desk is on another floor, and idle agents sometimes go to play upstairs.

**Doors**: pick **Door** (Furniture → Wall) and click a wall between two wall
tiles — the wall there becomes a doorway and the door turns to fit a wall
running across or down. It opens by itself when someone walks through. Select
it and use **Color** to paint it.

Floors need the relay updated too: an older relay refuses maps wider than 64
tiles, so the other people keep seeing their own layout.

### Known limits

- Edits made while the relay connection is down are lost: the office shows your
  own layout until it reconnects, then the room's map again.
- In standalone, keep one tokened page per office open: every tokened page
  reports where your characters are, so two would contradict each other.

## Emotes

The **Emote** button (or the number keys) plays an emote on your character, and
everyone in the room sees it:

| Key | Emote | What happens                                                   |
| --- | ----- | -------------------------------------------------------------- |
| 1   | Dance | Sways, steps and bounces with music notes; press again to stop |
| 2   | Wave  | 👋 floats up                                                   |
| 3   | Heart | ❤️ floats up                                                   |
| 4   | Clap  | 👏 floats up                                                   |
| 5   | Laugh | 😂 floats up                                                   |
| 6   | Party | 🎉 floats up while the character bounces                       |
| 7   | Jump  | Three hops                                                     |
| 8   | Spin  | A quick spin                                                   |

Reactions (2–6) work any time, even while Claude is working. Dance, jump and
spin move the character, so they need it free: not while Claude is working (a
hint says so), and they stand it up from the desk. Walking off, or Claude
starting to work, ends a dance.

Emotes are a visual layer only: the character's facing, stride and a hop are
drawn over whatever it is doing, and the pose carries `emote` + `emoteSeq` so
other offices replay it (a new `emoteSeq` replays the same emote again).

## Chat

When the office is in a room, the bottom toolbar shows a **Chat** button. It
opens a panel on the right with the room's messages and an input box. A badge on
the button counts the messages from other offices that arrived while the panel
was closed.

- A new message pops a speech bubble over the sender's character. The bubble
  types the text out, stays a few seconds (longer for longer messages), then
  fades.
- The relay sends each message back to its sender too. A message you sent shows
  up in your panel only once the relay has delivered it, so an unreachable relay
  never looks like a sent message.
- History lives in your office's memory only, capped at the last 100 messages.
  Reloading the panel brings it back. Restarting the office clears it, and an
  office that joins later does not see earlier messages.
- In standalone, only a page opened with the tokened URL can send, join, leave
  or move. An untokened page can still watch, but it cannot act in your name.

## You in the room

The **You** menu, the **Status** button and the **People** button appear on the
toolbar once you are in a room. Everything below is saved in
`~/.pixel-agents/multiplayer-profile.json`, so it comes back on the next start
and in the other surface (VS Code or standalone).

- **Customize character**: a body (skin, hairstyle, cut of the clothes), hair
  color, top and bottom colors (suits and dresses are one piece), and an
  accessory — cap, beanie, top hat, crown, party hat, headphones, glasses,
  sunglasses, flower, bow or halo. The preview walks and turns; everyone in the
  room sees the result. **Automatic** goes back to the character the office picks.
- **Status**: Available, Busy, In a meeting or Away, plus an optional message of
  your own (60 characters). It shows as a colored dot and a line under your name.
  With a calendar connected, an event in progress reads as _In a meeting_ while
  you are Available (see [Calendar](#calendar)).
- **People**: who is in the room, with their status, what they listen to and how
  many of their agents are working. **Locate** centers the view on someone, **Go
  to** walks your character over to them, **Follow** keeps walking after them
  until you press an arrow key (or Claude takes your character to work).
- **Decorate desk**: pick an item from the catalog and put it down on the map.
  Desk items — monitors, a code monitor, laptop, keyboard, mouse, robot arm, desk
  lamp, mug, pie… — go anywhere on your tabletop, to the pixel: a ghost follows
  the mouse, green where the item's base rests on the tabletop (the rest may
  overhang), and items nearer the front edge draw over the ones behind. They come
  turned toward your chair (screen facing you from the front, the back or the
  side); **R** turns the one in hand. Plants and bins snap to the floor, clocks
  and paintings to the wall. On the map, click one of your items to move it and
  right-click to remove it. Up to 12 items. They are anchored to your desk's
  chair, so they move with you when you change desks, and every office in the
  room draws them. Your desk in each room is remembered, so the decoration is
  back after a reload.
  - **Studio desk** (top of the panel) sets the whole desk up in one click: a
    curved white desk, an office chair, the computer that came with the desk taken
    off, a robot arm, PC tower, a wide and a portrait monitor, keyboard, mouse, a
    pie on the desk and a fig on a stand beside it — turned for wherever your
    chair is. Change anything afterwards.
  - **Desk style** draws your own desk and chair as a curved or office desk
    (white top, slate front) with a dark office chair, for everyone, without
    touching the room's layout. Anyone in the room can also build with these desks
    and chairs in the layout editor (`CURVED_DESK`, `OFFICE_DESK`, `OFFICE_CHAIR`,
    in 4-, 3- and 2-tile sizes).
  - **The computer that came with the desk** (or any item the room put on it):
    click it to take it off and move it, right-click to just remove it; _Taken off
    your desk_ in the panel puts it back. Only items on your own desk.

  The catalog has a desk setup, plants, office items, ornaments,
  **special** items (trophy, birthday cake) and **seasonal** ones offered only
  around their date: Carnival (Feb 1 – Mar 10), Valentine's (Feb 1–14, Jun 1–12),
  Easter (Mar 15 – Apr 30), Festa junina (Jun – Jul), Spring (Sep 20 – Oct 31),
  Halloween (Oct 1 – Nov 2), Christmas (Dec 1 – Jan 6) and winter (Dec – Jan).
  A seasonal item you placed stays after its season.

## Calendar

The **Calendar** button (always there, room or not) shows your meetings for the
next 24 hours with a **Join** button on every video call (Google Meet, Teams,
Zoom, Webex, Whereby, Jitsi…). Five minutes before a call starts, a toast offers
to join it. In a room, joining also walks your character to the office's meeting
place (beside a whiteboard or a table), and while the event runs the room sees
you _In a meeting_ (turn that off in the panel).

Connect a calendar with its **secret iCal address**:

- **Google Calendar**: Settings → your calendar → _Integrate calendar_ → _Secret
  address in iCal format_.
- **Outlook / Microsoft 365**: Settings → Calendar → _Shared calendars_ →
  _Publish a calendar_ (Can view all details) → copy the _ICS_ link.

The address is a read password for your calendar. It is kept in
`~/.pixel-agents/calendar.json` (owner-only), fetched every 5 minutes over
https, and never sent to the UI (it only shows the host). Recurring events,
exceptions, time zones (including Outlook's Windows names) and all-day events
are understood.

## Music

The **Music** button connects **Spotify**: what is playing, play/pause/skip
(Spotify Premium) and, in a room, **Show the room what I am listening to**
(off by default), which puts `♪ Artist – Song` under your name.

Pixel Agents ships no Spotify credentials: you use your own Spotify app.

1. Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard)
   (tick _Web API_).
2. Add the redirect URI `http://127.0.0.1:43117/spotify/callback`.
3. Paste the app's **Client ID** in the panel and connect. The browser opens the
   Spotify sign-in; the office listens on that loopback port only until you finish.

The sign-in uses OAuth with PKCE (no client secret). The tokens stay in
`~/.pixel-agents/spotify.json` (owner-only) and never reach the UI.

## Meetings

Video calls inside the room. The **Meet** button (in a room) lists the calls
going on and starts a new one. Joining walks your character to the office's
meeting place, and while you are in a call the room sees you _In a meeting_ and a
📞 next to your name.

The call opens over the office: people's cameras in a grid, or — when someone
shares — the screens side by side with the cameras in a strip below. Click a tile
to pin it big. **▁ Office** (or Esc) shrinks the call to a strip of small tiles
along the top of the office, so you can keep walking around while you talk.

| Button     | What it does                                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mic        | Mute / unmute. Muted keeps the device open (unmuting is instant) but sends silence.                                                                                                                                                                                                                                                          |
| Camera     | On / off. Off releases the camera.                                                                                                                                                                                                                                                                                                           |
| Share      | Share a screen, window or tab — _…with its sound_ shares its audio too (Chrome, Edge). Up to 4 screens per person at once, and everyone can share at the same time: every screen shows up side by side.                                                                                                                                      |
| React      | 👍 ❤️ 😂 😮 👏 🎉 🙌 👋 float over your tile. Those with a matching emote (wave, heart, clap, laugh, party) also play on your character, for the whole room.                                                                                                                                                                                 |
| Hand       | Raise / lower. The People tab lists raised hands in the order they went up.                                                                                                                                                                                                                                                                  |
| Chat       | The meeting's own chat, seen only by the people in the call.                                                                                                                                                                                                                                                                                 |
| Transcript | Live captions and the transcript (download it as `.md`).                                                                                                                                                                                                                                                                                     |
| Notes      | **Write notes with Claude**: your own Claude Code (`claude -p`, no tools, nothing saved as a session) writes a summary, decisions, action items and open questions from the transcript and chat, in the language the meeting was held in. The notes are shared with the call and saved, with the transcript, in `~/.pixel-agents/meetings/`. |
| People     | Who is in the call (mic, camera, screens, hand, connection) and **Invite** for the people in the room who are not — they get a toast with **Join**.                                                                                                                                                                                          |
| Record     | Records the call — every camera and screen composed into one video, with everyone's sound and the music — to a `.webm` saved on your computer when you stop. Everyone in the call sees **● REC** with your name while you record.                                                                                                            |
| CC         | Turns transcription on or off for the whole call (see below).                                                                                                                                                                                                                                                                                |
| Music      | Background music everyone in the call hears **in sync**: five built-in chiptune tracks (lo-fi, bossa, arcade, synthwave, ambient), generated live — no account, nothing streamed. Each person sets their own volume. Anyone can change or stop it for everyone.                                                                              |
| ⚙          | Microphone, camera and speaker.                                                                                                                                                                                                                                                                                                              |

### Transcription

Each person transcribes **their own voice**, with the browser's speech
recognition, so every line has the right name. When someone turns captions on,
everyone else is asked whether to transcribe them too; saying no only means your
voice is not transcribed. Nothing is transcribed while you are muted. Chrome and
Edge send the audio to Google's or Microsoft's speech service to do it (Safari
works on the device; Firefox has no speech recognition, but still shows the
others' captions). Pick the language you speak in the Transcript tab.

### Where it works

- **Standalone (`npx pixel-agents`)**, in Chrome, Edge, Firefox or Safari, opened
  from the tokened `http://127.0.0.1…` URL: everything. Browsers only allow the
  camera and microphone on https or on the machine itself.
- **VS Code**: its webviews may not open the camera, microphone or screen. You
  can join, see and hear the others, chat and react; to talk, click **Web** in
  the toolbar. It copies a link that opens **this window's office** in the
  browser (and offers to open it): a loopback server of the window's own, with a
  token of its own that controls the office, so keep the link private. While
  that page is open it is the person's page: the panel stops publishing its
  position and meeting presence, leaves any call and says the office is open in
  the browser; closing the tab hands it back. Hooks stay the panel's business
  (the page asks no consent).

### Networks: STUN and TURN

A call is a mesh: every browser connects to every other one directly (fine for
the handful of people in a room). To find a way through home routers, browsers
ask a public STUN server (Google's, by default). That works for most networks,
but some — corporate firewalls, carrier-grade NAT — let no direct connection
through, and a tile then says _no connection_. For those, give the relay a
**TURN** server, which forwards the media when nothing else works:

```json
[
  { "urls": ["stun:stun.l.google.com:19302"] },
  {
    "urls": ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
    "username": "team",
    "credential": "secret"
  }
]
```

```bash
npx pixel-agents relay --ice-servers turn.json
```

Every office in the relay's rooms gets that list. An office can add its own in
`~/.pixel-agents/multiplayer.json` (`"iceServers": [...]`, same shape). Run your
own TURN with [coturn](https://github.com/coturn/coturn), or use a hosted one.
The relay tunnel alone (e.g. a `trycloudflare.com` URL) carries only the
signaling, never media.

To see what a call is doing, run `localStorage['pixelAgents.meetingDebug'] = '1'`
in the browser console and reload: the negotiation is logged.

## Games

The **Games** button (always there, in a room or not) opens the games you can
play from the office. The first is **Pixel Frag**, a first-person shooter drawn
in pixels.

- **Play solo**: you against bots, no room needed (VS Code or standalone). The
  game pauses while its menu is open.
- **Host in the room**: starts a match everyone in the room can join from their
  own Games panel (a 🎮 appears next to the players' names). The match goes on
  while you are in the menu.

| Setting    | Choices                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map        | **Your office** — the floor on screen: its walls stand, desks become waist-high blocks you shoot over, the rest of the furniture stands in the room — or the built-in **Arena**, **Maze** and **Warehouse** |
| Bots       | 0 to 8 computer players, **Easy**, **Normal** or **Hard**                                                                                                                                                   |
| Frag limit | 5, 10, 20 or none: the first to reach it wins the round                                                                                                                                                     |
| Time limit | 3, 5, 10 minutes or none                                                                                                                                                                                    |

A round ends at the frag limit or the time limit; the scoreboard shows for a few
seconds and the next round starts. Everyone plays their own character: the look
you picked (or your agent's palette) is what the others see.

**Controls**: click the game to catch the mouse (Esc lets it go and opens the
menu). WASD or the arrows move, the mouse (or Q E / ← →) turns, click or Space
fires, Shift runs, 1-3 or the wheel switch weapon (pistol, shotgun, chaingun),
Tab shows the scoreboard, M the minimap. Health packs, shells and bullets lie
around the map and come back 20 s after someone takes them. Where the page cannot
catch the mouse, turn with the keys or by dragging with the right button held.
Mouse sensitivity, field of view, volume and the minimap are in the menu, and
remembered in that browser.

**How a match works**: nothing new runs anywhere. Each office moves its own
player, resolves its own shots against what it sees and tells the target it was
hit; the target decides whether it died. The player who joined first hosts the
match (bots, score, clock); if they leave, the next player takes over where it
was. The relay passes the match's frames to its players only. An office too old
to know games simply does not see the match; an old relay drops its frames, so
update the relay with the offices.

## Protocol

The relay speaks JSON frames over one WebSocket at `/`. Each frame has a `t`
discriminator. `server/src/multiplayer/protocol.ts` is the reference
implementation, and both ends sanitize every frame they receive. Unknown frames
and fields are ignored on both ends, so older peers and relays keep working.

| Direction      | Frame                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| office → relay | `{ t: 'hello', v: 1, room, name }` (first frame)                                        |
| office → relay | `{ t: 'state', agents: RemoteAgent[], desk, profile, meeting? }`                        |
| office → relay | `{ t: 'chat', text }`                                                                   |
| office → relay | `{ t: 'layout', layout, base, id }` (an edit made on revision `base`)                   |
| office → relay | `{ t: 'signal', to, data }` (WebRTC offer/answer/candidate, invite)                     |
| office → relay | `{ t: 'meet', ev: { kind, text } }` (chat, reaction, caption, notes)                    |
| office → relay | `{ t: 'play', ev: { k, … } }` (a frame of the sender's match)                           |
| relay → office | `{ t: 'welcome', peerId, since, peers: Peer[], layout, layoutOwner, rev, iceServers? }` |
| relay → office | `{ t: 'peer', peer: Peer }`                                                             |
| relay → office | `{ t: 'leave', peerId }`                                                                |
| relay → office | `{ t: 'error', reason }`                                                                |
| relay → office | `{ t: 'chat', peerId, name, text, ts }`                                                 |
| relay → office | `{ t: 'layout', layout, rev, id? }` (to the whole room, the editor included)            |
| relay → office | `{ t: 'layoutReject', id, rev, reason }` (to the editor: `stale` or `busy`)             |
| relay → office | `{ t: 'signal', from, data }` (to the one peer named in `to`)                           |
| relay → office | `{ t: 'meet', from, name, meetingId, ev, ts }` (that meeting only)                      |
| relay → office | `{ t: 'play', from, gameId, ev }` (the match's other players, never back to the sender) |

The office forwards all of this to its UI through `core/asyncapi.yaml`:
`remotePeers` (where `RemoteAgent`, `RemotePose`, `PeerProfile` and each peer's
`desk`/`since` are defined), `roomLayout`, `multiplayerStatus`, `profileLoaded`,
`chatMessage` and `chatHistory`. The UI sends `joinRoom`, `leaveRoom`,
`presenceUpdate` (its characters' poses and desk: only the webview runs the
simulation, so only it knows positions), `updateProfile`, `sendChat` and
`saveRoomLayout` (an edit of the room's map, answered by the next `roomLayout`
carrying its `editId`, or by `roomLayoutRejected`; the page merges and retries,
see `webview-ui/src/office/layout/roomLayoutSync.ts`). The
calendar and Spotify use `calendarState` / `configureCalendar` and
`spotifyStatus` / `spotifyCommand`; they never touch the relay. Meetings use
`updateMeetingPresence` (re-sent every 5 s while in a call; the server drops a
presence nobody refreshes, so a closed tab leaves), `sendMeetingSignal`,
`sendMeetingEvent` and `generateMeetingNotes`, answered by `meetingSignal`,
`meetingEvent` and `meetingNotesResult`; `multiplayerStatus` carries the office's
`peerId`, the relay `clockOffset` and the `iceServers`. Games use
`updateGamePresence` (re-sent every 5 s while playing, like a meeting presence)
and `sendGameFrame`, answered by `gameFrame`; `RemotePeer.game` is each peer's
match presence (`GamePresence`, `FpsConfig`) and `GameFrameBody` / `FpsMapData`
are the frames (see `server/src/multiplayer/gameProtocol.ts`).
