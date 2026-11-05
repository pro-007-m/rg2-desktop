import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOLVED, applyAlg, invertAlg, solvedSlots, isCross, isF2L, isSolved, centers, areEdgesOriented,
} from '../data/solver/core.mjs';
import { searchCross, searchF2L } from '../data/solver/search.mjs';
import {
  createTrace, createSegment, appendSegment, traceMoves, rewindTrace, stageCopy,
} from '../data/solver/trace.mjs';

function segment(id, family, before, moves, extra = {}, options = {}) {
  const after = applyAlg(before, moves);
  return createSegment({ id: 'candidate-' + id, family, moves, state: after, ...extra }, {
    id, stage: family, beforeState: before, afterState: after, ...options,
  });
}

test('selected Cross and F2L segments replay actual goals, source orientation is copied once', () => {
  const raw = applyAlg(SOLVED, "F2 R' U B L2 U' R F D2 B' L U2");
  const setup = ['x2'], initial = applyAlg(raw, setup);
  let current = initial, trace = createTrace();
  const prefixes = [];
  for (let step = 0; step < 5 && !isF2L(current); step++) {
    const family = step === 0 ? 'CROSS' : 'F2L';
    const candidate = (step === 0 ? searchCross(current, { maxCandidates: 1, extraDepth: 0 }) : searchF2L(current, { maxCandidates: 4 })).candidates[0];
    assert.ok(candidate);
    prefixes.push(trace);
    const selected = createSegment(candidate, { id: 'selected-' + step, stage: family, startMove: traceMoves(trace).length, beforeState: current, afterState: candidate.state });
    if (family === 'CROSS') assert.equal(selected.label, 'CROSS · Крест');
    const beforeJSON = JSON.stringify(trace);
    trace = appendSegment(trace, selected);
    assert.equal(JSON.stringify(prefixes[prefixes.length - 1]), beforeJSON, 'Append mutated its prefix');
    current = candidate.state;
    assert.ok(isCross(current));
    assert.deepEqual(Array.from(applyAlg(initial, traceMoves(trace))), Array.from(current));
    assert.deepEqual(Array.from(applyAlg(raw, [...setup, ...traceMoves(trace)])), Array.from(current));
    assert.deepEqual(selected.slotsBefore, solvedSlots(selected.beforeState));
    assert.deepEqual(selected.slotsAfter, solvedSlots(current));
    assert.deepEqual(selected.newlySlots, selected.slotsAfter.filter(slot => !selected.slotsBefore.includes(slot)));
    assert.equal(selected.lostSlots.length, 0);
    assert.ok(!Object.hasOwn(selected, 'expectedPll') && !Object.hasOwn(selected, 'nextColl'), 'Predicted continuations are not selected trace');
  }
  assert.ok(isF2L(current));
  const copy = stageCopy(trace, { setupMoves: setup });
  assert.ok(copy.startsWith('[Ориентация: x2]\n'));
  assert.equal(copy.match(/Ориентация:/g).length, 1);
  assert.equal(trace.activeId, trace.segments.at(-1).id);
  for (const selected of trace.segments) {
    const parts = selected.parts.flatMap(part => selected.moves.slice(part.from, part.to));
    assert.deepEqual(parts, selected.moves, 'Parts duplicated or omitted selected tokens');
  }
});

test('Cross pair markers and simultaneous F2L pair completions never duplicate a move block', () => {
  const cross = segment('cross-skip', 'CROSS', SOLVED, [], { origin: 'skip' });
  assert.equal(cross.pairMarkers.length, 4);
  assert.deepEqual(cross.pairMarkers.map(marker => marker.slot), ['FR', 'FL', 'BL', 'BR']);
  assert.ok(cross.pairMarkers.every(marker => marker.atMove === 0 && marker.from === marker.to && marker.source === 'cross'));
  const insertion = ["R'", 'U', 'R', 'L', 'U', "L'"];
  const before = applyAlg(SOLVED, invertAlg(insertion));
  assert.ok(isCross(before));
  const joined = segment('joint', 'F2L', before, insertion);
  assert.equal(joined.slotsBefore.length, 2);
  assert.equal(joined.slotsAfter.length, 4);
  assert.equal(joined.newlySlots.length, 2);
  assert.match(joined.label, /F2L 3–4\/4/);
  assert.ok(joined.pairMarkers.every(marker => marker.sharedAlgorithm && marker.number === null && marker.atMove === insertion.length));
  assert.deepEqual(joined.pairMarkers.map(marker => marker.numberRange), [[3, 4], [3, 4]]);
  const trace = appendSegment(createTrace(), joined);
  assert.deepEqual(traceMoves(trace), insertion);
  assert.equal(trace.segments.length, 1);
});

