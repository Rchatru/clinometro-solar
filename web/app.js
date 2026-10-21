/* Clinómetro Solar 2.0
   Lógica de la app: sensores, proyectos, diagrama solar y exportación.
   Funciona igual como web (GitHub Pages) y dentro de la app Android (Capacitor). */
(function () {
"use strict";

var VERSION = "2.0.0-beta2";
var D2R = Math.PI / 180, R2D = 180 / Math.PI;
var $ = function (id) { return document.getElementById(id); };
var Cap = window.Capacitor;
var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
var plugin = function (name) { try { return Cap && Cap.registerPlugin ? Cap.registerPlugin(name) : null; } catch (e) { return null; } };

/* ---------------- Almacenamiento ---------------- */
var KEY = "cs.v2";
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

var DEFAULT_LOC = { lat: 28.68, lon: -17.77 };
function wmmDecl(lat, lon) {
  try { return window.Geomag ? Geomag.model(new Date()).point([lat, lon]).decl : null; } catch (e) { return null; }
}
function newProject(name, from) {
  var lat = from ? from.lat : DEFAULT_LOC.lat, lon = from ? from.lon : DEFAULT_LOC.lon;
  var d = from ? from.decl : wmmDecl(lat, lon);
  return { id: uid(), name: name, created: Date.now(), updated: Date.now(), lat: lat, lon: lon,
           decl: d == null ? -4.5 : +d.toFixed(1), declSource: from ? from.declSource : "wmm", points: [],
           beta: from ? from.beta : 30, alphaMod: from ? from.alphaMod : 0, idaeTable: "auto", idaeCase: from ? from.idaeCase : "general" };
}

var db = load();
if (!db || !db.projects || !db.projects.length) {
  db = { projects: [], currentId: null,
         settings: { avg: 1000, delay: 0, tap: false, vol: true, theme: "system", offset: 0, chartMode: "simple", compareId: "" } };
  var p0 = newProject("Proyecto 1");
  /* migración desde la versión 1 (web) */
  try {
    var old = JSON.parse(localStorage.getItem("clino.points") || "null");
    if (old && old.length) {
      p0.name = "Mediciones anteriores";
      p0.points = old.map(function (q) { return { az: q.az, head: q.head, elev: q.elev, sd: q.sd, note: q.note || "", t: Date.parse(q.date) || Date.now(), abs: q.abs }; });
      var ol = JSON.parse(localStorage.getItem("clino.lat") || "null"); if (typeof ol === "number") p0.lat = ol;
      var od = JSON.parse(localStorage.getItem("clino.decl") || "null"); if (typeof od === "number") { p0.decl = od; p0.declSource = "manual"; }
      var oo = JSON.parse(localStorage.getItem("clino.offset") || "null"); if (typeof oo === "number") db.settings.offset = oo;
    }
  } catch (e) {}
  db.projects.push(p0); db.currentId = p0.id; save();
}
var S = db.settings;
function withDefaults(p) {
  if (p.beta == null) p.beta = 30; if (p.alphaMod == null) p.alphaMod = 0;
  if (!p.idaeTable) p.idaeTable = "auto"; if (!p.idaeCase) p.idaeCase = "general";
  p.points.forEach(function (q) { if (!q.id) q.id = uid(); });
  return p;
}
if (S.photos == null) S.photos = true;
db.projects.forEach(withDefaults);
function proj() { for (var i = 0; i < db.projects.length; i++) if (db.projects[i].id === db.currentId) return db.projects[i]; db.currentId = db.projects[0].id; return db.projects[0]; }
function touch() { proj().updated = Date.now(); save(); }

/* ---------------- Utilidades ---------------- */
function fmt(n, d) { return (n < 0 ? "−" : "") + Math.abs(n).toFixed(d).replace(".", ","); }
function sgn(n, d) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d).replace(".", ","); }
function norm180(a) { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }
function norm360(a) { return ((a % 360) + 360) % 360; }
var CARD = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
function cardinal(h) { return CARD[Math.round(norm360(h) / 22.5) % 16]; }
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function toast(t, ms) { var el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, ms || 2400); }
var Haptics = isNative ? plugin("Haptics") : null;
function haptic(kind) {
  try { if (Haptics) { kind === "light" ? Haptics.impact({ style: "LIGHT" }) : Haptics.impact({ style: "MEDIUM" }); return; } } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(kind === "light" ? 15 : 40); } catch (e) {}
}
function dateStr(t) { var d = new Date(t); return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }); }

/* ---------------- Fotos (IndexedDB) ---------------- */
var Photos = (function () {
  var dbp = null, urls = {};
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      try {
        var r = indexedDB.open("cs-photos", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("photos"); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(function (d) { return new Promise(function (res, rej) {
      var t = d.transaction("photos", mode), st = t.objectStore("photos"), out = fn(st);
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); };
    }); });
  }
  return {
    put: function (id, blob) { return tx("readwrite", function (st) { st.put(blob, id); }); },
    get: function (id) { return tx("readonly", function (st) { return st.get(id); }); },
    del: function (ids) { ids.forEach(function (id) { if (urls[id]) { URL.revokeObjectURL(urls[id]); delete urls[id]; } }); return tx("readwrite", function (st) { ids.forEach(function (id) { st.delete(id); }); }).catch(function () {}); },
    url: function (id) {
      if (urls[id]) return Promise.resolve(urls[id]);
      return this.get(id).then(function (b) { if (!b) return null; urls[id] = URL.createObjectURL(b); return urls[id]; });
    }
  };
})();

/* Captura del visor con la retícula y las lecturas impresas */
function capturePhoto(pt, n) {
  var v = $("video");
  if (!v.videoWidth) return Promise.resolve(null);
  var vw = v.videoWidth, vh = v.videoHeight, el = v.getBoundingClientRect();
  /* recorte igual que se ve en pantalla (object-fit: cover) */
  var scr = el.width / el.height, src = vw / vh, sw = vw, sh = vh, sx = 0, sy = 0;
  if (src > scr) { sw = vh * scr; sx = (vw - sw) / 2; } else { sh = vw / scr; sy = (vh - sh) / 2; }
  var W = Math.min(1080, Math.round(sw)), H = Math.round(W * sh / sw);
  var c = document.createElement("canvas"); c.width = W; c.height = H;
  var g = c.getContext("2d");
  g.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
  var cx = W / 2, cy = H / 2, u = W / 400;
  g.strokeStyle = "#ffd27a"; g.lineWidth = 1.6 * u; g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 3 * u;
  g.beginPath(); g.arc(cx, cy, 11 * u, 0, 7); g.stroke();
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { g.beginPath(); g.moveTo(cx + d[0] * 12 * u, cy + d[1] * 12 * u); g.lineTo(cx + d[0] * 46 * u, cy + d[1] * 46 * u); g.stroke(); });
  g.shadowBlur = 0;
  var bh = 44 * u; g.fillStyle = "rgba(10,15,22,.72)"; g.fillRect(0, H - bh, W, bh);
  g.fillStyle = "#f4f7fb"; g.textBaseline = "middle";
  g.font = "500 " + 15 * u + "px " + css("--f-mono");
  g.fillText("#" + n + "  El " + fmt(pt.elev, 1) + "°  Az " + sgn(pt.az, 0) + "°", 12 * u, H - bh / 2);
  g.font = "500 " + 10.5 * u + "px " + css("--f-ui"); g.textAlign = "right"; g.fillStyle = "rgba(244,247,251,.75)";
  g.fillText(proj().name + " · " + new Date(pt.t).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }), W - 12 * u, H - bh / 2);
  return new Promise(function (res) { c.toBlob(function (b) { res(b); }, "image/jpeg", 0.82); });
}

