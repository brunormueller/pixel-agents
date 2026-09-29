// webview-ui/src/games/fps/session.ts
//
// One Pixel Frag match as this office plays it. Each office owns its own
// player: it moves it, reports where it is (`pos`), resolves its own shots
// against what it sees and tells a target it was hit (`hit`); the target keeps
// its own health and says when it died (`die`). The match's host — the player
// who joined first, or this office alone in a solo game — also runs the bots,
// keeps the score and the round clock (`bots`, `score`), and hands the office
// map to newcomers (`map`). When the host leaves, the next player takes over
// the bots and the score where they were. No DOM: the page drives `update()`
// every frame and draws what it reads back.

import type {
  AvatarLook,
  FpsConfig,
  FpsMapData,
  GameFrameBody,
} from '../../../../core/src/messages.js';
import {
  FPS_BULLETS_PICKUP,
  FPS_FEED_MAX_LINES,
  FPS_FEED_SHOW_MS,
  FPS_HEALTH_PICKUP,
  FPS_HIT_MARKER_SEC,
  FPS_HURT_FLASH_SEC,
  FPS_ITEM_RESPAWN_SEC,
  FPS_MAX_HP,
  FPS_MAX_PUFFS,
  FPS_MESSAGE_SHOW_MS,
  FPS_NET_BOTS_INTERVAL_MS,
  FPS_NET_POS_INTERVAL_MS,
  FPS_NET_SCORE_INTERVAL_MS,
  FPS_PICKUP_RADIUS,
  FPS_PLAYER_RADIUS,
  FPS_PUFF_SEC,
  FPS_REMOTE_SMOOTHING,
  FPS_REMOTE_STALE_MS,
  FPS_RESPAWN_SEC,
  FPS_ROUND_RESTART_MS,
  FPS_RUN_SPEED,
  FPS_SHELLS_PICKUP,
  FPS_SPAWN_GUARD_SEC,
  FPS_START_BULLETS,
  FPS_START_SHELLS,
  FPS_WALK_SPEED,
  PALETTE_COUNT,
} from '../../constants.js';
import type { FpsSound } from './audio.js';
import { WEAPON_SOUNDS } from './audio.js';
import { isBuiltinMap } from './maps.js';
import type { BotBrain, ItemState, Rng } from './sim.js';
import {
  angleDiff,
  applyPickup,
  bestWeapon,
  compileWorld,
  fireWeapon,
  hasAmmo,
  moveCircle,
  newBrain,
  openFacing,
  pickSpawn,
  thinkBot,
  traceShot,
  turnToward,
  wrapAngle,
} from './sim.js';
import type { Actor, FpsInput, FpsWorld, WeaponSlot } from './types.js';
import { DIFFICULTY, WEAPONS } from './types.js';

/** How this match reaches the other players (absent in a solo game). */
export interface FpsNet {
  send(frame: GameFrameBody): void;
}

export interface FpsPlayerInfo {
  id: string;
  name: string;
  palette: number;
  hueShift: number;
  look: AvatarLook | null;
}

export interface FeedLine {
  killer: string;
  victim: string;
  weapon: number;
  at: number;
  /** This office's player did it, or had it done to them. */
  mine: boolean;
}

export interface ScoreRow {
  id: string;
  name: string;
  frags: number;
  deaths: number;
  bot: boolean;
  self: boolean;
}

export interface Puff {
  x: number;
  y: number;
  t: number;
  blood: boolean;
}

interface Remote {
  actor: Actor;
  /** Last reported spot, glided toward. */
  tx: number;
  ty: number;
  ta: number;
  lastAt: number;
  seen: boolean;
}

interface Row {
  name: string;
  f: number;
  d: number;
  bot: boolean;
}

export interface FpsSessionOptions {
  self: FpsPlayerInfo;
  cfg: FpsConfig;
  /** Null until the host sends it (an office map). */
  map: FpsMapData | null;
  net: FpsNet | null;
  /** Milliseconds on the clock every player shares (the relay's, in a room). */
  now: () => number;
  rng?: Rng;
}

const BOT_NAMES = [
  'Byte',
  'Pixel',
  'Glitch',
  'Nibble',
  'Kernel',
  'Cache',
  'Buffer',
  'Cursor',
  'Sprite',
  'Vector',
];

/** A newcomer's item taken locally keeps counting as taken this long, whatever the host last said. */
const TAKEN_GRACE_MS = 1_500;
/** A remote player further off than this from where it said it is jumps there (respawned). */
const SNAP_DISTANCE = 2.5;