test('source family, EPLL request, skips, explicit AUF and real frame-return ranges are preserved', () => {
  const pllAlgorithm = ["R'", 'U', "R'", "U'", "R'", "U'", "R'", 'U', 'R', 'U', 'R2'];
  const moves = [...pllAlgorithm, 'U', "y'"];
  const before = applyAlg(SOLVED, invertAlg(moves));
  const pll = segment('edge-pll', 'PLL', before, moves, { caseId: 'Ua', epll: true, auf: ['U'], algorithmMoves: [...pllAlgorithm, 'U'], frameRestoreMoves: ["y'"] }, { stage: 'EPLL' });
  assert.equal(pll.family, 'PLL');
  assert.equal(pll.displayFamily, 'EPLL');
  assert.equal(pll.label, 'EPLL · Ua');
  assert.deepEqual(pll.parts.map(part => [part.role, part.from, part.to]), [['algorithm', 0, 11], ['finalAuf', 11, 12], ['returnFrame', 12, 13]]);
  assert.ok(isSolved(pll.afterState));
  assert.deepEqual(pll.parts.flatMap(part => pll.moves.slice(part.from, part.to)), moves);
  const coll = segment('coll', 'COLL', applyAlg(SOLVED, "U'"), ['U'], { caseId: 'O', auf: ['U'] }, { stage: 'LAST_LAYER' });
  assert.equal(coll.label, 'COLL · O');
  assert.equal(coll.branchAfter, 'EPLL');
  assert.deepEqual(coll.parts.map(part => part.role), ['algorithm'], 'COLL alignment must remain within COLL');
  const preparation = ['F', 'R', 'U', "R'", "U'", "F'"];
  const eollInput = applyAlg(SOLVED, invertAlg(preparation));
  assert.ok(isF2L(eollInput) && !areEdgesOriented(eollInput));
  const eoll = segment('eoll', 'EOLL', eollInput, preparation, { route: 'EOLL → PLL', nextColl: { moves: ['R'] }, expectedPll: { moves: ['F'] } }, { stage: 'LAST_LAYER' });
  assert.equal(eoll.family, 'EOLL');
  assert.equal(eoll.branchAfter, 'PLL');
  assert.ok(!Object.hasOwn(eoll, 'nextColl') && !Object.hasOwn(eoll, 'expectedPll'));
  const skip = segment('oll-skip', 'SKIP', SOLVED, [], { skip: true }, { stage: 'LAST_LAYER' });
  assert.equal(skip.label, 'OLL: пропуск');
  const auf = segment('pll-skip-auf', 'SKIP', applyAlg(SOLVED, "U'"), ['U'], { skip: true, auf: ['U'] }, { stage: 'PLL' });
  assert.deepEqual(auf.parts.map(part => [part.role, part.from, part.to]), [['algorithm', 0, 0], ['finalAuf', 0, 1]]);
  assert.match(stageCopy(appendSegment(createTrace(), auf)), /\[PLL: пропуск\] \[AUF: U\]/);
  const notAuf = segment('imported-u', 'PLL', applyAlg(SOLVED, "U'"), ['U']);
  assert.deepEqual(notAuf.parts.map(part => part.role), ['algorithm'], 'A final U alone does not prove AUF');
  const stale = segment('stale-suffix', 'PLL', applyAlg(SOLVED, "U'"), ['U'], { auf: ["U'"], frameRestoreMoves: ['y'] });
  assert.equal(stale.metadataWarnings.length, 2);
  assert.deepEqual(stale.parts.map(part => part.role), ['algorithm']);
});

