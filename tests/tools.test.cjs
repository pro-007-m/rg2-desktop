'use strict';

// Run from any working directory: node tests/tools.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tools = require('../data/tools.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/trainer-data.json'), 'utf8'));

// Reproducible samples exercise the public RNG argument without changing globals.
let seed = 0x524732;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
}

for (const [ms, penalty, expected] of [
  [12340, '', '12.34'],
  [60000, '', '1:00.00'],
  [3601200, '', '1:00:01.20'],
  [12340, '+2', '14.34+'],
  [12340, 'DNF', 'DNF'],
]) assert.equal(tools.formatTime(ms, penalty), expected);

const results = [10000, 11000, 12000, 13000, 14000].map(ms => ({ ms, penalty: '' }));
assert.equal(tools.averageOf(results, 5), 12000);
assert.equal(tools.averageOf(results.slice(0, 4), 5), null);
assert.equal(tools.resultValue({ ms: 10000, penalty: '+2' }), 12000);
results[4].penalty = 'DNF';
assert.equal(tools.averageOf(results, 5), 12000);
results[3].penalty = 'DNF';
assert.equal(tools.averageOf(results, 5), Infinity);
assert.equal(tools.averageOf([{ ms: 1000 }, { ms: 2000 }], 2), null);

const axes = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
let sequences = 0;
for (let size = 2; size <= 7; size++) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const sequence = tools.generateScramble(size, 100, random).split(' ');
    assert.equal(sequence.length, 100, `Wrong sequence length for ${size}x${size}`);
    let previousAxis = -1;
    for (const token of sequence) {
      const match = /^(?:(\d)?([RLUDFB])(w)?)(2|')?$/.exec(token);
      assert.ok(match, `Invalid move: ${token}`);
      const width = match[3] ? Number(match[1] || 2) : 1;
      assert.ok(width <= Math.floor(size / 2), `Move too wide: ${size}x${size} ${token}`);
      assert.notEqual(axes[match[2]], previousAxis, `Consecutive axis repeated: ${token}`);
      if (size === 2) assert.ok(['R', 'U', 'F'].includes(match[2]), `Unexpected 2x2 face: ${token}`);
      previousAxis = axes[match[2]];
    }
    sequences++;
  }
}
assert.throws(() => tools.generateScramble(1, 20), RangeError);
assert.throws(() => tools.generateScramble(8, 20), RangeError);
assert.throws(() => tools.generateScramble(3, 0), RangeError);

const permutations = data.azbuka.movePermutations;
const unique = Array.from({ length: 54 }, (_, i) => i);
assert.equal(Object.keys(permutations).length, 36);
for (const [name, permutation] of Object.entries(permutations)) {
  assert.deepEqual([...permutation].sort((a, b) => a - b), unique, `Invalid permutation: ${name}`);
}
for (const face of ['R', 'L', 'U', 'D', 'F', 'B', 'E', 'M', 'S', 'Y', 'X', 'Z']) {
  assert.deepEqual(tools.applyMoves(unique, `${face} ${face} ${face} ${face}`, permutations), unique, `${face} fourth power`);
  assert.deepEqual(tools.applyMoves(unique, `${face} ${face}'`, permutations), unique, `${face} inverse`);
  assert.deepEqual(tools.applyMoves(unique, `${face}2 ${face}2`, permutations), unique, `${face} double turn`);
}

for (const name of ['mainEdge', 'mainCorner', 'dopEdge', 'dopCorner']) {
  const map = data.azbuka[name];
  assert.equal(Object.keys(map).length, 24, `Wrong ${name} mapping size`);
  assert.ok(Object.values(map).every(index => Number.isInteger(index) && index >= 0 && index < 54), `Invalid ${name} identity`);
}
assert.equal(data.azbuka.mainEdge['12'], 3);
assert.equal(data.azbuka.mainCorner['12'], 0);
assert.equal(Object.keys(data.azbuka.slotElementNumbers).length, 7);
for (const alphabet of Object.values(data.azbuka.alphabets)) assert.equal(alphabet.length, 54);

let sourceMappings = 0;
const colorCounts = [...data.azbuka.solvedCube].sort((a, b) => a - b);
for (let trial = 0; trial < 250; trial++) {
  const cube = tools.applyMoves(data.azbuka.solvedCube, tools.generateScramble(3, 19, random), permutations);
  assert.deepEqual([...cube].sort((a, b) => a - b), colorCounts, 'Scramble changed sticker counts');
  for (const [slot, pair] of Object.entries(data.azbuka.slotElementNumbers)) {
    const identity = (cube[pair[0]] + 1) * 10 + cube[pair[1]] + 1;
    const index = (Number(slot) < 3 ? data.azbuka.mainCorner : data.azbuka.mainEdge)[identity];
    assert.ok(Number.isInteger(index), `Unmapped identity ${identity} in slot ${slot}`);
    for (const [name, alphabet] of Object.entries(data.azbuka.alphabets)) {
      assert.ok(alphabet[index] && alphabet[index] !== '-', `Invalid ${name} answer for identity ${identity}`);
    }
    sourceMappings++;
  }
}
assert.equal(sourceMappings, 1750);
assert.equal(data.pll.length, 21);
assert.equal(new Set(data.pll.map(item => item.name)).size, 21);

console.log(`Tools tests passed: formats/averages, ${sequences} generated sequences, 36 permutations, ${sourceMappings} source-derived quiz mappings, 21 PLL cases.`);
