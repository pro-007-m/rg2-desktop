import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SOLVED, CORNER_FACELETS, EDGE_FACELETS, applyAlg, invertAlg, analyze, validate,
  isCross, isF2L, isOLL, isSolved, areEdgesOriented, areCornersSolved, solvedSlots,
} from '../data/solver/core.mjs';
import {
  compileCatalog, getApplicable, matchPLL, matchLastLayer, matchF2L,
  bestContinuation, costScore, moveMetrics, ollKey, cornerKey, pllKey,
} from '../data/solver/catalog.mjs';

const raw = JSON.parse(fs.readFileSync(new URL('../data/solver/algorithm-data.json', import.meta.url), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(new URL('../docs/solver-sources.json', import.meta.url), 'utf8'));
const catalog = compileCatalog(raw);
const AUF = ['', 'U', 'U2', "U'"];
const Y = ['', 'y', 'y2', "y'"];

function permutations(values) {
  if (!values.length) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index)).map(rest => [value, ...rest]));
}
function parity(values) {
  let result = 0;
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) result ^= Number(values[i] > values[j]);
  return result;
}
const PERMS = permutations([0, 1, 2, 3]);
function llState({ cp = [0, 1, 2, 3], ep = [0, 1, 2, 3], co = [0, 0, 0, 0], eo = [0, 0, 0, 0] } = {}) {
  const state = Uint8Array.from(SOLVED);
  for (let position = 0; position < 4; position++) {
    for (let side = 0; side < 3; side++) state[CORNER_FACELETS[position][(side + co[position]) % 3]] = Math.floor(CORNER_FACELETS[cp[position]][side] / 9);
    for (let side = 0; side < 2; side++) state[EDGE_FACELETS[position][(side + eo[position]) % 2]] = Math.floor(EDGE_FACELETS[ep[position]][side] / 9);
  }
  return state;
}
function indexed(state, family) {
  const key = family === 'OLL' ? ollKey : family === 'COLL' ? cornerKey : pllKey;
  for (const y of Y) for (const u of AUF) {
    if (catalog.indices[family].has(key(analyze(applyAlg(state, `${y} ${u}`))))) return true;
  }
  return false;
}
function randomFactory(seed = 0x147ac019) {
  return max => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; };
}
const random = randomFactory();
function randomLL() {
  const cp = PERMS[random(24)], edgeChoices = PERMS.filter(ep => parity(ep) === parity(cp)), ep = edgeChoices[random(12)];
  const co = [random(3), random(3), random(3)]; co.push((9 - co.reduce((a, b) => a + b, 0)) % 3);
  const eo = [random(2), random(2), random(2)]; eo.push(eo.reduce((a, b) => a ^ b, 0));
  return llState({ cp, ep, co, eo });
}

test('Import consumed all advertised public variant lists, not only top four', () => {
  assert.equal(provenance.noTopNLimit, true);
  assert.equal(provenance.requests.length, 286);
  const more = provenance.requests.filter(request => request.url.includes('/category.algs.php?'));
  assert.equal(more.length, 282);
  assert.ok(more.every(request => request.furtherMoreButtons === 0));
  assert.ok(more.some(request => request.caseId === 'Aa' && request.formulaCount > 4));
  assert.ok(raw.records.length > 6500);
  assert.ok(raw.records.every(record => record.rawAlg && record.source?.url && record.source?.date));
  assert.equal(provenance.localRG2.copiedArticleProse, false);
  assert.ok(raw.records.some(record => record.source.name === 'RG2 original APK'));
});

test('Every imported online case has verified alternatives; invalid source occurrences are quarantined', () => {
  for (const [family, expected] of Object.entries({ F2L: 41, OLL: 57, COLL: 40, PLL: 21 })) {
    assert.equal(catalog.coverage[family].sourceCaseCount, expected, family);
    assert.ok(catalog.coverage[family].verifiedVariants > expected, family);
  }
  assert.ok(catalog.rejected.length > 0);
  for (const rejected of catalog.rejected) assert.ok(rejected.reason && !catalog.records.some(record => record.id === rejected.id));
});