/* ---------------- Sensores ---------------- */
var sens = { samples: [], absolute: false, gotData: false, started: false };

/* Eje de la cámara trasera (−Z del dispositivo) en coordenadas Este-Norte-Arriba,
   a partir de alpha, beta y gamma (rotación Z-X'-Y'' de la especificación W3C). */
function cameraVector(a, b, g) {
  a *= D2R; b *= D2R; g *= D2R;
  var cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  return { x: -(cG * sA * sB + cA * sG), y: -(sA * sG - cA * cG * sB), z: -(cB * cG) };
}
function onOrient(e, isAbs) {
  if (e.beta == null || e.gamma == null) return;
  var v = cameraVector(e.alpha || 0, e.beta, e.gamma);
  var elev = Math.asin(Math.max(-1, Math.min(1, v.z))) * R2D;
  var hx = v.x, hy = v.y;
  if (isAbs) sens.absolute = true;
  if (e.webkitCompassHeading != null) { var h = e.webkitCompassHeading * D2R; hx = Math.sin(h); hy = Math.cos(h); sens.absolute = true; }
  sens.gotData = true;
  var t = performance.now();
  sens.samples.push({ t: t, e: elev, x: hx, y: hy });
  while (sens.samples.length && t - sens.samples[0].t > 2500) sens.samples.shift();
}
function average(ms) {
  var t = performance.now(), n = 0, se = 0, se2 = 0, sx = 0, sy = 0;
  for (var i = sens.samples.length - 1; i >= 0; i--) {
    var s = sens.samples[i]; if (t - s.t > ms) break;
    n++; se += s.e; se2 += s.e * s.e; sx += s.x; sy += s.y;
  }
  if (!n) return null;
  var me = se / n, sd = Math.sqrt(Math.max(0, se2 / n - me * me));
  var head = norm360(Math.atan2(sx, sy) * R2D + proj().decl);
  return { elev: me + S.offset, raw: me, sd: sd, head: head, az: norm180(head - 180) };
}
function startSensors() {
  if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", function (e) { onOrient(e, true); });
  window.addEventListener("deviceorientation", function (e) { if (!sens.absolute || e.webkitCompassHeading != null) onOrient(e, !!e.absolute); });
}

async function start() {
  var msg = [];
  $("btnStart").disabled = true;
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      var p = await DeviceOrientationEvent.requestPermission();
      if (p !== "granted") msg.push("No se ha concedido el acceso a los sensores de movimiento.");
    }
  } catch (e) { msg.push("No se ha podido pedir permiso para los sensores."); }
  startSensors();
  if (!window.isSecureContext) msg.push("La página debe abrirse con https:// para usar la cámara y los sensores.");
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    var v = $("video"); v.srcObject = stream; v.play().catch(function () {});
  } catch (e) { msg.push("No se ha podido abrir la cámara (" + (e && e.name || "error") + "). Las lecturas funcionan igual apuntando con la parte trasera del móvil."); }
  try { if ("wakeLock" in navigator) navigator.wakeLock.request("screen").catch(function () {}); } catch (e) {}
  sens.started = true;
  $("btnSave").disabled = false; $("btnCal").disabled = false;
  var t0 = performance.now();
  (function wait() {
    if (sens.gotData && !msg.length) { $("startPanel").hidden = true; return; }
    if (sens.gotData || performance.now() - t0 > 5000) {
      if (!sens.gotData) msg.push("El dispositivo no envía datos de orientación. Hace falta un móvil con giroscopio y brújula.");
      $("startMsg").textContent = msg.join(" ");
      $("btnStart").textContent = "Continuar"; $("btnStart").disabled = false;
      $("btnStart").onclick = function () { $("startPanel").hidden = true; };
      return;
    }
    setTimeout(wait, 200);
  })();
  requestAnimationFrame(loop);
}
$("btnStart").addEventListener("click", start, { once: true });

/* ---------------- Visor ---------------- */
var lastUI = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (t - lastUI < 90) return; lastUI = t;
  if (currentView !== "measure") return;
  var a = average(350); if (!a) return;
  if (!$("startPanel").hidden && /no envía datos/.test($("startMsg").textContent)) $("startPanel").hidden = true;
  $("vElev").textContent = fmt(a.elev, 1);
  $("vAz").textContent = sgn(Math.round(a.az), 0);
  $("vCard").textContent = cardinal(a.head) + " · rumbo " + Math.round(a.head) + "°";
  var full = average(S.avg), stable = full && full.sd < 0.4;
  var chip = $("chipStab");
  chip.className = "chip " + (stable ? "good" : "bad");
  chip.lastChild.textContent = stable ? "Lectura estable" : "Moviéndose ±" + (full ? full.sd : 0).toFixed(1).replace(".", ",") + "°";
  $("btnSave").classList.toggle("stable", !!stable);
  $("chipRef").hidden = sens.absolute;
  drawTape(a.head);
}

/* Cinta de rumbo, como la de un instrumento de navegación */
function drawTape(head) {
  var c = $("tape"), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  var span = 100, ppd = w / span, cx = w / 2;
  var grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)"); grad.addColorStop(.18, "rgba(255,255,255,1)"); grad.addColorStop(.82, "rgba(255,255,255,1)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  g.save();
  g.font = "500 11px " + css("--f-mono"); g.textAlign = "center";
  var start = Math.floor((head - span / 2) / 5) * 5;
  for (var d = start; d <= head + span / 2; d += 5) {
    var x = cx + (d - head) * ppd, n = norm360(d), major = n % 45 === 0, mid = n % 15 === 0;
    g.strokeStyle = "rgba(244,247,251," + (major ? .95 : mid ? .7 : .4) + ")"; g.lineWidth = major ? 1.6 : 1;
    g.beginPath(); g.moveTo(x, h - 2); g.lineTo(x, h - (major ? 14 : mid ? 10 : 6)); g.stroke();
    if (major) { g.fillStyle = n === 180 ? "#ffad6b" : "rgba(244,247,251,.95)"; g.font = "600 12px " + css("--f-ui"); g.fillText(CARD[n / 22.5], x, h - 19); }
    else if (mid) { g.fillStyle = "rgba(244,247,251,.6)"; g.font = "500 10px " + css("--f-mono"); g.fillText(String(n), x, h - 19); }
  }
  /* puntos guardados */
  g.fillStyle = "#ffad6b";
  proj().points.forEach(function (p) {
    var dd = norm180(p.head - head); if (Math.abs(dd) > span / 2) return;
    g.beginPath(); g.arc(cx + dd * ppd, 5, 3, 0, 7); g.fill();
  });
  g.globalCompositeOperation = "destination-in"; g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.restore();
  g.fillStyle = "#ffd27a"; g.beginPath(); g.moveTo(cx - 5, h); g.lineTo(cx + 5, h); g.lineTo(cx, h - 7); g.closePath(); g.fill();
}

