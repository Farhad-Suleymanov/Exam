(function(){
  "use strict";
  /* PDF.js: the copy in the pdfjs folder; when the page is opened as a local file, or that copy fails, the same version from jsDelivr */
  var PDFJS_VERSION = "6.2.108";
  var SOURCES = [];
  if (location.protocol !== "file:") SOURCES.push({lib:new URL("pdfjs/pdf.min.mjs", document.baseURI).href, worker:new URL("pdfjs/pdf.worker.min.mjs", document.baseURI).href});
  SOURCES.push({lib:"https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/legacy/build/pdf.min.mjs", worker:"https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/legacy/build/pdf.worker.min.mjs"});
  var SCALE = 2.5;
  var LETTERS = ["A","B","C","D","E","F","G","H"];
  var MONTHS = ["yanvar","fevral","mart","aprel","may","iyun","iyul","avqust","sentyabr","oktyabr","noyabr","dekabr"];
  var SK = {state:"pdftest.state.v1", hist:"pdftest.hist.v1", opts:"pdftest.opts.v1"};

  function $(id){ return document.getElementById(id); }
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function load(k, d){ try{ var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function rnd(n){ try{ var a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; }catch(e){ return Math.floor(Math.random() * n); } }
  function shuffle(a){ for (var i = a.length - 1; i > 0; i--){ var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function mmss(s){ var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r; }
  function when(t){ var d = new Date(t), h = d.getHours(), m = d.getMinutes(); return d.getDate() + " " + MONTHS[d.getMonth()] + ", " + (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }

  /* A small IndexedDB store keeps the current test (with its pictures) so a reload does not lose it */
  var IDB = (function(){
    var dbp = null;
    function open(){
      if (dbp) return dbp;
      dbp = new Promise(function(res){
        try{
          var r = indexedDB.open("pdf-test", 1);
          r.onupgradeneeded = function(){ r.result.createObjectStore("kv"); };
          r.onsuccess = function(){ res(r.result); };
          r.onerror = function(){ res(null); };
          r.onblocked = function(){ res(null); };
        }catch(e){ res(null); }
      });
      return dbp;
    }
    function tx(mode, fn){
      return open().then(function(db){
        if (!db) return null;
        return new Promise(function(res){
          try{
            var t = db.transaction("kv", mode), st = t.objectStore("kv"), out = fn(st);
            t.oncomplete = function(){ res(out && "result" in out ? out.result : true); };
            t.onerror = t.onabort = function(){ res(null); };
          }catch(e){ res(null); }
        });
      });
    }
    return {
      get: function(k){ return tx("readonly", function(st){ return st.get(k); }); },
      set: function(k, v){ return tx("readwrite", function(st){ st.put(v, k); }); }
    };
  })();

  /* ---------- views ---------- */
  function show(v){
    $("vStart").hidden = v !== "start";
    $("vSetup").hidden = v !== "setup";
    $("vQuiz").hidden = v !== "quiz";
    window.scrollTo(0, 0);
  }

  /* ---------- step 1: read the PDF ---------- */
  var lib = null, bank = null;
  function loadLib(){
    if (lib) return Promise.resolve(lib);
    var i = 0;
    function next(){
      if (i >= SOURCES.length) return Promise.reject(new Error("PDF.js did not load"));
      var s = SOURCES[i++];
      return import(s.lib).then(function(m){
        m.GlobalWorkerOptions.workerSrc = s.worker;
        lib = m;
        return m;
      }, next);
    }
    return next();
  }
  function busy(text, frac){
    $("busy").hidden = text == null;
    $("pickBtn").hidden = text != null;
    if (text != null){ $("busyText").textContent = text; $("busyBar").style.width = Math.round((frac || 0) * 100) + "%"; }
  }
  function loadError(msg){
    busy(null);
    var e = $("loadErr"); e.textContent = msg; e.hidden = !msg;
  }
  function readFile(file){
    if (!file) return;
    loadError("");
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf"){ loadError("Bu fayl PDF deyil. Sual bazasının PDF faylını seç."); return; }
    show("start");
    busy("PDF oxuyucu yüklənir…", 0);
    var name = file.name.replace(/\.pdf$/i, "");
    loadLib().catch(function(){ throw {msg:"PDF oxuyucu yüklənmədi. İnternet bağlantısını yoxla və yenidən cəhd et."}; })
      .then(function(L){ return file.arrayBuffer().then(function(buf){ return L.getDocument({data:new Uint8Array(buf), isEvalSupported:false}).promise; }); })
      .then(function(doc){ return readAll(doc, name); })
      .then(function(b){
        busy(null);
        bank = b;
        openSetup(true);
      })
      .catch(function(err){
        var m = err && err.msg;
        if (!m && err && err.name === "PasswordException") m = "Bu PDF parolla qorunur. Parolsuz versiyasını seç.";
        if (!m && err && err.name === "InvalidPDFException") m = "PDF faylı oxunmadı: fayl zədələnib və ya PDF deyil.";
        loadError(m || "PDF oxunarkən xəta baş verdi. Başqa faylla yoxla.");
        try{ console.error(err); }catch(e){}
      });
  }
  async function readAll(doc, name){
    var pages = [], chars = 0;
    for (var i = 1; i <= doc.numPages; i++){
      busy("Səhifələr oxunur: " + i + " / " + doc.numPages, i / doc.numPages);
      var page = await doc.getPage(i);
      var pg = await PQ.extractText(page);
      try{ pg.imgs = await PQ.extractImages(lib, page); }catch(e){ pg.imgs = []; }
      page.cleanup();
      pg.items.forEach(function(it){ chars += it.s.trim().length; });
      pages.push(pg);
    }
    if (chars < 20) throw {msg:"Bu PDF-də mətn yoxdur (skan edilmiş səhifələrdir). Sayt yalnız mətni seçilə bilən PDF-ləri oxuya bilir."};
    var res = PQ.parseBank(pages);
    if (res.error || !res.questions.length) throw {msg:"Bu PDF-də nömrəli və • / √ işarəli suallar tapılmadı. Sayt UNEC test bazası formatındakı PDF-lər üçündür."};
    return {name:name, doc:doc, pages:pages, subject:res.subject, questions:res.questions, byN:new Map(res.questions.map(function(q){ return [q.n, q]; }))};
  }

  var drop = $("drop");
  $("file").addEventListener("change", function(e){ var f = e.target.files && e.target.files[0]; e.target.value = ""; readFile(f); });
  ["dragenter","dragover"].forEach(function(t){ drop.addEventListener(t, function(e){ e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave","dragend"].forEach(function(t){ drop.addEventListener(t, function(){ drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function(e){
    e.preventDefault(); drop.classList.remove("over");
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    readFile(f);
  });
  document.addEventListener("dragover", function(e){ e.preventDefault(); });
  document.addEventListener("drop", function(e){ e.preventDefault(); });

  /* ---------- step 2: choose the range ---------- */
  var countTouched = false;
  function usable(from, to){ return bank.questions.filter(function(q){ return q.n >= from && q.n <= to && !q.bad; }); }
  function openSetup(fresh){
    var qs = bank.questions, first = qs[0].n, last = qs[qs.length - 1].n;
    $("bkTitle").textContent = bank.subject || bank.name;
    $("bkMeta").textContent = qs.length + " sual tapıldı · № " + first + "–" + last + (bank.subject ? " · " + bank.name + ".pdf" : "");
    var bad = qs.filter(function(q){ return q.bad; });
    $("bkWarn").hidden = !bad.length;
    if (bad.length) $("bkWarn").textContent = bad.length + " sualda düzgün cavab müəyyən olunmadı, onlar testə düşməyəcək: № " + bad.slice(0, 12).map(function(q){ return q.n; }).join(", ") + (bad.length > 12 ? " …" : "") + ".";
    var o = load(SK.opts, {});
    $("shQ").checked = o.shQ !== false;
    $("shO").checked = o.shO !== false;
    if (fresh){
      $("rFrom").value = first;
      $("rTo").value = Math.min(last, first + 49);
      countTouched = false;
    }
    $("rFrom").min = $("rTo").min = first; $("rFrom").max = $("rTo").max = last;
    var quick = $("quick"); quick.textContent = "";
    var size = 50;
    if (last - first + 1 > size){
      for (var a = first; a <= last; a += size){
        var b = Math.min(last, a + size - 1);
        var c = el("button", "chip", a + "–" + b); c.type = "button"; c.dataset.a = a; c.dataset.b = b; quick.appendChild(c);
      }
    }
    var all = el("button", "chip", "Hamısı · " + first + "–" + last); all.type = "button"; all.dataset.a = first; all.dataset.b = last; quick.appendChild(all);
    $("setupErr").hidden = true;
    $("prep").hidden = true; $("goBtn").disabled = false;
    refreshSetup();
    show("setup");
  }
  function readRange(){
    var a = parseInt($("rFrom").value, 10), b = parseInt($("rTo").value, 10);
    return {a:a, b:b, ok:isFinite(a) && isFinite(b) && a <= b};
  }
  function refreshSetup(){
    var r = readRange(), qs = r.ok ? usable(r.a, r.b) : [];
    var cnt = $("rCount");
    var n = qs.length;
    var cur = parseInt(cnt.value, 10);
    if (!countTouched || !isFinite(cur)) cur = n;
    cur = Math.max(n ? 1 : 0, Math.min(cur, n));
    cnt.value = cur; cnt.max = n;
    $("countHint").textContent = !r.ok ? "Aralığı düzgün yaz: birinci rəqəm ikincidən böyük olmamalıdır." : (n ? "Aralıqda " + n + " sual var." + (cur < n ? " " + cur + " sual təsadüfi seçiləcək." : "") : "Bu aralıqda sual yoxdur.");
    $("goBtn").textContent = "Testə başla · " + cur + " sual";
    $("goBtn").disabled = !cur;
    Array.prototype.forEach.call($("quick").children, function(c){ c.setAttribute("aria-pressed", r.ok && +c.dataset.a === r.a && +c.dataset.b === r.b ? "true" : "false"); });
  }
  $("rFrom").addEventListener("input", refreshSetup);
  $("rTo").addEventListener("input", refreshSetup);
  $("rCount").addEventListener("input", function(){ countTouched = true; refreshSetup(); });
  $("quick").addEventListener("click", function(e){
    var c = e.target.closest(".chip"); if (!c) return;
    $("rFrom").value = c.dataset.a; $("rTo").value = c.dataset.b; refreshSetup();
  });
  ["shQ","shO"].forEach(function(id){ $(id).addEventListener("change", function(){ save(SK.opts, {shQ:$("shQ").checked, shO:$("shO").checked}); }); });
  $("otherPdf").addEventListener("click", function(){ show("start"); renderStart(); });

  /* Pictures: render each needed page once and cut out the figures */
  var pageCanvas = null;
  async function preparePictures(qs){
    var byPage = new Map();
    qs.forEach(function(q){
      q.si.concat.apply(q.si, q.o.map(function(o){ return o.imgs; })).forEach(function(b){
        if (b.url !== undefined) return;
        if (!byPage.has(b.p)) byPage.set(b.p, []);
        byPage.get(b.p).push(b);
      });
    });
    var pagesList = Array.from(byPage.keys()).sort(function(a, b){ return a - b; });
    if (!pagesList.length) return;
    $("prep").hidden = false;
    if (!pageCanvas) pageCanvas = document.createElement("canvas");
    var ctx = pageCanvas.getContext("2d");
    for (var i = 0; i < pagesList.length; i++){
      $("prepText").textContent = "Şəkillər hazırlanır: " + (i + 1) + " / " + pagesList.length + " səhifə";
      $("prepBar").style.width = Math.round(100 * i / pagesList.length) + "%";
      var p = pagesList[i];
      var page = await bank.doc.getPage(p + 1);
      var vp = page.getViewport({scale:SCALE, rotation:0});
      pageCanvas.width = Math.ceil(vp.width); pageCanvas.height = Math.ceil(vp.height);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      try{ await page.render({canvasContext:ctx, viewport:vp}).promise; }catch(e){}
      byPage.get(p).forEach(function(b){ cut(b, ctx); });
      page.cleanup();
    }
    pageCanvas.width = pageCanvas.height = 1;
    $("prepBar").style.width = "100%";
  }
  function cut(b, ctx){
    var pad = b.region ? 0 : 1.5;
    var x = Math.max(0, Math.floor((b.x - pad) * SCALE)), y = Math.max(0, Math.floor((b.top - pad) * SCALE));
    var w = Math.min(pageCanvas.width - x, Math.ceil((b.w + 2 * pad) * SCALE)), h = Math.min(pageCanvas.height - y, Math.ceil((b.h + 2 * pad) * SCALE));
    if (w < 4 || h < 4){ b.url = null; return; }
    if (b.region){
      // a fallback area: trim it to the ink inside, or report that the PDF has nothing there
      var data = ctx.getImageData(x, y, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1, ink = 0;
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++){
        var k = (yy * w + xx) * 4;
        if (data[k] + data[k + 1] + data[k + 2] < 600){ ink++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      }
      if (ink < 60 || x1 - x0 < 12 || y1 - y0 < 12){ b.url = null; return; }
      x += Math.max(0, x0 - 6); y += Math.max(0, y0 - 6);
      w = Math.min(x1 - x0 + 13, pageCanvas.width - x); h = Math.min(y1 - y0 + 13, pageCanvas.height - y);
    }
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(pageCanvas, x, y, w, h, 0, 0, w, h);
    b.url = c.toDataURL("image/png");
    b.dw = Math.round(w / SCALE * 1.25);
    b.dh = Math.round(h / SCALE * 1.25);
  }
  function picData(b){ return b.url ? {u:b.url, w:b.dw, h:b.dh} : null; }

  $("goBtn").addEventListener("click", async function(){
    var r = readRange();
    if (!r.ok){ refreshSetup(); return; }
    var pool = usable(r.a, r.b);
    var cnt = Math.min(pool.length, parseInt($("rCount").value, 10) || pool.length);
    if (!cnt) return;
    var pick = cnt < pool.length ? shuffle(pool.slice()).slice(0, cnt) : pool.slice();
    if ($("shQ").checked) shuffle(pick); else pick.sort(function(a, b){ return a.n - b.n; });
    $("goBtn").disabled = true; $("setupErr").hidden = true;
    try{
      await preparePictures(pick);
    }catch(e){
      $("setupErr").textContent = "Şəkillər hazırlanmadı. Səhifəni yeniləyib PDF-i yenidən seç.";
      $("setupErr").hidden = false; $("goBtn").disabled = false; $("prep").hidden = true;
      return;
    }
    var qs = pick.map(function(q){
      return {n:q.n, s:q.s, i:q.i, c:q.c,
        si:q.si.map(picData).filter(Boolean),
        o:q.o.map(function(o){ return {t:o.t, im:o.imgs.map(picData).filter(Boolean), pic:o.imgs.length > 0}; })};
    });
    var title = (bank.subject || bank.name) + " · " + r.a + "–" + r.b;
    begin(qs, {title:title, from:r.a, to:r.b, kind:"full", shO:$("shO").checked});
    $("prep").hidden = true; $("goBtn").disabled = false;
  });

  /* ---------- step 3 and 4: the test ---------- */
  var quiz = null, QS = null, onlyWrong = false, confirmOpen = false;
  function begin(qs, meta){
    var id = Date.now().toString(36) + rnd(1e6).toString(36);
    var perms = qs.map(function(q){ var p = q.o.map(function(_, i){ return i; }); return meta.shO ? shuffle(p) : p; });
    QS = qs;
    quiz = {id:id, title:meta.title, from:meta.from, to:meta.to, kind:meta.kind, perms:perms, answers:{}, pos:0, sec:0, done:false, total:qs.length};
    IDB.set("quiz", {id:id, qs:qs});
    saveQuiz();
    onlyWrong = false; confirmOpen = false;
    renderQuiz();
    show("quiz");
  }
  function saveQuiz(){ if (quiz) save(SK.state, quiz); }
  function answeredCount(){ var n = 0; for (var i = 0; i < QS.length; i++) if (quiz.answers[i] != null) n++; return n; }
  function result(){
    var ok = 0, bad = 0, empty = 0;
    QS.forEach(function(q, i){ var a = quiz.answers[i]; if (a == null) empty++; else if (a === q.c) ok++; else bad++; });
    return {ok:ok, bad:bad, empty:empty};
  }
  function picEl(m, alt){
    var box = el("span", "pic"), im = document.createElement("img");
    im.src = m.u; im.width = m.w; im.height = m.h; im.alt = alt; im.decoding = "async";
    box.appendChild(im);
    return box;
  }
  function stemInto(box, q){
    if (q.s) box.appendChild(el("p", "q-stem", q.s));
    if (q.i && q.i.length){ var ol = el("ol", "q-items"); q.i.forEach(function(t){ ol.appendChild(el("li", null, t)); }); box.appendChild(ol); }
    q.si.forEach(function(m){ var f = el("div", "fig"); f.appendChild(picEl(m, "Sualın şəkli")); box.appendChild(f); });
  }
  function optList(q){
    var ul = el("ul", "q-opts");
    if (q.o.every(function(o){ return !o.t && o.im.length === 1; })){
      var mx = Math.max.apply(null, q.o.map(function(o){ return o.im[0].w; }));
      if (mx <= 340){ ul.classList.add("tiles"); ul.style.setProperty("--tile", (mx + 66) + "px"); }
    }
    return ul;
  }
  function optEl(tag, q, oi, k, cls){
    var b = el(tag, "opt" + (cls ? " " + cls : ""));
    if (tag === "button"){ b.type = "button"; b.dataset.oi = oi; }
    b.appendChild(el("span", "key", LETTERS[k]));
    var t = el("span", "txt"), o = q.o[oi];
    if (o.t) t.appendChild(document.createTextNode(o.t));
    o.im.forEach(function(m){ t.appendChild(picEl(m, "Variant " + LETTERS[k])); });
    if (!o.t && !o.im.length) t.appendChild(el("span", "nopic", o.pic ? "PDF-də bu variantın şəkli yoxdur" : "Boş variant"));
    b.appendChild(t);
    return b;
  }
  function renderQuiz(){
    $("qzTitle").textContent = quiz.title;
    $("qzRun").hidden = quiz.done;
    $("qzResult").hidden = !quiz.done;
    if (quiz.done) renderResult(); else renderRun();
  }
  function renderRun(){
    var total = QS.length, q = QS[quiz.pos], a = answeredCount();
    $("qzPos").textContent = "Sual " + (quiz.pos + 1) + " / " + total;
    $("qzAnswered").textContent = a + " cavablanıb";
    $("qzTime").textContent = "Vaxt " + mmss(quiz.sec);
    $("qzBar").style.width = (100 * a / total) + "%";
    var pal = $("qzPalette"); pal.textContent = "";
    QS.forEach(function(_, i){
      var done = quiz.answers[i] != null;
      var b = el("button", "pal" + (done ? " done" : "") + (i === quiz.pos ? " cur" : ""), String(i + 1));
      b.type = "button"; b.dataset.i = i;
      b.setAttribute("aria-label", "Sual " + (i + 1) + (done ? ", cavablanıb" : ", cavabsız"));
      if (i === quiz.pos) b.setAttribute("aria-current", "step");
      pal.appendChild(b);
    });
    var card = $("qzCard"); card.textContent = "";
    var h = el("div", "q-head");
    h.appendChild(el("span", "q-no", "Sual " + (quiz.pos + 1)));
    h.appendChild(el("span", "q-tag", "PDF-də № " + q.n));
    card.appendChild(h);
    stemInto(card, q);
    var ul = optList(q);
    quiz.perms[quiz.pos].forEach(function(oi, k){
      var picked = quiz.answers[quiz.pos] === oi;
      var b = optEl("button", q, oi, k, picked ? "picked" : "");
      b.setAttribute("aria-pressed", picked ? "true" : "false");
      var li = el("li"); li.appendChild(b); ul.appendChild(li);
    });
    card.appendChild(ul);
    $("qzPrev").disabled = quiz.pos === 0;
    $("qzNext").textContent = quiz.pos === total - 1 ? "Testi bitir" : "Növbəti →";
    $("qzConfirm").hidden = !confirmOpen;
  }
  function renderResult(){
    var res = result(), total = QS.length;
    $("qzKind").textContent = quiz.kind === "retry" ? "Səhvlərin təkrarı · nəticə" : "Test nəticəsi";
    $("qzBig").textContent = res.ok + " / " + total;
    $("qzPct").textContent = Math.round(100 * res.ok / total) + "%";
    var line = $("qzLine"); line.textContent = "";
    line.appendChild(el("span", "ok", "Düz " + res.ok));
    line.appendChild(document.createTextNode(" · "));
    line.appendChild(el("span", "bad", "Səhv " + res.bad));
    line.appendChild(document.createTextNode(" · Cavabsız " + res.empty + " · Vaxt " + mmss(quiz.sec)));
    var wrongNs = [];
    QS.forEach(function(q, i){ if (quiz.answers[i] !== q.c) wrongNs.push(q.n); });
    wrongNs.sort(function(a, b){ return a - b; });
    var wl = $("qzWrongList"); wl.textContent = "";
    if (wrongNs.length){ wl.appendChild(document.createTextNode("Səhv və cavabsız sualların PDF nömrələri: ")); wl.appendChild(el("b", null, wrongNs.join(", "))); }
    else wl.textContent = "Bütün suallara düz cavab verdin.";
    $("qzRetry").hidden = !wrongNs.length;
    $("qzRetry").textContent = "Səhvləri yenidən işlə · " + wrongNs.length;
    $("qzNew").textContent = bank ? "Yeni test" : "Yeni test üçün PDF seç";
    $("qzOnlyWrong").setAttribute("aria-pressed", onlyWrong ? "true" : "false");
    var rv = $("qzReview"); rv.textContent = "";
    var shown = 0;
    QS.forEach(function(q, i){
      var a = quiz.answers[i];
      var st = a == null ? "empty" : (a === q.c ? "ok" : "bad");
      if (onlyWrong && st === "ok") return;
      shown++;
      var art = el("article", "q qz-rev");
      var h = el("div", "q-head");
      h.appendChild(el("span", "q-no", "Sual " + (i + 1)));
      h.appendChild(el("span", "q-tag", "PDF-də № " + q.n));
      h.appendChild(el("span", "verdict v-" + st, st === "ok" ? "Düz" : st === "bad" ? "Səhv" : "Cavabsız"));
      art.appendChild(h);
      stemInto(art, q);
      var ul = optList(q);
      quiz.perms[i].forEach(function(oi, k){
        var cls = oi === q.c ? "right" : (oi === a ? "wrong" : "");
        var o = optEl("div", q, oi, k, cls);
        var f = null;
        if (oi === q.c) f = el("span", "flag", a === q.c ? "✓ Sənin cavabın" : "✓ Düzgün cavab");
        else if (oi === a) f = el("span", "flag", "✗ Sənin cavabın");
        if (f) o.appendChild(f);
        var li = el("li"); li.appendChild(o); ul.appendChild(li);
      });
      art.appendChild(ul);
      rv.appendChild(art);
    });
    if (!shown) rv.appendChild(el("p", "muted", "Bu testdə səhvin yoxdur."));
  }
  function pick(oi){ quiz.answers[quiz.pos] = oi; confirmOpen = false; saveQuiz(); renderRun(); }
  function go(d){
    var p = quiz.pos + d;
    if (p < 0 || p >= QS.length) return;
    quiz.pos = p; confirmOpen = false; saveQuiz(); renderRun();
    var t = $("qzCard").getBoundingClientRect().top;
    if (t < 0) window.scrollBy(0, t - 12);
  }
  function finish(){
    confirmOpen = false; quiz.done = true;
    if (quiz.kind === "full"){
      var hist = load(SK.hist, []); if (!Array.isArray(hist)) hist = [];
      hist.unshift({d:Date.now(), title:quiz.title, ok:result().ok, t:QS.length, sec:quiz.sec});
      save(SK.hist, hist.slice(0, 20));
    }
    onlyWrong = false; saveQuiz(); renderQuiz(); window.scrollTo(0, 0);
  }
  function tryFinish(){
    var left = QS.length - answeredCount();
    if (left > 0){
      confirmOpen = true;
      $("qzConfirmText").textContent = left + " sual cavabsızdır. İndi bitirsən, onlar cavabsız kimi sayılacaq.";
      renderRun(); $("qzConfirm").scrollIntoView({block:"nearest"});
      return;
    }
    finish();
  }
  $("qzPalette").addEventListener("click", function(e){ var b = e.target.closest(".pal"); if (!b) return; quiz.pos = +b.dataset.i; confirmOpen = false; saveQuiz(); renderRun(); });
  $("qzCard").addEventListener("click", function(e){ var b = e.target.closest(".opt"); if (b) pick(+b.dataset.oi); });
  $("qzPrev").addEventListener("click", function(){ go(-1); });
  $("qzNext").addEventListener("click", function(){ if (quiz.pos === QS.length - 1) tryFinish(); else go(1); });
  $("qzFinish").addEventListener("click", tryFinish);
  $("qzConfirmYes").addEventListener("click", finish);
  $("qzConfirmNo").addEventListener("click", function(){
    confirmOpen = false;
    for (var i = 0; i < QS.length; i++) if (quiz.answers[i] == null){ quiz.pos = i; break; }
    saveQuiz(); renderRun();
  });
  $("qzOnlyWrong").addEventListener("click", function(){ onlyWrong = !onlyWrong; renderResult(); });
  $("qzRetry").addEventListener("click", function(){
    var qs = QS.filter(function(q, i){ return quiz.answers[i] !== q.c; });
    if (!qs.length) return;
    begin(shuffle(qs.slice()), {title:quiz.title.replace(/ · səhvlər$/, "") + " · səhvlər", from:quiz.from, to:quiz.to, kind:"retry", shO:true});
  });
  $("qzNew").addEventListener("click", function(){ if (bank) openSetup(false); else { show("start"); renderStart(); } });
  $("qzBack").addEventListener("click", function(){
    if (bank) openSetup(false); else { show("start"); renderStart(); }
  });
  document.addEventListener("keydown", function(e){
    if ($("vQuiz").hidden || !quiz || quiz.done || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    var k = (e.key || "").toLowerCase(), perm = quiz.perms[quiz.pos];
    var idx = k.length === 1 ? "abcdefgh".indexOf(k) : -1;
    if (idx === -1 && k.length === 1) idx = "12345678".indexOf(k);
    if (idx !== -1 && idx < perm.length){ pick(perm[idx]); e.preventDefault(); return; }
    if (e.key === "ArrowRight"){ go(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft"){ go(-1); e.preventDefault(); }
  });
  setInterval(function(){
    if ($("vQuiz").hidden || !quiz || quiz.done || document.hidden) return;
    quiz.sec++;
    $("qzTime").textContent = "Vaxt " + mmss(quiz.sec);
    if (quiz.sec % 5 === 0) saveQuiz();
  }, 1000);
  window.addEventListener("pagehide", saveQuiz);

  /* ---------- start screen ---------- */
  function renderStart(){
    var hist = load(SK.hist, []); if (!Array.isArray(hist)) hist = [];
    var ul = $("hist"); ul.textContent = "";
    $("histCard").hidden = !hist.length;
    hist.slice(0, 6).forEach(function(h){
      var li = el("li");
      li.appendChild(el("span", "h-title", h.title));
      li.appendChild(el("b", null, h.ok + " / " + h.t));
      li.appendChild(el("span", null, when(h.d)));
      ul.appendChild(li);
    });
    var r = $("resume");
    r.hidden = !quiz;
    if (quiz){
      $("resumeTitle").textContent = quiz.done ? "Son testin nəticəsi" : "Yarımçıq test";
      $("resumeSub").textContent = quiz.title + " · " + (quiz.done ? result().ok + " / " + QS.length + " düz" : answeredCount() + " / " + QS.length + " cavablanıb");
      $("resumeGo").textContent = quiz.done ? "Nəticəyə bax" : "Davam et";
    }
  }
  $("resumeGo").addEventListener("click", function(){ if (quiz){ renderQuiz(); show("quiz"); } });

  var st = load(SK.state, null);
  renderStart();
  show("start");
  if (st && st.id){
    IDB.get("quiz").then(function(rec){
      if (!rec || rec.id !== st.id || !Array.isArray(rec.qs) || rec.qs.length !== (st.perms || []).length) return;
      QS = rec.qs; quiz = st; quiz.answers = quiz.answers || {}; quiz.sec = quiz.sec | 0;
      quiz.pos = Math.min(Math.max(0, quiz.pos | 0), QS.length - 1);
      if ($("vStart").hidden === false) renderStart();
    });
  }
})();
