/**
 * Unit tests for the pure multiplayer reconciler (`RemoteAgentRegistry`):
 * `remotePeers` snapshots in, OfficeState calls out. Structural fake office,
 * mirroring existingAgents.test.ts — no React, no real OfficeState.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { RemoteAgent, RemotePeer } from '../../core/src/messages.js';
import { REMOTE_AGENT_ID_BASE } from '../src/constants.js';
import type { RemoteAgentsOffice } from '../src/office/engine/remoteAgents.js';
import { RemoteAgentRegistry } from '../src/office/engine/remoteAgents.js';

const TOOLS = { reading: 'Read', typing: 'remote:typing' };
const PALETTES = 6;

type Call = [string, ...unknown[]];

function fakeOffice(): { os: RemoteAgentsOffice; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    os: {
      addAgent: rec('addAgent'),
      removeAgent: rec('removeAgent'),
      setRemote: rec('setRemote'),
      setAgentActive: rec('setAgentActive'),
      setAgentTool: rec('setAgentTool'),
      showPermissionBubble: rec('showPermissionBubble'),
      clearPermissionBubble: rec('clearPermissionBubble'),
      showWaitingBubble: rec('showWaitingBubble'),
    },
  };
}

function agent(overrides: Partial<RemoteAgent> = {}): RemoteAgent {
  return {
    id: 1,
    palette: 2,
    hueShift: 0,
    status: 'waiting',
    activity: null,
    permission: false,
    awaitingInput: false,
    ...overrides,
  };
}

const peer = (peerId: string, agents: RemoteAgent[], name = peerId): RemotePeer => ({
  peerId,
  name,
  agents,
});

test('a new remote agent becomes a character marked remote, with its palette', () => {
  const { os, calls } = fakeOffice();
  const reg = new RemoteAgentRegistry();
  assert.equal(reg.reconcile(os, [peer('p1', [agent()], 'Alice')], true, PALETTES, TOOLS), true);

  assert.deepEqual(calls.slice(0, 2), [
    ['addAgent', REMOTE_AGENT_ID_BASE, 2, 0],
    ['setRemote', REMOTE_AGENT_ID_BASE, 'Alice', 'p1'],
  ]);
  assert.deepEqual(reg.characters(), [
    {
      id: REMOTE_AGENT_ID_BASE,
      peerId: 'p1',
      peerName: 'Alice',
      status: 'waiting',
      activity: null,
      permission: false,
      awaitingInput: false,
      isAvatar: false,
    },
  ]);
  assert.equal(reg.isRemote(REMOTE_AGENT_ID_BASE), true);
});

test('the same agent id on two peers is two characters', () => {
  const { os } = fakeOffice();
  const reg = new RemoteAgentRegistry();
  reg.reconcile(
    os,
    [peer('p1', [agent({ id: 1 })]), peer('p2', [agent({ id: 1 })])],
    true,
    PALETTES,
    TOOLS,
  );
  assert.deepEqual(
    reg.characters().map((c) => c.id),
    [REMOTE_AGENT_ID_BASE, REMOTE_AGENT_ID_BASE - 1],
  );
});

test('state changes drive animation and bubbles; an unchanged snapshot does nothing', () => {
  const { os, calls } = fakeOffice();
  const reg = new RemoteAgentRegistry();
  const id = REMOTE_AGENT_ID_BASE;
  reg.reconcile(os, [peer('p1', [agent()])], true, PALETTES, TOOLS);

  calls.length = 0;
  reg.reconcile(
    os,
    [peer('p1', [agent({ status: 'active', activity: 'reading' })])],
    true,
    PALETTES,
    TOOLS,
  );
  assert.deepEqual(calls, [
    ['setAgentActive', id, true],
    ['setAgentTool', id, 'Read'],
  ]);

  calls.length = 0;
  reg.reconcile(
    os,
    [peer('p1', [agent({ status: 'active', activity: 'typing', permission: true })])],
    true,
    PALETTES,
    TOOLS,
  );
  assert.deepEqual(calls, [
    ['setAgentTool', id, 'remote:typing'],
    ['showPermissionBubble', id],
  ]);

  calls.length = 0;
  reg.reconcile(os, [peer('p1', [agent({ awaitingInput: true })])], true, PALETTES, TOOLS);
  assert.deepEqual(calls, [
    ['setAgentActive', id, false],
    ['showWaitingBubble', id, true],
    ['setAgentTool', id, null],
    ['clearPermissionBubble', id],
  ]);

  calls.length = 0;
  assert.equal(
    reg.reconcile(os, [peer('p1', [agent({ awaitingInput: true })])], true, PALETTES, TOOLS),
    false,
  );
  assert.deepEqual(calls, []);
});

test('an agent or peer missing from the snapshot is removed', () => {
  const { os, calls } = fakeOffice();
  const reg = new RemoteAgentRegistry();
  reg.reconcile(os, [peer('p1', [agent({ id: 1 }), agent({ id: 2 })])], true, PALETTES, TOOLS);

  calls.length = 0;
  reg.reconcile(os, [peer('p1', [agent({ id: 2 })])], true, PALETTES, TOOLS);
  assert.deepEqual(calls, [['removeAgent', REMOTE_AGENT_ID_BASE]]);

  calls.length = 0;
  reg.reconcile(os, [], true, PALETTES, TOOLS);
  assert.deepEqual(calls, [['removeAgent', REMOTE_AGENT_ID_BASE - 1]]);
  assert.deepEqual(reg.characters(), []);
});

test('a snapshot before the layout is held and applied by flush', () => {
  const { os, calls } = fakeOffice();
  const reg = new RemoteAgentRegistry();
  assert.equal(reg.reconcile(os, [peer('p1', [agent()])], false, PALETTES, TOOLS), false);
  assert.deepEqual(calls, []);

  assert.equal(reg.flush(os, PALETTES, TOOLS), true);
  assert.equal(calls[0]?.[0], 'addAgent');
  assert.equal(reg.flush(os, PALETTES, TOOLS), false);
});

test('a palette index beyond the loaded palettes wraps instead of breaking the sprite', () => {
  const { os, calls } = fakeOffice();
  const reg = new RemoteAgentRegistry();
  reg.reconcile(os, [peer('p1', [agent({ palette: 9 })])], true, PALETTES, TOOLS);
  assert.deepEqual(calls[0], ['addAgent', REMOTE_AGENT_ID_BASE, 3, 0]);
});

test('speakerOf names the oldest character of an office, or null when it shows none', () => {
  const { os } = fakeOffice();
  const reg = new RemoteAgentRegistry();
  reg.reconcile(
    os,
    [peer('p1', [agent({ id: 1 }), agent({ id: 2 })]), peer('p2', [])],
    true,
    PALETTES,
    TOOLS,
  );
  assert.equal(reg.speakerOf('p1'), REMOTE_AGENT_ID_BASE);
  assert.equal(reg.speakerOf('p2'), null);
  assert.equal(reg.speakerOf('gone'), null);

  // Its oldest agent leaves: the next one speaks for the office.
  reg.reconcile(os, [peer('p1', [agent({ id: 2 })])], true, PALETTES, TOOLS);
  assert.equal(reg.speakerOf('p1'), REMOTE_AGENT_ID_BASE - 1);
});