/* ---------------- Disparo ---------------- */
var counting = false;
function trigger() {
  if (!sens.started || counting) return;
  var delay = +S.delay;
  if (!delay) { savePoint(); return; }
  counting = true;
  var b = $("btnSave"), cd = $("countdown"), left = delay;
  b.classList.add("counting"); cd.hidden = false; cd.textContent = left; haptic("light");
  var iv = setInterval(function () {
    left--;
    if (left > 0) { cd.textContent = left; haptic("light"); return; }
    clearInterval(iv); cd.hidden = true; b.classList.remove("counting"); counting = false; savePoint();
  }, 1000);
}
function savePoint() {
  var a = average(S.avg);
  if (!a) { toast("Sin datos de los sensores"); return; }
  var p = proj();
  var pt = { id: uid(), az: +a.az.toFixed(1), head: +a.head.toFixed(1), elev: +a.elev.toFixed(1), sd: +a.sd.toFixed(2), note: "", t: Date.now(), abs: sens.absolute };
  p.points.push(pt);
  touch(); haptic();
  if (S.photos) capturePhoto(pt, p.points.length).then(function (b) {
    if (!b) return; return Photos.put(pt.id, b).then(function () { pt.photo = true; touch(); });
  }).catch(function () {});
  renderCounts();
  toast("Punto " + p.points.length + ": " + fmt(a.elev, 1) + "° a " + sgn(Math.round(a.az), 0) + "°" + (a.sd > 0.8 ? " · lectura poco estable" : ""));
}
$("btnSave").addEventListener("click", trigger);
$("tapzone").addEventListener("click", trigger);
$("btnUndo").addEventListener("click", function () {
  var p = proj(); if (!p.points.length) return;
  var gone = p.points.pop(); touch(); renderCounts(); toast("Último punto eliminado");
  if (gone && gone.photo) Photos.del([gone.id]);
});
$("btnGoPoints").addEventListener("click", function () { show("points"); });
/* Botón de volumen: lo llama la actividad nativa de Android */
window.__volShutter = function () {
  if (!S.vol || currentView !== "measure" || !sens.started || !$("startPanel").hidden) return false;
  trigger(); return true;
};

/* ---------------- Navegación ---------------- */
var currentView = "measure";
function show(v) {
  currentView = v;
  document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = el.dataset.view !== v; });
  document.querySelectorAll("[data-tab]").forEach(function (b) { if (b.dataset.tab === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  $("app").classList.toggle("on-measure", v === "measure");
  if (v === "chart") { fillCompare(); renderLoss(); drawChart(); }
  if (v === "points") renderPoints();
  if (v === "settings") renderSettings();
}
document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.tab); }); });

/* ---------------- Puntos ---------------- */
function renderCounts() {
  var n = proj().points.length;
  $("vCount").textContent = n; $("btnUndo").disabled = !n;
}
var ICON_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
function renderPoints() {
  var p = proj(), list = $("plist");
  $("projTitle").textContent = p.name;
  $("pointsEyebrow").textContent = p.points.length ? p.points.length + (p.points.length === 1 ? " punto" : " puntos") + " · " + dateStr(p.updated) : "Sin puntos";
  list.textContent = "";
  p.points.forEach(function (q, i) {
    var li = document.createElement("li");
    if (q.photo) li.className = "has-photo";
    li.innerHTML = '<span class="p-n">' + String(i + 1).padStart(2, "0") + '</span>' +
      (q.photo ? '<button class="p-thumb" type="button" aria-label="Ver foto del punto ' + (i + 1) + '"><img alt=""></button>' : '') +
      '<div class="p-vals"><span><small>Azimut</small>' + sgn(q.az, 0) + '°</span><span><small>Elevación</small>' + fmt(q.elev, 1) + '°</span><span class="sd"><small>Desv.</small>±' + q.sd.toFixed(1).replace(".", ",") + '°</span></div>' +
      '<button class="p-del" type="button" aria-label="Eliminar punto ' + (i + 1) + '">' + ICON_DEL + '</button>' +
      '<input class="p-note" type="text" placeholder="Añadir nota" aria-label="Nota del punto ' + (i + 1) + '">';
    var inp = li.querySelector(".p-note"); inp.value = q.note || ""; inp.id = "note-" + i;
    inp.addEventListener("change", function () { q.note = inp.value.trim(); touch(); });
    li.querySelector(".p-del").addEventListener("click", function () { p.points.splice(i, 1); if (q.photo) Photos.del([q.id]); touch(); renderPoints(); renderCounts(); });
    if (q.photo) {
      var img = li.querySelector(".p-thumb img");
      Photos.url(q.id).then(function (u) { if (u) img.src = u; else { q.photo = false; } });
      li.querySelector(".p-thumb").addEventListener("click", function () { openLightbox(q, i + 1); });
    }
    list.appendChild(li);
  });
  var has = p.points.length > 0;
  $("emptyMsg").hidden = has; list.hidden = !has; $("pointActions").hidden = !has;
  if (!has) $("confirmClear").hidden = true;
}
$("btnClear").addEventListener("click", function () { $("confirmClear").hidden = false; });
$("btnClearNo").addEventListener("click", function () { $("confirmClear").hidden = true; });
$("btnClearYes").addEventListener("click", function () { Photos.del(proj().points.map(function (q) { return q.id; })); proj().points = []; touch(); $("confirmClear").hidden = true; renderPoints(); renderCounts(); });

function openLightbox(q, n) {
  Photos.url(q.id).then(function (u) {
    if (!u) return;
    $("lbImg").src = u; $("lbCap").textContent = "Punto " + n + " · elevación " + fmt(q.elev, 1) + "° · azimut " + sgn(q.az, 0) + "°" + (q.note ? " · " + q.note : "");
    $("lightbox").hidden = false;
  });
}
$("lbClose").addEventListener("click", function () { $("lightbox").hidden = true; });
$("lightbox").addEventListener("click", function (e) { if (e.target === $("lightbox")) $("lightbox").hidden = true; });

/* Renombrar */
$("btnRename").addEventListener("click", function () { $("inRename").value = proj().name; $("renameBox").hidden = false; $("inRename").focus(); });
$("btnRenameNo").addEventListener("click", function () { $("renameBox").hidden = true; });
$("btnRenameOk").addEventListener("click", function () {
  var v = $("inRename").value.trim(); if (v) { proj().name = v; touch(); }
  $("renameBox").hidden = true; renderPoints();
});

