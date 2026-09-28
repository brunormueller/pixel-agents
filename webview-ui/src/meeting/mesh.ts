// webview-ui/src/meeting/mesh.ts
//
// The media side of a meeting: one RTCPeerConnection per other participant
// (a full mesh — fine for the handful of people a room holds), negotiated
// with the "perfect negotiation" pattern so either side may add a screen at
// any time without glare. Signaling rides the relay (sendSignal); audio and
// video go browser to browser.

import type { MeetingSignalData } from '../../../core/src/messages.js';
import {
  MEETING_CONNECT_WATCHDOG_MS,
  MEETING_ICE_RESTART_DELAY_MS,
  MEETING_POLITE_OFFER_WAIT_MS,
} from '../constants.js';
import { isPolite } from './model.js';

/** `localStorage['pixelAgents.meetingDebug'] = '1'` logs the negotiation (for troubleshooting a call). */
function debugEnabled(): boolean {
  try {
    return localStorage.getItem('pixelAgents.meetingDebug') === '1';
  } catch {
    return false;
  }
}
const DEBUG = typeof window !== 'undefined' && debugEnabled();
const debug = (...args: unknown[]) => {
  if (DEBUG) console.log('[Webview] Meeting:', ...args);
};

/** What this person sends: microphone + camera on one stream, each screen on its own. */
export interface LocalMedia {
  /** Carries mic + camera; its id is published as MeetingPresence.stream. */
  base: MediaStream;
  mic: MediaStreamTrack | null;
  cam: MediaStreamTrack | null;
  screens: MediaStream[];
}

export interface MeshCallbacks {
  sendSignal: (to: string, data: MeetingSignalData) => void;
  /** A remote stream appeared (or gained a track): look it up by stream.id. */
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerState: (peerId: string, state: RTCPeerConnectionState) => void;
}