test('rewind keeps only the containing real segment and its own suffix queue, dropping future zero markers', () => {
  const first = segment('first', 'CROSS', SOLVED, ['R', 'U']);
  const zero = segment('boundary-skip', 'SKIP', first.afterState, [], { skip: true }, { startMove: 2, stage: 'LAST_LAYER' });
  const second = segment('second', 'F2L', first.afterState, ["U'", "R'"], {}, { startMove: 2 });
  const after = segment('finished-skip', 'SKIP', second.afterState, [], { skip: true }, { startMove: 4, stage: 'PLL' });
  const trace = [first, zero, second, after].reduce(appendSegment, createTrace());
  const original = JSON.stringify(trace);
  const inside = rewindTrace(trace, 1);
  assert.deepEqual(inside.trace.segments.map(item => item.id), ['first']);
  assert.equal(inside.trace.activeId, 'first');
  assert.equal(inside.offset, 1);
  assert.deepEqual(inside.queue, ['U']);
  assert.deepEqual(traceMoves(inside.trace), ['R', 'U']);
  const boundary = rewindTrace(trace, 2);
  assert.deepEqual(boundary.trace.segments.map(item => item.id), ['first', 'boundary-skip', 'second']);
  assert.equal(boundary.trace.activeId, 'second');
  assert.equal(boundary.offset, 0);
  assert.deepEqual(boundary.queue, ["U'", "R'"]);
  const end = rewindTrace(trace, 4);
  assert.deepEqual(end.trace.segments.map(item => item.id), ['first', 'boundary-skip', 'second']);
  assert.deepEqual(end.queue, []);
  assert.equal(end.offset, second.moves.length);
  assert.equal(JSON.stringify(trace), original, 'Rewind mutated selected history');
  const alternative = segment('alternative', 'F2L', first.afterState, ['F', "F'"], {}, { startMove: 2 });
  const replaced = appendSegment(appendSegment(createTrace(), first), alternative);
  assert.deepEqual(traceMoves(replaced), ['R', 'U', 'F', "F'"]);
  assert.ok(!replaced.segments.some(item => item.id === 'second' || item.id === 'finished-skip'));
  assert.throws(() => appendSegment(trace, after), /id/);
  assert.throws(() => appendSegment(createTrace(), second), RangeError);
  assert.throws(() => rewindTrace(trace, -1), RangeError);
  assert.throws(() => rewindTrace(trace, 5), RangeError);
});

test('unique zero-move skips share offsets without adding phantom moves or stale branches', () => {
  const a = segment('zero-oll', 'SKIP', SOLVED, [], { skip: true }, { stage: 'LAST_LAYER' });
  const b = segment('zero-pll', 'SKIP', SOLVED, [], { skip: true }, { stage: 'PLL' });
  const trace = appendSegment(appendSegment(createTrace(), a), b);
  assert.deepEqual(traceMoves(trace), []);
  assert.deepEqual(trace.segments.map(item => [item.id, item.startMove, item.endMove]), [['zero-oll', 0, 0], ['zero-pll', 0, 0]]);
  assert.equal(trace.activeId, 'zero-pll');
  assert.match(stageCopy(trace), /OLL: пропуск/);
  assert.match(stageCopy(trace), /PLL: пропуск/);
  const edgeSkip = segment('zero-epll', 'SKIP', SOLVED, [], { skip: true }, { stage: 'EPLL' });
  assert.equal(edgeSkip.family, 'SKIP');
  assert.equal(edgeSkip.displayFamily, 'EPLL');
  assert.equal(edgeSkip.label, 'EPLL: пропуск');
  const cross = segment('already-cross', 'CROSS', SOLVED, [], { skip: true });
  assert.equal(cross.label, 'CROSS · Крест: готов');
  const observed = [cross, a, b].reduce(appendSegment, createTrace());
  assert.deepEqual(traceMoves(observed), []);
  assert.equal(observed.segments[0].pairMarkers.length, 4);
  assert.ok(observed.segments.every(item => item.startMove === 0 && item.endMove === 0));
  assert.match(stageCopy(observed), /CROSS · Крест: готов/);
  assert.match(stageCopy(observed), /готова после креста/);
  assert.deepEqual(rewindTrace(trace, 0), { trace: createTrace(), segment: null, offset: 0, queue: [] });
  assert.throws(() => createSegment({ family: 'SKIP', moves: [] }, { beforeState: SOLVED }), /id/);
  assert.throws(() => createSegment({ family: 'F2L', moves: ['R'] }, { id: 'wrong-end', beforeState: SOLVED, afterState: SOLVED }), /состояние|Состояние/);
  assert.deepEqual(centers(SOLVED), [0, 1, 2, 3, 4, 5]);
});