/* ---------------- Proyectos ---------------- */
var ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
function openSheet() { renderProjects(); $("sheet").hidden = false; $("sheetBg").hidden = false; }
function closeSheet() { $("sheet").hidden = true; $("sheetBg").hidden = true; }
$("btnProjects").addEventListener("click", openSheet);
$("sheetBg").addEventListener("click", closeSheet);
function renderProjects() {
  var ul = $("projList"); ul.textContent = "";
  db.projects.slice().sort(function (a, b) { return b.updated - a.updated; }).forEach(function (p) {
    var li = document.createElement("li");
    li.innerHTML = '<button class="pj-main' + (p.id === db.currentId ? " current" : "") + '" type="button"><b></b><span></span></button>' +
      '<div class="pj-tools"><button type="button" class="dup" aria-label="Duplicar">' + ICON_COPY + '</button>' +
      '<button type="button" class="del" aria-label="Eliminar">' + ICON_DEL + '</button></div>';
    li.querySelector("b").textContent = p.name;
    li.querySelector(".pj-main span").textContent = p.points.length + " pt · " + dateStr(p.updated) + " · " + fmt(p.lat, 2) + "°";
    li.querySelector(".pj-main").addEventListener("click", function () { db.currentId = p.id; save(); closeSheet(); renderPoints(); renderCounts(); toast("Proyecto: " + p.name); });
    li.querySelector(".dup").addEventListener("click", function () {
      var c = JSON.parse(JSON.stringify(p)); c.id = uid(); c.name = p.name + " (copia)"; c.created = c.updated = Date.now();
      c.points.forEach(function (q, k) {
        var oldId = p.points[k].id; q.id = uid();
        if (q.photo) Photos.get(oldId).then(function (b) { if (b) return Photos.put(q.id, b); q.photo = false; save(); }).catch(function () {});
      });
      db.projects.push(c); save(); renderProjects();
    });
    var del = li.querySelector(".del");
    del.addEventListener("click", function () {
      if (!del.classList.contains("armed")) { del.classList.add("armed"); del.setAttribute("aria-label", "Pulse otra vez para eliminar"); setTimeout(function () { del.classList.remove("armed"); }, 3000); return; }
      Photos.del(p.points.map(function (q) { return q.id; }));
      db.projects = db.projects.filter(function (x) { return x.id !== p.id; });
      if (!db.projects.length) db.projects.push(newProject("Proyecto 1"));
      if (db.currentId === p.id) db.currentId = db.projects[0].id;
      if (S.compareId === p.id) S.compareId = "";
      save(); renderProjects(); renderPoints(); renderCounts();
    });
    ul.appendChild(li);
  });
}
$("btnNewProj").addEventListener("click", function () {
  var n = newProject("Proyecto " + (db.projects.length + 1), proj());
  n.lat = proj().lat; n.lon = proj().lon;
  db.projects.push(n); db.currentId = n.id; save();
  closeSheet(); renderPoints(); renderCounts();
  $("inRename").value = n.name; $("renameBox").hidden = false; $("inRename").select();
  maybeAutoGps();
});

/* ---------------- Exportación ---------------- */
function csvText(sep) {
  var p = proj();
  var rows = [["n", "azimut_sur_deg", "rumbo_norte_deg", "elevacion_deg", "desviacion_deg", "nota", "fecha_hora", "ref_norte"]];
  p.points.forEach(function (q, i) {
    rows.push([i + 1, q.az.toFixed(1).replace(".", ","), q.head.toFixed(1).replace(".", ","), q.elev.toFixed(1).replace(".", ","), q.sd.toFixed(2).replace(".", ","),
      (q.note || "").replace(/[;\t\r\n]/g, " "), new Date(q.t).toISOString(), q.abs ? "si" : "no"]);
  });
  return "# " + p.name + " | latitud " + p.lat.toFixed(4) + " | longitud " + p.lon.toFixed(4) + " | declinacion " + p.decl.toFixed(1) + "\r\n" +
    rows.map(function (r) { return r.join(sep); }).join("\r\n");
}
function fileName(ext) { return proj().name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "") + "_" + new Date().toISOString().slice(0, 10) + "." + ext; }
async function shareText(text, name, mime) {
  if (isNative) {
    var FS = plugin("Filesystem"), Share = plugin("Share");
    var r = await FS.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
    await Share.share({ title: name, url: r.uri, dialogTitle: "Exportar " + name });
    return;
  }
  var blob = new Blob(["﻿" + text], { type: mime });
  try {
    var file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$("btnShare").addEventListener("click", function () {
  shareText(csvText(";"), fileName("csv"), "text/csv").catch(function (e) { if (!/cancel/i.test(String(e && e.message))) toast("No se ha podido exportar"); });
});
$("btnCopy").addEventListener("click", function () {
  var t = csvText("\t");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast("Tabla copiada. Se puede pegar en una hoja de cálculo."); }, function () { toast("No se ha podido copiar"); });
  else toast("Este dispositivo no permite copiar");
});

/* ---------------- Diagrama solar ---------------- */
var MONTHS = [{ d: 23.44, l: "jun", main: 1 }, { d: 20.2, l: "may-jul" }, { d: 11.8, l: "abr-ago" }, { d: 0, l: "mar-sep", main: 1 },
              { d: -10.8, l: "feb-oct" }, { d: -20.1, l: "ene-nov" }, { d: -23.44, l: "dic", main: 1 }];
function sunPos(lat, decl, hDeg) {
  var phi = lat * D2R, d = decl * D2R, H = hDeg * D2R;
  var el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H)) * R2D;
  var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * R2D;
  return [az, el];
}
function sunPath(lat, decl) { var out = []; for (var h = -180; h <= 180; h += 1.5) out.push(sunPos(lat, decl, h)); return out; }
function hex2rgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); var n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { var A = hex2rgb(a), B = hex2rgb(b); return "rgb(" + A.map(function (v, i) { return Math.round(v + (B[i] - v) * t); }).join(",") + ")"; }
function monthColor(decl) { var t = (decl + 23.44) / 46.88; return t < .5 ? mix(css("--winter"), "#9b7fd0", t * 2) : mix("#9b7fd0", css("--sun"), (t - .5) * 2); }

