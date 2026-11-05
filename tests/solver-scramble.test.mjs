import assert from 'node:assert/strict';
import '../data/tools.js';
import { SOLVED, FACE_NAMES, applyAlg, invertAlg, centers, stateKey, validate } from '../data/solver/core.mjs';
import { SCRAMBLE_LENGTH, inputCenters, solvedWithCenters, generateScrambleMoves, createScramble, restoreScramble } from '../data/solver/scramble.mjs';

function seeded(start) {
  let value = start >>> 0;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 0x100000000; };
}
const equalState = (left, right, message) => assert.deepEqual([...left], [...right], message);
const axis = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const clone = value => JSON.parse(JSON.stringify(value));
assert.equal(SCRAMBLE_LENGTH, 20);
assert.equal(typeof globalThis.RG2Tools.generateScramble, 'function');

const inputs = [
  SOLVED,
  applyAlg(SOLVED, 'x'),
  applyAlg(SOLVED, "y z'"),
  applyAlg(SOLVED, 'x2 U R F2 L D'),
  solvedWithCenters([5, 0, 4, 2, 1, 3]),
  Uint8Array.from({ length: 54 }, (_, index) => index % 9 === 4 ? Math.floor(index / 9) : 255),
];
let tested = 0;
for (const [frame, input] of inputs.entries()) {
  const inputSnapshot = [...input];
  for (let sample = 0; sample < 30; sample++) {
    const record = createScramble(input, { rng: seeded((frame + 1) * 1000 + sample + 1) });
    assert.equal(record.version, 1);
    assert.equal(record.moves.length, 20);
    assert.equal(record.state.length, 54);
    assert.deepEqual(record.centers, centers(input));
    assert.deepEqual(record.orientation, Object.fromEntries(FACE_NAMES.map((face, index) => [face, centers(input)[index]])));
    assert.equal(record.inputHash, stateKey(record.state));
    assert.equal(record.hash, record.inputHash);
    for (let index = 0; index < record.moves.length; index++) {
      const move = record.moves[index];
      assert.match(move, /^[URFDLB](?:2|')?$/);
      if (index) assert.notEqual(axis[move[0]], axis[record.moves[index - 1][0]], 'Adjacent axis repeated');
    }
    equalState(applyAlg(solvedWithCenters(input), record.moves), record.state, 'All 54 generated facelets must replay');
    equalState(applyAlg(record.state, invertAlg(record.moves)), solvedWithCenters(input), 'Inverse must return the center-frame solved cube');
    assert.equal(validate(record.state).valid, true, 'Generated painted state must be legal');
    assert.deepEqual(restoreScramble(clone(record), record.state), record, 'Serialized matching record must restore');
    assert.deepEqual([...input], inputSnapshot, 'Generator must not modify the painted input');
    tested++;
  }
}

// Using the existing generator and the standalone fallback gives the same draws.
const first = createScramble(SOLVED, { rng: seeded(177) });
const fallback = createScramble(SOLVED, { rng: seeded(177), generator: null });
assert.deepEqual(first.moves, fallback.moves);
equalState(first.state, fallback.state);
let calls = 0;
const injected = generateScrambleMoves({ generator(size, length, rng) {
  calls++; assert.equal(size, 3); assert.equal(length, 20);
  return globalThis.RG2Tools.generateScramble(size, length, rng);
}, rng: seeded(42) });
assert.equal(calls, 1); assert.equal(injected.length, 20);

// Even deterministic/failed entropy cannot repeat the immediately last sequence.
const repeated = createScramble(SOLVED, { rng: () => 0 });
const next = createScramble(SOLVED, { rng: () => 0, previousMoves: repeated.moves });
assert.notDeepEqual(next.moves, repeated.moves);
assert.notEqual(next.hash, repeated.hash);
assert.equal(next.moves.length, 20);
equalState(applyAlg(SOLVED, next.moves), next.state);

// Saved provenance is rejected on any mismatch, including a forged matching hash.
const saved = createScramble(SOLVED, { rng: seeded(91) });
const another = createScramble(SOLVED, { rng: seeded(92) });
assert.equal(restoreScramble(saved, another.state), null, 'Stale input must not show old scramble');
assert.equal(restoreScramble({ ...saved, inputHash: another.hash, hash: another.hash, state: another.state }, another.state), null, 'Hash alone cannot authorize nonmatching moves');
assert.equal(restoreScramble({ ...saved, version: 2 }, saved.state), null);
assert.equal(restoreScramble({ ...saved, moves: saved.moves.slice(1) }, saved.state), null);
assert.equal(restoreScramble({ ...saved, moves: ['Rw', ...saved.moves.slice(1)] }, saved.state), null);
assert.equal(restoreScramble({ ...saved, moves: ['x', ...saved.moves.slice(1)] }, saved.state), null);
assert.equal(restoreScramble({ ...saved, centers: [0, 0, 2, 3, 4, 5] }, saved.state), null);
assert.equal(restoreScramble({ ...saved, centers: Array.from(SOLVED) }, saved.state), null);
assert.equal(restoreScramble({ ...saved, state: SOLVED }, saved.state), null);
assert.equal(restoreScramble(null, saved.state), null);
assert.equal(restoreScramble(saved, null), null);
const incomplete = [...saved.state]; incomplete[0] = 255;
assert.equal(restoreScramble(saved, incomplete), null);
const changedCenters = [...saved.state]; [changedCenters[4], changedCenters[13]] = [changedCenters[13], changedCenters[4]];
assert.equal(restoreScramble(saved, changedCenters), null);

for (const bad of [null, [], [0], [0, 0, 2, 3, 4, 5], [0, 1, 2, 3, 4, 255], [0, 1, 2, 3, 4, -1], [0, 1, 2, 3, 4, 5.5]]) {
  assert.throws(() => inputCenters(bad), RangeError);
  assert.throws(() => createScramble(bad), RangeError);
}
const badFrame = SOLVED.slice(); badFrame[4] = badFrame[13];
assert.throws(() => createScramble(badFrame), RangeError);
assert.throws(() => generateScrambleMoves({ generator: () => 'R U' }));
assert.throws(() => generateScrambleMoves({ generator: null, rng: () => 1 }), RangeError);

console.log(`Scramble tests passed: ${tested} canonical/rotated/custom/incomplete-input samples, 20 outer moves, complete facelet replay/inverse, preserved centers, stale/forged-record rejection and no repeated last sequence.`);
