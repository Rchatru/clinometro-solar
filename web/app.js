/* Clinómetro Solar 2.0
   Lógica de la app: sensores, proyectos, diagrama solar y exportación.
   Funciona igual como web (GitHub Pages) y dentro de la app Android (Capacitor). */
(function () {
"use strict";

var VERSION = "2.0.0-beta5";
var D2R = Math.PI / 180, R2D = 180 / Math.PI;
var $ = function (id) { return document.getElementById(id); };
var Cap = window.Capacitor;
var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
var _plugins = {};
var plugin = function (name) {
  if (_plugins[name]) return _plugins[name];
  try { return (_plugins[name] = Cap && Cap.registerPlugin ? Cap.registerPlugin(name) : null); } catch (e) { return null; }
};

/* ---------------- Almacenamiento ---------------- */
var KEY = "cs.v2";
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

var DEFAULT_LOC = { lat: 28.68, lon: -17.77 };
function wmmField(lat, lon) {
  try { return window.Geomag ? Geomag.model(new Date()).point([lat, lon]).f / 1000 : null; } catch (e) { return null; }
}
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

/* ---------------- Corrección al punto de estudio ----------------
   El móvil mide desde un punto y el estudio se hace en otro (p. ej. desde el suelo bajo la pérgola).
   Con la distancia horizontal a cada punto medido se reconstruye su posición en el espacio
   (este, norte, arriba) y se recalculan azimut y elevación vistos desde el punto de estudio. */
function corrCfg(p) {
  if (!p.corr) p.corr = { on: false, dz: 0, dh: 0, dhAz: 0, mode: "point", wallD: null, wallAz: null };
  return p.corr;
}
function corrActive(p) { var c = corrCfg(p); return !!(c.on && (c.dz || c.dh)); }
function distFor(p, q) {
  var c = corrCfg(p);
  if (c.mode === "wall") {
    if (!(c.wallD > 0) || c.wallAz == null) return null;
    var k = Math.cos((q.az - c.wallAz) * D2R);
    return k > 0.17 ? c.wallD / k : null;          /* hasta unos 80° de la perpendicular */
  }
  return q.dist > 0 ? q.dist : null;
}
function correctPoint(p, q) {
  var d = distFor(p, q); if (d == null) return null;
  var c = corrCfg(p), H = (q.az + 180) * D2R, Hd = ((c.dhAz || 0) + 180) * D2R;
  var P = [d * Math.sin(H), d * Math.cos(H), d * Math.tan(q.elev * D2R)];
  var O = [(c.dh || 0) * Math.sin(Hd), (c.dh || 0) * Math.cos(Hd), c.dz || 0];
  var V = [P[0] - O[0], P[1] - O[1], P[2] - O[2]], hz = Math.hypot(V[0], V[1]);
  if (hz < 0.05) return null;
  return { az: norm180(Math.atan2(V[0], V[1]) * R2D - 180), elev: Math.atan2(V[2], hz) * R2D };
}
/* Puntos tal como se ven desde el punto de estudio (los que no tienen distancia se dejan como se midieron) */
function effPoints(p) {
  p = p || proj();
  if (!corrActive(p)) return p.points;
  return p.points.map(function (q) {
    var c = correctPoint(p, q), o = {};
    for (var k in q) o[k] = q[k];
    if (c) { o.az = c.az; o.elev = c.elev; o.corrected = true; } else o.uncorrected = true;
    return o;
  });
}
function missingDist(p) { return corrActive(p) ? p.points.filter(function (q) { return distFor(p, q) == null; }).length : 0; }

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
var sens = { samples: [], absolute: false, gotData: false, started: false, mag: null, magAcc: null };
/* Desviación del campo magnético medido respecto al esperado (WMM); null si no hay magnetómetro */
function magDeviation() {
  if (!sens.mag || performance.now() - sens.mag.t > 3000) return null;
  var F = wmmField(proj().lat, proj().lon); if (!F) return null;
  return (sens.mag.total - F) / F;
}
function startMagnetometer() {
  if (!isNative) return;
  var M = plugin("Magnetometro"); if (!M) return;
  try {
    M.addListener("field", function (d) { sens.mag = { total: d.total, t: performance.now() }; sens.magAcc = d.accuracy; });
    M.addListener("accuracy", function (d) { sens.magAcc = d.accuracy; });
    M.start().catch(function () {});
  } catch (e) {}
}

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
  if (sweep.on) sweep.raw.push({ t: t, e: elev, x: hx, y: hy });
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
  startSensors(); startMagnetometer();
  if (!window.isSecureContext) msg.push("La página debe abrirse con https:// para usar la cámara y los sensores.");
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    var v = $("video"); v.srcObject = stream;
    v.addEventListener("playing", function () { v.hidden = false; document.querySelector(".idle-art").hidden = true; }, { once: true });
    v.play().catch(function () {});
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
  var dev = magDeviation(), mchip = $("chipMag");
  if (dev != null && Math.abs(dev) > 0.15) { mchip.hidden = false; mchip.lastChild.textContent = "Interferencia magnética " + sgn(dev * 100, 0) + " %"; }
  else if (sens.magAcc != null && sens.magAcc <= 1) { mchip.hidden = false; mchip.lastChild.textContent = "Calibre la brújula: mueva el móvil en forma de 8"; }
  else mchip.hidden = true;
  $("tape").hidden = false; drawTape(a.head);
}

/* Cinta de rumbo, como la de un instrumento de navegación */
function drawTape(head) {
  var c = $("tape"), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  var span = 100, ppd = w / span, cx = w / 2, hrgb = css("--hud-rgb"), hacc = css("--hud-accent");
  var grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)"); grad.addColorStop(.18, "rgba(255,255,255,1)"); grad.addColorStop(.82, "rgba(255,255,255,1)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  g.save();
  g.font = "500 11px " + css("--f-mono"); g.textAlign = "center";
  var start = Math.floor((head - span / 2) / 5) * 5;
  for (var d = start; d <= head + span / 2; d += 5) {
    var x = cx + (d - head) * ppd, n = norm360(d), major = n % 45 === 0, mid = n % 15 === 0;
    g.strokeStyle = "rgba(" + hrgb + "," + (major ? .95 : mid ? .7 : .4) + ")"; g.lineWidth = major ? 1.6 : 1;
    g.beginPath(); g.moveTo(x, h - 2); g.lineTo(x, h - (major ? 14 : mid ? 10 : 6)); g.stroke();
    if (major) { g.fillStyle = n === 180 ? hacc : "rgba(" + hrgb + ",.95)"; g.font = "600 12px " + css("--f-ui"); g.fillText(CARD[n / 22.5], x, h - 19); }
    else if (mid) { g.fillStyle = "rgba(" + hrgb + ",.6)"; g.font = "500 10px " + css("--f-mono"); g.fillText(String(n), x, h - 19); }
  }
  /* puntos guardados */
  g.fillStyle = hacc;
  proj().points.forEach(function (p) {
    var dd = norm180(p.head - head); if (Math.abs(dd) > span / 2) return;
    g.beginPath(); g.arc(cx + dd * ppd, 5, 3, 0, 7); g.fill();
  });
  g.globalCompositeOperation = "destination-in"; g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.restore();
  g.fillStyle = css("--reticle"); g.beginPath(); g.moveTo(cx - 5, h); g.lineTo(cx + 5, h); g.lineTo(cx, h - 7); g.closePath(); g.fill();
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
  var md = magDeviation(); if (md != null) pt.mag = +md.toFixed(3);
  p.points.push(pt);
  touch(); haptic();
  if (S.photos) capturePhoto(pt, p.points.length).then(function (b) {
    if (!b) return; return Photos.put(pt.id, b).then(function () { pt.photo = true; touch(); });
  }).catch(function () {});
  renderCounts();
  toast("Punto " + p.points.length + ": " + fmt(a.elev, 1) + "° a " + sgn(Math.round(a.az), 0) + "°" + (a.sd > 0.8 ? " · lectura poco estable" : "") +
    (pt.mag != null && Math.abs(pt.mag) > 0.15 ? " · azimut dudoso por interferencia magnética" : ""), pt.mag != null && Math.abs(pt.mag) > 0.15 ? 3500 : 2400);
}
/* ---------------- Barrido ----------------
   Manteniendo pulsado el disparador se registran todas las lecturas mientras se recorre el borde del obstáculo.
   Al soltar: se descartan los tramos con giro rápido, se agrupa por grados de azimut (mediana) y se simplifica
   el perfil (Douglas-Peucker) para quedarse con los puntos que definen la forma. */
