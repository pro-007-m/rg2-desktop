import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SOLVED, applyAlg, centers, stateKey, validate, isCross, isF2L, isOLL,
  isSolved, solvedSlots, areEdgesOriented, areCornersSolved,
} from '../data/solver/core.mjs';
import { orientForCross } from '../data/solver/orientation.mjs';
import { bestContinuation, getApplicable, moveMetrics } from '../data/solver/catalog.mjs';
import { searchF2L } from '../data/solver/search.mjs';

test('worker preserves the chosen display frame, separates initial setup, and solves twelve painted inputs', async () => {
  const previousSelf = globalThis.self, previousFetch = globalThis.fetch;
  const catalogueUrl = new URL('../data/solver/algorithm-data.json', import.meta.url);
  const rawCatalogue = JSON.parse(fs.readFileSync(catalogueUrl, 'utf8'));
  let posts = [], loads = 0, requestId = 0, candidatesChecked = 0, rotatingCandidates = 0, restorations = 0;
  let restoredHtm = 0, restoredExecution = 0, catalogueRankChecks = 0, fullPairRankChecks = 0, estimatedRankChecks = 0;
  const round = value => Math.round(value * 10000) / 10000;
  const near = (actual, expected, description) => assert.ok(Math.abs(actual - expected) < 1e-7, `${description}: ${actual} != ${expected}`);
  globalThis.fetch = async url => {
    assert.equal(String(url), String(catalogueUrl), 'Worker must only fetch its local catalogue');
    loads++;
    return { ok: true, json: async () => rawCatalogue };
  };
  globalThis.self = { postMessage: message => posts.push(message) };

  let seed = 0x742f093;
  const random = max => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; };
  const faces = ['U', 'R', 'F', 'D', 'L', 'B'], suffixes = ['', "'", '2'];

  async function request(state, stage, extras = {}) {
    const message = { id: ++requestId, revision: requestId * 3, state: Array.from(state), stage,
      frameCenters: centers(state), settings: { rankMode: 'execution', crossColor: '0', prepareColl: false }, ...extras };
    posts = [];
    await globalThis.self.onmessage({ data: message });
    assert.equal(posts.length, 1, 'Worker must emit exactly one complete response');
    const response = posts[0];
    assert.equal(response.id, message.id);
    assert.equal(response.revision, message.revision);
    assert.equal(response.hash, stateKey(message.state));
    assert.equal(response.stage, stage);
    assert.ok(!response.error, response.error);
    assert.ok(response.candidates.length, `No candidates for ${stage}`);
    const profile = message.settings.rankMode === 'htm' ? 'htm' : 'execution';
    let originalCandidates;
    if (!['CROSS', 'F2L'].includes(stage)) {
      originalCandidates = new Map(getApplicable(message.state, { stage, profile, preferColl: true, allowEollPrep: message.settings.prepareColl }).map(candidate => [candidate.id, candidate]));
      assert.deepEqual(response.candidates.map(candidate => candidate.id).sort(), [...originalCandidates.keys()].sort(), 'Reranking lost a finite catalogue variant');
    }
    let sampledSourceContinuation = false;
    for (const candidate of response.candidates) {
      const base = candidate.baseState || message.state;
      const actual = applyAlg(base, candidate.moves);
      assert.deepEqual(Array.from(actual), Array.from(candidate.state), `${stage} result differs from displayed moves`);
      const target = candidate.baseState ? centers(candidate.baseState) : message.frameCenters;
      assert.deepEqual(centers(candidate.state), target, `${stage} changed canonical centers`);
      assert.equal(validate(candidate.state).valid, true, `${stage} produced an impossible cube`);
      const metrics = moveMetrics(candidate.moves, profile);
      const originalMoves = candidate.algorithmMoves || candidate.moves;
      const beforeMetrics = moveMetrics(originalMoves, profile);
      const delta = round(metrics.score - beforeMetrics.score);
      for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === 'number') near(candidate[key], value, `${stage} actual ${key}`);
        else assert.equal(candidate[key], value, `${stage} actual ${key}`);
      }
      near(candidate.cost, metrics.score, `${stage} actual own cost`);
      near(candidate.score, metrics.score, `${stage} actual own score`);
      if (candidate.moves.some(token => /^[xyz]/.test(token))) rotatingCandidates++;
      if (candidate.frameRestoreMoves?.length) {
        restorations++;
        assert.deepEqual(candidate.moves, [...candidate.algorithmMoves, ...candidate.frameRestoreMoves]);
        near(candidate.frameRestoreCost, delta, 'Only real frame-return own-cost delta is charged');
        if (profile === 'htm') { assert.equal(candidate.frameRestoreCost, 0); restoredHtm++; }
        else { assert.ok(candidate.frameRestoreCost > 0); restoredExecution++; }
      } else assert.equal(Object.hasOwn(candidate, 'frameRestoreCost'), false, 'No restoration cost without restoration moves');

      if (originalCandidates) {
        const original = originalCandidates.get(candidate.id);
        assert.deepEqual(originalMoves, original.moves, 'Original catalogue algorithm changed during restoration');
        const recommendation = Number.isFinite(original.recommendationScore) ? round(original.recommendationScore + delta) : metrics.score;
        near(candidate.recommendationScore, recommendation, 'Catalogue recommendation must retain its original continuation plus own-cost delta');
        if (Number.isFinite(original.totalCost)) near(candidate.totalCost, round(original.totalCost + delta), 'Catalogue total must retain its original continuation');
        for (const [total, metric] of [['totalHtm', 'htm'], ['totalQtm', 'qtm'], ['totalRotations', 'rotations']]) {
          if (Number.isFinite(original[total])) near(candidate[total], original[total] + metrics[metric] - beforeMetrics[metric], `${total} restoration delta`);
        }
        catalogueRankChecks++;
      } else if (stage === 'F2L') {
        const originalEnd = applyAlg(base, originalMoves);
        if (isF2L(originalEnd)) {
          const tail = bestContinuation(originalEnd, { profile, preferColl: true, allowEollPrep: message.settings.prepareColl });
          assert.ok(tail, 'A finished last pair must retain a last-layer continuation');
          near(candidate.recommendationScore, round(metrics.score + (tail.totalCost ?? tail.cost ?? 0)), 'Final-pair ranking must retain the complete LL continuation');
          fullPairRankChecks++;
        } else if (candidate.estimatedTotalHTM != null) {
          const expected = profile === 'htm' ? candidate.estimatedTotalHTM + delta : metrics.score + Math.max(0, candidate.estimatedTotalHTM - beforeMetrics.htm) * .75;
          near(candidate.recommendationScore, round(expected), 'Generated pair ranking must retain its bounded F2L continuation');
          estimatedRankChecks++;
        } else if (!sampledSourceContinuation) {
          const next = searchF2L(originalEnd, { maxCandidates: 1, maxMillis: 100, maxNodes: 3000, lookahead: true }).candidates[0];
          const remaining = next?.estimatedTotalHTM ?? next?.htm ?? (4 - solvedSlots(originalEnd).length) * 8;
          near(candidate.recommendationScore, round(metrics.score + remaining * (profile === 'htm' ? 1 : .75)), 'Source pair ranking must retain its next-pair estimate');
          sampledSourceContinuation = true;
        }
      }
      candidatesChecked++;
    }
    for (let index = 1; index < response.candidates.length; index++) {
      const previous = response.candidates[index - 1], current = response.candidates[index];
      const comparison = previous.recommendationScore - current.recommendationScore
        || (['LAST_LAYER', 'COLL'].includes(stage) ? Number(current.family === 'COLL') - Number(previous.family === 'COLL') : 0)
        || previous.htm - current.htm || previous.rotations - current.rotations;
      assert.ok(comparison <= 0, `${stage} candidate order did not use updated recommendation, HTM and rotation costs`);
    }
    return response;
  }

  try {
    await import('../data/solver/worker.mjs');
    assert.equal(typeof globalThis.self.onmessage, 'function');
    const inputs = [], finalPairStates = [], lastPairInputs = [];
    for (let trial = 0; trial < 12; trial++) {
      const moves = []; let previous = '';
      for (let step = 0; step < 22; step++) {
        let face;
        do { face = faces[random(6)]; } while (face === previous);
        moves.push(face + suffixes[random(3)]); previous = face;
      }
      const scheme = [0, 1, 2, 3, 4, 5];
      for (let index = 5; index; index--) { const other = random(index + 1); [scheme[index], scheme[other]] = [scheme[other], scheme[index]]; }
      const input = Array.from(applyAlg(applyAlg(SOLVED, moves), ['x', 'y', 'z2'].slice(0, trial % 4)), color => scheme[color]);
      assert.equal(validate(input).valid, true);
      inputs.push([...input]);
      const color = trial % 6, oriented = orientForCross(input, color);
      const settings = { rankMode: trial % 2 ? 'htm' : 'execution', crossColor: trial < 6 ? String(color) : 'auto', prepareColl: trial % 4 === 0 };
      const cross = await request(oriented.state, 'CROSS', { inputState: [...input], frameCenters: oriented.centers, settings, normalize: true });
      const offeredColors = new Set(cross.candidates.map(candidate => candidate.crossColor));
      assert.deepEqual([...offeredColors].sort(), trial < 6 ? [color] : [0, 1, 2, 3, 4, 5]);
      for (const candidate of cross.candidates) {
        assert.ok(isCross(candidate.state));
        assert.equal(candidate.baseState[31], candidate.crossColor);
        assert.equal(candidate.state[31], candidate.crossColor);
        assert.deepEqual(Array.from(applyAlg(input, candidate.setupMoves)), candidate.baseState);
        assert.deepEqual(candidate.baseState, orientForCross(input, candidate.crossColor).state);
        assert.ok(candidate.setupMoves.every(token => /^[xyz](?:2|')?$/.test(token)), 'Setup may contain only frame rotations');
        assert.ok(candidate.moves.every(token => /^[URFDLB](?:2|')?$/.test(token)), 'Initial frame setup was hidden inside the real cross moves');
      }
      assert.deepEqual(input, inputs[trial], 'Raw painted input changed');
      const selected = cross.candidates.find(candidate => candidate.crossColor === color);
      assert.ok(selected, 'Explicit automatic color choice must remain available');
      let current = selected.state;
      const frameCenters = centers(current);
      for (let step = 0; step < 4 && !isF2L(current); step++) {
        const before = solvedSlots(current);
        if (before.length === 3) lastPairInputs.push([...current]);
        const response = await request(current, 'F2L', { inputState: input, frameCenters, settings });
        for (const candidate of response.candidates) {
          assert.ok(isCross(candidate.state));
          assert.ok(before.every(slot => solvedSlots(candidate.state).includes(slot)), 'F2L lost a protected slot');
          assert.ok(solvedSlots(candidate.state).length > before.length, 'F2L did not finish another pair');
        }
        current = response.candidates[0].state;
      }
      assert.ok(isF2L(current), 'Four F2L segments must finish F2L');
      finalPairStates.push([...current]);

      // Verify the source-based planned continuation itself, independently of
      // the worker's human-readable expected-PLL string.
      const planned = bestContinuation(current, { profile: 'execution', allowEollPrep: false });
      assert.ok(planned?.expectedPll, 'Missing source continuation');
      const plannedEnd = applyAlg(applyAlg(current, planned.moves), planned.expectedPll.moves);
      assert.ok(isSolved(plannedEnd), 'Source OLL/COLL + expected PLL did not solve');
      assert.deepEqual(centers(plannedEnd), frameCenters);

      const lastLayer = await request(current, 'LAST_LAYER', { inputState: input, frameCenters, settings });
      const chosen = settings.prepareColl ? lastLayer.candidates.find(candidate => candidate.family === 'EOLL') || lastLayer.candidates[0] : lastLayer.candidates[0];
      current = chosen.state;
      if (chosen.family === 'EOLL') {
        assert.ok(areEdgesOriented(current) && isF2L(current));
        assert.ok(chosen.nextColl);
        current = Array.from(applyAlg(current, chosen.nextColl.moves));
        assert.deepEqual(centers(current), frameCenters);
      } else if (chosen.family === 'COLL') assert.ok(areCornersSolved(current));
      assert.ok(isOLL(current), 'Last-layer orientation goal failed');
      const pll = await request(current, 'PLL', { inputState: input, frameCenters, settings });
      assert.ok(pll.candidates.every(candidate => isSolved(candidate.state)));
      current = pll.candidates[0].state;
      assert.ok(isSolved(current));
      assert.deepEqual(centers(current), frameCenters);
    }

    // A temporarily y-rotated algorithm input must receive an explicit frame
    // restoration in the move list, not an invisible state-only correction.
    const canonical = finalPairStates.find(state => !isOLL(state)) || finalPairStates[0];
    const canonicalCenters = centers(canonical), shifted = applyAlg(canonical, ['y']);
    const restored = await request(shifted, 'LAST_LAYER', { frameCenters: canonicalCenters, settings: { rankMode: 'execution', prepareColl: false } });
    assert.ok(restored.candidates.some(candidate => candidate.frameRestoreMoves?.length));
    for (const candidate of restored.candidates) assert.ok(isOLL(candidate.state));
    const oriented = restored.candidates[0].state;
    const shiftedPLL = applyAlg(oriented, ["y'"]);
    const pll = await request(shiftedPLL, 'PLL', { frameCenters: canonicalCenters, settings: { rankMode: 'execution' } });
    assert.ok(pll.candidates.every(candidate => isSolved(candidate.state)));
    assert.ok(pll.candidates.some(candidate => candidate.frameRestoreMoves?.length));
    const htmRestored = await request(shifted, 'LAST_LAYER', { frameCenters: canonicalCenters, settings: { rankMode: 'htm', prepareColl: false } });
    assert.ok(htmRestored.candidates.some(candidate => candidate.frameRestoreMoves?.length));
    assert.ok(lastPairInputs.length, 'Tests must exercise a last-pair insertion');
    const pendingPair = lastPairInputs[0];
    const restoredPair = await request(applyAlg(pendingPair, ['y']), 'F2L', { frameCenters: centers(pendingPair), settings: { rankMode: 'execution', prepareColl: false } });
    assert.ok(restoredPair.candidates.some(candidate => candidate.frameRestoreMoves?.length && isF2L(candidate.state)), 'A last-pair insertion must include its explicit frame return');
    assert.equal(loads, 1, 'Local algorithm catalogue should compile once per worker');
    assert.ok(rotatingCandidates > 0, 'Tests did not exercise rotation-bearing source algorithms');
    assert.ok(restorations > 0, 'Tests did not exercise explicit frame restoration');
    assert.ok(restoredHtm > 0 && restoredExecution > 0, 'Frame-return cost must be checked in both ranking profiles');
    assert.ok(catalogueRankChecks > 0 && fullPairRankChecks > 0 && estimatedRankChecks > 0, 'Tests must cover both catalogue and F2L continuation ranking');
    console.log(`Worker frame checks: 12 painted inputs, six explicit colors and six auto comparisons, ${candidatesChecked} replayed/metric-checked candidates, ${rotatingCandidates} rotation-bearing formulas, ${restorations} explicit restorations (${restoredHtm} HTM, ${restoredExecution} execution); ${catalogueRankChecks} catalogue, ${fullPairRankChecks} complete-pair and ${estimatedRankChecks} bounded-pair ranking checks.`);
  } finally {
    globalThis.self = previousSelf;
    globalThis.fetch = previousFetch;
  }
});
