import assert from 'node:assert/strict';
import {
  FACE_NAMES, FACELETS, CENTER_INDICES, CORNER_FACELETS, EDGE_FACELETS,
  SOLVED, MOVE_TOKENS, MOVE_PERMUTATIONS, parseAlg, invertAlg, applyAlg, applyMove,
  analyze, validate, centers, stateKey, isCross, solvedSlots, isF2L, isOLL, isSolved,
  areCornersSolved, areEdgesOriented, rotateToCross, restoreFrameSequence, moveInfo,
} from '../data/solver/core.mjs';
import { buildCrossTable, searchCross, searchF2L } from '../data/solver/search.mjs';

let seed = 0xc0f0c011;
const random = max => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; };
const unique = Uint8Array.from({ length: 54 }, (_, i) => i);
const equalState = (a, b, message) => assert.deepEqual([...a], [...b], message);
const hasError = (state, code) => assert.ok(validate(state).errors.some(error => error.code === code), code);

assert.deepEqual(FACE_NAMES, ['U', 'R', 'F', 'D', 'L', 'B']);
assert.equal(new Set(FACELETS.map(item => item.position.join(',') + '/' + item.normal.join(','))).size, 54);
assert.equal(FACELETS.length, 54);
assert.equal(Object.keys(MOVE_PERMUTATIONS).length, 54);
for (const [token, permutation] of Object.entries(MOVE_PERMUTATIONS)) {
  assert.deepEqual([...permutation].sort((a, b) => a - b), [...unique], token + ' permutation');
  const base = token.replace(/[2']/g, '');
  equalState(applyAlg(unique, Array(4).fill(base)), unique, base + ' fourth power');
  equalState(applyAlg(unique, [token, ...invertAlg([token])]), unique, token + ' inverse');
  assert.ok(moveInfo(token).layers.every(layer => [-1, 0, 1].includes(layer)));
}
for (const face of FACE_NAMES) {
  const index = FACE_NAMES.indexOf(face) * 9;
  equalState(applyMove(unique, face).slice(index, index + 9), Uint8Array.from([6, 3, 0, 7, 4, 1, 8, 5, 2], i => index + i), face + ' clockwise face grid');
}

// Independent standard cubie fixtures establish orientation and move direction.
const fixtures = {
  U: { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0) },
  R: { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2], ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0], eo: Array(12).fill(0) },
  F: { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0], ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11], eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0] },
};
for (const [move, fixture] of Object.entries(fixtures)) {
  const actual = analyze(applyMove(SOLVED, move));
  for (const field of ['cp', 'co', 'ep', 'eo']) assert.deepEqual([...actual[field]], fixture[field], move + ' ' + field);
}
for (const [left, right] of [
  ['Rw', "R M'"], ['Lw', 'L M'], ['Uw', "U E'"], ['Dw', 'D E'], ['Fw', 'F S'], ['Bw', "B S'"],
  ['x', "R M' L'"], ['y', "U E' D'"], ['z', "F S B'"], ['2R', "M'"], ['3Rw', 'x'],
]) equalState(applyAlg(unique, left), applyAlg(unique, right), left + ' identity');

assert.deepEqual(parseAlg("r U2’ r’"), ['Rw', 'U2', "Rw'"]);
assert.deepEqual(parseAlg('[R,U]'), parseAlg("R U R' U'"));
assert.deepEqual(parseAlg('[R:U2]'), parseAlg("R U2 R'"));
assert.deepEqual(parseAlg("(R U)3'"), parseAlg("U' R' U' R' U' R'"));
assert.deepEqual(parseAlg("[R,(U F)2]2"), parseAlg("R U F U F R' F' U' F' U' R U F U F R' F' U' F' U'"));
assert.deepEqual(parseAlg("R2' 2R' 2U2 x’ · (L U L’)²"), ['R2', 'M', 'E2', "x'", 'L', 'U', "L'", 'L', 'U', "L'"]);
assert.deepEqual(parseAlg("R3 M3' y3 R4 U0 F10"), ["R'", 'M', "y'", 'F2']);
assert.deepEqual(parseAlg("R'3"), ['R']);
for (const invalid of ['Q', "R2'2", "R''", '[R,U', '(R U]', 'R]', '9Rw', '(R)10001']) assert.throws(() => parseAlg(invalid), SyntaxError, invalid);

