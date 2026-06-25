/**
 * Self-contained Web Worker source (classic worker, run from a Blob URL).
 *
 * The main thread prepends the fetched pdf-lib UMD bundle + the
 * WORKER_IMPORT_URLS map (so the worker knows where to find the lazy libs)
 * before creating the Blob. pdf-lib is embedded (small, always needed);
 * mammoth/xlsx/docx/pdfjs are loaded lazily via importScripts when a tool
 * that needs them runs.
 *
 * Message protocol matches `lib/processing/types.ts`:
 *   in : { type: 'process', task: Task }
 *   out: { id, kind: 'progress'|'log'|'result'|'error', ... }
 */
export const WORKER_SOURCE = /* js */ `
"use strict";

var IMPORT_URLS = __IMPORT_URLS_PLACEHOLDER__;

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
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes.buffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  if (bytes.buffer) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return bytes;
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

/* ---- Page Numbers ------------------------------------------------------ */
processors['page-numbers'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var fontSize = (opts && Number(opts.fontSize)) || 11;
  var position = (opts && opts.position) || 'bottom-center';
  var format = (opts && opts.format) || '{n}';
  var startNum = (opts && Number(opts.startNumber)) || 1;
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Numbering ' + inputs[i].fileName);
    var doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    var font = await doc.embedFont(lib.StandardFonts.Helvetica);
    var pages = doc.getPages();
    for (var p = 0; p < pages.length; p++) {
      var num = startNum + p;
      var text = String(format).replace(/\{n\}/g, String(num)).replace(/\{total\}/g, String(pages.length));
      var w = font.widthOfTextAtSize(text, fontSize);
      var pw = pages[p].getWidth(), ph = pages[p].getHeight();
      var margin = 28;
      var x, y;
      if (position === 'bottom-center') { x = (pw - w) / 2; y = margin; }
      else if (position === 'bottom-right') { x = pw - w - margin; y = margin; }
      else if (position === 'bottom-left') { x = margin; y = margin; }
      else if (position === 'top-center') { x = (pw - w) / 2; y = ph - margin - fontSize; }
      else if (position === 'top-right') { x = pw - w - margin; y = ph - margin - fontSize; }
      else { x = margin; y = ph - margin - fontSize; }
      pages[p].drawText(text, { x: x, y: y, font: font, size: fontSize, color: lib.rgb(0.3, 0.3, 0.3) });
    }
    var bytes = await doc.save({ useObjectStreams: true });
    out.push({ name: stripExt(inputs[i].fileName) + '-numbered.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: pages.length + ' pages numbered' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Watermark PDF ----------------------------------------------------- */
processors['watermark'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var text = (opts && opts.text) || 'CONFIDENTIAL';
  var fontSize = (opts && Number(opts.fontSize)) || 50;
  var opacity = Math.max(0, Math.min(1, (opts && Number(opts.opacity)) || 0.15));
  var rotation = (opts && Number(opts.rotation)) || -45;
  var color = lib.rgb(0.6, 0.1, 0.15);
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Watermarking ' + inputs[i].fileName);
    var doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    var font = await doc.embedFont(lib.StandardFonts.HelveticaBold);
    var pages = doc.getPages();
    for (var p = 0; p < pages.length; p++) {
      var pw = pages[p].getWidth(), ph = pages[p].getHeight();
      var w = font.widthOfTextAtSize(text, fontSize);
      pages[p].drawText(text, {
        x: (pw - w) / 2, y: ph / 2 - fontSize / 2,
        font: font, size: fontSize, color: color, opacity: opacity, rotate: lib.degrees(rotation)
      });
    }
    var bytes = await doc.save({ useObjectStreams: true });
    out.push({ name: stripExt(inputs[i].fileName) + '-watermarked.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: 'Watermark added' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Protect PDF ------------------------------------------------------- */
processors['protect'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var password = (opts && typeof opts.password === 'string') ? opts.password : '';
  if (!password) throw new Error('A password is required to protect a PDF.');
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Protecting ' + inputs[i].fileName);
    var doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    var bytes = await doc.save({
      useObjectStreams: true,
      encryption: {
        userPassword: password,
        ownerPassword: password,
        permissions: { printing: 'highResolution', modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false }
      }
    });
    out.push({ name: stripExt(inputs[i].fileName) + '-protected.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: 'Password protected' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- PDF to Images ----------------------------------------------------- */
/* Uses pdf.js (rendered via OffscreenCanvas) to rasterize each page. */
async function loadPdfJs() {
  if (self.pdfjsLib) return self.pdfjsLib;
  // pdf.js fake-worker setup checks for document even inside a worker.
  // Polyfill the minimal surface it needs so loading succeeds here.
  if (typeof self.document === 'undefined') {
    var fakeEl = { style: {}, appendChild: function () {}, setAttribute: function () {}, getContext: function () { return null; } };
    self.document = {
      createElement: function () { return fakeEl; },
      createElementNS: function () { return fakeEl; },
      currentScript: { src: '' },
      body: fakeEl, head: fakeEl, documentElement: fakeEl,
    };
    self.window = self;
  }
  importScripts(IMPORT_URLS.pdfjs);
  // Fetch the worker source and create a same-origin blob URL so pdf.js can
  // spawn its nested worker without cross-origin issues.
  var wc = await fetch(IMPORT_URLS.pdfjsWorker).then(function (r) { return r.text(); });
  var bu = URL.createObjectURL(new Blob([wc], { type: 'application/javascript' }));
  self.pdfjsLib.GlobalWorkerOptions.workerSrc = bu;
  return self.pdfjsLib;
}

processors['pdf-to-images'] = async function (inputs, opts, onProgress, log) {
  var format = (opts && opts.format) || 'png';
  var scale = (opts && Number(opts.scale)) || 2;
  var pdfjs;
  try { pdfjs = await loadPdfJs(); }
  catch (e) { throw new Error('Could not load PDF rendering engine: ' + (e.message || e)); }
  var all = [];
  for (var fi = 0; fi < inputs.length; fi++) {
    log('Rendering ' + inputs[fi].fileName);
    var data = new Uint8Array(inputs[fi].data);
    var doc = await pdfjs.getDocument({ data: data, useWorkerFetch: false, isEvalSupported: false }).promise;
    var base = stripExt(inputs[fi].fileName);
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var viewport = page.getViewport({ scale: scale });
      var canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      var blob = await canvas.convertToBlob({ type: mime, quality: format === 'jpg' ? 0.85 : undefined });
      var arr = new Uint8Array(await blob.arrayBuffer());
      all.push({ name: base + '-page-' + p + '.' + (format === 'jpg' ? 'jpg' : 'png'), data: toArrayBuffer(arr), mime: mime });
      onProgress((fi + (p / doc.numPages)) / inputs.length);
    }
    try { await doc.destroy(); } catch (_) {}
  }
  onProgress(1);
  return all;
};

/* ---- HTML to PDF ------------------------------------------------------- */
/* Renders HTML by parsing into text runs + basic layout via pdf-lib. */
processors['html-to-pdf'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var html = '';
  for (var i = 0; i < inputs.length; i++) {
    html += new TextDecoder().decode(new Uint8Array(inputs[i].data));
  }
  log('Parsing HTML');
  var doc = await lib.PDFDocument.create();
  var font = await doc.embedFont(lib.StandardFonts.Helvetica);
  var fontBold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  var pageW = 595.28, pageH = 841.89;
  var margin = 56, lineHeight = 18, fontSize = 11;
  var page = doc.addPage([pageW, pageH]);
  var y = pageH - margin;
  var maxWidth = pageW - margin * 2;

  function newPage() { page = doc.addPage([pageW, pageH]); y = pageH - margin; }

  function wrapText(text, f, size) {
    var words = text.split(/\s+/);
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (f.widthOfTextAtSize(test, size) > maxWidth) {
        if (line) lines.push(line);
        line = words[i];
      } else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function ensureSpace(h) { if (y - h < margin) newPage(); }

  // Simple HTML tokenizer: <h1-3>, <p>, <br>, <li>, <strong>/<b>
  // Note: forward slashes in regex inside a template literal must be escaped
  // as [\\/] (a character class) — \\/ would also work but [\\/] is clearer.
  var parts = html.replace(/<![^>]*>/g, '').replace(/<script[\\s\\S]*?<\\/script>/gi, '').replace(/<style[\\s\\S]*?<\\/style>/gi, '').split(/(<[^>]+>)/);
  var bold = false, heading = 0;
  for (var k = 0; k < parts.length; k++) {
    var part = parts[k];
    if (!part) continue;
    if (part[0] === '<') {
      var tag = part.toLowerCase().replace(/[<\/>]/g, '').split(/\s/)[0];
      if (/^h[1-3]$/.test(tag)) { heading = parseInt(tag[1]); ensureSpace(lineHeight * 1.5); y -= lineHeight * 0.5; }
      else if (tag === '/h1' || tag === '/h2' || tag === '/h3') { heading = 0; y -= lineHeight * 0.5; }
      else if (tag === 'p' || tag === 'li') { ensureSpace(lineHeight); y -= lineHeight * 0.4; }
      else if (tag === 'br') { y -= lineHeight; ensureSpace(0); }
      else if (tag === 'strong' || tag === 'b') bold = true;
      else if (tag === '/strong' || tag === '/b') bold = false;
      continue;
    }
    var decoded = part.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
    if (!decoded) continue;
    var f = heading ? fontBold : (bold ? fontBold : font);
    var size = heading === 1 ? 24 : heading === 2 ? 20 : heading === 3 ? 16 : fontSize;
    var lines = wrapText(decoded, f, size);
    for (var li = 0; li < lines.length; li++) {
      ensureSpace(size + 2);
      y -= size + 6;
      page.drawText(lines[li], { x: margin, y: y, font: f, size: size, color: lib.rgb(0.1, 0.1, 0.12) });
    }
  }
  var bytes = await doc.save({ useObjectStreams: true });
  onProgress(1);
  return [{ name: 'html-output.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: doc.getPageCount() + ' page(s)' }];
};

/* ---- Word to PDF (mammoth → HTML → pdf-lib) --------------------------- */
async function getMammoth() {
  if (!self.mammoth) importScripts(IMPORT_URLS.mammoth);
  if (!self.mammoth) throw new Error('mammoth failed to load');
  return self.mammoth;
}

processors['word-to-pdf'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var mammoth = await getMammoth();
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Converting ' + inputs[i].fileName);
    var arrayBuffer = inputs[i].data;
    var result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
    // Reuse the HTML→PDF rendering by feeding the HTML through the same logic.
    var htmlInput = [{ fileName: 'doc.html', data: new TextEncoder().encode(result.value).buffer }];
    var rendered = await processors['html-to-pdf'](htmlInput, {}, function () {}, function () {});
    var file = rendered[0];
    out.push({ name: stripExt(inputs[i].fileName) + '.pdf', data: file.data, mime: 'application/pdf', note: file.note });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Excel to PDF (SheetJS → grid) ------------------------------------ */
async function getXLSX() {
  if (!self.XLSX) importScripts(IMPORT_URLS.xlsx);
  if (!self.XLSX) throw new Error('xlsx failed to load');
  return self.XLSX;
}

processors['excel-to-pdf'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var XLSX = await getXLSX();
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Converting ' + inputs[i].fileName);
    var wb = XLSX.read(inputs[i].data, { type: 'array' });
    var doc = await lib.PDFDocument.create();
    var font = await doc.embedFont(lib.StandardFonts.Helvetica);
    var fontBold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
    var pageW = 841.89, pageH = 595.28; // A4 landscape
    var margin = 40, cellPad = 4, colWidth = 90, rowHeight = 18, fontSize = 9;
    for (var s = 0; s < wb.SheetNames.length; s++) {
      var sheet = wb.Sheets[wb.SheetNames[s]];
      var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      if (!rows.length) continue;
      var page = doc.addPage([pageW, pageH]);
      var y = pageH - margin;
      page.drawText(String(wb.SheetNames[s]), { x: margin, y: y, font: fontBold, size: 14, color: lib.rgb(0.1, 0.1, 0.15) });
      y -= 26;
      var maxCol = 0;
      for (var r = 0; r < rows.length; r++) maxCol = Math.max(maxCol, rows[r].length);
      var colsPerPage = Math.floor((pageW - margin * 2) / colWidth);
      for (var cStart = 0; cStart < maxCol; cStart += colsPerPage) {
        if (cStart > 0) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
        var cEnd = Math.min(cStart + colsPerPage, maxCol);
        for (var r2 = 0; r2 < rows.length; r2++) {
          if (y - rowHeight < margin) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
          for (var c2 = cStart; c2 < cEnd; c2++) {
            var val = rows[r2][c2] != null ? String(rows[r2][c2]) : '';
            if (val.length > 18) val = val.slice(0, 17) + '…';
            var isHeader = r2 === 0;
            var xf = isHeader ? fontBold : font;
            var x = margin + (c2 - cStart) * colWidth;
            page.drawText(val, { x: x + cellPad, y: y + cellPad, font: xf, size: fontSize, color: lib.rgb(0.1, 0.1, 0.12) });
            page.drawRectangle({ x: x, y: y, width: colWidth, height: rowHeight, borderColor: lib.rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
          }
          y -= rowHeight;
        }
      }
    }
    var bytes = await doc.save({ useObjectStreams: true });
    out.push({ name: stripExt(inputs[i].fileName) + '.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: wb.SheetNames.length + ' sheet(s)' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- PDF to Word (pdf.js text extraction → DOCX via docx lib) --------- */
async function getDocx() {
  if (!self.docx) importScripts(IMPORT_URLS.docx);
  if (!self.docx) throw new Error('docx library failed to load');
  return self.docx;
}

/** Extract text items (with y-positions) per page using pdf.js. */
async function extractTextPages(data, scale) {
  var pdfjs;
  try { pdfjs = await loadPdfJs(); }
  catch (e) { throw new Error('Could not load PDF text engine: ' + (e.message || e)); }
  var doc = await pdfjs.getDocument({ data: new Uint8Array(data), useWorkerFetch: false, isEvalSupported: false }).promise;
  var pages = [];
  for (var p = 1; p <= doc.numPages; p++) {
    var page = await doc.getPage(p);
    var content = await page.getTextContent();
    // Group items into lines by rounded y, then sort by x.
    var lines = {};
    for (var i = 0; i < content.items.length; i++) {
      var item = content.items[i];
      var str = item.str || '';
      if (item.hasEOL) str += '\\n';
      var yKey = Math.round(-item.transform[5]);
      if (!lines[yKey]) lines[yKey] = [];
      lines[yKey].push({ x: item.transform[4], text: str });
    }
    var sortedYs = Object.keys(lines).map(Number).sort(function (a, b) { return a - b; });
    var pageLines = sortedYs.map(function (yk) {
      var arr = lines[yk].sort(function (a, b) { return a.x - b.x; });
      return arr.map(function (it) { return it.text; }).join('').trim();
    }).filter(function (l) { return l.length > 0; });
    pages.push(pageLines);
    try { await page.cleanup(); } catch (_) {}
  }
  try { await doc.destroy(); } catch (_) {}
  return pages;
}

processors['pdf-to-word'] = async function (inputs, opts, onProgress, log) {
  var docxLib = await getDocx();
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Extracting text from ' + inputs[i].fileName);
    var pages = await extractTextPages(inputs[i].data);
    var children = [];
    for (var p = 0; p < pages.length; p++) {
      children.push(new docxLib.Paragraph({ text: 'Page ' + (p + 1), heading: docxLib.HeadingLevel.HEADING_2 }));
      for (var l = 0; l < pages[p].length; l++) {
        children.push(new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: pages[p][l] })] }));
      }
      if (p < pages.length - 1) children.push(new docxLib.Paragraph({ children: [new docxLib.PageBreak()] }));
    }
    var d = new docxLib.Document({ sections: [{ properties: {}, children: children }] });
    var blob = await docxLib.Packer.toBlob(d);
    var arr = new Uint8Array(await blob.arrayBuffer());
    var totalLines = pages.reduce(function (a, p) { return a + p.length; }, 0);
    out.push({ name: stripExt(inputs[i].fileName) + '.docx', data: toArrayBuffer(arr), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', note: pages.length + ' pages, ' + totalLines + ' lines' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- PDF to Excel (pdf.js text → rows) -------------------------------- */
processors['pdf-to-excel'] = async function (inputs, opts, onProgress, log) {
  var XLSX = await getXLSX();
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Extracting from ' + inputs[i].fileName);
    var pages = await extractTextPages(inputs[i].data);
    var wb = XLSX.utils.book_new();
    for (var p = 0; p < pages.length; p++) {
      var pageLines = pages[p] || [];
      var aoa = pageLines.map(function (line) {
        if (typeof line !== 'string') return [''];
        // Split on 2+ spaces or tabs to detect columns.
        return line.split(/\t| {2,}/).map(function (c) { return c.trim(); });
      });
      if (aoa.length === 0) aoa = [['(no text extracted)']];
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      var sheetName = 'Page ' + (p + 1);
      XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    }
    var xlsxOut = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    var xlsxBuf = xlsxOut instanceof ArrayBuffer ? xlsxOut : (xlsxOut.buffer ? toArrayBuffer(xlsxOut) : xlsxOut);
    out.push({ name: stripExt(inputs[i].fileName) + '.xlsx', data: xlsxBuf, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', note: pages.length + ' sheet(s)' });
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
