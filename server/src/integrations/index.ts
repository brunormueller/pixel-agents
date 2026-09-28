import type { AgentStateStore } from '../agentStateStore.js';
import type { MultiplayerClient } from '../multiplayer/multiplayerClient.js';
import { CalendarService } from './calendar/calendarService.js';
import type { MeetingNotesOptions } from './meetingNotes/meetingNotes.js';
import { MeetingNotesService } from './meetingNotes/meetingNotes.js';
import { SpotifyService } from './spotify/spotifyService.js';

type WsSend = (message: Record<string, unknown>) => void;

export interface IntegrationsOptions {
  /** The room, when multiplayer is configured: gets "in a meeting" and the song playing. */
  multiplayer?: MultiplayerClient;
  /** Open a sign-in page in the browser, when the surface can (VS Code). */
  openUrl?: (url: string) => void;
  /** Meeting notes (tests inject a fake Claude). */
  meetingNotes?: MeetingNotesOptions;
}

/**
 * The person's own apps, wired to the office: their calendar (the agenda, the
 * join button, the automatic "in a meeting" status) and Spotify (what is
 * playing, playback controls), plus their Claude Code writing meeting notes.
 * Both surfaces compose one of these next to
 * their store; each service broadcasts through the store like everything else.
 */
export class Integrations {
  readonly calendar: CalendarService;
  readonly spotify: SpotifyService;
  readonly meetingNotes: MeetingNotesService;

  constructor(store: AgentStateStore, options: IntegrationsOptions = {}) {
    const { multiplayer } = options;
    this.calendar = new CalendarService(store, {
      onMeetingChange: (inMeeting) => multiplayer?.setInMeeting(inMeeting),
    });
    this.spotify = new SpotifyService(store, {
      openUrl: options.openUrl,
      onTrack: (track) => multiplayer?.setMusic(track),
    });
    this.meetingNotes = new MeetingNotesService(options.meetingNotes);
  }

  start(): void {
    this.calendar.start();
    this.spotify.start();
  }

  /**
   * Route an integration message. Returns false when `msg` is not one. The
   * caller decides who may send them (standalone: privileged connections only).
   */
  handle(msg: Record<string, unknown>, reply?: WsSend): boolean {
    switch (msg.type) {
      case 'configureCalendar':
        void this.calendar.configure(msg);
        return true;
      case 'spotifyCommand':
        void this.spotify.command(msg, reply);
        return true;
      case 'generateMeetingNotes':
        void this.meetingNotes.generate(msg, reply);
        return true;
      default:
        return false;
    }
  }

  resend(send: WsSend): void {
    this.calendar.resend(send);
    this.spotify.resend(send);
  }

  dispose(): void {
    this.calendar.dispose();
    this.spotify.dispose();
  }
}

/** A link the office may open for the person: https only (meeting join links, Spotify pages). */
export function isOpenableUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 4096) return false;
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}