var sweep = { on: false, raw: [], timer: null, pointer: false };
function sweepStart() {
  if (!sens.started || counting) return;
  sweep.on = true; sweep.raw = []; haptic();
  $("btnSave").classList.add("sweeping"); $("chipSweep").hidden = false;
}
function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  var a = pts[0], b = pts[pts.length - 1], dmax = 0, idx = 0;
  for (var i = 1; i < pts.length - 1; i++) {
    var p = pts[i], dx = b.az - a.az, dy = b.elev - a.elev, L = Math.hypot(dx, dy) || 1;
    var d = Math.abs(dy * p.az - dx * p.elev + b.az * a.elev - b.elev * a.az) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}
function sweepEnd() {
  sweep.on = false; $("btnSave").classList.remove("sweeping"); $("chipSweep").hidden = true;
  var raw = sweep.raw; sweep.raw = [];
  if (raw.length < 10) { toast("Barrido demasiado corto"); return; }
  var t0 = raw[0].t, t1 = raw[raw.length - 1].t, decl = proj().decl, smp = [];
  raw.forEach(function (r) {
    if (r.t - t0 < 150 || t1 - r.t < 150) return;              /* inicio y final del gesto */
    var head = norm360(Math.atan2(r.x, r.y) * R2D + decl);
    smp.push({ t: r.t, az: norm180(head - 180), head: head, elev: r.e + S.offset });
  });
  var keep = smp.filter(function (q, i) {                         /* fuera los giros rápidos (> 30°/s) */
    var o = smp[i - 1] || smp[i + 1]; if (!o) return true;
    var dt = Math.abs(q.t - o.t) / 1000 || 0.016;
    return Math.hypot(norm180(q.az - o.az), q.elev - o.elev) / dt < 30;
  });
  var bins = {};
  keep.forEach(function (q) { var k = Math.round(q.az); (bins[k] = bins[k] || []).push(q); });
  var prof = Object.keys(bins).map(Number).sort(function (a, b) { return a - b; }).filter(function (k) { return bins[k].length >= 2; }).map(function (k) {
    var es = bins[k].map(function (q) { return q.elev; }), m = median(es);
    var sd = Math.sqrt(es.reduce(function (s, e) { return s + (e - m) * (e - m); }, 0) / es.length);
    return { az: k, elev: m, sd: sd, head: norm360(k + 180) };
  });
  if (prof.length < 2 || prof[prof.length - 1].az - prof[0].az < 3) { toast("Barrido demasiado corto: recorra al menos unos grados de azimut", 3200); return; }
  var pts = simplify(prof, 0.6), p = proj(), batch = uid(), md = magDeviation();
  pts.forEach(function (q) {
    var pt = { id: uid(), az: +q.az.toFixed(1), head: +q.head.toFixed(1), elev: +q.elev.toFixed(1), sd: +q.sd.toFixed(2), note: "barrido", t: Date.now(), abs: sens.absolute, batch: batch };
    if (md != null) pt.mag = +md.toFixed(3);
    p.points.push(pt);
  });
  touch(); haptic(); renderCounts();
  toast("Barrido: " + pts.length + " puntos a partir de " + keep.length + " lecturas", 3000);
}
var sb = $("btnSave");
sb.addEventListener("pointerdown", function (e) {
  if (sb.disabled) return;
  sweep.pointer = true; try { sb.setPointerCapture(e.pointerId); } catch (x) {}
  clearTimeout(sweep.timer); sweep.timer = setTimeout(sweepStart, 400);
});
function release() {
  if (!sweep.pointer) return; sweep.pointer = false; clearTimeout(sweep.timer);
  if (sweep.on) sweepEnd(); else trigger();
}
sb.addEventListener("pointerup", release);
sb.addEventListener("pointercancel", function () { sweep.pointer = false; clearTimeout(sweep.timer); if (sweep.on) sweepEnd(); });
sb.addEventListener("contextmenu", function (e) { e.preventDefault(); });
sb.addEventListener("click", function (e) { if (e.detail === 0) trigger(); });   /* teclado */
$("tapzone").addEventListener("click", trigger);
$("btnUndo").addEventListener("click", function () {
  var p = proj(); if (!p.points.length) return;
  var last = p.points[p.points.length - 1], gone = [];
  if (last.batch) { gone = p.points.filter(function (q) { return q.batch === last.batch; }); p.points = p.points.filter(function (q) { return q.batch !== last.batch; }); }
  else gone = [p.points.pop()];
  touch(); renderCounts(); toast(gone.length > 1 ? "Barrido eliminado (" + gone.length + " puntos)" : "Último punto eliminado");
  Photos.del(gone.filter(function (q) { return q.photo; }).map(function (q) { return q.id; }));
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
  if (v === "chart") { fillCompare(); renderLoss(); drawChart(); renderCalendar(); renderQuery(); renderPvgis(); }
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
    if (corrActive(p)) {
      var cc = correctPoint(p, q), box = document.createElement("div"); box.className = "p-corr";
      if (corrCfg(p).mode === "point") {
        var lab = document.createElement("label"); lab.className = "p-dist"; lab.textContent = "Distancia";
        var di = document.createElement("input"); di.type = "number"; di.step = "0.1"; di.min = "0"; di.inputMode = "decimal"; di.id = "dist-" + i;
        di.value = q.dist > 0 ? q.dist : ""; di.placeholder = "m";
        di.addEventListener("change", function () { var v = parseFloat(di.value); q.dist = v > 0 ? v : null; touch(); renderPoints(); });
        lab.appendChild(di); box.appendChild(lab);
      } else if (distFor(p, q) != null) {
        var sp = document.createElement("span"); sp.textContent = "Distancia " + fmt(distFor(p, q), 1) + " m"; box.appendChild(sp);
      }
      var res = document.createElement("span");
      if (cc) res.innerHTML = "Desde el punto de estudio: <b>" + sgn(cc.az, 0) + "° · " + fmt(cc.elev, 1) + "°</b>";
      else { res.className = "warn"; res.textContent = corrCfg(p).mode === "wall" ? "Fuera de la fachada: sin corregir" : "Sin distancia: sin corregir"; }
      box.appendChild(res); li.appendChild(box);
    }
    if (q.mag != null && Math.abs(q.mag) > 0.15) {
      var mw = document.createElement("div"); mw.className = "p-corr"; mw.innerHTML = '<span class="warn">Azimut dudoso: campo magnético alterado ' + sgn(q.mag * 100, 0) + ' %</span>'; li.appendChild(mw);
    }
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
  var corr = corrActive(p), ef = effPoints(p), dec = function (v, d) { return v == null ? "" : v.toFixed(d).replace(".", ","); };
  var head = ["n", "azimut_sur_deg", "rumbo_norte_deg", "elevacion_deg", "desviacion_deg", "nota", "fecha_hora", "ref_norte"];
  if (corr) head = head.concat(["distancia_m", "azimut_corregido_deg", "elevacion_corregida_deg"]);
  var rows = [head];
  p.points.forEach(function (q, i) {
    var r = [i + 1, dec(q.az, 1), dec(q.head, 1), dec(q.elev, 1), dec(q.sd, 2),
      (q.note || "").replace(/[;\t\r\n]/g, " "), new Date(q.t).toISOString(), q.abs ? "si" : "no"];
    if (corr) r = r.concat([dec(distFor(p, q), 2), ef[i].corrected ? dec(ef[i].az, 1) : "", ef[i].corrected ? dec(ef[i].elev, 1) : ""]);
    rows.push(r);
  });
  return "# " + p.name + " | latitud " + p.lat.toFixed(4) + " | longitud " + p.lon.toFixed(4) + " | declinacion " + p.decl.toFixed(1) + "\r\n" +
    rows.map(function (r) { return r.join(sep); }).join("\r\n");
}
function fileName(ext) { return proj().name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "") + "_" + new Date().toISOString().slice(0, 10) + "." + ext; }
async function shareText(text, name, mime) {
  if (isNative) {
    var FS = plugin("Filesystem"), Share = plugin("Share");
    var r = await FS.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
    await Share.share({ title: name, files: [r.uri], dialogTitle: "Exportar " + name });
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
  shareText(csvText(";"), fileName("csv"), "text/csv").catch(function (e) { if (!/cancel/i.test(String(e && e.message))) toast("No se ha podido exportar: " + (e && e.message || e), 5000); });
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
  silhouette(effPoints(p), ink, .16, false);
  var cmp = onScreen && S.compareId && db.projects.filter(function (x) { return x.id === S.compareId && x.id !== p.id; })[0];
  if (cmp) silhouette(effPoints(cmp), css("--winter"), .08, true);

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
    });    silhouette(effPoints(p), ink, 0, false);
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
  if (onScreen && query) {
    var sq = solarAt(query, p.lat, p.lon);
    if (sq.el > 0 && sq.az >= azMin && sq.az <= azMax) {
      var sx = X(sq.az), sy = Y(sq.el);
      g.fillStyle = css("--sun"); g.strokeStyle = surface; g.lineWidth = 2.5;
      g.beginPath(); g.arc(sx, sy, 7, 0, 7); g.fill(); g.stroke();
      g.strokeStyle = css("--sun"); g.lineWidth = 1.6;
      for (var ri = 0; ri < 8; ri++) { var an = ri * Math.PI / 4; g.beginPath(); g.moveTo(sx + Math.cos(an) * 10, sy + Math.sin(an) * 10); g.lineTo(sx + Math.cos(an) * 14, sy + Math.sin(an) * 14); g.stroke(); }
    }
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
window.addEventListener("resize", function () { if (currentView === "chart") { drawChart(); renderCalendar(); } });

/* ---------------- Calendario de sombras y posición del sol ---------------- */
/* Posición del sol para una fecha y hora reales (algoritmo simplificado del Almanaque Astronómico, ±0,1°) */
function solarAt(date, lat, lon) {
  var n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  var L = (280.460 + 0.9856474 * n) % 360, g = (357.528 + 0.9856003 * n) * D2R;
  var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, eps = (23.439 - 0.0000004 * n) * D2R;
  var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * R2D, dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * R2D;
  var gmst = (280.46061837 + 360.98564736629 * n) % 360;
  var H = norm180(gmst + lon - ra);
  var r = sunPos(lat, dec, H);
  return { az: r[0], el: r[1], dec: dec, H: H };
}
var MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
var CAL = { h0: 6, h1: 21, step: 30 };        /* columnas de media hora, de 6:00 a 21:00 */
var query = null;                              /* { date } consultada por el usuario */

/* Matriz mes × franja: -1 sol bajo el horizonte; 0…1 fracción en sombra */
function calendarData(p) {
  var prof = IDAE.profileFn(effPoints(p)), y = new Date().getFullYear(), cols = (CAL.h1 - CAL.h0) * 60 / CAL.step, out = [];
  for (var m = 0; m < 12; m++) {
    var row = [];
    for (var c = 0; c < cols; c++) {
      var up = 0, sh = 0;
      for (var k = 0; k < 3; k++) {
        var min = CAL.h0 * 60 + c * CAL.step + (k + .5) * CAL.step / 3;
        var s = solarAt(new Date(y, m, 15, Math.floor(min / 60), min % 60), p.lat, p.lon);
        if (s.el > 0) { up++; if (s.el < prof(s.az)) sh++; }
      }
      row.push(up ? sh / up : -1);
    }
    out.push(row);
  }
  return out;
}
var calGeom = null;
function drawCalendarOn(c, w, h, dpr, onScreen) {
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (!onScreen) { g.fillStyle = css("--surface"); g.fillRect(0, 0, w, h); }
  var p = proj(), data = calendarData(p), cols = data[0].length;
  var L = 30, T = 18, R = 4, B = 4, cw = (w - L - R) / cols, rh = (h - T - B) / 12;
  var sun = css("--cal-sun"), shade = css("--cal-shade"), night = css("--cal-night"), ink2 = css("--ink-2");
  g.font = "500 10.5px " + css("--f-mono"); g.fillStyle = ink2;
  g.textAlign = "center";
  for (var hh = CAL.h0; hh <= CAL.h1; hh += 2) g.fillText(String(hh), L + (hh - CAL.h0) * 60 / CAL.step * cw, 11);
  g.textAlign = "right";
  var shadeSlots = 0, sunSlots = 0;
  data.forEach(function (row, m) {
    g.fillStyle = ink2; g.fillText(MES[m], L - 5, T + m * rh + rh / 2 + 4);
    row.forEach(function (v, k) {
      var x = L + k * cw, y = T + m * rh;
      g.fillStyle = v < 0 ? night : v === 0 ? sun : v >= 1 ? shade : mix(sun, shade, .25 + .6 * v);
      g.fillRect(x + .5, y + .5, cw - 1, rh - 1);
      if (v >= 0) { sunSlots++; shadeSlots += v; }
    });
  });
  /* mediodía de cada mes: línea fina */
  if (query) {
    var qm = query.getMonth(), qmin = query.getHours() * 60 + query.getMinutes(), qx = L + (qmin - CAL.h0 * 60) / CAL.step * cw;
    if (qx >= L && qx <= w - R) {
      g.strokeStyle = css("--sun-ink"); g.lineWidth = 2;
      g.strokeRect(qx - 3, T + qm * rh + 1, 6, rh - 2);
    }
  }
  if (onScreen) calGeom = { L: L, T: T, cw: cw, rh: rh, cols: cols };
  return { shadeH: shadeSlots * CAL.step / 60, sunH: sunSlots * CAL.step / 60 };
}
function renderCalendar() {
  var c = $("cal"), w = c.clientWidth; if (!w) return;
  var r = drawCalendarOn(c, w, c.clientHeight, window.devicePixelRatio || 1, true), p = proj();
  $("calSummary").textContent = p.points.length ?
    "En los días representados, el obstáculo tapa el sol " + fmt(r.shadeH, 1) + " h de " + fmt(r.sunH, 1) + " h de sol (" + fmt(100 * r.shadeH / Math.max(1, r.sunH), 0) + " %). Es tiempo de sol, no energía: una hora de invierno al amanecer pesa mucho menos que una de mediodía."
    : "Mida el perfil de obstáculos para ver en qué meses y horas hay sombra.";
}
$("cal").addEventListener("click", function (e) {
  if (!calGeom) return;
  var r = this.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  var k = Math.floor((x - calGeom.L) / calGeom.cw), m = Math.floor((y - calGeom.T) / calGeom.rh);
  if (k < 0 || k >= calGeom.cols || m < 0 || m > 11) return;
  var min = CAL.h0 * 60 + k * CAL.step + CAL.step / 2;
  setQuery(new Date(new Date().getFullYear(), m, 15, Math.floor(min / 60), min % 60));
});
function pad(n) { return String(n).padStart(2, "0"); }
function setQuery(d) {
  query = d;
  $("inQDate").value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  $("inQTime").value = pad(d.getHours()) + ":" + pad(d.getMinutes());
  renderQuery(); renderCalendar(); drawChart();
}
function onQueryInput() {
  var dv = $("inQDate").value, tv = $("inQTime").value; if (!dv || !tv) return;
  var a = dv.split("-").map(Number), b = tv.split(":").map(Number);
  query = new Date(a[0], a[1] - 1, a[2], b[0], b[1]); renderQuery(); renderCalendar(); drawChart();
}
$("inQDate").addEventListener("change", onQueryInput); $("inQTime").addEventListener("change", onQueryInput);
$("btnNow").addEventListener("click", function () { var d = new Date(); d.setSeconds(0, 0); setQuery(d); });
function renderQuery() {
  var out = $("queryRes");
  if (!query) { out.innerHTML = ""; return; }
  var p = proj(), s = solarAt(query, p.lat, p.lon), h = IDAE.profileFn(effPoints(p))(s.az);
  var when = query.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + " a las " + pad(query.getHours()) + ":" + pad(query.getMinutes());
  var st = s.el <= 0 ? '<span class="st night">Sol bajo el horizonte</span>' : s.el < h ? '<span class="st shade">En sombra</span>' : '<span class="st sun">Sol directo</span>';
  out.innerHTML = escapeHtml(when) + ": sol a <b>" + fmt(s.el, 1) + "°</b> de altura y <b>" + sgn(s.az, 0) + "°</b> de azimut" +
    (s.el > 0 && h > 0 ? "; el obstáculo llega a <b>" + fmt(h, 1) + "°</b> en esa dirección" : "") + ".<br>" + st;
}

/* ---------------- Pérdidas por sombras (IDAE) ---------------- */
function lossTable() {
  var p = proj();
  if (p.idaeTable && p.idaeTable !== "auto") for (var i = 0; i < IDAE.TABLES.length; i++) if (IDAE.TABLES[i].id === p.idaeTable) return IDAE.TABLES[i];
  return IDAE.pick(p.beta, p.alphaMod);
}
function lossResult() { var p = proj(); return IDAE.compute(effPoints(p), p.lat, lossTable()); }
function tLabel(t) { return "Tabla " + t.id + " · β " + t.beta + "°" + (t.beta ? ", α " + (t.alpha > 0 ? "+" : "") + t.alpha + "°" : ""); }
function renderLoss() {
  if (!window.IDAE) { $("lossPanel").hidden = true; return; }
  var p = proj(), t = lossTable(), auto = IDAE.pick(p.beta, p.alphaMod);
  $("inBeta").value = p.beta; $("inAlpha").value = p.alphaMod; $("inCase").value = p.idaeCase;
  var sel = $("inTable"); sel.innerHTML = "";
  var o = document.createElement("option"); o.value = "auto"; o.textContent = "Automática (" + auto.id + ")"; sel.appendChild(o);
  IDAE.TABLES.forEach(function (x) { var op = document.createElement("option"); op.value = x.id; op.textContent = tLabel(x); sel.appendChild(op); });
  sel.value = p.idaeTable || "auto";
  var r = IDAE.compute(effPoints(p), p.lat, t), lim = IDAE.LIMITS.filter(function (l) { return l.key === p.idaeCase; })[0] || IDAE.LIMITS[0];
  var has = p.points.length > 0;
  $("lossVal").textContent = has ? r.total.toFixed(1).replace(".", ",") : "–";
  var pill = $("lossPill");
  if (!has) { pill.className = "pill"; pill.textContent = "Mida el perfil de obstáculos para calcular las pérdidas"; }
  else if (r.total <= lim.max) { pill.className = "pill ok"; pill.textContent = "Cumple el límite del " + lim.max + " % (" + lim.name.toLowerCase() + ")"; }
  else { pill.className = "pill bad"; pill.textContent = "Supera el límite del " + lim.max + " % (" + lim.name.toLowerCase() + ")"; }
  var notes = [tLabel(t) + "."];
  if (corrActive(p)) notes.push("Puntos corregidos al punto de estudio" + (missingDist(p) ? "; " + missingDist(p) + " sin distancia se usan tal como se midieron" : "") + ".");
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

/* ---------------- Producción con PVGIS ----------------
   PVGIS no admite consultas desde páginas web (CORS), así que en la app Android se usa el cliente HTTP nativo. */
var PVGIS = "https://re.jrc.ec.europa.eu/api/v5_3/";
async function pvgisGet(path, params) {
  var q = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
  var url = PVGIS + path + "?" + q;
  if (isNative) {
    var H = plugin("CapacitorHttp");
    var r = await H.get({ url: url, connectTimeout: 30000, readTimeout: 60000 });
    var d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    if (r.status !== 200) throw new Error((d && d.message) || "PVGIS respondió " + r.status);
    return d;
  }
  var res = await fetch(url);
  var data = await res.json();
  if (!res.ok) throw new Error(data.message || "PVGIS respondió " + res.status);
  return data;
}
/* Horizonte para PVGIS: 36 alturas cada 10°, empezando por el norte y en sentido horario.
   Se toma el mayor entre el relieve que da PVGIS y los obstáculos medidos. */
function horizonFor(p, terrain) {
  var prof = IDAE.profileFn(effPoints(p)), out = [];
  var ter = (terrain || []).slice().sort(function (a, b) { return a.A - b.A; });
  function terr(az) {
    if (!ter.length) return 0;
    for (var i = 1; i < ter.length; i++) if (az <= ter[i].A) { var a = ter[i - 1], b = ter[i]; return a.H_hor + (b.H_hor - a.H_hor) * (az - a.A) / ((b.A - a.A) || 1); }
    return ter[ter.length - 1].H_hor;
  }
  for (var i = 0; i < 36; i++) { var az = norm180(i * 10 - 180); out.push(Math.max(0, Math.round(Math.max(terr(az), prof(az)) * 10) / 10)); }
  return out;
}
async function runPvgis() {
  var p = proj();
  if (!p.points.length) { toast("Mida primero el perfil de obstáculos"); return; }
  var btn = $("btnPvgis"); btn.disabled = true; btn.textContent = "Consultando PVGIS…";
  try {
    var base = { lat: p.lat, lon: p.lon, peakpower: p.kwp || 1, loss: p.sysLoss == null ? 14 : p.sysLoss, angle: p.beta, aspect: p.alphaMod, outputformat: "json" };
    var hz = await pvgisGet("printhorizon", { lat: p.lat, lon: p.lon, outputformat: "json" });
    var terrain = hz.outputs && hz.outputs.horizon_profile || [];
    var r0 = await pvgisGet("PVcalc", base);
    var withObs = {}; for (var k in base) withObs[k] = base[k];
    withObs.userhorizon = horizonFor(p, terrain).join(",");
    var r1 = await pvgisGet("PVcalc", withObs);
    var pick = function (r) { return { Ey: r.outputs.totals.fixed.E_y, Em: r.outputs.monthly.fixed.map(function (m) { return m.E_m; }) }; };
    p.pvgis = { t: Date.now(), kwp: base.peakpower, loss: base.loss, angle: base.angle, aspect: base.aspect, db: r0.inputs.meteo_data.radiation_db, base: pick(r0), shaded: pick(r1), horizon: withObs.userhorizon };
    touch(); renderPvgis();
  } catch (e) {
    var msg = String(e && e.message || e);
    toast(isNative ? "No se ha podido consultar PVGIS: " + msg : "PVGIS no admite consultas desde la versión web. Use la app Android.", 4500);
  } finally { btn.disabled = false; btn.textContent = "Calcular con PVGIS"; }
}
$("btnPvgis").addEventListener("click", runPvgis);
function renderPvgis() {
  var p = proj();
  $("inKwp").value = p.kwp || 1; $("inSysLoss").value = p.sysLoss == null ? 14 : p.sysLoss;
  var r = p.pvgis; $("pvRes").hidden = !r; if (!r) return;
  var n0 = function (v) { return Math.round(v).toLocaleString("es-ES"); };
  var loss = r.base.Ey - r.shaded.Ey;
  $("pvBase").textContent = n0(r.base.Ey); $("pvShaded").textContent = n0(r.shaded.Ey);
  $("pvLoss").textContent = n0(loss); $("pvLossPct").textContent = "kWh/año · " + fmt(100 * loss / r.base.Ey, 1) + " %";
  var stale = r.angle !== p.beta || r.aspect !== p.alphaMod || r.kwp !== (p.kwp || 1) || p.updated > r.t + 2000;
  $("pvMeta").textContent = "Calculado el " + new Date(r.t).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) + " con " + r.kwp.toString().replace(".", ",") + " kWp, " + r.loss + " % de pérdidas, β " + r.angle + "° y α " + r.aspect + "° (" + r.db + ")." +
    (stale ? " El proyecto ha cambiado desde entonces: vuelva a calcular." : "");
  drawPvChartOn($("pvChart"), $("pvChart").clientWidth, $("pvChart").clientHeight, window.devicePixelRatio || 1, true);
}
function drawPvChartOn(c, w, h, dpr, onScreen) {
  var r = proj().pvgis; if (!r || !w) return;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (!onScreen) { g.fillStyle = css("--surface"); g.fillRect(0, 0, w, h); }
  var L = 36, B = 20, T = 8, pw = w - L - 4, ph = h - B - T, max = Math.max.apply(null, r.base.Em) * 1.08;
  var step = max > 400 ? 100 : max > 200 ? 50 : max > 80 ? 20 : 10, ink2 = css("--ink-2");
  g.font = "500 10px " + css("--f-mono"); g.strokeStyle = css("--line"); g.lineWidth = 1; g.fillStyle = ink2; g.textAlign = "right";
  for (var v = 0; v <= max; v += step) { var y = T + ph - v / max * ph; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillText(String(v), L - 5, y + 3); }
  var bw = pw / 12;
  for (var m = 0; m < 12; m++) {
    var x = L + m * bw, hb = r.base.Em[m] / max * ph, hs = r.shaded.Em[m] / max * ph;
    g.fillStyle = css("--line"); g.fillRect(x + bw * .18, T + ph - hb, bw * .64, hb);
    g.fillStyle = css("--sun"); g.fillRect(x + bw * .3, T + ph - hs, bw * .4, hs);
    g.fillStyle = ink2; g.textAlign = "center"; g.fillText(MES[m][0].toUpperCase(), x + bw / 2, h - 6);
  }
}
["inKwp", "inSysLoss"].forEach(function (id) { $(id).addEventListener("change", function () {
  var p = proj(), v = parseFloat(this.value);
  if (id === "inKwp" && v > 0) p.kwp = v; if (id === "inSysLoss" && v >= 0 && v <= 50) p.sysLoss = v;
  touch(); renderPvgis();
}); });

/* ---------------- Ajustes: punto de estudio ---------------- */
function renderCorr() {
  var p = proj(), c = corrCfg(p);
  $("inCorrOn").checked = !!c.on; $("corrBody").hidden = !c.on;
  $("inDz").value = c.dz || 0; $("inDh").value = c.dh || 0; $("inDhAz").value = c.dhAz || 0; $("dhAzRow").hidden = !(c.dh > 0);
  $("inDistMode").value = c.mode; $("wallBox").hidden = c.mode !== "wall";
  $("inWallD").value = c.wallD > 0 ? c.wallD : ""; $("inWallAz").value = c.wallAz != null ? Math.round(c.wallAz) : "";
  var miss = missingDist(p), n = p.points.length;
  $("corrInfo").textContent = !c.on ? "" : !(c.dz || c.dh) ? "Indique el desnivel o el desplazamiento para aplicar la corrección." :
    n ? (n - miss) + " de " + n + " puntos corregidos." + (miss ? (c.mode === "point" ? " Añada la distancia de los demás en la pestaña Puntos." : " Los demás quedan fuera del alcance de la fachada.") : "") : "La corrección se aplicará a los puntos que mida.";
}
function onCorrInput() {
  var c = corrCfg(proj()), num = function (id) { var v = parseFloat($(id).value); return isNaN(v) ? null : v; };
  c.on = $("inCorrOn").checked; c.dz = num("inDz") || 0; c.dh = Math.max(0, num("inDh") || 0); c.dhAz = num("inDhAz") || 0;
  c.mode = $("inDistMode").value; c.wallD = num("inWallD"); var wa = num("inWallAz"); c.wallAz = wa == null ? null : norm180(wa);
  touch(); renderCorr();
}
["inCorrOn", "inDz", "inDh", "inDhAz", "inDistMode", "inWallD", "inWallAz"].forEach(function (id) { $(id).addEventListener("change", onCorrInput); });
$("btnWallAz").addEventListener("click", function () {
  var a = average(600);
  if (!a) { toast("Active la cámara y los sensores en Medir y apunte en perpendicular a la fachada", 3500); return; }
  corrCfg(proj()).wallAz = +a.az.toFixed(0); touch(); renderCorr(); toast("Dirección de la fachada: " + sgn(a.az, 0) + "°");
});

/* ---------------- Ayuda: punto de estudio ---------------- */
var helpStep = 0, helpSteps = document.querySelectorAll(".help-step");
function showHelp(i) {
  helpStep = Math.max(0, Math.min(helpSteps.length - 1, i));
  helpSteps.forEach(function (el, k) {
    el.hidden = k !== helpStep; el.classList.remove("play");
    if (k === helpStep) { void el.offsetWidth; el.classList.add("play"); }
  });
  $("helpDots").innerHTML = Array.prototype.map.call(helpSteps, function (_, k) { return '<i class="' + (k === helpStep ? "on" : "") + '"></i>'; }).join("");
  $("helpPrev").disabled = helpStep === 0;
  $("helpNext").textContent = helpStep === helpSteps.length - 1 ? "Entendido" : "Siguiente";
}
function openHelp() { $("helpSheet").hidden = false; $("helpBg").hidden = false; showHelp(0); }
function closeHelp() { $("helpSheet").hidden = true; $("helpBg").hidden = true; }
$("btnCorrHelp").addEventListener("click", openHelp);
$("helpClose").addEventListener("click", closeHelp);
$("helpBg").addEventListener("click", closeHelp);
$("helpPrev").addEventListener("click", function () { showHelp(helpStep - 1); });
$("helpNext").addEventListener("click", function () { if (helpStep === helpSteps.length - 1) closeHelp(); else showHelp(helpStep + 1); });
/* deslizar para cambiar de paso */
(function () {
  var x0 = null;
  $("helpSheet").addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  $("helpSheet").addEventListener("touchend", function (e) {
    if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) showHelp(helpStep + (dx < 0 ? 1 : -1));
  });
})();

