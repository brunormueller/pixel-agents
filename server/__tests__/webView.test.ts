import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// A VS Code window opened in a browser ("Web" button): the window's own loopback
// server, pages proven by ?token=, the host (VS Code) owning hooks and restore.
// Isolated temp HOME: the handshake reads ~/.pixel-agents and ~/.claude.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { createHttpServer } = await import('../src/httpServer.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');

type Handle = Awaited<ReturnType<typeof createHttpServer>>;

const TOKEN = 'web-view-token';

async function startWebView(pages: number[]): Promise<Handle> {
  const staticDir = path.join(tmpBase, 'webview');
  fs.mkdirSync(staticDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>office</html>');
  return createHttpServer({
    embedded: false,
    quiet: true,
    hostOwned: true,
    configNamespace: 'vscode',
    token: TOKEN,
    store: new AgentStateStore(),
    staticDir,
    onPagesChanged: (n) => pages.push(n),
  });
}

/** Open a page's socket and collect what it receives. */
async function page(port: number, token?: string) {
  const url = `ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`;
  const socket = new WebSocket(url, { headers: { origin: `http://127.0.0.1:${port}` } });
  const messages: Array<Record<string, unknown>> = [];
  socket.on('message', (d: Buffer) => messages.push(JSON.parse(d.toString())));
  await new Promise((r) => socket.once('open', r));
  return { socket, messages };
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe('web view (a VS Code window in a browser)', () => {
  let server: Handle | null = null;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-web-view-'));
  });

  afterEach(async () => {
    await server?.app.close();
    server = null;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('serves the office page', async () => {
    server = await startWebView([]);
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(await res.text()).toContain('office');
  });

  it('counts tokened pages from their webviewReady to their close; untokened ones never', async () => {
    const pages: number[] = [];
    server = await startWebView(pages);
    const watcher = await page(server.port);
    watcher.socket.send(JSON.stringify({ type: 'webviewReady' }));
    await settle();
    expect(pages).toEqual([]);

    const mine = await page(server.port, TOKEN);
    mine.socket.send(JSON.stringify({ type: 'webviewReady' }));
    mine.socket.send(JSON.stringify({ type: 'webviewReady' })); // a reload handshake counts once
    await settle();
    expect(pages).toEqual([1]);
    mine.socket.close();
    await settle();
    expect(pages).toEqual([1, 0]);
    watcher.socket.close();
  });

  it('leaves hooks to VS Code: no consent ask, and a toggle only answers the truth', async () => {
    server = await startWebView([]);
    const mine = await page(server.port, TOKEN);
    mine.socket.send(JSON.stringify({ type: 'webviewReady' }));
    await settle(800);
    expect(mine.messages.some((m) => m.type === 'hooksStatus')).toBe(true);
    expect(mine.messages.some((m) => m.type === 'hooksConsentRequest')).toBe(false);

    mine.socket.send(
      JSON.stringify({ type: 'setHooksEnabled', providerId: 'claude', enabled: true }),
    );
    await settle(800);
    const statuses = mine.messages.filter((m) => m.type === 'hooksStatus');
    expect(statuses.at(-1)).toMatchObject({ providerId: 'claude', installed: false });
    expect(fs.existsSync(path.join(tmpBase, '.claude', 'settings.json'))).toBe(false);
    mine.socket.close();
  });
});
