'use strict';

// A server being replaced can hang up on a request without answering it. The
// call must still settle: the view keeper waits on these calls, and one that
// never settles stops every later re-apply and view switch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ipc = require('../lib/ipc');

test('a call the server hangs up on without a reply settles as null', { timeout: 3000 }, async (t) => {
  const at = path.join(os.tmpdir(), `herdr-radar-ipc-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`);
  const previous = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_SOCKET_PATH = at;

  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', () => socket.end());
  });
  // On Windows HERDR_SOCKET_PATH names a marker file and the pipe sits under it.
  if (process.platform === 'win32') {
    fs.writeFileSync(at, '');
    await new Promise((resolve) => server.listen(`\\\\.\\pipe\\${at}`, resolve));
  } else {
    await new Promise((resolve) => server.listen(at, resolve));
  }
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(at, { force: true });
    if (previous === undefined) delete process.env.HERDR_SOCKET_PATH;
    else process.env.HERDR_SOCKET_PATH = previous;
  });

  assert.equal(await ipc.call('agent.view.set', {}), null);
});
