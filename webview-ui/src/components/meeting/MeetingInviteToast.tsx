import type { MeetingController } from '../../meeting/useMeeting.js';

/** "Ana invites you to Standup — Join / Not now". One at a time, newest first. */
export function MeetingInviteToast({ m }: { m: MeetingController }) {
  const invite = m.invites[m.invites.length - 1];
  if (!invite) return null;
  return (
    <div
      className="absolute top-10 left-1/2 -translate-x-1/2 z-50 pixel-panel py-6 px-12 flex items-center gap-10 text-sm"
      style={{ maxWidth: 'calc(100% - 20px)' }}
      data-testid="meeting-invite"
    >
      <span style={{ overflowWrap: 'anywhere' }}>
        📞 <span className="text-accent-bright">{invite.name}</span> invites you to{' '}
        <span className="text-accent-bright">{invite.title}</span>
      </span>
      <button
        type="button"
        onClick={() => m.acceptInvite(invite)}
        disabled={!m.available}
        className="py-1 px-10 text-sm bg-accent text-white border-2 border-accent cursor-pointer shrink-0"
      >
        Join
      </button>
      <button
        type="button"
        onClick={() => m.dismissInvite(invite)}
        className="py-1 px-10 text-sm bg-btn-bg text-text border-2 border-transparent cursor-pointer shrink-0"
      >
        Not now
      </button>
    </div>
  );
}
