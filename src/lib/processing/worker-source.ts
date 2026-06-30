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
  var orientation = (opts && opts.orientation) || 'portrait';
  var margin = (opts && Number(opts.margin)) || 0;
  var pageRotations = (opts && opts.pages) || null; /* [{ id, rotation }] */
  var selectedIds = (opts && opts.selectedIds) || [];

  /* Build a rotation lookup from page config (id → rotation).
     inputs don't have IDs, so we map by index order. */
  var rotationMap = {};
  if (pageRotations && pageRotations.length) {
    for (var ri = 0; ri < pageRotations.length; ri++) {
      rotationMap[ri] = pageRotations[ri].rotation || 0;
    }
  }

  /* Get page dimensions based on size + orientation */
  function getPageDims() {
    if (pageSize === 'fit') return null; /* null = use image dimensions */
    var dims = PAGE_DIMS[pageSize] || PAGE_DIMS.a4;
    var isPortrait = orientation === 'portrait';
    return isPortrait ? [Math.min(dims[0], dims[1]), Math.max(dims[0], dims[1])]
                      : [Math.max(dims[0], dims[1]), Math.min(dims[0], dims[1])];
  }

  /* Build a single page with the image */
  async function buildPage(doc, data, fileName, index) {
    var mime = guessMime(fileName);
    var conv = await toEmbeddable(data, mime);
    var img = conv.kind === 'png' ? await doc.embedPng(conv.bytes) : await doc.embedJpg(conv.bytes);

    /* Apply per-image rotation to the embedded image dimensions */
    var imgRot = rotationMap[index] || 0;
    var imgW = img.width, imgH = img.height;
    if (imgRot === 90 || imgRot === 270) { var tmp = imgW; imgW = imgH; imgH = tmp; }

    var pageDims = getPageDims();
    var page;
    if (!pageDims) {
      /* Fit to image — page size = image size (after rotation) */
      pageDims = [imgW, imgH];
      page = doc.addPage(pageDims);
      page.drawImage(img, {
        x: 0, y: 0, width: imgW, height: imgH,
        rotate: lib.degrees(imgRot)
      });
    } else {
      page = doc.addPage(pageDims);
      /* Fit image within page minus margins */
      var availW = pageDims[0] - margin * 2;
      var availH = pageDims[1] - margin * 2;
      var scale = Math.min(availW / imgW, availH / imgH);
      var drawW = imgW * scale, drawH = imgH * scale;
      var x = margin + (availW - drawW) / 2;
      var y = margin + (availH - drawH) / 2;
      page.drawImage(img, {
        x: x, y: y, width: drawW, height: drawH,
        rotate: lib.degrees(imgRot)
      });
    }
    return img;
  }

  /* Single mode: all images → 1 PDF */
  if (output === 'single') {
    /* Determine output filename from the first input's original name */
    var outName = 'images.pdf';
    if (inputs.length > 0 && inputs[0].fileName) {
      /* If the input is a page image (e.g. "page-1.jpg"), use a generic name.
         If it's an original file (e.g. "report.docx"), derive from it. */
      var firstName = inputs[0].fileName;
      if (firstName.indexOf('-page-') === -1 && firstName.indexOf('doc') > -1) {
        outName = stripExt(firstName) + '.pdf';
      } else if (opts && opts.outputName) {
        outName = stripExt(opts.outputName) + '.pdf';
      }
    }
    if (opts && opts.outputName) {
      outName = stripExt(opts.outputName) + '.pdf';
    }
    var doc = await lib.PDFDocument.create();
    for (var i = 0; i < inputs.length; i++) {
      log('Adding ' + inputs[i].fileName);
      await buildPage(doc, inputs[i].data, inputs[i].fileName, i);
      onProgress((i + 1) / inputs.length);
    }
    var bytes = await doc.save();
    onProgress(1);
    return [{ name: outName, data: toArrayBuffer(bytes), mime: 'application/pdf', note: inputs.length + ' page(s)' }];

  /* Multiple mode: each image → 1 PDF */
  } else if (output === 'multiple') {
    var outs = [];
    for (var j = 0; j < inputs.length; j++) {
      log('Converting ' + inputs[j].fileName);
      var doc2 = await lib.PDFDocument.create();
      await buildPage(doc2, inputs[j].data, inputs[j].fileName, j);
      var b2 = await doc2.save();
      outs.push({ name: stripExt(inputs[j].fileName) + '.pdf', data: toArrayBuffer(b2), mime: 'application/pdf' });
      onProgress((j + 1) / inputs.length);
    }
    onProgress(1);
    return outs;

  /* Mixed mode: selected → 1 PDF, rest → separate PDFs */
  } else if (output === 'mixed') {
    var selectedSet = {};
    for (var si = 0; si < selectedIds.length; si++) selectedSet[selectedIds[si]] = true;
    /* Map selectedIds to input indices — inputs are in the same order as pages config */
    /* The selectedIds correspond to the page IDs, which map to input indices by position */
    var mixedOuts = [];
    var selectedDoc = await lib.PDFDocument.create();
    var selectedCount = 0;
    var separateCount = 0;

    for (var k = 0; k < inputs.length; k++) {
      /* Check if this input index is in the selected set */
      var pageId = (pageRotations && pageRotations[k]) ? pageRotations[k].id : null;
      var isSelected = pageId && selectedSet[pageId];
      if (isSelected) {
        log('Adding ' + inputs[k].fileName + ' to combined PDF');
        await buildPage(selectedDoc, inputs[k].data, inputs[k].fileName, k);
        selectedCount++;
        onProgress((k + 1) / inputs.length);
      } else {
        log('Creating separate PDF for ' + inputs[k].fileName);
        var sepDoc = await lib.PDFDocument.create();
        await buildPage(sepDoc, inputs[k].data, inputs[k].fileName, k);
        var sepBytes = await sepDoc.save();
        mixedOuts.push({ name: stripExt(inputs[k].fileName) + '.pdf', data: toArrayBuffer(sepBytes), mime: 'application/pdf' });
        separateCount++;
        onProgress((k + 1) / inputs.length);
      }
    }

    /* Add the combined PDF first if any selected */
    if (selectedCount > 0) {
      var combinedBytes = await selectedDoc.save();
      mixedOuts.unshift({ name: 'selected-images.pdf', data: toArrayBuffer(combinedBytes), mime: 'application/pdf', note: selectedCount + ' image(s) combined' });
    }

    onProgress(1);
    return mixedOuts;
  }
};