test('Every compiled full effect is reversible, restores its frame and preserves the declared stage boundary', () => {
  for (const record of catalog.records) {
    assert.equal(new Set(record.permutation).size, 54, record.id);
    assert.deepEqual(applyAlg(record.inverseState, record.moves), SOLVED, record.id);
    if (record.family === 'F2L') { assert.ok(isCross(record.inverseState)); assert.equal(solvedSlots(record.inverseState).length, 3); }
    else assert.ok(isF2L(record.inverseState), record.id);
    if (record.family === 'PLL') assert.ok(isOLL(record.inverseState), record.id);
    if (record.family === 'COLL') assert.ok(areEdgesOriented(record.inverseState), record.id);
  }
});

test('All 216 legal LL orientation patterns have OLL coverage or an explicit OLL skip', () => {
  let count = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const co = [a, b, c, (9 - a - b - c) % 3];
    for (let d = 0; d < 2; d++) for (let e = 0; e < 2; e++) for (let f = 0; f < 2; f++) {
      const state = llState({ co, eo: [d, e, f, d ^ e ^ f] });
      assert.ok(validate(state).valid);
      assert.ok(isOLL(state) || indexed(state, 'OLL'), `Missing OLL ${co}/${d}${e}${f}`);
      count++;
    }
  }
  assert.equal(count, 216);
});

test('All 624 non-oriented EO/corner states have COLL coverage; oriented corner states use PLL', () => {
  let count = 0;
  for (const cp of PERMS) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const co = [a, b, c, (9 - a - b - c) % 3];
    if (co.every(value => value === 0)) continue;
    const ep = parity(cp) ? [1, 0, 2, 3] : [0, 1, 2, 3];
    const state = llState({ cp, ep, co });
    assert.ok(validate(state).valid);
    assert.ok(indexed(state, 'COLL'), `Missing COLL ${cp}/${co}`);
    count++;
  }
  assert.equal(count, 624);
});

test('All 288 legal PLL permutations return actual solving moves including setup/AUF', () => {
  let count = 0;
  for (const cp of PERMS) for (const ep of PERMS) {
    if (parity(cp) !== parity(ep)) continue;
    const state = llState({ cp, ep });
    const choices = matchPLL(state, { catalog });
    assert.ok(choices.length > 0, `Missing PLL ${cp}/${ep}`);
    assert.ok(choices.every(choice => isSolved(choice.state)));
    assert.ok(isSolved(applyAlg(state, choices[0].moves)));
    count++;
  }
  assert.equal(count, 288);
});

test('Full LL alternatives retain distinct edge-permutation outcomes and rank the actual whole continuation', () => {
  let differentEdgeOutcomes = false;
  for (let sample = 0; sample < 12; sample++) {
    const state = randomLL();
    assert.ok(validate(state).valid);
    const choices = matchLastLayer(state, { catalog });
    assert.ok(choices.length > 4);
    const best = bestContinuation(state, { catalog });
    assert.ok(Math.abs(best.totalCost - choices[0].totalCost) < 1e-8);
    assert.ok(choices.every(choice => isOLL(choice.state)));
    assert.ok(isSolved(applyAlg(state, [...choices[0].moves, ...choices[0].expectedPll.moves])));
    assert.ok(Math.abs(choices[0].cost + choices[0].expectedPll.cost - choices[0].totalCost) < 1e-8);
    const edges = new Set(choices.filter(choice => choice.family === 'OLL').map(choice => Array.from(analyze(choice.state).ep).join(',')));
    if (edges.size > 1) differentEdgeOutcomes = true;
  }
  assert.ok(differentEdgeOutcomes, 'Do not merge algorithms merely because they share an OLL mask.');
});

