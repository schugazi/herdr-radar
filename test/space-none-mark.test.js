'use strict';

// Herdr draws its own ` · ` between a Spaces mark and the workspace name. With
// a middle dot as the no-agent mark, a plain shell workspace read `· · name`,
// two dots that look like two states (#61, #63).

const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../lib/state');

test('a Space with no agent is not marked with a middle dot', () => {
  const mark = state.spaceMark('none');
  assert.notEqual(mark, '·', "Herdr's separator is a middle dot");
  assert.equal(mark, '◦');
  assert.equal([...mark].length, 1, 'one character, so names stay aligned');
});