function newActor(
  id: string,
  name: string,
  bot: boolean,
  palette: number,
  hueShift: number,
  look: AvatarLook | null,
): Actor {
  return {
    id,
    name,
    bot,
    x: 1.5,
    y: 1.5,
    a: 0,
    hp: FPS_MAX_HP,
    alive: false,
    weapon: 1,
    shells: FPS_START_SHELLS,
    bullets: FPS_START_BULLETS,
    cooldown: 0,
    shot: 0,
    moving: false,
    respawnIn: 0,
    guard: 0,
    palette,
    hueShift,
    look,
    walkPhase: 0,
    flash: 0,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

const PICKUP_TEXT: Record<FpsMapData['items'][number]['k'], string> = {
  health: `+${FPS_HEALTH_PICKUP} health`,
  shells: `+${FPS_SHELLS_PICKUP} shells`,
  bullets: `+${FPS_BULLETS_PICKUP} bullets`,
};

export class FpsSession {
  readonly selfId: string;
  readonly cfg: FpsConfig;
  readonly solo: boolean;
  world: FpsWorld | null = null;
  /** Bumped when a map is loaded (the page rebuilds its textures). */
  mapVersion = 0;
  readonly me: Actor;
  round = 0;
  /** Shared clock the round ends at; 0 = no time limit. */
  endsAt = 0;
  over = false;
  restartAt = 0;
  /** Per map item: there to take. */
  items: boolean[] = [];
  feed: FeedLine[] = [];
  message: { text: string; at: number } | null = null;
  puffs: Puff[] = [];
  /** Seconds left of the hurt flash, the hit marker and the recoil. */
  hurt = 0;
  hitMarker = 0;
  kick = 0;
  killedBy: string | null = null;
  /** A solo game stands still while its menu is open. */
  paused = false;
  onSound: ((sound: FpsSound, x?: number, y?: number) => void) | null = null;

  private host: boolean;
  private hostId: string;
  private readonly net: FpsNet | null;
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly remotes = new Map<string, Remote>();
  /** Bots as the host reports them (on every office but the host's). */
  private readonly botViews = new Map<string, Remote>();
  /** Bots this office runs (it is the host). */
  private readonly bots = new Map<string, Actor>();
  private readonly brains = new Map<string, BotBrain>();
  private readonly score = new Map<string, Row>();
  private readonly players = new Map<string, FpsPlayerInfo>();
  private itemBackAt: number[] = [];
  private takenAt: number[] = [];
  private posTimer = 0;
  private botsTimer = 0;
  private scoreTimer = 0;
  private scoreDirty = false;

  constructor(opts: FpsSessionOptions) {
    this.selfId = opts.self.id;
    this.cfg = opts.cfg;
    this.net = opts.net;
    this.solo = opts.net === null;
    this.now = opts.now;
    this.rng = opts.rng ?? Math.random;
    this.host = this.solo;
    this.hostId = this.solo ? this.selfId : '';
    const s = opts.self;
    this.me = newActor(s.id, s.name, false, s.palette, s.hueShift, s.look);
    if (opts.map) this.loadMap(opts.map);
    // Whoever runs the match sends the score (and the map, when it is theirs).
    this.net?.send({ k: 'req' });
  }

  get isHost(): boolean {
    return this.host;
  }

  /** Still waiting for the host's map. */
  get waiting(): boolean {
    return this.world === null;
  }

  // ── Who is in the match ───────────────────────────────────

  /** The other players (from their presences) and who hosts: the one who joined first. */
  setParticipants(list: readonly FpsPlayerInfo[], hostId: string): void {
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...this.remotes.keys()]) {
      if (ids.has(id)) continue;
      this.remotes.delete(id);
      this.players.delete(id);
      if (this.host && this.score.delete(id)) this.scoreDirty = true;
    }
    for (const p of list) {
      if (p.id === this.selfId) continue;
      this.players.set(p.id, p);
      const known = this.remotes.get(p.id);
      if (known) {
        Object.assign(known.actor, {
          name: p.name,
          palette: p.palette,
          hueShift: p.hueShift,
          look: p.look,
        });
      } else {
        this.remotes.set(p.id, {
          actor: newActor(p.id, p.name, false, p.palette, p.hueShift, p.look),
          tx: 0,
          ty: 0,
          ta: 0,
          lastAt: 0,
          seen: false,
        });
      }
    }
    const wasHost = this.host;
    this.host = this.solo || hostId === this.selfId;
    this.hostId = this.solo ? this.selfId : hostId;
    if (this.host && !wasHost) this.takeOver();
    else if (!this.host && wasHost) this.handOver();
    if (this.host) {
      this.ensureRow(this.selfId, this.me.name, false);
      for (const p of list) if (p.id !== this.selfId) this.ensureRow(p.id, p.name, false);
    }
  }

  /** This office runs the match now: the bots carry on from where they were last seen. */
  private takeOver(): void {
    for (const [id, view] of this.botViews) {
      this.bots.set(id, { ...view.actor, x: view.tx, y: view.ty, a: view.ta });
      this.brains.set(id, newBrain());
    }
    this.botViews.clear();
    const t = this.now();
    this.itemBackAt = this.items.map((there) => (there ? 0 : t + FPS_ITEM_RESPAWN_SEC * 1000));
    if (this.world) {
      if (this.round === 0) this.startRound(1);
      else this.ensureBots();
    }
    this.scoreDirty = true;
  }

  private handOver(): void {
    for (const [id, bot] of this.bots) {
      this.botViews.set(id, {
        actor: bot,
        tx: bot.x,
        ty: bot.y,
        ta: bot.a,
        lastAt: this.now(),
        seen: true,
      });
    }
    this.bots.clear();
    this.brains.clear();
  }

  // ── Frames from the other players ─────────────────────────

  receive(from: string, f: GameFrameBody): void {
    switch (f.k) {
      case 'pos':
        this.onPos(from, f);
        break;
      case 'hit':
        if (f.to === undefined || f.dmg === undefined) break;
        if (f.to === this.selfId) this.damageMe(f.dmg, f.by ?? from, f.w ?? 0);
        else if (this.host) {
          const bot = this.bots.get(f.to);
          if (bot) this.damageBot(bot, f.dmg, f.by ?? from, f.w ?? 0);
        }
        break;
      case 'die': {
        const victim = f.who ?? from;
        const view = this.remotes.get(victim) ?? this.botViews.get(victim);
        if (view) view.actor.alive = false;
        this.addFeed(f.by ?? '', victim, f.w ?? 0);
        // The host records the deaths of players; a bot's it already recorded.
        if (this.host && f.who === undefined) this.recordDeath(victim, f.by ?? '');
        break;
      }
      case 'bots':
        if (!this.host && from === this.hostId) this.onBots(f.bots ?? []);
        break;
      case 'score':
        if (!this.host && from === this.hostId) this.onScore(f);
        break;
      case 'map':
        if (!this.world && f.map) this.loadMap(f.map);
        break;
      case 'req':
        if (this.host) this.answerNewcomer();
        break;
      case 'take':
        if (this.host && f.i !== undefined) this.takeItem(f.i);
        break;
    }
  }

  private onPos(from: string, f: GameFrameBody): void {
    if (f.x === undefined || f.y === undefined || f.a === undefined) return;
    let view = this.remotes.get(from);
    if (!view) {
      // Its presence has not reached us yet.
      const info = this.players.get(from);
      view = {
        actor: newActor(
          from,
          info?.name ?? 'Player',
          false,
          info?.palette ?? 0,
          info?.hueShift ?? 0,
          info?.look ?? null,
        ),
        tx: 0,
        ty: 0,
        ta: 0,
        lastAt: 0,
        seen: false,
      };
      this.remotes.set(from, view);
    }
    const a = view.actor;
    a.weapon = (f.w ?? 0) as WeaponSlot;
    this.track(view, f.x, f.y, f.a, f.shot ?? 0);
    a.hp = f.hp ?? a.hp;
    a.alive = f.alive === true;
    a.moving = f.mv === true;
  }

  /** A remote actor's new report: glide there (or jump, when far), flash on a new shot. */
  private track(view: Remote, x: number, y: number, a: number, shot: number): void {
    const actor = view.actor;
    const far = Math.hypot(actor.x - x, actor.y - y) > SNAP_DISTANCE;
    if (!view.seen || far) {
      actor.x = x;
      actor.y = y;
      actor.a = a;
    }
    if (view.seen && shot > actor.shot) {
      actor.flash = 0.08;
      this.sound(WEAPON_SOUNDS[actor.weapon] ?? 'pistol', x, y);
    }
    actor.shot = shot;
    view.tx = x;
    view.ty = y;
    view.ta = a;
    view.lastAt = this.now();
    view.seen = true;
  }

  private onBots(list: NonNullable<GameFrameBody['bots']>): void {
    const ids = new Set<string>();
    for (const b of list) {
      ids.add(b.id);
      let view = this.botViews.get(b.id);
      if (!view) {
        view = {
          actor: newActor(b.id, b.n, true, b.p, b.h, null),
          tx: 0,
          ty: 0,
          ta: 0,
          lastAt: 0,
          seen: false,
        };
        this.botViews.set(b.id, view);
      }
      const a = view.actor;
      a.weapon = b.w as WeaponSlot;
      this.track(view, b.x, b.y, b.a, b.shot);
      Object.assign(a, {
        name: b.n,
        hp: b.hp,
        alive: b.alive,
        moving: b.mv,
        palette: b.p,
        hueShift: b.h,
      });
    }
    for (const id of [...this.botViews.keys()]) if (!ids.has(id)) this.botViews.delete(id);
  }

  private onScore(f: GameFrameBody): void {
    this.score.clear();
    for (const r of f.score ?? [])
      this.score.set(r.id, { name: r.n, f: r.f, d: r.d, bot: r.bot === true });
    if (f.round !== undefined && f.round !== this.round) {
      this.round = f.round;
      this.roundStarted();
    }
    this.endsAt = f.endsAt ?? 0;
    this.over = f.over === true;
    this.restartAt = f.restartAt ?? 0;
    const there = f.items ?? '';
    const t = this.now();
    for (let i = 0; i < this.items.length; i++) {
      const on = there[i] === '1';
      if (on && t - (this.takenAt[i] ?? -Infinity) < TAKEN_GRACE_MS) continue;
      this.items[i] = on;
    }
  }

  private answerNewcomer(): void {
    if (this.world && !isBuiltinMap(this.cfg.map))
      this.net?.send({ k: 'map', map: this.world.data });
    this.sendScore();
    this.sendBots();
  }

  // ── The match ─────────────────────────────────────────────

  private loadMap(data: FpsMapData): void {
    this.world = compileWorld(data);
    this.mapVersion += 1;
    this.items = data.items.map(() => true);
    this.itemBackAt = data.items.map(() => 0);
    this.takenAt = data.items.map(() => -Infinity);
    if (this.host) {
      if (this.round === 0) this.startRound(1);
      else this.ensureBots();
    } else {
      this.respawn(this.me);
    }
  }

  private startRound(n: number): void {
    this.round = n;
    this.over = false;
    this.restartAt = 0;
    this.endsAt = this.cfg.timeLimit > 0 ? this.now() + this.cfg.timeLimit * 60_000 : 0;
    for (const row of this.score.values()) {
      row.f = 0;
      row.d = 0;
    }
    this.items = this.items.map(() => true);
    this.itemBackAt = this.items.map(() => 0);
    this.ensureBots();
    for (const bot of this.bots.values()) this.respawn(bot);
    this.roundStarted();
    this.scoreDirty = true;
  }

  /** A round began (here, or at the host): everyone back in, fresh. */
  private roundStarted(): void {
    this.feed = [];
    this.killedBy = null;
    if (this.world) this.respawn(this.me);
    const limits = [
      this.cfg.fragLimit > 0 ? `first to ${this.cfg.fragLimit} frags` : '',
      this.cfg.timeLimit > 0 ? `${this.cfg.timeLimit} min` : '',
    ].filter(Boolean);
    this.say(`Round ${this.round}${limits.length > 0 ? ` — ${limits.join(', ')}` : ''}`);
    this.sound('round');
  }

  private ensureBots(): void {
    if (!this.world) return;
    for (let i = 1; i <= this.cfg.bots; i++) {
      const id = `bot-${i}`;
      if (this.bots.has(id)) continue;
      const name = `${BOT_NAMES[(i - 1) % BOT_NAMES.length]} (bot)`;
      const bot = newActor(
        id,
        name,
        true,
        (i * 5) % PALETTE_COUNT,
        i > PALETTE_COUNT ? 140 : 0,
        null,
      );
      this.bots.set(id, bot);
      this.brains.set(id, newBrain());
      this.respawn(bot);
      this.ensureRow(id, name, true);
    }
    this.ensureRow(this.selfId, this.me.name, false);
  }

  private ensureRow(id: string, name: string, bot: boolean): void {
    const row = this.score.get(id);
    if (row) row.name = name;
    else {
      this.score.set(id, { name, f: 0, d: 0, bot });
      this.scoreDirty = true;
    }
  }

  private respawn(a: Actor): void {
    const world = this.world;
    if (!world) return;
    const others = this.allActors().filter((o) => o !== a);
    const spot = pickSpawn(world, others, this.rng);
    Object.assign(a, {
      x: spot.x,
      y: spot.y,
      a: openFacing(world, spot.x, spot.y),
      hp: FPS_MAX_HP,
      alive: true,
      shells: FPS_START_SHELLS,
      bullets: FPS_START_BULLETS,
      weapon: 1,
      cooldown: 0.3,
      respawnIn: 0,
      guard: FPS_SPAWN_GUARD_SEC,
      moving: false,
    });
    if (a === this.me) {
      this.killedBy = null;
      this.sound('respawn');
    }
  }

  private runRound(now: number): void {
    if (this.round === 0) {
      this.startRound(1);
      return;
    }
    if (!this.over) {
      let top = 0;
      for (const row of this.score.values()) top = Math.max(top, row.f);
      const fragsReached = this.cfg.fragLimit > 0 && top >= this.cfg.fragLimit;
      const timeUp = this.endsAt > 0 && now >= this.endsAt;
      if (fragsReached || timeUp) {
        this.over = true;
        this.restartAt = now + FPS_ROUND_RESTART_MS;
        this.scoreDirty = true;
        this.sound('round');
      }
    } else if (now >= this.restartAt) {
      this.startRound(this.round + 1);
    }
  }

  // ── Damage and deaths ─────────────────────────────────────

  private damageMe(dmg: number, attacker: string, weapon: number): void {
    const me = this.me;
    if (!me.alive || this.over || me.guard > 0) return;
    me.hp -= dmg;
    this.hurt = FPS_HURT_FLASH_SEC;
    this.sound('hurt');
    if (me.hp > 0) return;
    me.hp = 0;
    me.alive = false;
    me.moving = false;
    me.respawnIn = FPS_RESPAWN_SEC;
    this.killedBy = attacker;
    this.sound('die');
    this.net?.send({ k: 'die', by: attacker, w: weapon });
    this.addFeed(attacker, me.id, weapon);
    if (this.host) this.recordDeath(me.id, attacker);
    this.posTimer = 0; // everyone sees the fall at once
  }

  private damageBot(bot: Actor, dmg: number, attacker: string, weapon: number): void {
    if (!bot.alive || this.over || bot.guard > 0) return;
    bot.hp -= dmg;
    // Shot from behind: it turns to find out who.
    const brain = this.brains.get(bot.id);
    const shooter = this.allActors().find((a) => a.id === attacker);
    if (brain && shooter && !brain.targetId) {
      brain.lastSeen = { x: shooter.x, y: shooter.y };
      brain.lastSeenAge = 0;
      brain.path = [];
      bot.a = turnToward(bot.a, Math.atan2(shooter.y - bot.y, shooter.x - bot.x), 1.2);
    }
    if (bot.hp > 0) return;
    bot.hp = 0;
    bot.alive = false;
    bot.moving = false;
    bot.respawnIn = FPS_RESPAWN_SEC;
    this.sound('die', bot.x, bot.y);
    this.addFeed(attacker, bot.id, weapon);
    this.recordDeath(bot.id, attacker);
    this.net?.send({ k: 'die', who: bot.id, by: attacker, w: weapon });
  }

  private recordDeath(victim: string, killer: string): void {
    const v = this.score.get(victim);
    if (v) v.d += 1;
    if (killer && killer !== victim) {
      const k = this.score.get(killer);
      if (k) k.f += 1;
    }
    this.scoreDirty = true;
  }

  private addFeed(killer: string, victim: string, weapon: number): void {
    const mine = killer === this.selfId || victim === this.selfId;
    this.feed.push({
      killer: killer ? this.nameOf(killer) : '',
      victim: this.nameOf(victim),
      weapon,
      at: this.now(),
      mine,
    });
    if (this.feed.length > FPS_FEED_MAX_LINES) this.feed.shift();
    if (killer === this.selfId && victim !== this.selfId) {
      this.sound('frag');
      this.say(`You fragged ${this.nameOf(victim)}`);
    }
  }

  nameOf(id: string): string {
    if (id === this.selfId) return this.me.name;
    return (
      this.remotes.get(id)?.actor.name ??
      this.bots.get(id)?.name ??
      this.botViews.get(id)?.actor.name ??
      this.score.get(id)?.name ??
      'Someone'
    );
  }

  // ── Every frame ───────────────────────────────────────────

  update(dt: number, input: FpsInput): void {
    if (!this.world) return;
    const now = this.now();
    this.decay(dt, now);
    if (this.host && !this.paused) this.runRound(now);
    if (!this.over && !this.paused) {
      this.updateMe(dt, input, now);
      if (this.host) {
        this.updateBots(dt, now);
        this.respawnItems(now);
      }
    }
    this.glide(dt);
    if (this.net) this.sendState(dt);
  }

  private decay(dt: number, now: number): void {
    this.hurt = Math.max(0, this.hurt - dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.kick = Math.max(0, this.kick - dt * 6);
    for (const a of [this.me, ...this.bots.values()]) a.guard = Math.max(0, a.guard - dt);
    for (const a of this.allActors()) a.flash = Math.max(0, a.flash - dt);
    for (const p of this.puffs) p.t -= dt;
    this.puffs = this.puffs.filter((p) => p.t > 0);
    this.feed = this.feed.filter((l) => now - l.at < FPS_FEED_SHOW_MS);
    if (this.message && now - this.message.at > FPS_MESSAGE_SHOW_MS) this.message = null;
  }

  private updateMe(dt: number, input: FpsInput, now: number): void {
    const me = this.me;
    const world = this.world!;
    me.cooldown = Math.max(0, me.cooldown - dt);
    if (!me.alive) {
      me.respawnIn -= dt;
      if (me.respawnIn <= 0) this.respawn(me);
      return;
    }
    me.a = wrapAngle(me.a + input.turn);
    if (input.weapon !== null && input.weapon !== me.weapon) {
      if (hasAmmo(me, input.weapon)) me.weapon = input.weapon;
      else
        this.say(
          `No ${WEAPONS[input.weapon].ammo} for the ${WEAPONS[input.weapon].name.toLowerCase()}`,
        );
    }
    if (input.cycle !== 0) {
      for (let i = 1; i <= WEAPONS.length; i++) {
        const slot = ((((me.weapon + input.cycle * i) % WEAPONS.length) + WEAPONS.length) %
          WEAPONS.length) as WeaponSlot;
        if (hasAmmo(me, slot)) {
          me.weapon = slot;
          break;
        }
      }
    }
    const fx = Math.cos(me.a);
    const fy = Math.sin(me.a);
    // Right of the facing is (-sin, cos): the map's y grows downward.
    let mx = fx * input.forward - fy * input.strafe;
    let my = fy * input.forward + fx * input.strafe;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    me.moving = len > 0.01;
    if (me.moving) {
      const speed = input.run ? FPS_RUN_SPEED : FPS_WALK_SPEED;
      moveCircle(world, me, mx * speed * dt, my * speed * dt, FPS_PLAYER_RADIUS);
      me.walkPhase += dt * speed;
    }
    if (input.fire) this.fireMine();
    this.pickups(me, now);
  }

  private fireMine(): void {
    const me = this.me;
    if (me.cooldown > 0) return;
    if (!hasAmmo(me, me.weapon)) {
      me.weapon = bestWeapon(me);
      me.cooldown = 0.25;
      this.sound('empty');
      return;
    }
    const res = fireWeapon(this.world!, me, this.targetsFor(me), this.rng);
    if (!res) return;
    this.kick = 1;
    this.sound(WEAPON_SOUNDS[me.weapon]);
    this.addPuffs(res.impacts);
    for (const [id, dmg] of res.damage) {
      this.hitMarker = FPS_HIT_MARKER_SEC;
      const bot = this.host ? this.bots.get(id) : undefined;
      if (bot) this.damageBot(bot, dmg, me.id, me.weapon);
      else this.net?.send({ k: 'hit', to: id, dmg, w: me.weapon });
    }
    if (res.damage.size > 0) this.sound('hit');
  }

  private updateBots(dt: number, now: number): void {
    const world = this.world!;
    const params = DIFFICULTY[this.cfg.difficulty];
    const actors = this.allActors();
    const items = this.itemStates();
    for (const bot of this.bots.values()) {
      bot.cooldown = Math.max(0, bot.cooldown - dt);
      if (!bot.alive) {
        bot.respawnIn -= dt;
        if (bot.respawnIn <= 0) this.respawn(bot);
        continue;
      }
      let brain = this.brains.get(bot.id);
      if (!brain) {
        brain = newBrain();
        this.brains.set(bot.id, brain);
      }
      const intent = thinkBot(world, bot, brain, actors, items, params, dt, this.rng);
      bot.a = turnToward(bot.a, intent.face, params.turnSpeed * dt);
      const len = Math.hypot(intent.moveX, intent.moveY);
      bot.moving = len > 0.01;
      if (bot.moving) {
        const speed = FPS_WALK_SPEED * params.speed;
        moveCircle(
          world,
          bot,
          intent.moveX * speed * dt,
          intent.moveY * speed * dt,
          FPS_PLAYER_RADIUS,
        );
        bot.walkPhase += dt * speed;
      }
      if (hasAmmo(bot, intent.weapon)) bot.weapon = intent.weapon;
      if (intent.fire) this.fireBot(bot, params.aimError);
      this.pickups(bot, now);
    }
  }

  private fireBot(bot: Actor, aimError: number): void {
    const res = fireWeapon(this.world!, bot, this.targetsFor(bot), this.rng, aimError);
    if (!res) return;
    this.sound(WEAPON_SOUNDS[bot.weapon], bot.x, bot.y);
    this.addPuffs(res.impacts);
    for (const [id, dmg] of res.damage) {
      if (id === this.selfId) this.damageMe(dmg, bot.id, bot.weapon);
      else {
        const other = this.bots.get(id);
        if (other) this.damageBot(other, dmg, bot.id, bot.weapon);
        else this.net?.send({ k: 'hit', to: id, dmg, w: bot.weapon, by: bot.id });
      }
    }
  }

  private pickups(a: Actor, now: number): void {
    const list = this.world!.data.items;
    for (let i = 0; i < list.length; i++) {
      if (!this.items[i]) continue;
      const it = list[i];
      if (Math.hypot(it.x - a.x, it.y - a.y) > FPS_PICKUP_RADIUS) continue;
      if (!applyPickup(a, it.k)) continue;
      this.items[i] = false;
      if (this.host) {
        this.itemBackAt[i] = now + FPS_ITEM_RESPAWN_SEC * 1000;
        this.scoreDirty = true;
      } else {
        this.takenAt[i] = now;
        this.net?.send({ k: 'take', i });
      }
      if (a === this.me) {
        this.sound('pickup');
        this.say(PICKUP_TEXT[it.k]);
      }
    }
  }

  private takeItem(i: number): void {
    if (!this.items[i]) return;
    this.items[i] = false;
    this.itemBackAt[i] = this.now() + FPS_ITEM_RESPAWN_SEC * 1000;
    this.scoreDirty = true;
  }

  private respawnItems(now: number): void {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i] || !this.itemBackAt[i] || now < this.itemBackAt[i]) continue;
      this.items[i] = true;
      this.itemBackAt[i] = 0;
      this.scoreDirty = true;
    }
  }

  /** Remote actors glide toward where they last said they are. */
  private glide(dt: number): void {
    const k = 1 - Math.exp(-FPS_REMOTE_SMOOTHING * dt);
    for (const view of [...this.remotes.values(), ...this.botViews.values()]) {
      if (!view.seen) continue;
      const a = view.actor;
      a.x += (view.tx - a.x) * k;
      a.y += (view.ty - a.y) * k;
      a.a = wrapAngle(a.a + angleDiff(a.a, view.ta) * k);
      if (a.moving) a.walkPhase += dt * FPS_WALK_SPEED;
    }
  }

  private addPuffs(impacts: ReadonlyArray<{ x: number; y: number; blood: boolean }>): void {
    for (const i of impacts) this.puffs.push({ x: i.x, y: i.y, t: FPS_PUFF_SEC, blood: i.blood });
    if (this.puffs.length > FPS_MAX_PUFFS) this.puffs.splice(0, this.puffs.length - FPS_MAX_PUFFS);
  }

  private say(text: string): void {
    this.message = { text, at: this.now() };
  }

  private sound(sound: FpsSound, x?: number, y?: number): void {
    this.onSound?.(sound, x, y);
  }

  // ── Sending ───────────────────────────────────────────────

  private sendState(dt: number): void {
    const ms = dt * 1000;
    this.posTimer -= ms;
    if (this.posTimer <= 0) {
      this.posTimer = FPS_NET_POS_INTERVAL_MS;
      this.sendPos();
    }
    if (!this.host) return;
    this.botsTimer -= ms;
    if (this.botsTimer <= 0) {
      this.botsTimer = FPS_NET_BOTS_INTERVAL_MS;
      if (this.bots.size > 0) this.sendBots();
    }
    this.scoreTimer -= ms;
    if (this.scoreDirty || this.scoreTimer <= 0) {
      this.scoreTimer = FPS_NET_SCORE_INTERVAL_MS;
      this.sendScore();
    }
  }

  private sendPos(): void {
    const me = this.me;
    this.net?.send({
      k: 'pos',
      x: round3(me.x),
      y: round3(me.y),
      a: round3(wrapAngle(me.a)),
      hp: Math.max(0, Math.round(me.hp)),
      alive: me.alive,
      w: me.weapon,
      shot: me.shot,
      mv: me.moving,
    });
  }

  private sendBots(): void {
    if (!this.net) return;
    this.net.send({
      k: 'bots',
      bots: [...this.bots.values()].map((b) => ({
        id: b.id,
        n: b.name,
        x: round3(b.x),
        y: round3(b.y),
        a: round3(wrapAngle(b.a)),
        hp: Math.max(0, Math.round(b.hp)),
        alive: b.alive,
        w: b.weapon,
        shot: b.shot,
        mv: b.moving,
        p: b.palette,
        h: b.hueShift,
      })),
    });
  }

  private sendScore(): void {
    this.scoreDirty = false;
    if (!this.net) return;
    this.net.send({
      k: 'score',
      score: [...this.score].map(([id, r]) => ({
        id,
        n: r.name,
        f: r.f,
        d: r.d,
        ...(r.bot ? { bot: true } : {}),
      })),
      round: this.round,
      endsAt: this.endsAt,
      over: this.over,
      ...(this.over ? { restartAt: this.restartAt } : {}),
      items: this.items.map((there) => (there ? '1' : '0')).join(''),
    });
  }

  // ── What the page draws ───────────────────────────────────

  private freshRemotes(): Actor[] {
    const t = this.now();
    return [...this.remotes.values()]
      .filter((v) => v.seen && t - v.lastAt < FPS_REMOTE_STALE_MS)
      .map((v) => v.actor);
  }

  private botActors(): Actor[] {
    return this.host ? [...this.bots.values()] : [...this.botViews.values()].map((v) => v.actor);
  }

  /** Everyone in the match this office can see, this office's player first. */
  allActors(): Actor[] {
    return [this.me, ...this.freshRemotes(), ...this.botActors()];
  }

  /** Everyone but this office's player (what the page draws as characters). */
  others(): Actor[] {
    return [...this.freshRemotes(), ...this.botActors()];
  }

  private targetsFor(shooter: Actor): Actor[] {
    return this.allActors().filter((a) => a !== shooter && a.alive);
  }

  itemStates(): ItemState[] {
    const list = this.world?.data.items ?? [];
    return list.map((it, i) => ({ x: it.x, y: it.y, k: it.k, available: this.items[i] === true }));
  }

  /** Whose name the crosshair is on (within range, not behind a wall). */
  aimedAt(): string | null {
    const world = this.world;
    if (!world || !this.me.alive) return null;
    const { hit } = traceShot(world, this.me.x, this.me.y, this.me.a, 24, this.targetsFor(this.me));
    return hit ? this.nameOf(hit.id) : null;
  }

  scoreboard(): ScoreRow[] {
    const rows: ScoreRow[] = [...this.score].map(([id, r]) => ({
      id,
      name: r.name,
      frags: r.f,
      deaths: r.d,
      bot: r.bot,
      self: id === this.selfId,
    }));
    if (!this.score.has(this.selfId)) {
      rows.push({
        id: this.selfId,
        name: this.me.name,
        frags: 0,
        deaths: 0,
        bot: false,
        self: true,
      });
    }
    return rows.sort(
      (a, b) => b.frags - a.frags || a.deaths - b.deaths || a.name.localeCompare(b.name),
    );
  }

  /** Milliseconds left in the round, or null without a time limit. */
  timeLeftMs(): number | null {
    return this.endsAt > 0 ? Math.max(0, this.endsAt - this.now()) : null;
  }

  /** Milliseconds until the next round (while one just ended). */
  restartInMs(): number {
    return this.over ? Math.max(0, this.restartAt - this.now()) : 0;
  }
}