/* ---------------- Ajustes ---------------- */
function renderSettings() {
  var p = proj();
  $("inLat").value = p.lat.toFixed(4); $("inDecl").value = p.decl.toFixed(1);
  $("inAvg").value = String(S.avg); $("inDelay").value = String(S.delay);
  $("inTap").checked = !!S.tap; $("inPhoto").checked = !!S.photos; $("inVol").checked = !!S.vol; $("volRow").hidden = !isNative;
  gpsInfo();
  calInfo();
  renderCorr();
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

/* Búsqueda de la ubicación. En Android se comprueba antes que la ubicación del sistema esté activada
   y, si no lo está, se muestra el diálogo del sistema para activarla. */
var gpsWatch = null, gpsTimer = null;
function gpsMsg(text, kind, actions) {
  var box = $("gpsMsg"); box.hidden = !text; box.className = "gps-msg " + (kind || "");
  $("gpsMsgText").textContent = text || "";
  $("btnLocSettings").hidden = !(actions && actions.settings);
  $("btnGpsRetry").hidden = !(actions && actions.retry);
  $("btnGpsCancel").hidden = !(actions && actions.cancel);
}
function gpsStop() {
  if (gpsWatch != null) { try { navigator.geolocation.clearWatch(gpsWatch); } catch (e) {} gpsWatch = null; }
  clearTimeout(gpsTimer); $("btnGps").disabled = false;
}
async function locate(silent) {
  if (!navigator.geolocation) { if (!silent) gpsMsg("Este dispositivo no ofrece ubicación.", "bad"); return; }
  if (isNative) {
    var Dev = plugin("Dispositivo");
    try {
      var st = await Dev.locationStatus();
      if (!st.enabled) {
        if (silent) return;
        gpsMsg("La ubicación del móvil está desactivada. Actívela para que la app pueda leer el GPS.", "warn");
        var r = await Dev.requestLocationOn();
        if (!r.enabled) { gpsMsg("La ubicación sigue desactivada. Actívela en los ajustes del móvil y vuelva a pulsar «Usar GPS».", "bad", { settings: true, retry: true }); return; }
      }
    } catch (e) { /* sin servicios de Google: se intenta igualmente */ }
  }
  gpsStop();
  if (!silent) { $("btnGps").disabled = true; gpsMsg("Buscando señal GPS… Al aire libre suele tardar menos de 30 segundos.", "", { cancel: true }); }
  var best = null;
  function done(pos) {
    gpsStop();
    var p = proj(), c = pos.coords;
    p.lat = +c.latitude.toFixed(5); p.lon = +c.longitude.toFixed(5); p.acc = c.accuracy;
    var d = wmmDecl(p.lat, p.lon); if (d != null) { p.decl = +d.toFixed(1); p.declSource = "wmm"; }
    touch(); gpsMsg("");
    if (currentView === "settings") renderSettings();
    if (!silent) toast("Ubicación actualizada · declinación " + fmt(p.decl, 1) + "°");
  }
  gpsWatch = navigator.geolocation.watchPosition(function (pos) {
    if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
    if (pos.coords.accuracy <= 30) done(pos);           /* suficiente para la latitud y la declinación */
    else if (!silent) gpsMsg("Señal recibida (±" + Math.round(pos.coords.accuracy) + " m). Mejorando la precisión…", "", { cancel: true });
  }, function (err) {
    gpsStop();
    if (silent) return;
    if (err.code === 1) gpsMsg("La app no tiene permiso de ubicación. Permítalo en los ajustes de la app (Permisos → Ubicación).", "bad", { retry: true });
    else gpsMsg("No se ha podido obtener la ubicación. Compruebe que la ubicación del móvil está activada y pruebe al aire libre.", "bad", { settings: isNative, retry: true });
  }, { enableHighAccuracy: true, maximumAge: 30000 });
  gpsTimer = setTimeout(function () {
    if (best) { done(best); return; }
    gpsStop();
    if (!silent) gpsMsg("No llega señal GPS después de 45 segundos. Salga al exterior, lejos de edificios altos, y vuelva a intentarlo.", "bad", { settings: isNative, retry: true });
  }, 45000);
}
$("btnGpsCancel").addEventListener("click", function () { gpsStop(); gpsMsg(""); });
/* Al volver de los ajustes del sistema con la ubicación ya activada, se reintenta solo */
document.addEventListener("visibilitychange", function () {
  if (document.hidden || !isNative || $("btnLocSettings").hidden || $("gpsMsg").hidden) return;
  var Dev = plugin("Dispositivo"); if (!Dev) return;
  Dev.locationStatus().then(function (st) { if (st.enabled) locate(false); }).catch(function () {});
});
$("btnGpsRetry").addEventListener("click", function () { locate(false); });
$("btnLocSettings").addEventListener("click", function () { var Dev = plugin("Dispositivo"); if (Dev) Dev.openLocationSettings().catch(function () {}); });
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
  var dark = S.theme === "dark" || (S.theme === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? "#0d131b" : "#eef1f4";
  if (isNative) { var SB = plugin("SystemBars"); if (SB) SB.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(function () {}); }
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
  var p = proj(), t = lossTable(), r = IDAE.compute(effPoints(p), p.lat, t);
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
  if (corrActive(p)) {
    var cc = corrCfg(p);
    kv.push(["Punto de estudio", (cc.dz ? dot(cc.dz, 2) + " m " + (cc.dz > 0 ? "por encima" : "por debajo") + " del punto de medida" : "a la altura del punto de medida") +
      (cc.dh ? ", desplazado " + dot(cc.dh, 2) + " m hacia el azimut " + dot(cc.dhAz, 0) + "°" : "") +
      (cc.mode === "wall" ? "; fachada a " + dot(cc.wallD || 0, 1) + " m en la dirección " + dot(cc.wallAz || 0, 0) + "°" : "; distancia medida en cada punto") +
      (missingDist(p) ? " (" + missingDist(p) + " puntos sin corregir)" : "")]);
  }
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

  /* ---- Calendario ---- */
  var calR = null, calImg = withTheme("light", function () {
    var c = document.createElement("canvas"); calR = drawCalendarOn(c, 640, 330, 2.2, false); return c.toDataURL("image/jpeg", 0.9);
  });
  need(110); section("Calendario de sombras");
  doc.addImage(calImg, "JPEG", M, y, W, W * 330 / 640); y += W * 330 / 640 + 4;
  font("normal", 8, INK2);
  var cl = doc.splitTextToSize(pdfSafe("Día 15 de cada mes, en franjas de media hora (hora oficial del dispositivo). Naranja: sol directo; azul oscuro: sol tapado por el obstáculo; gris claro: sol bajo el horizonte. En total, el obstáculo tapa el sol " +
    dot(calR.shadeH, 1) + " h de " + dot(calR.sunH, 1) + " h de sol en los días representados."), W);
  doc.text(cl, M, y); y += cl.length * 3.6 + 6;

  /* ---- PVGIS ---- */
  if (p.pvgis) {
    var pv = p.pvgis, lossE = pv.base.Ey - pv.shaded.Ey;
    need(90); section("Producción estimada con PVGIS");
    var nums = [["Sin obstáculos", Math.round(pv.base.Ey) + " kWh/año"], ["Con obstáculos", Math.round(pv.shaded.Ey) + " kWh/año"], ["Pérdida", Math.round(lossE) + " kWh/año (" + dot(100 * lossE / pv.base.Ey, 1) + " %)"]];
    nums.forEach(function (n, i) { var x = M + i * (W / 3); font("bold", 7.5, INK2); txt(n[0].toUpperCase(), x, y); font("normal", 13, i === 2 ? SUN : INK); txt(n[1], x, y + 6.5); });
    y += 12;
    var pvImg = withTheme("light", function () { var c = document.createElement("canvas"); drawPvChartOn(c, 640, 200, 2.2, false); return c.toDataURL("image/jpeg", 0.9); });
    doc.addImage(pvImg, "JPEG", M, y, W, W * 200 / 640); y += W * 200 / 640 + 4;
    font("normal", 8, INK2);
    var pl = doc.splitTextToSize(pdfSafe("Producción mensual (kWh) con y sin los obstáculos medidos. PVGIS (Comisión Europea, " + pv.db + "), instalación conectada a red de " + String(pv.kwp).replace(".", ",") + " kWp, " + pv.loss +
      " % de pérdidas del sistema, inclinación " + pv.angle + "° y orientación " + pv.aspect + "°. El horizonte usado combina el relieve de PVGIS con los obstáculos medidos. Consulta del " + new Date(pv.t).toLocaleDateString("es-ES") + "."), W);
    doc.text(pl, M, y); y += pl.length * 3.6 + 6;
  }

  /* ---- Puntos ---- */
  section("Puntos medidos");
  var badMag = p.points.filter(function (q) { return q.mag != null && Math.abs(q.mag) > 0.15; }).length;
  if (badMag) { font("normal", 8.5, BAD); txt(badMag + " puntos se midieron con el campo magnético alterado: su azimut puede tener un error de varios grados.", M, y, { maxWidth: W }); y += 7; }
  if (corrActive(p)) {
    var efp = effPoints(p);
    table(["N.º", "Azimut", "Elevación", "Dist.", "Az. corr.", "El. corr.", "Nota"],
      p.points.map(function (q, i) { var d = distFor(p, q); return { cells: [String(i + 1), dot(q.az, 1) + "°", dot(q.elev, 1) + "°", d == null ? "-" : dot(d, 1) + " m",
        efp[i].corrected ? dot(efp[i].az, 1) + "°" : "-", efp[i].corrected ? dot(efp[i].elev, 1) + "°" : "-", q.note || ""] }; }),
      [12, 22, 24, 22, 24, 24, W - 128], ["left", "right", "right", "right", "right", "right", "left"]);
  } else table(["N.º", "Azimut", "Rumbo", "Elevación", "Desv.", "Nota"],
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
    await Share.share({ title: name, files: [res.uri], dialogTitle: "Compartir " + name });
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
    if (!/cancel/i.test(String(e && e.message))) { toast("No se ha podido generar el informe: " + (e && e.message || e), 5000); console.error(e); }
  }
});

/* ---------------- Inicio ---------------- */
$("appVersion").textContent = VERSION + (isNative ? " · Android" : " · web");
applyTheme(); applyTap(); renderCounts(); setMode(S.chartMode || "simple"); show("measure");
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (currentView === "chart") drawChart(); });
})();
