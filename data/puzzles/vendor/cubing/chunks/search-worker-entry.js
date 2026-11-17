import {
  exposeAPI
} from "./chunk-BHVTDDUY.js";

// src/cubing/search/worker-workarounds/search-worker-entry.js
if (exposeAPI.expose) {
  void import("./inside-UWSZBO4Y.js").then(() => {
    if (globalThis.postMessage) {
      globalThis.postMessage("comlink-exposed");
    } else {
      globalThis.process.getBuiltinModule("node:worker_threads").parentPort?.postMessage("comlink-exposed");
    }
  });
}
var WORKER_ENTRY_FILE_URL = import.meta.url;
export {
  WORKER_ENTRY_FILE_URL
};
