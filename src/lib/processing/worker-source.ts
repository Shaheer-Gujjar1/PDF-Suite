/**
 * Self-contained Web Worker source (classic worker, run from a Blob URL).
 *
 * Why a blob worker instead of `new Worker(new URL(...), {type:'module'})`?
 * Module workers enforce strict same-origin on the script URL, which breaks
 * in cross-origin preview/CDN deployments. A Blob-URL worker is same-origin
 * by construction, so it works everywhere. Heavy libraries (pdf-lib, jsPDF,
 * SheetJS, QPDF WASM…) are pulled in via `importScripts()` at the top as each
 * build step needs them — see the Step 3+ notes below.
 *
 * The message protocol matches `lib/processing/types.ts`:
 *   in : { type: 'process', task: Task }
 *   out: { id, kind: 'progress'|'log'|'result'|'error', ... }
 */
export const WORKER_SOURCE = /* js */ `
"use strict";

// --- Step 3+ library loaders (added as needed) -----------------------------
// Example for when pdf-lib is required:
//   importScripts('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
//   var PDFLib = self.PDFLib;
// ---------------------------------------------------------------------------

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function suffixName(name, suffix) {
  var dot = name.lastIndexOf('.');
  if (dot <= 0) return name + suffix;
  return name.slice(0, dot) + suffix + name.slice(dot);
}

function guessMime(name) {
  var ext = (name.split('.').pop() || '').toLowerCase();
  var map = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
    txt: 'text/plain',
    html: 'text/html'
  };
  return map[ext] || 'application/octet-stream';
}

var processors = {};

/**
 * Engine preview processor (Step 2). Simulates staged work with streamed
 * progress and returns each input unchanged (renamed). Verifies the full
 * pipeline: queue, parallelism, progress, transferable buffers, ZIP output.
 */
processors['passthrough'] = async function (inputs, _opts, onProgress, log) {
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    var inp = inputs[i];
    log('Processing ' + inp.fileName);
    var steps = 10;
    for (var s = 0; s <= steps; s++) {
      await delay(55);
      onProgress((i + s / steps) / inputs.length);
    }
    out.push({
      name: suffixName(inp.fileName, '-processed'),
      data: inp.data,
      mime: guessMime(inp.fileName)
    });
  }
  onProgress(1);
  return out;
};

self.onmessage = function (e) {
  var task = e.data && e.data.task;
  if (!task) return;
  var id = task.id;
  function send(msg, transfer) {
    self.postMessage(msg, transfer || []);
  }
  try {
    var fn = processors[task.processor];
    if (!fn) throw new Error('Unknown processor: ' + task.processor);
    var inputs = (task.inputs || []).map(function (i) {
      return { fileName: i.fileName, data: i.data };
    });
    var log = function (m) { send({ id: id, kind: 'log', message: m }); };
    var onProgress = function (p) { send({ id: id, kind: 'progress', progress: p }); };
    Promise.resolve()
      .then(function () { return fn(inputs, task.options, onProgress, log); })
      .then(function (files) {
        var transfer = files.map(function (f) { return f.data; });
        send({ id: id, kind: 'result', output: { id: id, files: files } }, transfer);
      })
      .catch(function (err) {
        send({ id: id, kind: 'error', message: (err && err.message) ? err.message : String(err) });
      });
  } catch (err) {
    send({ id: id, kind: 'error', message: (err && err.message) ? err.message : String(err) });
  }
};
`;
