import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  LAYOUT_FILE_DIR,
  MEETING_MAX_NOTES_LENGTH,
  MEETING_NOTES_DIR,
  MEETING_NOTES_MAX_INPUT_CHARS,
  MEETING_NOTES_TIMEOUT_MS,
  PIXEL_AGENTS_SKIP_HOOK_ENV,
} from '../../constants.js';
import {
  sanitizeMeetingTitle,
  sanitizeMultiline,
  sanitizeName,
  sanitizeText,
} from '../../multiplayer/protocol.js';

type WsSend = (message: Record<string, unknown>) => void;

/** One transcribed sentence or chat line, as the webview sends it. */
export interface MeetingLine {
  name: string;
  text: string;
  ts: number;
}

export interface NotesRequest {
  title: string;
  transcript: MeetingLine[];
  chat: MeetingLine[];
}

/** Runs one prompt through Claude and resolves with its answer. Injectable for tests. */
export type ClaudeRunner = (
  prompt: string,
  opts: { cwd: string; timeoutMs: number },
) => Promise<string>;

/** Validate the lines the page sent: sanitized names and text, oldest first, capped in total size. */
export function sanitizeLines(raw: unknown, budget: number): MeetingLine[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetingLine[] = [];
  let used = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const text = sanitizeText(e.text, 2000);
    if (!text) continue;
    used += text.length;
    if (used > budget) break;
    out.push({
      name: sanitizeName(e.name) || 'Someone',
      text,
      ts: Number.isSafeInteger(e.ts) ? (e.ts as number) : 0,
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

const clock = (ts: number): string =>
  ts > 0
    ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '--:--';

const lineText = (lines: MeetingLine[]): string =>
  lines.map((l) => `[${clock(l.ts)}] ${l.name}: ${l.text}`).join('\n');

/** The prompt Claude writes the notes from. Pure. */
export function buildNotesPrompt(req: NotesRequest, date: Date): string {
  const people = [...new Set([...req.transcript, ...req.chat].map((l) => l.name))];
  return [
    `You are writing the notes of a team meeting called "${req.title}", held on ${date.toISOString().slice(0, 10)}` +
      (people.length > 0 ? ` with ${people.join(', ')}.` : '.'),
    'The transcript below comes from live speech recognition, one line per sentence, so expect',
    'misheard words: infer what was meant from context, but never add anything the meeting did not say.',
    'Messages typed in the meeting chat follow the transcript.',
    '',
    'Write the notes in the language most of the meeting was held in, every heading included.',
    'Markdown, with these sections — leave a section out when there is nothing for it:',
    '## Summary — two to five sentences.',
    '## Decisions — bullet list.',
    '## Action items — "- [ ] Owner: task (due date, if one was said)".',
    '## Key points — bullet list.',
    '## Open questions — bullet list.',
    'Keep it under 400 words. Reply with the notes only: no preamble, no closing remarks.',
    '',
    '<transcript>',
    lineText(req.transcript) || '(no transcript)',
    '</transcript>',
    '<chat>',
    lineText(req.chat) || '(no chat)',
    '</chat>',
  ].join('\n');
}

/** "2026-09-24-1530-weekly-sync.md", local time. Pure. */
export function meetingFileName(title: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug =
    title
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'meeting';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}-${slug}.md`;
}

/** The saved file: notes first, then the full transcript and chat. Pure. */
export function renderMeetingFile(req: NotesRequest, notes: string, date: Date): string {
  return [
    `# ${req.title}`,
    '',
    `_${date.toLocaleString()} — notes written by Claude from the live transcript._`,
    '',
    notes.trim(),
    '',
    '---',
    '',
    '## Transcript',
    '',
    lineText(req.transcript) || '_No transcript._',
    '',
    '## Chat',
    '',
    lineText(req.chat) || '_No chat._',
    '',
  ].join('\n');
}

/**
 * The person's own Claude Code, headless: `claude -p` reads the prompt from
 * stdin and prints the answer. No tools (it only has to write), no saved
 * session (nothing lands in ~/.claude/projects for the office to adopt), and
 * our hook script told to stay quiet, so this run never appears as an agent.
 */
export const runClaudeCli: ClaudeRunner = (prompt, { cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, [PIXEL_AGENTS_SKIP_HOOK_ENV]: '1' };
    // A server started from inside a Claude Code session would otherwise be refused as nested.
    delete env['CLAUDECODE'];
    delete env['CLAUDE_CODE_ENTRYPOINT'];
    const win = process.platform === 'win32';
    // Windows resolves claude(.cmd/.exe) through the shell; every argument here is a fixed literal.
    const args = [
      '-p',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--tools',
      win ? '""' : '',
    ];
    let child;
    try {
      child = spawn('claude', args, { cwd, env, shell: win, windowsHide: true });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let out = '';
    let errText = '';
    let settled = false;
    const finish = (err: Error | null, value = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      if (win && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill('SIGKILL');
      finish(new Error('Claude took too long to write the notes.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      if (out.length < MEETING_MAX_NOTES_LENGTH * 4) out += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (errText.length < 8192) errText += chunk;
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(
        err.code === 'ENOENT'
          ? new Error('Claude Code (the `claude` command) was not found on this machine.')
          : err,
      );
    });
    child.on('close', (code) => {
      if (code === 0 && out.trim()) return finish(null, out);
      // Claude Code reports some failures ("Not logged in · Please run /login") on stdout.
      const reason = (errText.trim() || out.trim()).split('\n').pop() ?? '';
      if (/not recognized|command not found|no such file/i.test(reason)) {
        return finish(
          new Error('Claude Code (the `claude` command) was not found on this machine.'),
        );
      }
      finish(
        new Error(`Claude could not write the notes${reason ? `: ${reason.slice(0, 300)}` : '.'}`),
      );
    });
    child.stdin.on('error', () => {
      /* the process died before reading everything; 'close' reports it */
    });
    child.stdin.end(prompt, 'utf-8');
  });

export interface MeetingNotesOptions {
  runClaude?: ClaudeRunner;
  /** Where notes are saved (default ~/.pixel-agents/meetings). */
  dir?: string;
  timeoutMs?: number;
}

/**
 * Meeting notes by Claude: the page sends the transcript (and chat) it
 * collected, Claude Code writes the notes, and notes + transcript are saved
 * as markdown under ~/.pixel-agents/meetings/. The transcript leaves the
 * machine only as far as the person's own Claude Code sends it.
 */
export class MeetingNotesService {
  private busy = false;
  private readonly runClaude: ClaudeRunner;
  private readonly dir: string;
  private readonly timeoutMs: number;

  constructor(options: MeetingNotesOptions = {}) {
    this.runClaude = options.runClaude ?? runClaudeCli;
    this.dir = options.dir ?? path.join(os.homedir(), LAYOUT_FILE_DIR, MEETING_NOTES_DIR);
    this.timeoutMs = options.timeoutMs ?? MEETING_NOTES_TIMEOUT_MS;
  }

  async generate(msg: Record<string, unknown>, reply?: WsSend): Promise<void> {
    const requestId = sanitizeText(msg.requestId, 64);
    const answer = (result: Record<string, unknown>) =>
      reply?.({ type: 'meetingNotesResult', requestId, ...result });
    const half = MEETING_NOTES_MAX_INPUT_CHARS / 2;
    const req: NotesRequest = {
      title: sanitizeMeetingTitle(msg.title) || 'Meeting',
      transcript: sanitizeLines(msg.transcript, half),
      chat: sanitizeLines(msg.chat, half),
    };
    if (req.transcript.length === 0 && req.chat.length === 0) {
      answer({
        ok: false,
        error: 'Nothing to summarize yet: turn on transcription or chat first.',
      });
      return;
    }
    if (this.busy) {
      answer({ ok: false, error: 'Claude is already writing notes. Try again in a moment.' });
      return;
    }
    this.busy = true;
    const date = new Date();
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const raw = await this.runClaude(buildNotesPrompt(req, date), {
        cwd: this.dir,
        timeoutMs: this.timeoutMs,
      });
      const notes = sanitizeMultiline(raw, MEETING_MAX_NOTES_LENGTH);
      if (!notes) throw new Error('Claude answered with nothing.');
      let savedTo: string | undefined;
      try {
        const file = path.join(this.dir, meetingFileName(req.title, date));
        fs.writeFileSync(file, renderMeetingFile(req, notes, date), { mode: 0o600 });
        savedTo = file;
      } catch (err) {
        console.warn(`[Pixel Agents] Meeting notes: could not save: ${err}`);
      }
      console.log(`[Pixel Agents] Meeting notes written${savedTo ? `: ${savedTo}` : ''}`);
      answer({ ok: true, text: notes, ...(savedTo ? { savedTo } : {}) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[Pixel Agents] Meeting notes failed: ${error}`);
      answer({ ok: false, error });
    } finally {
      this.busy = false;
    }
  }
}