interface PeerLink {
  peerId: string;
  /** The remote side's join (its MeetingPresence.since). */
  remoteSid: number;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Fixed senders for mic and camera, once this side sends (see startSending). */
  micSender: RTCRtpSender | null;
  camSender: RTCRtpSender | null;
  /** Screen track id → its sender. */
  screenSenders: Map<string, RTCRtpSender>;
  /** Signals are applied one at a time: a candidate must not overtake its description. */
  queue: Promise<void>;
  timers: Set<ReturnType<typeof setTimeout>>;
  restartTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export class MeshSession {
  private readonly links = new Map<string, PeerLink>();
  private media: LocalMedia | null = null;
  private closed = false;
  private readonly selfPeerId: string;
  /** This join (our MeetingPresence.since): signals for an older join are ignored. */
  private readonly selfSid: number;
  private readonly iceServers: RTCIceServer[];
  private readonly cb: MeshCallbacks;

  constructor(selfPeerId: string, selfSid: number, iceServers: RTCIceServer[], cb: MeshCallbacks) {
    this.selfPeerId = selfPeerId;
    this.selfSid = selfSid;
    this.iceServers = iceServers;
    this.cb = cb;
  }

  /** Apply what we send to every connection: swap mic/camera tracks in place,
   *  add or remove screen tracks (those renegotiate). */
  setLocal(media: LocalMedia): void {
    this.media = media;
    for (const link of this.links.values()) this.applyMedia(link);
  }

  /** The participants other than us: connect to newcomers, drop the departed,
   *  reconnect anyone who rejoined (a new sid). */
  sync(participants: ReadonlyArray<{ peerId: string; sid: number }>): void {
    if (this.closed) return;
    const wanted = new Map(participants.map((p) => [p.peerId, p.sid]));
    for (const [peerId, link] of this.links) {
      const sid = wanted.get(peerId);
      if (sid === undefined || sid !== link.remoteSid) this.dropLink(peerId);
    }
    for (const [peerId, sid] of wanted) {
      if (!this.links.has(peerId) && peerId !== this.selfPeerId) this.createLink(peerId, sid);
    }
  }

  handleSignal(from: string, data: MeetingSignalData): void {
    if (this.closed || data.tsid !== this.selfSid) {
      debug(`drop ${data.kind} from ${from}: tsid ${data.tsid} vs ours ${this.selfSid}`);
      return; // meant for an earlier join of ours
    }
    if (data.kind !== 'sdp' && data.kind !== 'ice') return;
    let link = this.links.get(from);
    if (link && link.remoteSid !== data.sid) {
      this.dropLink(from);
      link = undefined;
    }
    // Their offer can beat their presence here; the next sync keeps or drops the link.
    link ??= this.createLink(from, data.sid);
    const l = link;
    l.queue = l.queue
      .then(() => this.applySignal(l, data))
      .catch((err: unknown) => {
        console.warn(`[Webview] Meeting: signal from ${from} failed:`, err);
      });
  }

  close(): void {
    this.closed = true;
    for (const peerId of [...this.links.keys()]) this.dropLink(peerId);
  }

  // ── Connections ─────────────────────────────────────────────

  private createLink(peerId: string, remoteSid: number): PeerLink {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const link: PeerLink = {
      peerId,
      remoteSid,
      pc,
      polite: isPolite(this.selfPeerId, peerId),
      makingOffer: false,
      ignoreOffer: false,
      micSender: null,
      camSender: null,
      screenSenders: new Map(),
      queue: Promise.resolve(),
      timers: new Set(),
      restartTimer: null,
      closed: false,
    };
    this.links.set(peerId, link);
    debug(`link to ${peerId} (polite=${link.polite}, their sid ${remoteSid})`);

    pc.onnegotiationneeded = async () => {
      try {
        link.makingOffer = true;
        await pc.setLocalDescription();
        const d = pc.localDescription;
        if (d) this.send(link, { kind: 'sdp', description: { type: d.type, sdp: d.sdp } });
      } catch (err) {
        console.warn('[Webview] Meeting: offer failed:', err);
      } finally {
        link.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.send(link, {
        kind: 'ice',
        candidate: {
          candidate: candidate.candidate,
          ...(candidate.sdpMid !== null ? { sdpMid: candidate.sdpMid } : {}),
          ...(candidate.sdpMLineIndex !== null ? { sdpMLineIndex: candidate.sdpMLineIndex } : {}),
          ...(candidate.usernameFragment ? { usernameFragment: candidate.usernameFragment } : {}),
        },
      });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.cb.onRemoteStream(peerId, stream);
      // A track that starts later (camera turned on) makes the tile re-read the stream.
      e.track.onunmute = () => this.cb.onRemoteStream(peerId, stream);
    };
    pc.onsignalingstatechange = () => debug(`${peerId} signaling ${pc.signalingState}`);
    pc.oniceconnectionstatechange = () => debug(`${peerId} ice ${pc.iceConnectionState}`);
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      debug(`${peerId} connection ${state}`);
      this.cb.onPeerState(peerId, state);
      if (state === 'failed' || state === 'disconnected') {
        // A network change (wifi hop, VPN) often heals with fresh candidates.
        link.restartTimer ??= setTimeout(() => {
          link.restartTimer = null;
          this.restart(link, 'connection lost');
        }, MEETING_ICE_RESTART_DELAY_MS);
      } else if (link.restartTimer) {
        clearTimeout(link.restartTimer);
        link.restartTimer = null;
      }
    };

    // Only the impolite side opens the first negotiation. Two first offers
    // crossing make the polite side roll its own back, and Chrome then may never
    // gather candidates for that connection. The polite side answers first and
    // only then adds what it sends — or starts on its own if no offer comes.
    if (link.polite) {
      this.later(link, MEETING_POLITE_OFFER_WAIT_MS, () => {
        if (!link.micSender) {
          debug(`${peerId}: no offer yet, offering first`);
          this.startSending(link);
        }
      });
    } else {
      this.startSending(link);
    }
    // Still not through after a while (lost signal, stuck gathering): restart ICE.
    this.later(link, MEETING_CONNECT_WATCHDOG_MS, () => {
      if (pc.connectionState !== 'connected') this.restart(link, 'not connected yet');
    });
    this.cb.onPeerState(peerId, pc.connectionState);
    return link;
  }

  /** Add the fixed mic + camera senders (a negotiation) and everything we share. */
  private startSending(link: PeerLink): void {
    if (link.closed || link.micSender) return;
    const streams = this.media ? [this.media.base] : [];
    // Turning the mic or camera on or off later swaps the track in place
    // (replaceTrack) instead of renegotiating every time.
    link.micSender = link.pc.addTransceiver('audio', { direction: 'sendrecv', streams }).sender;
    link.camSender = link.pc.addTransceiver('video', { direction: 'sendrecv', streams }).sender;
    this.applyMedia(link);
  }

  private restart(link: PeerLink, why: string): void {
    if (link.closed || link.pc.connectionState === 'connected') return;
    debug(`${link.peerId}: ICE restart (${why})`);
    if (!link.micSender) this.startSending(link);
    link.pc.restartIce();
  }

  private later(link: PeerLink, ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      link.timers.delete(t);
      if (!link.closed) fn();
    }, ms);
    link.timers.add(t);
  }

  private send(link: PeerLink, data: Omit<MeetingSignalData, 'sid' | 'tsid'>): void {
    if (link.closed) return;
    debug(`→ ${link.peerId} ${data.kind}${data.description ? ` ${data.description.type}` : ''}`);
    this.cb.sendSignal(link.peerId, { ...data, sid: this.selfSid, tsid: link.remoteSid });
  }

  private async applySignal(link: PeerLink, data: MeetingSignalData): Promise<void> {
    if (link.closed) return;
    const pc = link.pc;
    debug(
      `← ${link.peerId} ${data.kind}${data.description ? ` ${data.description.type}` : ''} (state ${pc.signalingState}, makingOffer ${link.makingOffer})`,
    );
    if (data.kind === 'sdp' && data.description) {
      const description = data.description;
      const collision =
        description.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable');
      link.ignoreOffer = !link.polite && collision;
      if (link.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        const d = pc.localDescription;
        if (d) this.send(link, { kind: 'sdp', description: { type: d.type, sdp: d.sdp } });
        // Answered their first offer: now add what we send (our own negotiation).
        if (!link.micSender) this.startSending(link);
      }
    } else if (data.kind === 'ice' && data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!link.ignoreOffer) throw err;
      }
    }
  }

  private applyMedia(link: PeerLink): void {
    const media = this.media;
    if (!media || link.closed || !link.micSender || !link.camSender) return;
    const replace = (sender: RTCRtpSender, track: MediaStreamTrack | null) => {
      if (sender.track !== track) {
        sender.replaceTrack(track).catch((err: unknown) => {
          console.warn('[Webview] Meeting: replaceTrack failed:', err);
        });
      }
    };
    replace(link.micSender, media.mic);
    replace(link.camSender, media.cam);
    // Screens come and go as whole tracks; adding or removing one renegotiates.
    const live = new Set<string>();
    for (const stream of media.screens) {
      for (const track of stream.getTracks()) {
        live.add(track.id);
        if (!link.screenSenders.has(track.id)) {
          link.screenSenders.set(track.id, link.pc.addTrack(track, stream));
        }
      }
    }
    for (const [trackId, sender] of link.screenSenders) {
      if (live.has(trackId)) continue;
      try {
        link.pc.removeTrack(sender);
      } catch {
        /* connection already closing */
      }
      link.screenSenders.delete(trackId);
    }
  }

  private dropLink(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link) return;
    link.closed = true;
    if (link.restartTimer) clearTimeout(link.restartTimer);
    for (const t of link.timers) clearTimeout(t);
    link.timers.clear();
    this.links.delete(peerId);
    link.pc.onnegotiationneeded = null;
    link.pc.onicecandidate = null;
    link.pc.ontrack = null;
    link.pc.onconnectionstatechange = null;
    link.pc.onsignalingstatechange = null;
    link.pc.oniceconnectionstatechange = null;
    link.pc.close();
    this.cb.onPeerState(peerId, 'closed');
  }
}