assert.equal(validate(SOLVED).valid, true);
assert.ok(isCross(SOLVED) && isF2L(SOLVED) && isOLL(SOLVED) && isSolved(SOLVED));
assert.deepEqual(solvedSlots(SOLVED), ['FR', 'FL', 'BL', 'BR']);
assert.ok(areCornersSolved(SOLVED) && areEdgesOriented(SOLVED));
const unfilled = SOLVED.slice(); unfilled[0] = 255; hasError(unfilled, 'UNFILLED');
const counts = SOLVED.slice(); counts[0] = 1; hasError(counts, 'COLOR_COUNT');
const badCenters = SOLVED.slice(); [badCenters[4], badCenters[13]] = [badCenters[13], badCenters[4]]; assert.equal(validate(badCenters).valid, false);
const flipped = SOLVED.slice(); [flipped[5], flipped[10]] = [flipped[10], flipped[5]]; hasError(flipped, 'EDGE_FLIP');
const twisted = SOLVED.slice(); [twisted[8], twisted[9], twisted[20]] = [twisted[9], twisted[20], twisted[8]]; hasError(twisted, 'CORNER_TWIST');
const mirrored = SOLVED.slice(); [mirrored[9], mirrored[20]] = [mirrored[20], mirrored[9]]; hasError(mirrored, 'CORNER_COLORS');
const odd = SOLVED.slice();
for (let i = 0; i < 2; i++) [odd[EDGE_FACELETS[0][i]], odd[EDGE_FACELETS[1][i]]] = [odd[EDGE_FACELETS[1][i]], odd[EDGE_FACELETS[0][i]]];
hasError(odd, 'PARITY');
assert.ok(validate(odd).errors.find(error => error.code === 'PARITY').indices === undefined, 'Parity must not guess a bad sticker');
assert.equal(validate([0]).valid, false);

const transitions = Object.fromEntries(MOVE_TOKENS.map(move => [move, analyze(applyMove(SOLVED, move))]));
const allTokens = Object.keys(MOVE_PERMUTATIONS);
for (let trial = 0; trial < 500; trial++) {
  const moves = Array.from({ length: 30 }, () => allTokens[random(allTokens.length)]);
  const state = applyAlg(SOLVED, moves);
  assert.equal(validate(state).valid, true, moves.join(' '));
  equalState(applyAlg(state, invertAlg(moves)), SOLVED, 'Random mixed-move inverse');
  equalState(applyAlg(unique, [...moves, ...invertAlg(moves)]), unique, 'Unique-sticker round trip');
  for (const color of FACE_NAMES.keys()) {
    const oriented = rotateToCross(state, color);
    assert.equal(oriented.state[31], color);
    equalState(applyAlg(state, oriented.moves), oriented.state);
    const back = restoreFrameSequence(oriented.state, centers(state));
    equalState(applyAlg(oriented.state, back), state, 'Frame restoration');
  }
  const faceMoves = Array.from({ length: 25 }, () => MOVE_TOKENS[random(18)]);
  let state2 = SOLVED.slice(), cube = analyze(SOLVED);
  for (const move of faceMoves) {
    const t = transitions[move];
    cube = {
      cp: Int8Array.from(t.cp, position => cube.cp[position]),
      co: Int8Array.from(t.cp, (position, index) => (cube.co[position] + t.co[index]) % 3),
      ep: Int8Array.from(t.ep, position => cube.ep[position]),
      eo: Int8Array.from(t.ep, (position, index) => cube.eo[position] ^ t.eo[index]),
    };
    state2 = applyMove(state2, move);
  }
  const actual = analyze(state2);
  for (const field of ['cp', 'co', 'ep', 'eo']) assert.deepEqual([...cube[field]], [...actual[field]], 'Cubie composition ' + field);
}
assert.equal(stateKey(SOLVED).length, 54);
assert.notEqual(stateKey(SOLVED), stateKey(applyMove(SOLVED, 'R')));
assert.ok(CENTER_INDICES.every(index => Number.isInteger(index)) && CORNER_FACELETS.length === 8);
console.log('Solver core tests passed: 54 exact move permutations, independent U/R/F cubie fixtures, notation identities, impossible painted states, 500 mixed/random states and 3000 center-frame round trips.');

const started = performance.now();
const pdb = buildCrossTable();
assert.equal(pdb.reachable, 190080);
assert.equal(pdb.capacity, 24 ** 4);
assert.equal(pdb.maxDistance, 8);
assert.equal(pdb.distance(SOLVED), 0);
assert.equal([...pdb.distances].filter(distance => distance !== 255).length, 190080);
const crossSkip = searchCross(SOLVED);
assert.equal(crossSkip.candidates[0].moves.length, 0);
assert.equal(crossSkip.candidates[0].claim, 'optimal-cross-htm');
assert.equal(searchF2L(SOLVED).candidates[0].moves.length, 0);
assert.equal(searchF2L(applyMove(SOLVED, 'R')).coverage.stopReason, 'cross-required');

