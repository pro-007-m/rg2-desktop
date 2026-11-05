import assert from 'node:assert/strict';
import { SOLVED, CENTER_INDICES, applyAlg, centers, invertAlg, validate } from '../data/solver/core.mjs';
import { orientForCross, determineCrossColor, normalizeCrossPreference, displayFromInput, inputFromDisplay } from '../data/solver/orientation.mjs';

const labels = Array.from({ length: 54 }, (_, index) => index);
const frames = [{ state: Uint8Array.from(SOLVED), moves: [] }], seen = new Set([centers(SOLVED).join(',')]);
for (let head = 0; head < frames.length; head++) {
  for (const move of ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2']) {
    const state = applyAlg(frames[head].state, [move]), key = centers(state).join(',');
    if (!seen.has(key)) { seen.add(key); frames.push({ state, moves: [...frames[head].moves, move] }); }
  }
}
assert.equal(frames.length, 24);

let checks = 0;
function checkOrientation(raw, color) {
  const original = Array.from(raw), result = orientForCross(raw, color);
  assert.equal(result.validCenters, true);
  assert.equal(result.error, undefined);
  assert.equal(result.state[31], color, 'Selected cross color must be on D');
  assert.deepEqual(Array.from(raw), original, 'Original input was mutated');
  assert.deepEqual([...result.displayToInput].sort((a, b) => a - b), labels);
  assert.deepEqual([...result.inputToDisplay].sort((a, b) => a - b), labels);
  assert.deepEqual(Array.from(applyAlg(Uint8Array.from(labels), result.moves)), result.displayToInput);
  assert.deepEqual(result.state, displayFromInput(raw, result));
  assert.deepEqual(inputFromDisplay(result.state, result), original);
  for (let index = 0; index < 54; index++) {
    assert.equal(result.inputToDisplay[result.displayToInput[index]], index);
    assert.equal(result.displayToInput[result.inputToDisplay[index]], index);
    assert.equal(result.state[index], original[result.displayToInput[index]]);
  }
  const normalColors = original.every(value => Number.isInteger(value) && value >= 0 && value < 6);
  if (normalColors) {
    assert.deepEqual(Array.from(applyAlg(raw, result.moves)), result.state);
    assert.deepEqual(Array.from(applyAlg(result.state, invertAlg(result.moves))), original);
  }
  // Repainting a displayed sticker changes exactly its original input cell.
  const displayIndex = (checks * 17) % 54, edited = [...result.state];
  edited[displayIndex] = 255;
  const painted = inputFromDisplay(edited, result);
  const changed = labels.filter(index => painted[index] !== original[index]);
  assert.deepEqual(changed, original[result.displayToInput[displayIndex]] === 255 ? [] : [result.displayToInput[displayIndex]]);
  checks++;
}

const scramble = "R U2 F' L D2 B U R' F2 D L2 U' B2";
for (const frame of frames) {
  const raw = applyAlg(applyAlg(SOLVED, scramble), frame.moves);
  assert.equal(validate(raw).valid, true);
  for (let color = 0; color < 6; color++) checkOrientation(raw, color);
}

// All 720 custom center schemes are legitimate relative color conventions.
function* permutations(values) {
  if (!values.length) { yield []; return; }
  for (let index = 0; index < values.length; index++) {
    for (const rest of permutations(values.filter((_, i) => i !== index))) yield [values[index], ...rest];
  }
}
let schemes = 0;
for (const colors of permutations([0, 1, 2, 3, 4, 5])) {
  const raw = Array.from(SOLVED, faceColor => colors[faceColor]);
  for (let color = 0; color < 6; color++) checkOrientation(raw, color);
  schemes++;
}
assert.equal(schemes, 720);

const incomplete = Array.from(SOLVED);
for (let index = 0; index < 54; index++) if (!CENTER_INDICES.includes(index)) incomplete[index] = [-1, null, 255][index % 3];
for (let color = 0; color < 6; color++) checkOrientation(incomplete, color);

for (const invalid of [null, [], Array(53).fill(0), Array(55).fill(0)]) {
  const result = orientForCross(invalid, 0);
  assert.equal(result.validCenters, false);
  assert.equal(result.error.code, 'SIZE');
  assert.deepEqual(result.moves, []);
}
for (const value of [-1, 255, null, undefined, '0', NaN, 6]) {
  const raw = Array.from(SOLVED); raw[4] = value;
  const result = orientForCross(raw, 0);
  assert.equal(result.validCenters, false);
  assert.equal(result.error.code, 'CENTERS');
  assert.deepEqual(result.displayToInput, labels);
}
const duplicate = Array.from(SOLVED); duplicate[4] = duplicate[13];
assert.equal(orientForCross(duplicate, 0).validCenters, false);
const previous = orientForCross(SOLVED, 0), fallback = orientForCross(duplicate, 0, { fallback: previous });
assert.equal(fallback.validCenters, false);
assert.equal(fallback.usedFallback, true);
assert.deepEqual(fallback.moves, previous.moves);
assert.deepEqual(fallback.displayToInput, previous.displayToInput);
assert.deepEqual(inputFromDisplay(fallback.state, fallback), duplicate);
assert.deepEqual(orientForCross(duplicate, 0, { fallback: 'R U' }).moves, []);
assert.deepEqual(orientForCross(duplicate, 0, { fallback: '(' }).moves, []);

for (const invalidColor of ['pink', 6, -1, null, NaN]) {
  const result = orientForCross(SOLVED, invalidColor);
  assert.equal(result.validCenters, true);
  assert.equal(result.error.code, 'CROSS_COLOR');
}
for (let color = 0; color < 6; color++) {
  assert.equal(determineCrossColor(SOLVED, color, 5), color);
  assert.equal(determineCrossColor(SOLVED, String(color), 5), color);
  assert.equal(determineCrossColor(SOLVED, 'auto', color), color);
  assert.equal(normalizeCrossPreference(String(color)), color);
}
assert.equal(determineCrossColor(SOLVED, 'auto'), 0);
assert.equal(determineCrossColor(SOLVED, 'auto', 'invalid'), 0);
assert.equal(normalizeCrossPreference(null), 'auto');
assert.equal(normalizeCrossPreference(''), 'auto');
assert.equal(normalizeCrossPreference('auto'), 'auto');
assert.throws(() => displayFromInput([], previous), RangeError);
assert.throws(() => inputFromDisplay(SOLVED, Array(54).fill(0)), RangeError);
assert.throws(() => displayFromInput(SOLVED, Array(54).fill(-1)), RangeError);

console.log(`Orientation tests passed: ${frames.length} physical frames, ${schemes} custom center schemes, ${checks} cross/map/painting checks, unknown stickers and safe invalid-center fallbacks.`);