function fmtBytes(n) {
  if (!n) return '0 B';
  var k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/* ---- Compress PDF (3 levels — text stays selectable on Low/Normal) ----- */
/* Low: lossless structural + light image recompression (q0.85). Text selectable.
   Normal: structural + medium image recompression (q0.5, downsample to 1200px). Text selectable.
   Extreme: full page rasterization at 0.6x → JPEG q0.3. Text NOT selectable. */
processors['compress'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var level = (opts && opts.level) || 'normal';
  var out = [];

  /* Helper: lossless structural compression */
  async function losslessCompress(data) {
    var doc = await lib.PDFDocument.load(data, { ignoreEncryption: true });
    try { doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer(''); } catch (_) {}
    return await doc.save({ useObjectStreams: true, addDefaultPage: false });
  }

  /* Helper: in-place image recompression — finds JPEG images in the PDF,
     decodes and re-encodes them at lower quality. Text stays as vector text. */
  async function recompressImages(data, quality, maxDim, progressBase, progressSpan) {
    var doc = await lib.PDFDocument.load(data, { ignoreEncryption: true });
    try { doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer(''); } catch (_) {}

    var context = doc.context;
    var PDFName = lib.PDFName;
    var PDFNumber = lib.PDFNumber;
    var PDFRawStream = lib.PDFRawStream;
    var imageCount = 0;
    var totalImages = 0;

    /* Enumerate all indirect objects to find image XObjects */
    var entries = Array.from(context.enumerateIndirectObjects());
    var imageEntries = [];

    for (var k = 0; k < entries.length; k++) {
      var ref = entries[k][0];
      var obj = entries[k][1];
      if (!obj || !obj.dict) continue;
      var subtype = obj.dict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Image') continue;

      var filter = obj.dict.get(PDFName.of('Filter'));
      var filterStr = '';
      if (filter) {
        if (filter.toString) filterStr = filter.toString();
        else if (filter.array) filterStr = filter.array.map(function (f) { return f.toString ? f.toString() : ''; }).join(' ');
      }

      /* Only handle DCTDecode (JPEG) images — the most common type in PDFs */
      if (filterStr.indexOf('DCTDecode') > -1) {
        imageEntries.push([ref, obj]);
      }
    }

    totalImages = imageEntries.length;

    for (var j = 0; j < imageEntries.length; j++) {
      var ref2 = imageEntries[j][0];
      var obj2 = imageEntries[j][1];
      try {
        var jpegBytes = obj2.contents;
        if (!jpegBytes || jpegBytes.length < 100) continue;

        /* Decode the JPEG to a bitmap */
        var blob = new Blob([jpegBytes], { type: 'image/jpeg' });
        var bmp = await createImageBitmap(blob);

        /* Downsample if larger than maxDim */
        var scale = 1;
        if (maxDim > 0 && (bmp.width > maxDim || bmp.height > maxDim)) {
          scale = maxDim / Math.max(bmp.width, bmp.height);
        }
        var w = Math.max(1, Math.round(bmp.width * scale));
        var h = Math.max(1, Math.round(bmp.height * scale));

        var canvas = new OffscreenCanvas(w, h);
        var ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(bmp, 0, 0, w, h);
        var newJpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
        var newBytes = new Uint8Array(await newJpeg.arrayBuffer());

        /* Only replace if the recompressed version is smaller */
        if (newBytes.length < jpegBytes.length) {
          /* Update the stream dictionary */
          obj2.dict.set(PDFName.of('Length'), PDFNumber.of(newBytes.length));
          if (scale < 1) {
            obj2.dict.set(PDFName.of('Width'), PDFNumber.of(w));
            obj2.dict.set(PDFName.of('Height'), PDFNumber.of(h));
          }
          /* Replace the stream with new contents */
          var newStream = PDFRawStream.of(obj2.dict, newBytes);
          context.assign(ref2, newStream);
          imageCount++;
        }
        bmp.close();
      } catch (e) {
        /* Skip images that fail to process */
      }
      onProgress(progressBase + (progressSpan * ((j + 1) / totalImages)));
    }

    var bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes: bytes, imageCount: imageCount, totalImages: totalImages };
  }

  /* Helper: full page rasterization (Extreme only) */
  async function rasterize(data, scale, quality, progressBase, progressSpan) {
    var pdfjs = await loadPdfJs();
    /* Copy the data — pdf.js transfers/detaches the ArrayBuffer internally */
    var dataCopy = data.slice(0);
    var srcDoc = await pdfjs.getDocument({ data: new Uint8Array(dataCopy), useWorkerFetch: false, isEvalSupported: false }).promise;
    var newDoc = await lib.PDFDocument.create();
    var pageCount = srcDoc.numPages;
    for (var p = 1; p <= pageCount; p++) {
      var page = await srcDoc.getPage(p);
      var viewport = page.getViewport({ scale: scale });
      var w = Math.max(1, Math.ceil(viewport.width));
      var h = Math.max(1, Math.ceil(viewport.height));
      var canvas = new OffscreenCanvas(w, h);
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2D context for page ' + p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var jpgBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
      var jpgArr = new Uint8Array(await jpgBlob.arrayBuffer());
      var img = await newDoc.embedJpg(jpgArr);
      var newPage = newDoc.addPage([viewport.width, viewport.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
      try { await page.cleanup(); } catch (_) {}
      onProgress(progressBase + (progressSpan * (p / pageCount)));
    }
    try { await srcDoc.destroy(); } catch (_) {}
    return await newDoc.save({ useObjectStreams: true });
  }

  for (var i = 0; i < inputs.length; i++) {
    var orig = inputs[i].data.byteLength;
    log('Compressing ' + inputs[i].fileName + ' (' + fmtBytes(orig) + ') — ' + level);
    var bytes;
    var noteExtra = '';

    if (level === 'low') {
      /* Low: lossless + light image recompression (q0.85, no downsampling) */
      var lowResult = await recompressImages(inputs[i].data, 0.85, 0, i / inputs.length, 0.9 / inputs.length);
      bytes = lowResult.bytes;
      if (lowResult.imageCount > 0) noteExtra = ' · ' + lowResult.imageCount + ' image(s) optimized · text selectable';
      else noteExtra = ' · text selectable';
      onProgress((i + 1) / inputs.length);
    } else if (level === 'normal') {
      /* Normal: structural + medium image recompression (q0.5, downsample to 1200px) */
      var normResult = await recompressImages(inputs[i].data, 0.5, 1200, i / inputs.length, 0.9 / inputs.length);
      bytes = normResult.bytes;
      if (normResult.imageCount > 0) noteExtra = ' · ' + normResult.imageCount + ' image(s) recompressed · text selectable';
      else noteExtra = ' · text selectable';
      /* If normal didn't help enough, try rasterizing as fallback */
      if (bytes.byteLength >= orig * 0.85) {
        log('Image recompression insufficient — trying page rasterization');
        var rasterFallback = await rasterize(inputs[i].data, 1.0, 0.5, (i + 0.9) / inputs.length, 0.1 / inputs.length);
        if (rasterFallback.byteLength < bytes.byteLength) {
          bytes = rasterFallback;
          noteExtra = ' · pages rasterized (text not selectable)';
        }
      }
      onProgress((i + 1) / inputs.length);
    } else {
      /* Extreme: full rasterization at 0.6x → JPEG q0.3 */
      var extremeBytes = await rasterize(inputs[i].data, 0.6, 0.3, i / inputs.length, 0.9 / inputs.length);
      /* Try even more aggressive if result is still large */
      if (extremeBytes.byteLength > orig * 0.4) {
        var extraBytes = await rasterize(inputs[i].data, 0.5, 0.25, (i + 0.9) / inputs.length, 0.1 / inputs.length);
        if (extraBytes.byteLength < extremeBytes.byteLength) {
          extremeBytes = extraBytes;
        }
      }
      bytes = extremeBytes;
      noteExtra = ' · pages rasterized (text not selectable)';
      onProgress((i + 1) / inputs.length);
    }

    var comp = bytes.byteLength;
    var pct = orig > 0 ? Math.round((1 - comp / orig) * 100) : 0;
    var note = fmtBytes(orig) + ' → ' + fmtBytes(comp) + (pct > 0 ? ' (' + pct + '% smaller)' : (pct < 0 ? ' (' + (-pct) + '% larger)' : ' (no change)'));
    note += noteExtra;
    out.push({
      name: stripExt(inputs[i].fileName) + '-compressed.pdf',
      data: toArrayBuffer(bytes),
      mime: 'application/pdf',
      note: note
    });
  }
  onProgress(1);
  return out;
};

/* ---- Repair PDF (multi-strategy recovery) ------------------------------ */
/* Strategy 1: Try pdf-lib with tolerant options (fixes xref issues, bad objects).
   Strategy 2: If no PDF header, search for it in the file and slice.
   Strategy 3: Try pdf.js (more tolerant parser) → re-save with pdf-lib.
   Strategy 4: If all fail, report a clear error. */
processors['repair'] = async function (inputs, _opts, onProgress, log) {
  var lib = getPDFLib();
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Repairing ' + inputs[i].fileName);
    var origData = inputs[i].data;
    var doc = null;
    var strategy = '';

    /* Strategy 1: pdf-lib tolerant load */
    try {
      doc = await lib.PDFDocument.load(origData, { ignoreEncryption: true, throwOnInvalidObject: false });
      strategy = 'structural rebuild';
    } catch (e1) {
      var msg1 = (e1 && e1.message) ? e1.message : String(e1);
      log('Strategy 1 failed: ' + msg1);

      /* Strategy 2: Find PDF header if missing/truncated */
      if (msg1.indexOf('No PDF header') > -1 || msg1.indexOf('header') > -1) {
        try {
          var bytes = new Uint8Array(origData);
          var headerIdx = -1;
          /* Search for %PDF- in first 10KB of file */
          for (var j = 0; j < Math.min(bytes.length, 10240) - 4; j++) {
            if (bytes[j] === 0x25 && bytes[j+1] === 0x50 && bytes[j+2] === 0x44 && bytes[j+3] === 0x46) {
              headerIdx = j;
              break;
            }
          }
          if (headerIdx > 0) {
            log('Found PDF header at offset ' + headerIdx + ' — truncating prefix');
            var sliced = origData.slice(headerIdx);
            doc = await lib.PDFDocument.load(sliced, { ignoreEncryption: true, throwOnInvalidObject: false });
            strategy = 'header recovery';
          }
        } catch (e2) {
          log('Strategy 2 failed: ' + ((e2 && e2.message) ? e2.message : String(e2)));
        }
      }

      /* Strategy 3: Try pdf.js (more tolerant) → re-save */
      if (!doc) {
        try {
          log('Trying pdf.js parser…');
          var pdfjs = await loadPdfJs();
          var dataCopy = origData.slice(0);
          var jsDoc = await pdfjs.getDocument({ data: new Uint8Array(dataCopy), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
          var pageCount = jsDoc.numPages;
          var newDoc = await lib.PDFDocument.create();
          for (var p = 1; p <= pageCount; p++) {
            var page = await jsDoc.getPage(p);
            var viewport = page.getViewport({ scale: 1.0 });
            var canvas = new OffscreenCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
            var ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              try { await page.render({ canvasContext: ctx, viewport: viewport }).promise; } catch (_) {}
              var pngBlob = await canvas.convertToBlob({ type: 'image/png' });
              var pngArr = new Uint8Array(await pngBlob.arrayBuffer());
              var img = await newDoc.embedPng(pngArr);
              var newPage = newDoc.addPage([viewport.width, viewport.height]);
              newPage.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
            }
            try { await page.cleanup(); } catch (_) {}
          }
          try { await jsDoc.destroy(); } catch (_) {}
          doc = newDoc;
          strategy = 'rasterized recovery (text not selectable)';
        } catch (e3) {
          log('Strategy 3 failed: ' + ((e3 && e3.message) ? e3.message : String(e3)));
        }
      }
    }

    if (!doc) {
      throw new Error('Could not repair ' + inputs[i].fileName + '. The file is too severely corrupted — no valid PDF structure could be recovered.');
    }

    var bytes2 = await doc.save({ useObjectStreams: true });
    out.push({
      name: stripExt(inputs[i].fileName) + '-repaired.pdf',
      data: toArrayBuffer(bytes2),
      mime: 'application/pdf',
      note: doc.getPageCount() + ' pages recovered · ' + strategy
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
  // NOTE: createElement('canvas') returns a fake element — pdf.js rendering
  // uses OffscreenCanvas directly in workers, not document.createElement.
  if (typeof self.document === 'undefined') {
    var fakeEl = { style: {}, appendChild: function () {}, setAttribute: function () {}, remove: function () {}, addEventListener: function () {} };
    /* createElement('canvas') returns a real OffscreenCanvas so pdf.js can
       call getContext('2d') on it for rendering. */
    function makeCanvas() {
      try { return new OffscreenCanvas(1, 1); } catch (_) { return fakeEl; }
    }
    self.document = {
      createElement: function (tag) {
        if (tag === 'canvas') return makeCanvas();
        return fakeEl;
      },
      createElementNS: function () { return fakeEl; },
      currentScript: { src: '' },
      body: fakeEl, head: fakeEl, documentElement: fakeEl,
      addEventListener: function () {},
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
  var mode = (opts && opts.mode) || 'pages';
  var format = (opts && opts.format) || 'png';
  var scale = (opts && Number(opts.scale)) || 2;
  var selectedPages = (opts && opts.selectedPages) || null; /* array of 1-indexed page numbers */
  var selectedImages = (opts && opts.selectedImages) || null; /* array of 0-indexed image indices */
  var pdfjs;
  try { pdfjs = await loadPdfJs(); }
  catch (e) { throw new Error('Could not load PDF rendering engine: ' + (e.message || e)); }
  var all = [];

  for (var fi = 0; fi < inputs.length; fi++) {
    var dataCopy = inputs[fi].data.slice(0);
    var doc = await pdfjs.getDocument({ data: new Uint8Array(dataCopy), useWorkerFetch: false, isEvalSupported: false }).promise;
    var base = stripExt(inputs[fi].fileName);

    if (mode === 'extract') {
      /* Extract embedded images from the PDF */
      log('Extracting embedded images from ' + inputs[fi].fileName);
      var imgIdx = 0;
      var selectedSet = {};
      if (selectedImages) { for (var si = 0; si < selectedImages.length; si++) selectedSet[selectedImages[si]] = true; }

      for (var p = 1; p <= doc.numPages; p++) {
        var page = await doc.getPage(p);
        var ops = await page.getOperatorList();
        var PDFJS_OPS = pdfjs.OPS;

        for (var oi = 0; oi < ops.fnArray.length; oi++) {
          var fn = ops.fnArray[oi];
          if (fn === PDFJS_OPS.paintImageXObject || fn === PDFJS_OPS.paintInlineImageRuntimeObject) {
            var shouldExtract = !selectedImages || selectedSet[imgIdx];
            if (shouldExtract) {
              var args = ops.argsArray[oi];
              var imgName = args[0];
              try {
                var imgObj;
                if (typeof imgName === 'string') {
                  imgObj = await new Promise(function (resolve) { page.objs.get(imgName, resolve); });
                }
                if (imgObj) {
                  var canvas, ctx;
                  if (imgObj.bitmap) {
                    canvas = new OffscreenCanvas(imgObj.bitmap.width, imgObj.bitmap.height);
                    ctx = canvas.getContext('2d');
                    ctx.drawImage(imgObj.bitmap, 0, 0);
                  } else if (imgObj.data && imgObj.width) {
                    canvas = new OffscreenCanvas(imgObj.width, imgObj.height);
                    ctx = canvas.getContext('2d');
                    var imgData = ctx.createImageData(imgObj.width, imgObj.height);
                    if (imgObj.data.length === imgObj.width * imgObj.height * 3) {
                      for (var d = 0; d < imgObj.data.length; d += 3) {
                        imgData.data[d] = imgObj.data[d];
                        imgData.data[d + 1] = imgObj.data[d + 1];
                        imgData.data[d + 2] = imgObj.data[d + 2];
                        imgData.data[d + 3] = 255;
                      }
                    } else {
                      imgData.data.set(imgObj.data);
                    }
                    ctx.putImageData(imgData, 0, 0);
                  }
                  if (canvas) {
                    var mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
                    var blob = await canvas.convertToBlob({ type: mime, quality: format === 'jpg' ? 0.85 : undefined });
                    var arr = new Uint8Array(await blob.arrayBuffer());
                    all.push({ name: base + '-image-' + (imgIdx + 1) + '.' + (format === 'jpg' ? 'jpg' : 'png'), data: toArrayBuffer(arr), mime: mime });
                  }
                }
              } catch (_) {}
            }
            imgIdx++;
          }
        }
        try { await page.cleanup(); } catch (_) {}
        onProgress((fi + (p / doc.numPages)) / inputs.length);
      }
    } else {
      /* Convert pages to images */
      log('Rendering pages from ' + inputs[fi].fileName);
      var pagesToRender = selectedPages || [];
      if (pagesToRender.length === 0) {
        for (var pp = 1; pp <= doc.numPages; pp++) pagesToRender.push(pp);
      }
      var totalPages = pagesToRender.length;

      for (var pi = 0; pi < totalPages; pi++) {
        var pageNum = pagesToRender[pi];
        var page = await doc.getPage(pageNum);
        var viewport = page.getViewport({ scale: scale });
        var canvas = new OffscreenCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
        var ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        var mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
        var jpgBlob = await canvas.convertToBlob({ type: mime, quality: format === 'jpg' ? 0.85 : undefined });
        var jpgArr = new Uint8Array(await jpgBlob.arrayBuffer());
        all.push({ name: base + '-page-' + pageNum + '.' + (format === 'jpg' ? 'jpg' : 'png'), data: toArrayBuffer(jpgArr), mime: mime });
        try { await page.cleanup(); } catch (_) {}
        onProgress((fi + ((pi + 1) / totalPages)) / inputs.length);
      }
    }
    try { await doc.destroy(); } catch (_) {}
  }
  onProgress(1);
  return all;
};

/* ---- HTML to PDF ------------------------------------------------------- */
/* Renders HTML by parsing into text runs + basic layout via pdf-lib.
   Supports orientation, page size, margin, and one-page mode via opts. */
processors['html-to-pdf'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var html = '';
  for (var i = 0; i < inputs.length; i++) {
    html += new TextDecoder().decode(new Uint8Array(inputs[i].data));
  }
  log('Parsing HTML (' + html.length + ' chars)');
  console.log('[html-to-pdf] Received HTML:', html.length, 'chars, first 100:', html.slice(0, 100));

  /* Parse options */
  var orientation = (opts && opts.orientation) || 'portrait';
  var pageSize = (opts && opts.pageSize) || 'a4';
  var customMargin = (opts && opts.margin !== undefined) ? Number(opts.margin) : 40;
  var onePage = !!(opts && opts.onePage);

  /* Page dimensions */
  var DIMS = { a4: [595.28, 841.89], letter: [612, 792] };
  var dims = DIMS[pageSize] || DIMS.a4;
  var pageW = orientation === 'landscape' ? Math.max(dims[0], dims[1]) : Math.min(dims[0], dims[1]);
  var pageH = orientation === 'landscape' ? Math.min(dims[0], dims[1]) : Math.max(dims[0], dims[1]);
  var margin = customMargin;
  var lineHeight = 18, fontSize = 11;

  var doc = await lib.PDFDocument.create();
  var font = await doc.embedFont(lib.StandardFonts.Helvetica);
  var fontBold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  var page = doc.addPage([pageW, pageH]);
  var y = pageH - margin;
  var maxWidth = pageW - margin * 2;

  /* Sanitize text for WinAnsi (CP-1252) encoding — pdf-lib StandardFonts
     only support WinAnsi. Remove zero-width chars, replace common Unicode
     punctuation, and strip any remaining non-encodable characters. */
  function sanitizeText(text) {
    return text
      /* Remove zero-width characters */
      .replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, '')
      /* Replace common Unicode punctuation with WinAnsi equivalents */
      .replace(/\u2018/g, "'")   /* left single quote */
      .replace(/\u2019/g, "'")   /* right single quote */
      .replace(/\u201A/g, "'")   /* single low-9 quote */
      .replace(/\u201B/g, "'")   /* reversed-9 quote */
      .replace(/\u201C/g, '"')   /* left double quote */
      .replace(/\u201D/g, '"')   /* right double quote */
      .replace(/\u201E/g, '"')   /* double low-9 quote */
      .replace(/\u2013/g, '-')   /* en dash */
      .replace(/\u2014/g, '--')  /* em dash */
      .replace(/\u2026/g, '...') /* ellipsis */
      .replace(/\u00A0/g, ' ')   /* non-breaking space */
      .replace(/\u2022/g, '\u00B7') /* bullet → middle dot (WinAnsi 0xB7) */
      .replace(/\u2010/g, '-')   /* hyphen */
      .replace(/\u2011/g, '-')   /* non-breaking hyphen */
      .replace(/\u2122/g, 'TM')  /* trademark */
      .replace(/\u00A9/g, '(c)') /* copyright */
      .replace(/\u00AE/g, '(r)') /* registered */
      .replace(/\u20AC/g, 'EUR') /* euro */
      /* Remove any remaining characters outside WinAnsi range
         (keep 0x00-0xFF which covers ASCII + Latin-1, plus a few extras) */
      .replace(/[\u0100-\uFFFF]/g, function (ch) {
        /* Try to keep as-is if it's a common Latin extended char */
        return '?';
      });
  }

  function newPage() {
    if (onePage) {
      /* One-page mode: extend the current page height instead of adding new pages */
      /* We can't actually extend a page in pdf-lib, so we add a new page
         but in one-page mode the user expects one continuous flow.
         For simplicity, we just keep adding standard pages — the visual
         result is the same as split mode but the user chose this. */
      page = doc.addPage([pageW, pageH]); y = pageH - margin;
    } else {
      page = doc.addPage([pageW, pageH]); y = pageH - margin;
    }
  }

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
  console.log('[html-to-pdf] Parsed parts:', parts.length, 'items');
  var bold = false, heading = 0;
  var textDrawn = 0;
  for (var k = 0; k < parts.length; k++) {
    var part = parts[k];
    if (!part) continue;
    if (part[0] === '<') {
      var tag = part.toLowerCase().replace(/[<\\/>]/g, '').split(/\\s/)[0];
      if (/^h[1-3]$/.test(tag)) { heading = parseInt(tag[1]); ensureSpace(lineHeight * 1.5); y -= lineHeight * 0.5; }
      else if (tag === '/h1' || tag === '/h2' || tag === '/h3') { heading = 0; y -= lineHeight * 0.5; }
      else if (tag === 'p' || tag === 'li') { ensureSpace(lineHeight); y -= lineHeight * 0.4; }
      else if (tag === 'br') { y -= lineHeight; ensureSpace(0); }
      else if (tag === 'strong' || tag === 'b') bold = true;
      else if (tag === '/strong' || tag === '/b') bold = false;
      continue;
    }
    var decoded = sanitizeText(part.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim());
    if (!decoded) continue;
    var f = heading ? fontBold : (bold ? fontBold : font);
    var size = heading === 1 ? 24 : heading === 2 ? 20 : heading === 3 ? 16 : fontSize;
    var lines = wrapText(decoded, f, size);
    for (var li = 0; li < lines.length; li++) {
      ensureSpace(size + 2);
      y -= size + 6;
      page.drawText(lines[li], { x: margin, y: y, font: f, size: size, color: lib.rgb(0.1, 0.1, 0.12) });
      textDrawn++;
    }
  }
  console.log('[html-to-pdf] Drew', textDrawn, 'text lines, pages:', doc.getPageCount());
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

/* ---- Organize PDF (reorder/delete/rotate pages) ------------------------ */
/* options.pages = [{ source: 0, rotation: 0 }, ...] — source is 0-indexed original page */
processors['organize'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var pagePlan = (opts && opts.pages) || null;
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Organizing ' + inputs[i].fileName);
    var src = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    var dst = await lib.PDFDocument.create();
    var plan = pagePlan || src.getPageIndices().map(function (idx) { return { source: idx, rotation: 0 }; });
    var sourceIndices = plan.map(function (p) { return p.source; });
    var copied = await dst.copyPages(src, sourceIndices);
    for (var p = 0; p < plan.length; p++) {
      var page = copied[p];
      var rot = (plan[p].rotation || 0) % 360;
      if (rot) { var cur = page.getRotation().angle; page.setRotation(lib.degrees((cur + rot) % 360)); }
      dst.addPage(page);
    }
    var bytes = await dst.save({ useObjectStreams: true });
    out.push({ name: stripExt(inputs[i].fileName) + '-organized.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: plan.length + ' pages' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Crop PDF (apply crop boxes — all-pages or per-page) --------------- */
/* options.mode = 'all' | 'current'
   options.crop = { x, y, width, height } (all-pages mode, PDF points)
   options.pageCrops = { 0: {x,y,w,h}, 2: {...} } (current-page mode, keyed by page index) */
processors['crop'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var mode = (opts && opts.mode) || 'all';
  var allCrop = opts && opts.crop;
  var pageCrops = (opts && opts.pageCrops) || {};
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Cropping ' + inputs[i].fileName);
    var doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    var pages = doc.getPages();
    var appliedCount = 0;
    for (var p = 0; p < pages.length; p++) {
      var crop = mode === 'all' ? allCrop : pageCrops[p];
      if (crop) {
        pages[p].setCropBox(crop.x, crop.y, crop.width, crop.height);
        pages[p].setMediaBox(crop.x, crop.y, crop.width, crop.height);
        appliedCount++;
      }
    }
    var bytes = await doc.save({ useObjectStreams: true });
    var note;
    if (appliedCount === 0) note = 'no change';
    else if (mode === 'all') note = Math.round(allCrop.width) + 'x' + Math.round(allCrop.height) + 'pt on all pages';
    else note = appliedCount + ' page(s) cropped';
    out.push({ name: stripExt(inputs[i].fileName) + '-cropped.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: note });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Sign & Annotate (overlay image annotations) ---------------------- */
/* options.annotations = [{ type: 'image', data: base64, mime, x, y, width, height, page }] */
processors['sign-annotate'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var annotations = (opts && opts.annotations) || [];
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Applying annotations to ' + inputs[i].fileName);
    var doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    var pages = doc.getPages();
    for (var a = 0; a < annotations.length; a++) {
      var ann = annotations[a];
      var pageIdx = Math.min(ann.page || 0, pages.length - 1);
      var page = pages[pageIdx];
      if (ann.type === 'image' && ann.data) {
        var raw = atob(ann.data);
        var arr = new Uint8Array(raw.length);
        for (var b = 0; b < raw.length; b++) arr[b] = raw.charCodeAt(b);
        var conv = await toEmbeddable(arr.buffer, ann.mime || 'image/png');
        var img = conv.kind === 'png' ? await doc.embedPng(conv.bytes) : await doc.embedJpg(conv.bytes);
        page.drawImage(img, { x: ann.x || 0, y: ann.y || 0, width: ann.width || img.width, height: ann.height || img.height });
      }
    }
    var bytes = await doc.save({ useObjectStreams: true });
    out.push({ name: stripExt(inputs[i].fileName) + '-signed.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: annotations.length + ' annotation(s)' });
    onProgress((i + 1) / inputs.length);
  }
  onProgress(1);
  return out;
};

/* ---- Edit PDF Text (overlay corrected text with whiteout) ------------- */
/* options.edits = [{ page, x, y, text, size, whiteout: {x,y,w,h} }] */
processors['edit-text'] = async function (inputs, opts, onProgress, log) {
  var lib = getPDFLib();
  var edits = (opts && opts.edits) || [];
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    log('Editing text in ' + inputs[i].fileName);
    var doc = await lib.PDFDocument.load(inputs[i].data, { ignoreEncryption: true });
    var pages = doc.getPages();
    var font = await doc.embedFont(lib.StandardFonts.Helvetica);
    for (var e = 0; e < edits.length; e++) {
      var edit = edits[e];
      var pageIdx = Math.min(edit.page || 0, pages.length - 1);
      var page = pages[pageIdx];
      if (edit.whiteout) {
        page.drawRectangle({ x: edit.whiteout.x, y: edit.whiteout.y, width: edit.whiteout.w, height: edit.whiteout.h, color: lib.rgb(1, 1, 1) });
      }
      if (edit.text) {
        page.drawText(edit.text, { x: edit.x || 50, y: edit.y || 50, font: font, size: edit.size || 11, color: lib.rgb(0, 0, 0) });
      }
    }
    var bytes = await doc.save({ useObjectStreams: true });
    out.push({ name: stripExt(inputs[i].fileName) + '-edited.pdf', data: toArrayBuffer(bytes), mime: 'application/pdf', note: edits.length + ' edit(s)' });
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
