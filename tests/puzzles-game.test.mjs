import assert from 'node:assert/strict';
import {createGame,restoreGame,normalizeSpec} from '../data/puzzles/model.mjs';
for(const spec of [{kind:'cube',size:2},{kind:'cube',size:3},{kind:'cube',size:50},{kind:'pyramid',size:2},{kind:'pyramid',size:20},{kind:'dodecahedron',size:2},{kind:'dodecahedron',size:3},{kind:'dodecahedron',size:20}]){
  const game=await createGame(spec),moves=game.adapter.scramble().slice(0,12);
  assert.ok(game.solved);game.applyInstant(moves,{source:'scramble',stage:'Перемешивание'});game.markScramble(moves);
  const before=[...game.state],saved=game.toJSON(),restored=await restoreGame(JSON.stringify(saved));
  assert.deepEqual([...restored.state],before);assert.deepEqual(restored.spec,spec);assert.equal(restored.scramble,game.scramble);
  game.apply(moves[0],{source:'manual',stage:'Практика'});assert.ok(game.startedAt!==null||game.solved);game.stop();assert.ok(game.elapsed>=0);
  game.undo();assert.deepEqual([...game.state],before);game.redo();assert.notDeepEqual([...game.state],before);
  game.resetAttempt();assert.deepEqual([...game.state],before);assert.equal(game.playerMoves,0);
  while(game.canUndo)game.undo();game.apply(moves[0]);game.resetAttempt();assert.ok(game.cursor<=game.moves.length);assert.equal(game.canRedo,true);
}
for(let c=0;c<6;c++){const g=await createGame({kind:'cube',size:4},{crossColor:c});assert.equal(g.state[3*16],c);assert.ok(g.solved);}
for(const size of [2,3,4,5,50]){
  const g=await createGame({kind:'cube',size});g.applyInstant('x y',{source:'manual'});
  assert.deepEqual(g.goal,g.state,'manual whole turns update the solved frame');assert.equal(g.playerMoves,0);assert.equal(g.startedAt,null);
  const goalBefore=g.goal.slice(),orientation=g.setCrossFrame(2);assert.deepEqual(g.goal,goalBefore,'planning a frame change is side-effect free');
  g.applyInstant(orientation,{source:'frame'});assert.equal(g.state[3*size*size],2);assert.deepEqual(g.goal,g.state);
  g.undo();assert.deepEqual(g.goal,g.state);g.redo();assert.deepEqual(g.goal,g.state);
  const restored=await restoreGame(g.toJSON());assert.deepEqual(restored.goal,g.goal);assert.deepEqual(restored.state,g.state);
  g.resetAttempt();assert.deepEqual(g.goal,g.initial);assert.deepEqual(g.state,g.initial);
}
// Custom valid 3x3 centre palettes survive orientation, export and replay.
const source=await createGame({kind:'cube',size:3}),palette=[1,2,0,4,5,3];
const custom=await createGame({kind:'cube',size:3},{initialState:[...source.state].map(c=>palette[c])});
custom.applyInstant('M x R');const customRestored=await restoreGame(custom.toJSON());assert.deepEqual(customRestored.goal,custom.goal);
custom.resetAttempt();assert.deepEqual(custom.goal,custom.initial);
const game=await createGame({kind:'cube',size:3});game.apply('R');assert.ok(game.startedAt!==null,'first manual move starts timer');game.stop();
const json=game.toJSON();
for(const bad of [{...json,version:99},{...json,cursor:200},{...json,moves:['200Rw']},{...json,initial:[1]},{...json,initial:Array(54).fill(0)},{...json,goal:Array(54).fill(0)},{...json,goal:[1]}])await assert.rejects(()=>restoreGame(bad));
assert.throws(()=>normalizeSpec({kind:'cube',size:51}));assert.throws(()=>normalizeSpec({kind:'pyramid',size:21}));assert.throws(()=>normalizeSpec({kind:'pyramid',size:2.5}));
console.log('PASS game sessions: 8 puzzle/size variants, opaque even dodeca, restore/branch/undo/redo/timer/cross frame and malformed imports.');
