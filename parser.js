/* PDF question-bank parser for UNEC-style test PDFs.
   A question is a number at the left margin, a stem, then options marked with bullets:
   "•" for a wrong option and "√" for the correct one. The PDF lays every cell out as a table row,
   with the number and each bullet centred vertically on its text, so text is grouped into blocks
   and each block goes to the anchor (number or bullet) whose centre falls inside it. */
(function (root) {
  "use strict";

  var CHARMAP = { "": "•", "∙": "•", "": "√", "": "√", "✓": "√", "✔": "√" };
  function normChars(s) {
    return s.replace(/[∙✓✔]/g, function (c) { return CHARMAP[c]; });
  }
  function bulletKind(ch) {
    if (ch === "•") return "no";
    if (ch === "√") return "ok";
    return null;
  }

  /* ---------- extraction with pdf.js (browser and Node) ---------- */
  function extractText(page) {
    var view = page.view;
    return page.getTextContent().then(function (tc) {
      var items = [];
      tc.items.forEach(function (it) {
        if (!it.str || !it.transform) return;
        var t = it.transform;
        var size = Math.hypot(t[2], t[3]) || it.height || 0;
        if (!size) return;
        items.push({ s: it.str, x: t[4] - view[0], y: view[3] - t[5], w: it.width || 0, size: size });
      });
      return { w: view[2] - view[0], h: view[3] - view[1], items: items, imgs: null };
    });
  }

  function extractImages(pdfjsLib, page) {
    var view = page.view;
    var OPS = pdfjsLib.OPS, mul = pdfjsLib.Util.transform;
    var paint = {};
    ["paintImageXObject", "paintInlineImageXObject", "paintImageMaskXObject", "paintJpegXObject"].forEach(function (k) {
      if (OPS[k] != null) paint[OPS[k]] = true;
    });
    return page.getOperatorList().then(function (ops) {
      var ctm = [1, 0, 0, 1, 0, 0], stack = [], out = [];
      for (var i = 0; i < ops.fnArray.length; i++) {
        var fn = ops.fnArray[i], a = ops.argsArray[i];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.length ? stack.pop() : [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = mul(ctm, a);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm);
          if (a && a[0] && a[0].length === 6) ctm = mul(ctm, a[0]);
        } else if (fn === OPS.paintFormXObjectEnd) {
          ctm = stack.length ? stack.pop() : ctm;
        } else if (paint[fn]) {
          var xs = [], ys = [];
          [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (p) {
            xs.push(ctm[0] * p[0] + ctm[2] * p[1] + ctm[4]);
            ys.push(ctm[1] * p[0] + ctm[3] * p[1] + ctm[5]);
          });
          var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
          var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
          if (x1 - x0 < 3 || y1 - y0 < 3) continue;
          out.push({ x: x0 - view[0], top: view[3] - y1, w: x1 - x0, h: y1 - y0 });
        }
      }
      return out;
    });
  }

  /* ---------- text clean-up ---------- */
  var CYR = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X" };
  var LAT = "A-Za-zÀ-ɏəƏ";
  var reWord = new RegExp("[" + LAT + "Ѐ-ӿ]+", "g");
  var reLat = new RegExp("[" + LAT + "]");
  function fixCyr(s) {
    if (!/[Ѐ-ӿ]/.test(s)) return s;
    return s.replace(reWord, function (w) {
      if (!reLat.test(w)) return w;            // a whole Cyrillic word stays as it is
      return w.replace(/[аеорсухАВЕКМНОРСТХ]/g, function (c) { return CYR[c]; });
    });
  }
  // Azerbaijani PDFs often print a dotless capital I at the start of words (Idarə, Istilik).
  function fixI(s) {
    return s.replace(/(^|[^A-Za-zÀ-ɏəƏ0-9_])I([a-zçəğıöşü][A-Za-z0-9çəğıöşüÇƏĞİÖŞÜ]*)/g, function (m, pre, rest) {
      if (rest === "nP") return m;
      if (rest.length === 1 && "şçğıöüə".indexOf(rest) === -1) return m;   // symbols such as Ik, Ie
      return pre + "İ" + rest;
    });
  }
  function makeClean(az) {
    return function (s) {
      s = fixCyr(s).replace(/­/g, "");
      s = s.replace(/\s+/g, " ").trim();
      s = s.replace(/\s+([,;:?!])/g, "$1");
      s = s.replace(/([,;])(?=[^\s\d])/g, "$1 ");
      if (az) s = fixI(s);
      return s;
    };
  }
  var MARK_PREV = /[\s.?!:;,)a-zçəğıöşü]/;
  function splitItems(stem) {
    var re = /([1-9])\s*[.)](?!\d)\s*/g, m, seq = [], want = 1;
    while ((m = re.exec(stem))) {
      var prev = m.index > 0 ? stem.charAt(m.index - 1) : "";
      if (prev && !MARK_PREV.test(prev)) continue;
      if (+m[1] === want) { seq.push({ start: m.index, end: m.index + m[0].length }); want++; }
    }
    if (seq.length < 2) return { intro: stem, items: [] };
    var items = seq.map(function (x, i) {
      var end = i + 1 < seq.length ? seq[i + 1].start : stem.length;
      return stem.slice(x.end, end).trim().replace(/^[;,]+|[;,]+$/g, "").trim();
    });
    return { intro: stem.slice(0, seq[0].start).trim(), items: items };
  }
  function normOpt(o) {
    o = o.trim();
    if (/^\d(\s*[,;]\s*\d)*\s*[;,.]?$/.test(o)) {
      return o.replace(/[;,.]+$/, "").trim().replace(/\s*([,;])\s*/g, "$1 ");
    }
    o = o.replace(/\s*;$/, "");
    var re = /([1-9])\)\s*/g, m, seq = [], want = 1;
    while ((m = re.exec(o))) {
      if (m.index === 0 || !/\s/.test(o.charAt(m.index - 1))) continue;
      if (+m[1] === want) { seq.push(m.index); want++; }
    }
    if (seq.length >= 2) {
      var parts = [], last = 0;
      seq.forEach(function (i) { parts.push(o.slice(last, i).trim()); last = i; });
      parts.push(o.slice(last).trim());
      o = parts.filter(Boolean).join("\n");
    }
    return o;
  }

  /* ---------- the parser ---------- */
  function mode(map) {
    var best = null, bc = -1;
    Object.keys(map).forEach(function (k) { if (map[k] > bc) { bc = map[k]; best = k; } });
    return best == null ? null : +best;
  }
  var HEADER = /Fənn\s*:|testinin sualları|imtahan.*sualları|^\d{4,6}_/i;

  function parseBank(pages) {
    var items = [];
    pages.forEach(function (pg, p) {
      pg.items.forEach(function (it) {
        var s = normChars(it.s);
        if (!s.trim()) return;
        items.push({ p: p, s: s, x: it.x, y: it.y, w: it.w, size: it.size });
      });
    });
    var bx = {};
    items.forEach(function (it) {
      var t = it.s.trim();
      if (bulletKind(t.charAt(0))) { var k = Math.round(it.x); bx[k] = (bx[k] || 0) + 1; }
    });
    // the bullet column: the most common x of bullet glyphs (merge neighbours within 1pt)
    var cols = {};
    Object.keys(bx).forEach(function (k) { var c = Math.round(+k / 2) * 2; cols[c] = (cols[c] || 0) + bx[k]; });
    var bulletX = mode(cols);
    if (bulletX == null) return { error: "nobullets", questions: [] };

    var nums = [], buls = [], content = [];
    items.forEach(function (it) {
      var t = it.s.trim();
      var bk = bulletKind(t.charAt(0));
      if (bk && Math.abs(it.x - bulletX) <= 6) {
        buls.push({ kind: "bul", ok: bk === "ok", p: it.p, y: it.y, size: it.size, c: it.y - 0.28 * it.size });
        var rest = t.slice(1).trim();
        if (rest) content.push({ p: it.p, s: rest, x: bulletX + 12, y: it.y, w: Math.max(0, it.w - it.size), size: it.size });
        return;
      }
      if (it.x < bulletX - 4) {
        var m = /^(\d{1,4})\s*[.)]?$/.exec(t) || /^(\d{1,4})[.)]\s+(.+)$/.exec(t);
        if (m) {
          nums.push({ kind: "num", n: +m[1], p: it.p, y: it.y, size: it.size, c: it.y - 0.28 * it.size, src: it });
          if (m[2]) content.push({ p: it.p, s: m[2], x: bulletX + 12, y: it.y, w: 0, size: it.size });
          return;
        }
      }
      content.push(it);
    });

    // question numbers are accepted in sequence, each after at least two options of the previous question
    var anc = nums.concat(buls).sort(function (a, b) { return a.p - b.p || a.c - b.c || (a.kind === "num" ? -1 : 1); });
    var expected = null, since = 99;
    anc.forEach(function (a) {
      if (a.kind === "bul") { since++; return; }
      if (since >= 2 && (expected === null || (a.n >= expected && a.n <= expected + 3))) {
        a.start = true; expected = a.n + 1; since = 0;
      } else {
        content.push(a.src);
      }
    });
    anc = anc.filter(function (a) { return a.kind === "bul" || a.start; });
    if (!anc.some(function (a) { return a.start; })) return { error: "nonumbers", questions: [] };

    // lines
    var sc = {};
    content.forEach(function (it) { var k = Math.round(it.size * 2) / 2; sc[k] = (sc[k] || 0) + it.s.length; });
    var dom = mode(sc) || 10;
    content.sort(function (a, b) { return a.p - b.p || a.y - b.y || a.x - b.x; });
    var lines = [], byPageLines = {};
    content.forEach(function (it) {
      if (it.size < 0.8 * dom) return;
      var L = null;
      for (var i = lines.length - 1; i >= 0 && i >= lines.length - 6; i--) {
        if (lines[i].p === it.p && Math.abs(lines[i].y - it.y) <= 1.6) { L = lines[i]; break; }
      }
      if (!L) { L = { p: it.p, y: it.y, size: it.size, items: [] }; lines.push(L); (byPageLines[it.p] = byPageLines[it.p] || []).push(L); }
      L.items.push(it);
      if (it.size > L.size) L.size = it.size;
    });
    content.forEach(function (it) {          // sub- and superscripts join the nearest line
      if (it.size >= 0.8 * dom) return;
      var best = null, bd = 1e9;
      (byPageLines[it.p] || []).forEach(function (L) {
        var d = Math.abs(L.y - it.y);
        if (d <= 0.6 * L.size && d < bd) { bd = d; best = L; }
      });
      if (best) best.items.push(it);
      else { var L2 = { p: it.p, y: it.y, size: it.size, items: [it] }; lines.push(L2); (byPageLines[it.p] = byPageLines[it.p] || []).push(L2); }
    });
    lines.forEach(function (L) {
      L.items.sort(function (a, b) { return a.x - b.x; });
      var s = "", prevEnd = null;
      L.items.forEach(function (it) {
        if (s && prevEnd !== null && !/\s$/.test(s) && !/^\s/.test(it.s) && it.x - prevEnd > 0.15 * L.size) s += " ";
        s += it.s;
        prevEnd = it.x + it.w;
      });
      L.text = s.replace(/\s+/g, " ").trim();
      L.top = L.y - 0.78 * L.size;
      L.bottom = L.y + 0.22 * L.size;
    });
    lines = lines.filter(function (L) { return L.text; });
    lines.sort(function (a, b) { return a.p - b.p || a.y - b.y; });

    // the line step inside one cell (single spacing); a larger step starts a new block
    var steps = {};
    for (var li = 1; li < lines.length; li++) {
      var d = lines[li].y - lines[li - 1].y;
      if (lines[li].p === lines[li - 1].p && d >= 0.8 * dom && d <= 1.6 * dom) { var k2 = Math.round(d * 2) / 2; steps[k2] = (steps[k2] || 0) + 1; }
    }
    var step = mode(steps) || dom;
    var blocks = [];
    lines.forEach(function (L) {
      var B = blocks[blocks.length - 1];
      if (B && B.p === L.p && L.y - B.lastY <= step * 1.2) {
        B.lines.push(L); B.bottom = Math.max(B.bottom, L.bottom); B.lastY = L.y;
      } else {
        blocks.push({ p: L.p, top: L.top, bottom: L.bottom, lastY: L.y, lines: [L] });
      }
    });

    // blocks to anchors
    var byPage = {};
    anc.forEach(function (a, i) { a.i = i; a.lines = []; a.top = a.c - 0.5 * a.size; a.bottom = a.c + 0.5 * a.size; (byPage[a.p] = byPage[a.p] || []).push(a); });
    function own(a, L) { a.lines.push(L.text); a.top = Math.min(a.top, L.top); a.bottom = Math.max(a.bottom, L.bottom); }
    var loose = [];
    blocks.forEach(function (B) {
      var cs = (byPage[B.p] || []).filter(function (a) { return a.c >= B.top - 1.5 && a.c <= B.bottom + 1.5; });
      if (cs.length === 1) B.lines.forEach(function (L) { own(cs[0], L); });
      else if (cs.length > 1) {
        B.lines.forEach(function (L) {
          var mid = (L.top + L.bottom) / 2, best = cs[0];
          cs.forEach(function (a) { if (Math.abs(a.c - mid) < Math.abs(best.c - mid)) best = a; });
          own(best, L);
        });
      } else loose.push(B);
    });

    // walk anchors, loose text and pictures in reading order
    var ev = [];
    anc.forEach(function (a) { ev.push({ p: a.p, y: a.c, o: 0, t: "a", a: a }); });
    loose.forEach(function (B) { ev.push({ p: B.p, y: B.top, o: 1, t: "b", b: B }); });
    pages.forEach(function (pg, p) {
      (pg.imgs || []).forEach(function (im) { ev.push({ p: p, y: im.top, o: 2, t: "i", im: { p: p, x: im.x, top: im.top, w: im.w, h: im.h } }); });
    });
    ev.sort(function (a, b) { return a.p - b.p || a.y - b.y || a.o - b.o; });
    var nextAnchorAt = new Array(ev.length), na = null;
    for (var ei = ev.length - 1; ei >= 0; ei--) { nextAnchorAt[ei] = na; if (ev[ei].t === "a") na = ev[ei].a; }

    var qs = [], q = null, pendText = [], pendImg = [], last = null, header = [];
    function isImgText(lines) { var t = lines.join(" ").trim(); return t === "" || t === "."; }
    ev.forEach(function (e, k) {
      if (e.t === "a") {
        var a = e.a;
        if (a.kind === "num") {
          q = { n: a.n, p: a.p, stem: pendText.concat(a.lines), stemImgs: [], opts: [], a: a };
          pendText = [];
          qs.push(q);
          last = { k: "num", q: q };
        } else if (q) {
          var o = { ok: a.ok, lines: a.lines.slice(), imgs: [], a: a };
          if (!q.opts.length && pendImg.length) { q.stemImgs = q.stemImgs.concat(pendImg); pendImg = []; }
          q.opts.push(o);
          last = { k: "bul", o: o };
        }
      } else if (e.t === "b") {
        var texts = e.b.lines.map(function (L) { return L.text; });
        if (!qs.length && HEADER.test(texts.join(" "))) { header = header.concat(texts); return; }
        var nx = nextAnchorAt[k];
        if (nx && nx.kind === "num") pendText = pendText.concat(texts);
        else if (last && last.k === "num") last.q.stem = last.q.stem.concat(texts);
        else if (last && last.k === "bul") last.o.lines = last.o.lines.concat(texts);
        else pendText = pendText.concat(texts);
      } else {
        var im = e.im;
        if (last && last.k === "bul") {
          var lo = last.o, prev = lo.imgs[lo.imgs.length - 1];
          var beside = im.p === lo.a.p && im.top < lo.a.bottom + 2 && im.top + im.h > lo.a.top - 2;
          if (isImgText(lo.lines) && (!prev || (prev.p === im.p && im.top < prev.top + prev.h + 6))) { lo.imgs.push(im); return; }
          if (!isImgText(lo.lines) && beside) { lo.imgs.push(im); return; }
          pendImg.push(im);
        } else if (last && last.k === "num" && q && !q.opts.length) {
          q.stemImgs.push(im);
        } else {
          pendImg.push(im);
        }
      }
    });

    // finish the questions
    var allText = qs.map(function (x) { return x.stem.join(" ") + " " + x.opts.map(function (o) { return o.lines.join(" "); }).join(" "); }).join(" ");
    var letters = (allText.match(/[A-Za-zÇçƏəĞğİıÖöŞşÜü]/g) || []).length || 1;
    var az = ((allText.match(/[Əə]/g) || []).length / letters) > 0.004;
    var clean = makeClean(az);
    var subject = "";
    header.forEach(function (h) { var m = /Fənn\s*:\s*(.+)$/.exec(h); if (m) subject = m[1].trim(); });
    if (qs.length) {
      var first = qs[0];
      while (first.stem.length && HEADER.test(first.stem[0])) {
        var mm = /Fənn\s*:\s*(.+)$/.exec(first.stem[0]);
        if (mm && !subject) subject = mm[1].trim();
        first.stem.shift();
      }
    }
    var contentX = bulletX + 10;
    function regionAfter(a, isStem, q2) {
      // fallback picture: from this anchor's row to the next anchor on the page
      var idx = a.i, nxt = anc[idx + 1];
      var top = isStem ? a.bottom : a.top;
      var bottom = nxt && nxt.p === a.p ? Math.min(nxt.top, nxt.c - 0.5 * nxt.size) - 1 : pages[a.p].h - 12;
      if (bottom - top < 8) return null;
      return { p: a.p, x: contentX, top: top, w: pages[a.p].w - contentX - 10, h: bottom - top, region: true };
    }
    var out = qs.map(function (x) {
      var stem = clean(x.stem.join(" "));
      if (stem === ".") stem = "";
      var sp = splitItems(stem);
      var opts = x.opts.map(function (o) {
        var t = clean(o.lines.join(" "));
        var isImg = t === "." || t === "";
        var imgs = o.imgs.slice();
        if (isImg && !imgs.length) { var r = regionAfter(o.a, false); if (r) imgs.push(r); }
        return { t: isImg ? "" : normOpt(t), ok: o.ok, imgs: imgs };
      });
      var stemImgs = x.stemImgs.slice();
      if (!sp.intro && !sp.items.length && !stemImgs.length) { var r2 = regionAfter(x.a, true); if (r2) stemImgs.push(r2); }
      var cs = [];
      opts.forEach(function (o, i) { if (o.ok) cs.push(i); });
      var bad = null;
      if (opts.length < 2) bad = "variant tapılmadı";
      else if (!cs.length) bad = "düzgün cavab işarələnməyib";
      else if (cs.length > 1) bad = "bir neçə variant düzgün işarələnib";
      return { n: x.n, p: x.p, s: sp.intro, i: sp.items, si: stemImgs, o: opts, c: cs.length === 1 ? cs[0] : -1, bad: bad };
    });
    return { questions: out, subject: subject, bulletX: bulletX, az: az };
  }

  var api = { extractText: extractText, extractImages: extractImages, parseBank: parseBank, splitItems: splitItems, normOpt: normOpt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PQ = api;
})(typeof window !== "undefined" ? window : this);