let crossMillis = 0, f2lMillis = 0, segments = 0, returnedCandidates = 0;
for (let trial = 0; trial < 30; trial++) {
  const scramble = Array.from({ length: 30 }, () => MOVE_TOKENS[random(18)]);
  const painted = applyAlg(SOLVED, scramble);
  assert.equal(validate(painted).valid, true);
  let current = rotateToCross(painted, trial % 6).state;
  const startKey = stateKey(current), minimum = pdb.distance(current);
  assert.ok(minimum >= 0 && minimum <= 8);
  if (minimum) {
    const neighborDistances = MOVE_TOKENS.map(move => pdb.distance(applyMove(current, move)));
    assert.equal(Math.min(...neighborDistances), minimum - 1, 'Exact Cross PDB descending neighbor');
    assert.ok(neighborDistances.every(distance => Math.abs(distance - minimum) <= 1), 'Cross PDB transition consistency');
    const bounded = searchCross(current, { maxDepth: minimum - 1, maxCandidates: 1 });
    assert.equal(bounded.candidates.length, 0);
    assert.equal(bounded.coverage.stopReason, 'depth-bound');
  }
  const crossStart = performance.now();
  const cross = searchCross(current, { maxCandidates: 8, maxMillis: 1000, maxNodes: 200000 });
  crossMillis += performance.now() - crossStart;
  assert.ok(cross.candidates.length, `Cross failed on random position ${trial}`);
  assert.equal(stateKey(current), startKey, 'Cross search mutated input');
  assert.equal(cross.candidates[0].htm, minimum, 'Cross minimum not attained');
  assert.equal(cross.coverage.minimumHTM, minimum);
  for (const candidate of cross.candidates) {
    equalState(applyAlg(current, candidate.moves), candidate.state, 'Cross candidate effect');
    assert.ok(isCross(candidate.state));
    assert.equal(candidate.baseStateHash, startKey);
    if (candidate.claim === 'optimal-cross-htm') assert.equal(candidate.htm, minimum);
    returnedCandidates++;
  }
  current = Uint8Array.from(cross.candidates[trial % cross.candidates.length].state);
  let rounds = 0;
  while (!isF2L(current)) {
    assert.ok(rounds++ < 4, 'F2L did not progress within four pair segments');
    const before = solvedSlots(current), beforeKey = stateKey(current);
    const pairStarted = performance.now();
    const next = searchF2L(current, { maxCandidates: 8, maxMillis: 1000, maxNodes: 10000 });
    f2lMillis += performance.now() - pairStarted;
    assert.ok(next.candidates.length, `F2L failed on position ${trial}, round ${rounds}`);
    assert.equal(stateKey(current), beforeKey, 'F2L search mutated input');
    for (const candidate of next.candidates) {
      const result = applyAlg(current, candidate.moves), after = solvedSlots(result);
      equalState(result, candidate.state, 'F2L candidate effect');
      assert.ok(isCross(result), 'F2L segment lost Cross');
      assert.ok(before.every(slot => after.includes(slot)), 'F2L segment lost protected slot');
      assert.ok(after.includes(candidate.targetSlot) && after.length > before.length, 'F2L segment made no progress');
      assert.equal(candidate.baseStateHash, beforeKey);
      assert.equal(candidate.claim, 'best-found', 'F2L must not claim global optimality');
      assert.ok(candidate.moves.length <= 18);
      if (candidate.continuationMoves) assert.ok(isF2L(applyAlg(result, candidate.continuationMoves)), 'Ranking continuation must be physically valid');
      returnedCandidates++;
    }
    current = Uint8Array.from(next.candidates[(trial + rounds) % next.candidates.length].state);
    segments++;
  }
  assert.ok(isF2L(current) && isCross(current));
  assert.equal(validate(current).valid, true);
  assert.equal(current[31], trial % 6, 'Selected cross color/frame changed');
}
const pendingPair = applyAlg(SOLVED, "R U R'");
assert.ok(isCross(pendingPair) && !isF2L(pendingPair));
assert.equal(searchF2L(pendingPair, { maxDepth: 0, lookahead: false }).candidates.length, 0);
const aborted = new AbortController(); aborted.abort();
assert.equal(searchCross(applyMove(SOLVED, 'R'), { signal: aborted.signal }).candidates.length, 0);
assert.equal(searchF2L(pendingPair, { signal: aborted.signal }).candidates.length, 0);
console.log(JSON.stringify({
  crossPdbStates: pdb.reachable, crossPdbMaximum: pdb.maxDistance,
  randomCrossToF2LPositions: 30, f2lSegments: segments, verifiedCandidates: returnedCandidates,
  crossTotalMillis: Math.round(crossMillis), f2lTotalMillis: Math.round(f2lMillis),
  elapsedMillis: Math.round(performance.now() - started),
}, null, 2));
