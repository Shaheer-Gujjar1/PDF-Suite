/**
 * Self-contained Web Worker source (classic worker, run from a Blob URL).
 *
 * The main thread prepends the fetched pdf-lib UMD bundle to this string
 * before creating the Blob, so `self.PDFLib` is available with no runtime
 * importScripts. See `lib/processing/libs.ts`.
 *
 * Message protocol matches `lib/processing/types.ts`:
 *   in : { type: 'process', task: Task }
 *   out: { id, kind: 'progress'|'log'|'result'|'error', ... }
 */
export const WORKER_SOURCE = /* js */ `
"use strict";

/* pdf-lib is prepended by the main thread; access via self.PDFLib. */
function getPDFLib() {
  if (!self.PDFLib) throw new Error('pdf-lib failed to load');
  return self.PDFLib;
}

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function guessMime(name) {
  var ext = (name.split('.').pop() || '').toLowerCase();
  var map = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
    zip: 'application/zip', txt: 'text/plain', html: 'text/html'
  };
  return map[ext] || 'application/octet-stream';
}

function stripExt(name) {
  var dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Convert a Uint8Array (possibly a subarray) into a clean ArrayBuffer. */
function toArrayBuffer(bytes) {
  if (bytes.buffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Parse "1-3, 5, 7-9" into 0-indexed page indices. */
function parseRanges(text, pageCount) {
  var groups = [];
  var parts = String(text || '').split(',');
  for (var i = 0; i < parts.length; i++) {
    var raw = parts[i].trim();
    if (!raw) continue;
    var dash = raw.indexOf('-');
    var start, end;
    if (dash >= 0) {
      start = parseInt(raw.slice(0, dash), 10);
      end = parseInt(raw.slice(dash + 1), 10);
    } else {
      start = end = parseInt(raw, 10);
    }
    if (isNaN(start) || isNaN(end) || start < 1 || end < 1) continue;
    if (start > end) { var t = start; start = end; end = t; }
    var group = [];
    for (var p = start; p <= end && p <= pageCount; p++) group.push(p - 1);
    if (group.length) groups.push(group);
  }
  return groups;
}

/** Convert any image to PNG Uint8Array (via OffscreenCanvas) if not jpg/png. */
async function toEmbeddable(data, mime) {
  if (mime === 'image/jpeg') return { bytes: new Uint8Array(data), kind: 'jpg' };
  if (mime === 'image/png') return { bytes: new Uint8Array(data), kind: 'png' };
  var blob = new Blob([data], { type: mime || 'image/png' });
  var bmp = await createImageBitmap(blob);
  var canvas = new OffscreenCanvas(bmp.width, bmp.height);
  var ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  var pngBlob = await canvas.convertToBlob({ type: 'image/png' });
  var arr = new Uint8Array(await pngBlob.arrayBuffer());
  return { bytes: arr, kind: 'png' };
}

function fitInto(imgW, imgH, pageW, pageH) {
  var scale = Math.min(pageW / imgW, pageH / imgH);
  var w = imgW * scale, h = imgH * scale;
  return { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h };
}

var PAGE_DIMS = { a4: [595.28, 841.89], letter: [612, 792] };

var processors = {};

/* ---- Engine preview (Step 2) ------------------------------------------- */
processors['passthrough'] = async function (inputs, _opts, onProgress, log) {
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Processing ' + inputs[i].fileName);
    for (var s = 0; s <= 10; s++) { await delay(55); onProgress((i + s / 10) / inputs.length); }
    out.push({ name: stripExt(inputs[i].fileName) + '-processed.' + (inputs[i].fileName.split('.').pop()||'pdf'), data: inputs[i].data, mime: guessMime(inputs[i].fileName) });
  }
  onProgress(1);
  return out;
};

/* ---- Merge PDF (multiple PDFs -> one) ---------------------------------- */
processors['merge'] = async function (inputs, _opts, onProgress, log) {
  var lib = getPDFLib();
  var out = await lib.PDFDocument.create();
  for (var i = 0; i < inputs.length; i++) {
    log('Merging ' + inputs[i].fileName);
    var src;
    try { src = await lib.PDFDocument.load(inputs[i].data); }
    catch (e) { throw new Error('Could not read ' + inputs[i].fileName + ': ' + e.message); }
    var pages = await out.copyPages(src, src.getPageIndices());
    for (var p = 0; p < pages.length; p++) out.addPage(pages[p]);
    onProgress((i + 1) / inputs.length);
  }
  var bytes = await out.save();
  onProgress(1);
  return [{ name: 'merged.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf' }];
};

/* ---- Split PDF (one or more PDFs -> many) ------------------------------ */
processors['split'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var mode = (opts && opts.mode) || 'each';
  var rangesText = (opts && opts.ranges) || '';
  var all = [];
  for (var fi = 0; fi < inputs.length; fi++) {
    log('Splitting ' + inputs[fi].fileName);
    var src = await lib.PDFDocument.load(inputs[fi].data);
    var total = src.getPageCount();
    var groups;
    if (mode === 'ranges') {
      groups = parseRanges(rangesText, total);
      if (!groups.length) groups = [src.getPageIndices()];
    } else {
      groups = [];
      for (var g = 0; g < total; g++) groups.push([g]);
    }
    var base = stripExt(inputs[fi].fileName);
    for (var gi = 0; gi < groups.length; gi++) {
      var sub = await lib.PDFDocument.create();
      var copied = await sub.copyPages(src, groups[gi]);
      for (var c = 0; c < copied.length; c++) sub.addPage(copied[c]);
      var b = await sub.save();
      var first = groups[gi][0] + 1, last = groups[gi][groups[gi].length - 1] + 1;
      var label = first === last ? String(first) : first + '-' + last;
      all.push({ name: base + '-pages-' + label + '.pdf', data: toArrayBuffer(b), mime: 'application/pdf' });
    }
    onProgress((fi + 1) / inputs.length);
  }
  onProgress(1);
  return all;
};

/* ---- Rotate PDF (batch) ------------------------------------------------ */
processors['rotate'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var angle = ((opts && Number(opts.angle)) || 90) % 360;
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Rotating ' + inputs[i].fileName);
    var doc = await lib.PDFDocument.load(inputs[i].data);
    var pages = doc.getPages();
    for (var p = 0; p < pages.length; p++) {
      var cur = pages[p].getRotation().angle;
      pages[p].setRotation(lib.degrees((cur + angle) % 360));
    }
    var bytes = await doc.save();
    out.push({ name: stripExt(inputs[i].fileName) + '-rotated.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Images to PDF ----------------------------------------------------- */
processors['images-to-pdf'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var output = (opts && opts.output) || 'single';
  var pageSize = (opts && opts.pageSize) || 'fit';

  async function buildPage(doc, conv) {
    var img = conv.kind === 'png' ? await doc.embedPng(conv.bytes) : await doc.embedJpg(conv.bytes);
    var page;
    if (pageSize === 'fit') {
      page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      var dims = PAGE_DIMS[pageSize] || PAGE_DIMS.a4;
      page = doc.addPage(dims);
      var f = fitInto(img.width, img.height, dims[0], dims[1]);
      page.drawImage(img, { x: f.x, y: f.y, width: f.width, height: f.height });
    }
    return img;
  }

  if (output === 'single') {
    var doc = await lib.PDFDocument.create();
    for (var i = 0; i < inputs.length; i++) {
      log('Adding ' + inputs[i].fileName);
      var conv = await toEmbeddable(inputs[i].data, guessMime(inputs[i].fileName));
      await buildPage(doc, conv);
      onProgress((i + 1) / inputs.length);
    }
    var bytes = await doc.save();
    onProgress(1);
    return [{ name: 'images.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf' }];
  } else {
    var outs = [];
    for (var j = 0; j < inputs.length; j++) {
      log('Converting ' + inputs[j].fileName);
      var doc2 = await lib.PDFDocument.create();
      var conv2 = await toEmbeddable(inputs[j].data, guessMime(inputs[j].fileName));
      await buildPage(doc2, conv2);
      var b2 = await doc2.save();
      outs.push({ name: stripExt(inputs[j].fileName) + '.pdf', data: toArrayBuffer(b2), mime: 'application/pdf' });
      onProgress((j + 1) / inputs.length);
    }
    onProgress(1);
    return outs;
  }
};

function fmtBytes(n) {
  if (!n) return '0 B';
  var k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/* ---- Compress PDF (lossless, stream + metadata) ------------------------ */
processors['compress'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var stripMeta = !!(opts && opts.stripMetadata);
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    var orig = inputs[i].data.byteLength;
    log('Compressing ' + inputs[i].fileName + ' (' + fmtBytes(orig) + ')');
    var doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    if (stripMeta) {
      try {
        doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
        doc.setKeywords([]); doc.setCreator(''); doc.setProducer('PDF Suite');
      } catch (_) {}
    }
    var bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    var comp = bytes.byteLength;
    var pct = orig > 0 ? Math.round((1 - comp / orig) * 100) : 0;
    var note = fmtBytes(orig) + ' → ' + fmtBytes(comp) + (pct > 0 ? ' (' + pct + '% smaller)' : (pct < 0 ? ' (' + (-pct) + '% larger)' : ' (no change)'));
    out.push({
      name: stripExt(inputs[i].fileName) + '-compressed.pdf',
      data: toArrayBuffer(bytes),
      mime: 'application/pdf',
      note: note
    });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Repair PDF (tolerant load + clean re-save) ------------------------- */
processors['repair'] = async function (inputs, _opts, onProgress, log) {
  var lib = getPDFLib();
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Repairing ' + inputs[i].fileName);
    var doc;
    try {
      doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true, throwOnInvalidObject: false });
    } catch (e) {
      throw new Error('Could not repair ' + inputs[i].fileName + ': ' + (e && e.message ? e.message : String(e)));
    }
    var bytes = await doc.save({ useObjectStreams: true });
    out.push({
      name: stripExt(inputs[i].fileName) + '-repaired.pdf',
      data: toArrayBuffer(bytes),
      mime: 'application/pdf',
      note: doc.getPageCount() + ' pages recovered'
    });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Unlock PDF (remove owner-password restrictions) ------------------- */
processors['unlock'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var password = (opts && typeof opts.password === 'string') ? opts.password : '';
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Unlocking ' + inputs[i].fileName);
    var doc;
    try {
      var loadOpts = { ignoreEncryption: true };
      if (password) loadOpts.password = password;
      doc = await lib.PDFDocument.load(inputs[i].data, loadOpts);
    } catch (e) {
      var msg = (e && e.message ? e.message : String(e));
      throw new Error('Could not unlock ' + inputs[i].fileName + '. If it requires a password to open, pdf-lib cannot decrypt encrypted content. ' + msg);
    }
    // Re-save without any encryption → restrictions removed.
    var bytes = await doc.save({ useObjectStreams: true });
    out.push({
      name: stripExt(inputs[i].fileName) + '-unlocked.pdf',
      data: toArrayBuffer(bytes),
      mime: 'application/pdf',
      note: 'Restrictions removed'
    });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

self.onmessage = function (e) {
  var task = e.data && e.data.task;
  if (!task) return;
  var id = task.id;
  function send(msg, transfer) { self.postMessage(msg, transfer || []); }
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
        var transfer = [];
        for (var i = 0; i < files.length; i++) {
          if (files[i].data instanceof ArrayBuffer) transfer.push(files[i].data);
        }
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
