import {
  experimentalSolve2x2x2,
  experimentalSolve3x3x3IgnoringCenters,
  setSearchDebug,
  solveMegaminx,
  solvePyraminx,
  solveSkewb,
  solveTwips
} from "../chunks/chunk-NJ66FRKF.js";
import {
  random333Pattern
} from "../chunks/chunk-QOLD6GH2.js";
import "../chunks/chunk-BHVTDDUY.js";
import "../chunks/chunk-6R47S6MP.js";
import "../chunks/chunk-IIJFVP3K.js";
import "../chunks/chunk-LBER75W4.js";
import "../chunks/chunk-QZK3M7IM.js";

// src/cubing/search/index.ts
var experimentalSolveTwsearch = (...args) => {
  console.error(
    "`experimentalSolveTwsearch(\u2026)` is deprecated. Please call `experimentalSolveTwips(\u2026)` instead."
  );
  return solveTwips(...args);
};
export {
  experimentalSolve2x2x2,
  experimentalSolve3x3x3IgnoringCenters,
  solveTwips as experimentalSolveTwips,
  experimentalSolveTwsearch,
  random333Pattern,
  setSearchDebug,
  solveMegaminx,
  solvePyraminx,
  solveSkewb
};