function drawChart() {
  var c = $("chart"), w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  drawChartOn(c, w, h, window.devicePixelRatio || 1, S.chartMode, true);
}
/* Dibuja el diagrama en cualquier lienzo (pantalla o informe) */
function drawChartOn(c, w, h, dpr, mode, onScreen) {
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (!onScreen) { g.fillStyle = css("--surface"); g.fillRect(0, 0, w, h); }
  var p = proj(), full = mode === "full";
  var L = 34, R = 10, T = 10, B = 26, pw = w - L - R, ph = h - T - B, azMin = -135, azMax = 135, elMax = 90;
  var X = function (a) { return L + (a - azMin) / (azMax - azMin) * pw; }, Y = function (e) { return T + ph - (e / elMax) * ph; };
  var ink2 = css("--ink-2"), line = css("--line"), ink = css("--ink"), surface = css("--surface");
  g.lineWidth = 1; g.strokeStyle = line; g.fillStyle = ink2; g.font = "500 11px " + css("--f-mono");
  for (var e = 0; e <= 90; e += 15) { g.beginPath(); g.moveTo(L, Y(e)); g.lineTo(L + pw, Y(e)); g.stroke(); g.textAlign = "right"; g.fillText(e + "°", L - 6, Y(e) + 4); }
  [[-120, "−120"], [-90, "E"], [-60, "−60"], [-30, "−30"], [0, "S"], [30, "30"], [60, "60"], [90, "O"], [120, "120"]].forEach(function (t) {
    g.beginPath(); g.moveTo(X(t[0]), T); g.lineTo(X(t[0]), T + ph); g.stroke();
    g.textAlign = "center"; g.fillStyle = /[A-Z]/.test(t[1]) ? ink : ink2; g.fillText(t[1], X(t[0]), h - 8);
  });
  function poly(pts) {
    var on = false; g.beginPath();
    pts.forEach(function (q) { if (q[0] < azMin || q[0] > azMax || q[1] < 0) { on = false; return; } var x = X(q[0]), y = Y(q[1]); on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; });
    g.stroke();
  }
  /* silueta del proyecto comparado */
  function silhouette(points, color, fillA, dashed) {
    var pts = points.filter(function (q) { return q.az >= azMin && q.az <= azMax; }).slice().sort(function (a, b) { return a.az - b.az; });
    if (!pts.length) return;
    if (fillA) {
      g.beginPath(); g.moveTo(X(pts[0].az), Y(0));
      pts.forEach(function (q) { g.lineTo(X(q.az), Y(Math.max(0, q.elev))); });
      g.lineTo(X(pts[pts.length - 1].az), Y(0)); g.closePath();
      g.globalAlpha = fillA; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    }
    g.strokeStyle = color; g.lineWidth = 2; g.setLineDash(dashed ? [5, 4] : []);
    g.beginPath(); pts.forEach(function (q, i) { var x = X(q.az), y = Y(Math.max(0, q.elev)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    g.setLineDash([]);
    if (!dashed) { g.fillStyle = color; pts.forEach(function (q) { g.beginPath(); g.arc(X(q.az), Y(Math.max(0, q.elev)), 3, 0, 7); g.fill(); }); }
  }
  silhouette(p.points, ink, .16, false);
  var cmp = onScreen && S.compareId && db.projects.filter(function (x) { return x.id === S.compareId && x.id !== p.id; })[0];
  if (cmp) silhouette(cmp.points, css("--winter"), .08, true);

  /* porciones del IDAE */
  if (mode === "idae" && window.IDAE) {
    var res = lossResult(), fmap = {};
    res.cells.forEach(function (c) { fmap[c.id] = c.f; });
    var sunc = css("--sun");
    IDAE.ids().forEach(function (id) {
      var o = IDAE.outline(id, p.lat).map(function (q) { return [Math.max(azMin, Math.min(azMax, q[0])), Math.max(0, q[1])]; });
      var any = IDAE.outline(id, p.lat).some(function (q) { return q[1] > 0; }); if (!any) return;
      g.beginPath(); o.forEach(function (q, i) { var x = X(q[0]), y = Y(q[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      if (fmap[id]) { g.globalAlpha = .15 + .55 * fmap[id]; g.fillStyle = sunc; g.fill(); g.globalAlpha = 1; }
      g.strokeStyle = ink2; g.globalAlpha = .55; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
      var c = IDAE.center(id, p.lat);
      if (c[1] > 2) { g.font = "500 9.5px " + css("--f-mono"); g.textAlign = "center"; g.fillStyle = fmap[id] > .5 ? ink : ink2; g.fillText(id, X(c[0]), Y(c[1]) + 3); }
    });    silhouette(p.points, ink, 0, false);
  }
  /* trayectorias */
  if (mode === "idae") { /* solo porciones */ }
  else if (full) {
    g.strokeStyle = ink2; g.globalAlpha = .45; g.lineWidth = 1; g.setLineDash([2, 3]);
    for (var hr = 6; hr <= 18; hr++) { var ln = []; for (var d = -23.44; d <= 23.45; d += 1) ln.push(sunPos(p.lat, d, (hr - 12) * 15)); poly(ln); }
    g.setLineDash([]); g.globalAlpha = 1;
  }
  if (mode !== "idae") MONTHS.forEach(function (m) {
    if (!full && !m.main) return;
    g.strokeStyle = monthColor(m.d); g.lineWidth = m.main ? 2.2 : 1.3; poly(sunPath(p.lat, m.d));
  });
  if (full) {
    g.font = "500 10.5px " + css("--f-mono"); g.lineWidth = 3; g.lineJoin = "round"; g.strokeStyle = surface;
    function label(t, x, y, color) { g.strokeText(t, x, y); g.fillStyle = color; g.fillText(t, x, y); }
    g.textAlign = "center";
    for (var hh = 7; hh <= 17; hh++) { var q = sunPos(p.lat, 23.44, (hh - 12) * 15); if (q[1] > 3 && q[0] >= azMin && q[0] <= azMax) label(hh + "h", X(q[0]), Y(q[1]) - 6, ink2); }
    g.textAlign = "left";
    MONTHS.forEach(function (m) { var q = sunPos(p.lat, m.d, 0); label(m.l, X(0) + 5, Y(q[1]) + 12, monthColor(m.d)); });
  }
  if (!onScreen) return;
  /* claves */
  var k = '<span><i style="background:' + ink + ';opacity:.6"></i>' + escapeHtml(p.name) + '</span>';
  if (cmp) k += '<span><i style="background:' + css("--winter") + ';opacity:.6"></i>' + escapeHtml(cmp.name) + '</span>';
  $("chartKeys").innerHTML = k;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function fillCompare() {
  var sel = $("inCompare"), cur = S.compareId;
  sel.innerHTML = '<option value="">Ninguno</option>';
  db.projects.forEach(function (x) { if (x.id === db.currentId) return; var o = document.createElement("option"); o.value = x.id; o.textContent = x.name + " (" + x.points.length + " pt)"; sel.appendChild(o); });
  sel.value = cur && sel.querySelector('option[value="' + cur + '"]') ? cur : "";
  sel.parentElement.hidden = db.projects.length < 2;
}
$("inCompare").addEventListener("change", function () { S.compareId = this.value; save(); drawChart(); });
function setMode(m) {
  S.chartMode = m; save();
  $("modeSimple").setAttribute("aria-pressed", String(m === "simple")); $("modeFull").setAttribute("aria-pressed", String(m === "full"));
  $("modeIdae").setAttribute("aria-pressed", String(m === "idae"));
  $("noteFull").hidden = m !== "full"; $("noteIdae").hidden = m !== "idae"; drawChart();
}
$("modeIdae").addEventListener("click", function () { setMode("idae"); });
$("modeSimple").addEventListener("click", function () { setMode("simple"); });
$("modeFull").addEventListener("click", function () { setMode("full"); });
window.addEventListener("resize", function () { if (currentView === "chart") drawChart(); });

/* ---------------- Pérdidas por sombras (IDAE) ---------------- */
function lossTable() {
  var p = proj();
  if (p.idaeTable && p.idaeTable !== "auto") for (var i = 0; i < IDAE.TABLES.length; i++) if (IDAE.TABLES[i].id === p.idaeTable) return IDAE.TABLES[i];
  return IDAE.pick(p.beta, p.alphaMod);
}
function lossResult() { var p = proj(); return IDAE.compute(p.points, p.lat, lossTable()); }
function tLabel(t) { return "Tabla " + t.id + " · β " + t.beta + "°" + (t.beta ? ", α " + (t.alpha > 0 ? "+" : "") + t.alpha + "°" : ""); }
function renderLoss() {
  if (!window.IDAE) { $("lossPanel").hidden = true; return; }
  var p = proj(), t = lossTable(), auto = IDAE.pick(p.beta, p.alphaMod);
  $("inBeta").value = p.beta; $("inAlpha").value = p.alphaMod; $("inCase").value = p.idaeCase;
  var sel = $("inTable"); sel.innerHTML = "";
  var o = document.createElement("option"); o.value = "auto"; o.textContent = "Automática (" + auto.id + ")"; sel.appendChild(o);
  IDAE.TABLES.forEach(function (x) { var op = document.createElement("option"); op.value = x.id; op.textContent = tLabel(x); sel.appendChild(op); });
  sel.value = p.idaeTable || "auto";
  var r = IDAE.compute(p.points, p.lat, t), lim = IDAE.LIMITS.filter(function (l) { return l.key === p.idaeCase; })[0] || IDAE.LIMITS[0];
  var has = p.points.length > 0;
  $("lossVal").textContent = has ? r.total.toFixed(1).replace(".", ",") : "–";
  var pill = $("lossPill");
  if (!has) { pill.className = "pill"; pill.textContent = "Mida el perfil de obstáculos para calcular las pérdidas"; }
  else if (r.total <= lim.max) { pill.className = "pill ok"; pill.textContent = "Cumple el límite del " + lim.max + " % (" + lim.name.toLowerCase() + ")"; }
  else { pill.className = "pill bad"; pill.textContent = "Supera el límite del " + lim.max + " % (" + lim.name.toLowerCase() + ")"; }
  var notes = [tLabel(t) + "."];
  if (Math.abs(t.beta - p.beta) > 12 || (t.beta && Math.abs(t.alpha - p.alphaMod) > 15)) notes.push("La superficie no coincide bien con ninguna tabla; el resultado es orientativo.");
  if (t.note) notes.push(t.note);
  notes.push("Las tablas del pliego están calculadas para la Península; en Canarias el resultado es una aproximación.");
  $("tableNote").textContent = notes.join(" ");
  var tb = $("lossBody"); tb.textContent = "";
  r.cells.filter(function (c) { return c.f >= 0.02; }).forEach(function (c) {
    var tr = document.createElement("tr");
    [c.id, Math.round(c.f * 100) + " %", c.fill.toFixed(2).replace(".", ","), c.v.toFixed(2).replace(".", ","), c.loss.toFixed(2).replace(".", ",")].forEach(function (v, i) {
      var td = document.createElement("td"); td.textContent = v; if (i === 4 && !c.fill) td.className = "zero"; tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  $("lossFoot").textContent = r.total.toFixed(2).replace(".", ",") + " %";
  $("lossTableWrap").hidden = !r.cells.some(function (c) { return c.f >= 0.02; });
  $("lossExact").textContent = has ? "Con la fracción tapada exacta de cada porción, sin redondear el factor de llenado: " + r.exact.toFixed(2).replace(".", ",") + " %." : "";
}
function onLossInput() {
  var p = proj();
  var b = parseFloat($("inBeta").value), a = parseFloat($("inAlpha").value);
  if (!isNaN(b)) p.beta = Math.max(0, Math.min(90, b));
  if (!isNaN(a)) p.alphaMod = Math.max(-90, Math.min(90, a));
  p.idaeTable = $("inTable").value; p.idaeCase = $("inCase").value;
  touch(); renderLoss(); drawChart();
}
["inBeta", "inAlpha", "inTable", "inCase"].forEach(function (id) { $(id).addEventListener("change", onLossInput); });

/* ---------------- Ajustes ---------------- */
function renderSettings() {
  var p = proj();
  $("inLat").value = p.lat.toFixed(4); $("inDecl").value = p.decl.toFixed(1);
  $("inAvg").value = String(S.avg); $("inDelay").value = String(S.delay);
  $("inTap").checked = !!S.tap; $("inPhoto").checked = !!S.photos; $("inVol").checked = !!S.vol; $("volRow").hidden = !isNative;
  gpsInfo();
  calInfo();
  document.querySelectorAll("[data-theme-opt]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.themeOpt === S.theme)); });
}
function gpsInfo() {
  var p = proj();
  $("gpsInfo").textContent = (p.lat >= 0 ? fmt(p.lat, 4) + "° N" : fmt(-p.lat, 4) + "° S") + ", " + (p.lon >= 0 ? fmt(p.lon, 4) + "° E" : fmt(-p.lon, 4) + "° O") +
    " · declinación " + fmt(p.decl, 1) + "° (" + (p.declSource === "wmm" ? "WMM2025" : "manual") + ")" + (p.acc ? " · precisión ±" + Math.round(p.acc) + " m" : "");
}
$("inLat").addEventListener("change", function () { var v = parseFloat(this.value); if (!isNaN(v) && Math.abs(v) <= 90) { proj().lat = v; touch(); gpsInfo(); } });
$("inDecl").addEventListener("change", function () { var v = parseFloat(this.value); if (!isNaN(v)) { proj().decl = v; proj().declSource = "manual"; touch(); gpsInfo(); } });
$("inAvg").addEventListener("change", function () { S.avg = +this.value; save(); });
$("inDelay").addEventListener("change", function () { S.delay = +this.value; save(); });
$("inTap").addEventListener("change", function () { S.tap = this.checked; save(); applyTap(); });
$("inVol").addEventListener("change", function () { S.vol = this.checked; save(); });
$("inPhoto").addEventListener("change", function () { S.photos = this.checked; save(); });
function applyTap() { $("tapzone").hidden = !S.tap; }

function locate(silent) {
  if (!navigator.geolocation) { if (!silent) toast("Este dispositivo no ofrece ubicación"); return; }
  if (!silent) { $("btnGps").disabled = true; $("gpsInfo").textContent = "Buscando señal GPS…"; }
  navigator.geolocation.getCurrentPosition(function (pos) {
    var p = proj(), c = pos.coords;
    p.lat = +c.latitude.toFixed(5); p.lon = +c.longitude.toFixed(5); p.acc = c.accuracy;
    var d = wmmDecl(p.lat, p.lon); if (d != null) { p.decl = +d.toFixed(1); p.declSource = "wmm"; }
    touch(); $("btnGps").disabled = false;
    if (currentView === "settings") renderSettings();
    if (!silent) toast("Ubicación actualizada · declinación " + fmt(p.decl, 1) + "°");
  }, function (err) {
    $("btnGps").disabled = false;
    if (!silent) { gpsInfo(); toast(err.code === 1 ? "Permiso de ubicación denegado" : "No se ha podido obtener la ubicación", 3200); }
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
}
$("btnGps").addEventListener("click", function () { locate(false); });
function maybeAutoGps() {
  try { navigator.permissions.query({ name: "geolocation" }).then(function (r) { if (r.state === "granted") locate(true); }); } catch (e) {}
}

$("btnCal").addEventListener("click", function () {
  var a = average(2000);
  if (!a) { toast("Sin datos de los sensores"); return; }
  if (a.raw > -80) { toast("Coloque el móvil boca arriba y plano antes de calibrar", 3200); return; }
  S.offset = +(-90 - a.raw).toFixed(2); save(); calInfo(); toast("Corrección guardada");
});
$("btnCalReset").addEventListener("click", function () { S.offset = 0; save(); calInfo(); toast("Corrección eliminada"); });
function calInfo() { $("calInfo").textContent = S.offset ? "Corrección aplicada: " + sgn(S.offset, 2) + "°" : "Sin corrección aplicada."; }

function applyTheme() {
  var r = document.documentElement;
  if (S.theme === "system") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", S.theme);
  if (currentView === "chart") drawChart();
}
document.querySelectorAll("[data-theme-opt]").forEach(function (b) {
  b.addEventListener("click", function () { S.theme = b.dataset.themeOpt; save(); applyTheme(); renderSettings(); });
});
if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (currentView === "chart") drawChart(); });

/* ---------------- Informe PDF ---------------- */
function pdfSafe(t) { return String(t).replace(/−/g, "-").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[–—]/g, "-").replace(/β/g, "beta").replace(/α/g, "alfa"); }
function withTheme(theme, fn) {
  var r = document.documentElement, prev = r.getAttribute("data-theme");
  r.setAttribute("data-theme", theme);
  try { return fn(); } finally { if (prev == null) r.removeAttribute("data-theme"); else r.setAttribute("data-theme", prev); }
}
function chartImage(mode, wmm, hmm) {
  return withTheme("light", function () {
    var c = document.createElement("canvas"), w = 640, h = Math.round(640 * hmm / wmm);
    drawChartOn(c, w, h, 2.2, mode, false);
    return c.toDataURL("image/jpeg", 0.9);
  });
}
function blobToDataURL(b) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(b); }); }

async function buildReport() {
  var J = window.jspdf && window.jspdf.jsPDF; if (!J) throw new Error("jsPDF no disponible");
  var p = proj(), t = lossTable(), r = IDAE.compute(p.points, p.lat, t);
  var lim = IDAE.LIMITS.filter(function (l) { return l.key === p.idaeCase; })[0] || IDAE.LIMITS[0];
  var doc = new J({ unit: "mm", format: "a4" });
  var M = 18, W = 210 - 2 * M, y;
  var INK = [18, 27, 38], INK2 = [85, 98, 116], LINE = [215, 222, 230], SUN = [236, 122, 44], OK = [31, 157, 99], BAD = [194, 65, 45];
  function txt(t, x, yy, o) { doc.text(pdfSafe(t), x, yy, o || {}); }
  function font(st, size, col) { doc.setFont("helvetica", st); doc.setFontSize(size); doc.setTextColor.apply(doc, col || INK); }
  function rule(yy, col) { doc.setDrawColor.apply(doc, col || LINE); doc.setLineWidth(0.25); doc.line(M, yy, M + W, yy); }
  function header() {
    font("bold", 7.5, SUN); txt("CLINÓMETRO SOLAR · ESTUDIO DE SOMBRAS", M, 12);
    font("normal", 7.5, INK2); txt(p.name, M + W, 12, { align: "right" });
    rule(14.5);
  }
  function need(h) { if (y + h > 297 - 20) { doc.addPage(); header(); y = 24; } }
  function section(t) { need(14); font("bold", 12, INK); txt(t, M, y); y += 2.5; rule(y, SUN); y += 6; }
  function table(cols, rows, widths, aligns) {
    var rh = 6.2;
    function head() {
      font("bold", 7.5, INK2); var x = M;
      cols.forEach(function (c, i) { txt(c.toUpperCase(), aligns[i] === "right" ? x + widths[i] - 1 : x + 1, y, { align: aligns[i] === "right" ? "right" : "left" }); x += widths[i]; });
      y += 2; rule(y); y += 4.2;
    }
    head();
    rows.forEach(function (row, k) {
      if (y + rh > 297 - 20) { doc.addPage(); header(); y = 24; head(); }
      font(row.bold ? "bold" : "normal", 9, INK); var x = M;
      row.cells.forEach(function (c, i) { txt(c, aligns[i] === "right" ? x + widths[i] - 1 : x + 1, y, { align: aligns[i] === "right" ? "right" : "left", maxWidth: widths[i] - 2 }); x += widths[i]; });
      y += 1.8; if (k < rows.length - 1) { doc.setDrawColor(235, 239, 243); doc.setLineWidth(0.2); doc.line(M, y, M + W, y); } y += 4.4;
    });
  }
  var dot = function (n, d) { return (n < 0 ? "-" : "") + Math.abs(n).toFixed(d).replace(".", ","); };

  /* ---- Página 1 ---- */
  header(); y = 30;
  font("normal", 26, INK); txt(p.name, M, y); y += 7;
  font("normal", 9.5, INK2);
  txt("Informe generado el " + new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) + " · " + p.points.length + " puntos medidos", M, y); y += 10;

  /* bloque de resultado */
  var ok = r.total <= lim.max, bx = M, bw = W, bh = 30;
  doc.setFillColor(246, 248, 250); doc.setDrawColor.apply(doc, LINE); doc.roundedRect(bx, y, bw, bh, 3, 3, "FD");
  font("bold", 7.5, INK2); txt("PÉRDIDAS POR SOMBRAS · MÉTODO IDAE (ANEXO III)", bx + 6, y + 8);
  font("normal", 30, INK); txt(dot(r.total, 1) + " %", bx + 6, y + 22);
  font("bold", 10, ok ? OK : BAD); txt((ok ? "Cumple" : "No cumple") + " el límite del " + lim.max + " %", bx + 70, y + 14);
  font("normal", 8.5, INK2);
  txt("Caso: " + lim.name.toLowerCase() + ". " + tLabel(t) + ".", bx + 70, y + 19.5, { maxWidth: bw - 76 });
  txt("Fracción tapada exacta, sin redondear: " + dot(r.exact, 2) + " %.", bx + 70, y + 24.5, { maxWidth: bw - 76 });
  y += bh + 8;

  /* datos del estudio */
  section("Datos del estudio");
  var kv = [
    ["Ubicación", dot(Math.abs(p.lat), 4) + "° " + (p.lat >= 0 ? "N" : "S") + ", " + dot(Math.abs(p.lon), 4) + "° " + (p.lon >= 0 ? "E" : "O")],
    ["Declinación magnética", dot(p.decl, 1) + "° (" + (p.declSource === "wmm" ? "modelo WMM2025" : "introducida a mano") + ")"],
    ["Generador fotovoltaico", "inclinación β = " + p.beta + "°, orientación α = " + (p.alphaMod > 0 ? "+" : "") + p.alphaMod + "° (0° = sur, este negativo)"],
    ["Medición", "clinómetro y brújula del teléfono, promedio de " + (S.avg / 1000).toString().replace(".", ",") + " s por punto"]
  ];
  kv.forEach(function (row) { font("normal", 9, INK2); txt(row[0], M, y); font("normal", 9.5, INK); txt(row[1], M + 48, y, { maxWidth: W - 48 }); y += 6.2; });
  y += 4;

  var ch = 92; need(ch + 24);
  section("Perfil de obstáculos sobre las trayectorias solares");
  doc.addImage(chartImage("full", W, ch), "JPEG", M, y, W, ch); y += ch + 4;
  font("normal", 8, INK2);
  txt("Trayectoria del sol el día 21 de cada mes (azul: diciembre; naranja: junio) y horas solares. Zona gris: silueta medida de los obstáculos. Azimut 0° = sur, este negativo.", M, y, { maxWidth: W }); y += 10;

  /* ---- Porciones ---- */
  ch = 92; need(ch + 20);
  section("Porciones del diagrama afectadas");
  doc.addImage(chartImage("idae", W, ch), "JPEG", M, y, W, ch); y += ch + 6;
  var rows = r.cells.filter(function (c) { return c.f >= 0.02; }).map(function (c) {
    return { cells: [c.id, Math.round(c.f * 100) + " %", c.fill.toFixed(2).replace(".", ","), c.v.toFixed(2).replace(".", ","), c.loss.toFixed(2).replace(".", ",")] };
  });
  if (rows.length) {
    rows.push({ bold: true, cells: ["Total", "", "", "", r.total.toFixed(2).replace(".", ",") + " %"] });
    table(["Porción", "Fracción tapada", "Factor de llenado", "Valor tabla (%)", "Pérdida (%)"], rows, [30, 38, 38, 34, W - 140], ["left", "right", "right", "right", "right"]);
  } else { font("normal", 9.5, INK); txt("Ninguna porción queda tapada por el perfil medido.", M, y); y += 8; }
  y += 3; font("normal", 8, INK2);
  var meth = "Método del Anexo III del Pliego de Condiciones Técnicas de Instalaciones Conectadas a Red (IDAE, 2011). La geometría de las porciones se calcula para la latitud del proyecto; los valores proceden de la tabla de referencia indicada, elaborada para la Península Ibérica. El factor de llenado se redondea a 0,25, 0,50, 0,75 o 1 como indica el pliego." + (t.note ? " " + t.note : "");
  need(16); var lines = doc.splitTextToSize(pdfSafe(meth), W); doc.text(lines, M, y); y += lines.length * 3.6 + 6;

  /* ---- Puntos ---- */
  section("Puntos medidos");
  table(["N.º", "Azimut", "Rumbo", "Elevación", "Desv.", "Nota"],
    p.points.map(function (q, i) { return { cells: [String(i + 1), dot(q.az, 1) + "°", dot(q.head, 1) + "°", dot(q.elev, 1) + "°", "±" + q.sd.toFixed(1).replace(".", ",") + "°", q.note || ""] }; }),
    [14, 24, 24, 26, 20, W - 108], ["left", "right", "right", "right", "right", "left"]);

  /* ---- Fotos ---- */
  var withPhoto = p.points.map(function (q, i) { return { q: q, n: i + 1 }; }).filter(function (o) { return o.q.photo; });
  if (withPhoto.length) {
    doc.addPage(); header(); y = 24; section("Fotografías de los puntos");
    var cw = (W - 6) / 2, cols = 2, col = 0, rowH = 0;
    for (var k = 0; k < withPhoto.length; k++) {
      var o = withPhoto[k], b = await Photos.get(o.q.id).catch(function () { return null; });
      if (!b) continue;
      var src = await blobToDataURL(b);
      var shrunk = await new Promise(function (res) {
        var im = new Image();
        im.onload = function () {
          var k = Math.min(1, 720 / Math.max(im.width, im.height)), c = document.createElement("canvas");
          c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          res({ url: c.toDataURL("image/jpeg", 0.72), w: c.width, h: c.height });
        };
        im.onerror = function () { res(null); }; im.src = src;
      });
      if (!shrunk) continue;
      var url = shrunk.url, dims = [shrunk.w, shrunk.h];
      var ih = cw * dims[1] / dims[0]; if (ih > 110) ih = 110;
      var iw = ih * dims[0] / dims[1];
      if (col === 0) { if (y + ih + 10 > 297 - 20) { doc.addPage(); header(); y = 24; } rowH = 0; }
      var x = M + col * (cw + 6) + (cw - iw) / 2;
      doc.addImage(url, "JPEG", x, y, iw, ih);
      font("normal", 8, INK2); txt("Punto " + o.n + " · elevación " + dot(o.q.elev, 1) + "° · azimut " + dot(o.q.az, 0) + "°" + (o.q.note ? " · " + o.q.note : ""), M + col * (cw + 6), y + ih + 4, { maxWidth: cw });
      rowH = Math.max(rowH, ih + 10);
      col++; if (col === cols) { col = 0; y += rowH; }
    }
  }

  /* pies de página */
  var n = doc.getNumberOfPages();
  for (var i = 1; i <= n; i++) {
    doc.setPage(i); rule(297 - 14);
    font("normal", 7.5, INK2); txt("Generado con Clinómetro Solar " + VERSION, M, 297 - 9); txt("Página " + i + " de " + n, M + W, 297 - 9, { align: "right" });
  }
  return doc;
}
async function shareBinary(base64, name, mime) {
  if (isNative) {
    var FS = plugin("Filesystem"), Share = plugin("Share");
    var res = await FS.writeFile({ path: name, data: base64, directory: "CACHE" });
    await Share.share({ title: name, url: res.uri, dialogTitle: "Compartir " + name });
    return;
  }
  var bin = atob(base64), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  var blob = new Blob([arr], { type: mime });
  try { var f = new File([blob], name, { type: mime }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } }
  catch (e) { if (e && e.name === "AbortError") return; }
  var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
$("btnReport").addEventListener("click", async function () {
  $("busy").hidden = false;
  try {
    var doc = await buildReport();
    var b64 = doc.output("datauristring").split(",")[1];
    window.__lastReport = b64;
    $("busy").hidden = true;
    await shareBinary(b64, fileName("pdf"), "application/pdf");
  } catch (e) {
    $("busy").hidden = true;
    if (!/cancel/i.test(String(e && e.message))) { toast("No se ha podido generar el informe"); console.error(e); }
  }
});

/* ---------------- Inicio ---------------- */
$("appVersion").textContent = VERSION + (isNative ? " · Android" : " · web");
applyTheme(); applyTap(); renderCounts(); setMode(S.chartMode || "simple"); show("measure");
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (currentView === "chart") drawChart(); });
})();
