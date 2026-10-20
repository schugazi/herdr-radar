'use strict';

// A worktree's corner says "cut from the project above". In the plugin's own
// order that is always true, because the family key holds a family in one
// block. In Herdr's order (`order = off`) a worktree opened later is appended
// to the end of the list, and the corner would hang it off whichever project
// sits above it (#54). Such a worktree is drawn detached: a top-level row with
// its worktree mark, no tee into a stranger, and no repo row of its own, since
// the repo is already on the panel as the real parent (#62).

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const { Frame } = require('../lib/frame');

// Herdr's workspace order from the reports: app, its first worktree, an
// unrelated project, a worktree of app opened later, another project.
const entries = ['app', 'feature', 'other', 'hotfix', 'scratch'].map((ws) => ({
  pane: `${ws}:p1`,
  workspace: ws,
  tab: `${ws}:t1`,
  name: 'claude',
  title: 'x',
}));
const parents = new Map([
  ['feature', 'app'],
  ['hotfix', 'app'],
]);
const worktrees = new Map([
  ['feature', 'app'],
  ['hotfix', 'app'],
]);

function treeFor(viewMode, list = entries) {
  const frame = new Frame('test');
  const ranks = frame.sortKeys(list, parents, worktrees);
  const displayEntries = frame.displayOrder(list, viewMode, ranks);
  return { tree: frame.strayWorktrees(displayEntries, ranks), displayEntries };
}

async function groupsFor(t, list, tree) {
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens);
    return true;
  });
  const labels = new Map(list.map((entry) => [entry.workspace, entry.workspace]));
  await state.writeGroups('test', list, labels, new Set(), {
    parentOf: tree.parentOf,
    orphanRepo: tree.orphanRepo,
    detached: tree.detached,
  });
  return sent;
}

test('in Herdr order a worktree away from its family is detached, not orphaned', () => {
  const { tree } = treeFor(null);
  assert.equal(tree.parentOf.get('feature'), 'app', 'the worktree under its parent keeps the tree');
  assert.equal(tree.parentOf.has('hotfix'), false, 'the stray is no longer a child');
  assert.equal(tree.detached.has('hotfix'), true, 'it is drawn detached');
  assert.equal(tree.orphanRepo.has('hotfix'), false, 'its parent is listed, so it is no orphan');
  assert.equal(tree.nested('hotfix'), false, 'and it sits at the top level');
});

test('in the plugin order a family is one block, so nothing is detached', () => {
  const { tree, displayEntries } = treeFor('grouped');
  const order = [...new Set(displayEntries.map((entry) => entry.workspace))];
  const family = ['app', 'feature', 'hotfix'].map((ws) => order.indexOf(ws)).sort((a, b) => a - b);
  assert.equal(family[2] - family[0], 2, `the family is contiguous in ${order.join(', ')}`);
  assert.equal(tree.parentOf.get('hotfix'), 'app');
  assert.equal(tree.detached.size, 0);
});

test('writeGroups draws the stray with no tee and no second copy of its repo', async (t) => {
  const { tree } = treeFor(null);
  const sent = await groupsFor(t, entries, tree);
  assert.match(sent.get('feature:p1').group, /[├└]─ /, 'the attached worktree keeps its corner');
  assert.doesNotMatch(sent.get('hotfix:p1').group, /[├└]─/, 'no corner into the project above');
  assert.equal(sent.get('hotfix:p1').group_parent, null, 'no repo row: app is already on the panel');
  const parentRows = [...sent.values()].filter((tokens) => tokens.group === 'app' || tokens.group_parent === 'app');
  assert.equal(parentRows.length, 1, 'app appears once');
  assert.equal(sent.get('other:p1').group_parent, null, 'the project above is left alone');
});

test('a worktree whose parent is not listed still gets its repo row', async (t) => {
  const list = entries.filter((entry) => entry.workspace !== 'app');
  const { tree } = treeFor(null, list);
  assert.equal(tree.orphanRepo.get('hotfix'), 'app');
  assert.equal(tree.detached.has('hotfix'), false);
  const sent = await groupsFor(t, list, tree);
  assert.equal(sent.get('hotfix:p1').group_parent, 'app', 'the repo name stands in for the absent parent');
});
