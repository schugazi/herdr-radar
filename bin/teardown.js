#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// The uninstall path (schu fork; replaces upstream's `unconfigure`, which also
// removed config blocks this fork never writes): stop the daemon, clear every
// pane and workspace token it wrote, and hand the Agents panel back to
// Herdr's own order — a plain stop leaves the view override in place.
//
//   node bin/teardown.js

const view = require('../lib/view');
const { stopAnimator } = require('../lib/stop');

(async () => {
  const stopped = await stopAnimator({ purge: true });
  const reply = await view.clear();
  console.log(`daemon ${stopped ? 'stopped' : 'still running'}, tokens purged, view ${reply && !reply.error ? 'cleared' : 'not cleared'}`);
  process.exit(stopped ? 0 : 1);
})();