test('COLL alternatives require EO and leave correctly aligned corners plus a real EPLL continuation', () => {
  const source = catalog.records.find(record => record.family === 'COLL');
  const choices = getApplicable(source.inverseState, { catalog, stage: 'LAST_LAYER', preferColl: true });
  assert.ok(choices.some(choice => choice.family === 'OLL'));
  const colls = choices.filter(choice => choice.family === 'COLL');
  assert.ok(colls.length > 0);
  for (const choice of colls) {
    assert.ok(isF2L(choice.state) && areEdgesOriented(choice.state) && areCornersSolved(choice.state));
    assert.ok(isSolved(applyAlg(choice.state, choice.expectedPll.moves)));
  }
  const flipped = catalog.records.find(record => record.family === 'OLL' && !areEdgesOriented(record.inverseState)).inverseState;
  assert.equal(getApplicable(flipped, { catalog, stage: 'COLL' }).length, 0);
});

test('Explicit optional EOLL preparation handles dot EO, preserves F2L and does not masquerade as COLL', () => {
  const dot = catalog.records.find(record => record.family === 'OLL' && Array.from(record.cubies.eo.slice(0, 4)).every(value => value === 1)).inverseState;
  const defaultChoices = matchLastLayer(dot, { catalog });
  assert.ok(defaultChoices.every(choice => choice.family !== 'EOLL'));
  const expanded = matchLastLayer(dot, { catalog, allowEollPrep: true });
  const bestDefault = bestContinuation(dot, { catalog });
  const bestExpanded = bestContinuation(dot, { catalog, allowEollPrep: true });
  assert.ok(Math.abs(bestExpanded.totalCost - expanded[0].totalCost) < 1e-8);
  assert.ok(bestExpanded.totalCost <= bestDefault.totalCost);
  const preparations = expanded.filter(choice => choice.family === 'EOLL');
  assert.ok(preparations.length > 0);
  assert.ok(preparations.every(choice => choice.route.startsWith('EOLL') && isF2L(choice.state) && areEdgesOriented(choice.state)));
  for (const prep of preparations.slice(0, 8)) assert.ok(isSolved(applyAlg(dot, [...prep.moves, ...prep.nextColl.moves, ...prep.expectedPll.moves])));
});

test('All four F2L slots use source variants and preserve prior slots at the segment boundary', () => {
  for (const slot of ['FR', 'FL', 'BL', 'BR']) {
    const source = catalog.records.find(record => record.family === 'F2L' && ['FR', 'FL', 'BL', 'BR'][record.targetSlot] === slot);
    assert.ok(source, slot);
    const before = solvedSlots(source.inverseState);
    const choices = matchF2L(source.inverseState, { catalog, slot, lookahead: false });
    assert.ok(choices.length > 0, slot);
    for (const choice of choices) {
      assert.ok(isCross(choice.state));
      const after = solvedSlots(choice.state);
      assert.ok(before.every(name => after.includes(name)) && after.includes(slot));
    }
    assert.ok(isF2L(applyAlg(source.inverseState, choices[0].moves)));
  }
});

test('Noncanonical center colors and whole-cube frame normalization retain applicable solutions', () => {
  const source = catalog.records.find(record => record.family === 'OLL');
  const recoloring = [4, 2, 5, 1, 0, 3];
  const state = Uint8Array.from(source.inverseState, color => recoloring[color]);
  const choices = matchLastLayer(state, { catalog });
  assert.ok(choices.length > 0);
  assert.ok(isSolved(applyAlg(state, [...choices[0].moves, ...choices[0].expectedPll.moves])));
});

test('Execution estimates are explicitly scores; HTM/QTM/rotations remain independent', () => {
  assert.equal(costScore(['R2', 'U'], 'htm'), 2);
  assert.equal(costScore(['R2', 'U'], 'qtm'), 3);
  assert.deepEqual(moveMetrics(['x', 'M2', 'Rw']), { htm: 3, qtm: 5, rotations: 1, slices: 1, wide: 1,
    score: costScore(['x', 'M2', 'Rw']), metric: 'execution',
    metricDefinition: 'HTM: outer/wide=1, slice=2, whole-cube rotations counted separately; QTM counts half turns twice.' });
});
