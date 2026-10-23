/* Clinómetro Solar 2.0
   Lógica de la app: sensores, proyectos, diagrama solar y exportación.
   Funciona igual como web (GitHub Pages) y dentro de la app Android (Capacitor). */
(function () {
"use strict";

var VERSION = "2.0.2";
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
    var o = {}; for (var k in q) o[k] = q[k];
    if (q.sky) return o;
    var c = correctPoint(p, q);
    if (c) { o.az = c.az; o.elev = c.elev; o.corrected = true; } else o.uncorrected = true;
    return o;
  });
}
/* ---------------- Horizonte del terreno (PVGIS) ----------------
   PVGIS calcula el horizonte con un modelo digital del terreno: capta las montañas lejanas pero no los
   obstáculos cercanos. Se guarda en el proyecto ({lat, lon, A: azimut desde el norte, h}) y, si está activado,
   se combina con lo medido tomando en cada dirección el mayor de los dos. */
function hzValid(p) { var z = p.hz; return !!(z && z.h && z.h.length > 3 && Math.abs(z.lat - p.lat) < 0.002 && Math.abs(z.lon - p.lon) < 0.002); }
function hzOn(p) { return p.useHz !== false && hzValid(p); }
function terrFn(p) {
  var z = p.hz, n = z.A.length;
  return function (az) {
    var A = norm360(az + 180);
    for (var i = 0; i < n; i++) {
      var a0 = z.A[i], a1 = i + 1 < n ? z.A[i + 1] : z.A[0] + 360, h1 = i + 1 < n ? z.h[i + 1] : z.h[0];
      if (A >= a0 && A <= a1) return z.h[i] + (h1 - z.h[i]) * (A - a0) / ((a1 - a0) || 1);
    }
    var aL = z.A[n - 1] - 360;                    /* antes del primer azimut */
    return z.h[n - 1] + (z.h[0] - z.h[n - 1]) * (A - aL) / ((z.A[0] - aL) || 1);
  };
}
/* Perfil con el que se calcula todo: lo medido y, si procede, el relieve */
function shadeProfile(p) {
  p = p || proj();
  var m = IDAE.profileFn(effPoints(p)); if (!hzOn(p)) return m;
  var t = terrFn(p); return function (az) { return Math.max(m(az), t(az)); };
}
function hasProfile(p) { return p.points.length > 0 || hzOn(p); }
function basisText(p) { return p.points.length && hzOn(p) ? "medido + relieve PVGIS" : hzOn(p) ? "solo relieve PVGIS (sin puntos medidos)" : "solo lo medido"; }
var hzState = {};                                 /* por proyecto: { loading, err } */
async function ensureHorizon(p, force) {
  if (p.useHz === false && !force) return;
  if (hzValid(p) && !force) return;
  var st = hzState[p.id] || (hzState[p.id] = {});
  if (st.loading) return st.loading;
  var lat = p.lat, lon = p.lon;
  st.err = null; renderHz();
  st.loading = (async function () {
    try {
      var hz = await pvgisGet("topography/horizon-profile", { latitude: lat, longitude: lon, angle_output_units: "Degrees" });
      var hp = hz.horizon_profile || {}, A = hp.azimuth || [], H = hp.horizon_height || [];
      if (A.length < 4 || A.length !== H.length) throw new Error("PVGIS no ha devuelto el horizonte.");
      var pairs = A.map(function (a, i) { return [norm360(+a), Math.max(0, +H[i] || 0)]; }).sort(function (x, y) { return x[0] - y[0]; });
      if (p.lat === lat && p.lon === lon) {
        p.hz = { t: Date.now(), lat: lat, lon: lon, A: pairs.map(function (x) { return +x[0].toFixed(2); }), h: pairs.map(function (x) { return +x[1].toFixed(2); }) };
        save();
      }
    } catch (e) { st.err = (e && e.message) || String(e); }
    finally { st.loading = null; }
    if (p.id === db.currentId && currentView === "chart") { renderLoss(); drawChart(); renderCalendar(); renderQuery(); renderPvgis(); }
    renderHz();
  })();
  return st.loading;
}
function renderHz() {
  var p = proj(), st = hzState[p.id] || {}, on = p.useHz !== false, b = $("btnHz"), info = $("hzInfo");
  if (!b) return;
  b.setAttribute("aria-checked", String(on));
  if (!on) info.textContent = "Solo se usan los obstáculos medidos.";
  else if (st.loading) info.textContent = "Descargando el relieve de PVGIS…";
  else if (hzValid(p)) info.textContent = "Relieve del terreno según PVGIS, combinado con lo medido.";
  else {
    info.innerHTML = '<span></span> <button type="button" id="btnHzRetry">Reintentar</button>';
    info.firstChild.textContent = (st.err ? "No se ha podido descargar el relieve de PVGIS" + (navigator.onLine === false ? " (sin conexión)" : "") : "Falta el relieve de PVGIS") + ". De momento se usa solo lo medido.";
    $("btnHzRetry").addEventListener("click", function () { ensureHorizon(proj(), true); });
  }
}
$("btnHz").addEventListener("click", function () {
  var p = proj(); p.useHz = p.useHz === false; touch();
  renderHz(); renderLoss(); drawChart(); renderCalendar(); renderQuery(); renderPvgis();
  if (p.useHz) ensureHorizon(p);
});

function missingDist(p) { return corrActive(p) ? p.points.filter(function (q) { return !q.sky && distFor(p, q) == null; }).length : 0; }

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
/* Aviso sobre la brújula: interferencia (campo medido lejos del esperado) o calibración baja */
function compassWarning() {
  var dev = magDeviation();
  if (dev != null && Math.abs(dev) > 0.15) return "Interferencia magnética " + sgn(dev * 100, 0) + " %";
  if (sens.magAcc != null && sens.magAcc <= 1) return "Calibre la brújula: mueva el móvil en forma de 8";
  return null;
}
function startMagnetometer() {
  if (!isNative || startMagnetometer.done) return; startMagnetometer.done = true;
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
var sensOn = false;
function startSensors() {
  if (sensOn) return; sensOn = true;
  startMagnetometer();
  if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", function (e) { onOrient(e, true); });
  window.addEventListener("deviceorientation", function (e) { if (!sens.absolute || e.webkitCompassHeading != null) onOrient(e, !!e.absolute); });
}

/* Enciende los sensores de orientación sin abrir la cámara (p. ej. para seguir el móvil en la vista 3D) */
async function enableSensors() {
  if (sensOn) return true;
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return false;
    }
  } catch (e) { return false; }
  startSensors(); return true;
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
  var camErr = await openCamera();
  if (camErr) msg.push("No se ha podido abrir la cámara (" + camErr + "). Las lecturas funcionan igual apuntando con la parte trasera del móvil.");
  keepAwake(); checkFar(proj());
  sens.started = true;
  $("btnSave").disabled = false; $("btnCal").disabled = false; $("btnSky").disabled = false;
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

/* Cámara trasera. Devuelve null si se abre o el nombre del error */
async function openCamera() {
  try {
    var v = $("video"), old = v.srcObject;
    if (old) old.getTracks().forEach(function (t) { t.stop(); });
    var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    v.srcObject = stream;
    v.addEventListener("playing", function () { v.hidden = false; document.querySelector(".idle-art").hidden = true; }, { once: true });
    v.play().catch(function () {});
    return null;
  } catch (e) { return e && e.name || "error"; }
}
function keepAwake() { try { if ("wakeLock" in navigator) navigator.wakeLock.request("screen").catch(function () {}); } catch (e) {} }
/* Al volver a la app, el sistema puede haber cerrado la cámara: se reabre si hace falta */
document.addEventListener("visibilitychange", function () {
  if (document.hidden || !sens.started) return;
  var v = $("video"), st = v.srcObject, tr = st && st.getVideoTracks()[0];
  if (!tr || tr.readyState === "ended") openCamera();
  else if (v.paused) v.play().catch(function () {});
  keepAwake();
});

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
  var cw = compassWarning(), mchip = $("chipMag");
  mchip.hidden = !cw; if (cw) mchip.lastChild.textContent = cw;
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
    g.fillStyle = p.sky ? "#5b9cf0" : hacc; g.beginPath(); g.arc(cx + dd * ppd, 5, 3, 0, 7); g.fill();
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
  p.points.push(pt); checkFar(p);
  touch(); haptic();
  if (S.photos) capturePhoto(pt, p.points.length).then(function (b) {
    if (!b) return; return Photos.put(pt.id, b).then(function () { pt.photo = true; touch(); });
  }).catch(function () {});
  renderCounts();
  toast("Punto " + p.points.length + ": " + fmt(a.elev, 1) + "° a " + sgn(Math.round(a.az), 0) + "°" + (a.sd > 0.8 ? " · lectura poco estable" : "") +
    (pt.mag != null && Math.abs(pt.mag) > 0.15 ? " · azimut dudoso por interferencia magnética" : ""), pt.mag != null && Math.abs(pt.mag) > 0.15 ? 3500 : 2400);
}
/* Punto de cielo: marca un hueco sin obstáculo en la dirección a la que se apunta */
function saveSky() {
  if (!sens.started) return;
  var a = average(500);
  if (!a) { toast("Sin datos de los sensores"); return; }
  var p = proj();
  p.points.push({ id: uid(), az: +a.az.toFixed(1), head: +a.head.toFixed(1), elev: 0, sd: 0, note: "", t: Date.now(), abs: sens.absolute, sky: true });
  touch(); haptic("light"); renderCounts();
  toast("Cielo marcado a " + sgn(Math.round(a.az), 0) + "°: aquí no hay obstáculo");
}
$("btnSky").addEventListener("click", saveSky);

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
  /* mediana móvil de 3 grados: quita el ruido sin redondear las esquinas */
  var smooth = prof.map(function (q, i) {
    if (i === 0 || i === prof.length - 1) return q;
    var o = {}; for (var k in q) o[k] = q[k]; o.elev = median([prof[i - 1].elev, q.elev, prof[i + 1].elev]); return o;
  });
  var pts = simplify(smooth, 0.8), p = proj(), batch = uid(), md = magDeviation();
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

/* ---------------- Capas y botón Atrás ----------------
   Cada capa abierta (hoja, guía, foto, vista 3D) añade una entrada al historial; el botón Atrás de Android
   (o del navegador) la cierra en lugar de salir de la app. */
var layers = [], skipPop = 0;
function layerOpen(name, hideFn) {
  if (layers.some(function (l) { return l.name === name; })) return;
  layers.push({ name: name, hide: hideFn });
  try { history.pushState({ layer: name }, ""); } catch (e) {}
}
function layerClose(name) {
  var i = -1; layers.forEach(function (l, k) { if (l.name === name) i = k; });
  if (i < 0) return;
  layers.splice(i, 1); skipPop++;
  try { history.back(); } catch (e) { skipPop--; }
}
window.addEventListener("popstate", function () {
  if (skipPop) { skipPop--; return; }
  var l = layers.pop(); if (l) l.hide();
});

/* ---------------- Navegación ---------------- */
var currentView = "measure";
function show(v) {
  currentView = v;
  document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = el.dataset.view !== v; });
  document.querySelectorAll("[data-tab]").forEach(function (b) { if (b.dataset.tab === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  $("app").classList.toggle("on-measure", v === "measure");
  if (v === "chart") { if (queryLive) { var qd = new Date(); qd.setSeconds(0, 0); query = qd; $("inQDate").value = qd.getFullYear() + "-" + pad(qd.getMonth() + 1) + "-" + pad(qd.getDate()); $("inQTime").value = pad(qd.getHours()) + ":" + pad(qd.getMinutes()); $("btnNow").setAttribute("aria-pressed", "true"); }
    fillCompare(); renderHz(); renderLoss(); drawChart(); renderCalendar(); renderQuery(); renderPvgis(); ensureHorizon(proj()); }
  if (v === "points") renderPoints();
  if (v === "settings") renderSettings();
}
document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.tab); }); });

/* ---------------- Puntos ---------------- */
function renderCounts() {
  var n = proj().points.length;
  $("vCount").textContent = n; $("btnUndo").disabled = !n; $("btnSky").disabled = !sens.started;
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
      (q.sky ? '<div class="p-vals"><span><small>Azimut</small>' + sgn(q.az, 0) + '°</span><span class="sky"><small>Cielo</small>sin obstáculo</span></div>' :
      '<div class="p-vals"><span><small>Azimut</small>' + sgn(q.az, 0) + '°</span><span><small>Elevación</small>' + fmt(q.elev, 1) + '°</span><span class="sd"><small>Desv.</small>±' + q.sd.toFixed(1).replace(".", ",") + '°</span></div>') +
      '<button class="p-del" type="button" aria-label="Eliminar punto ' + (i + 1) + '">' + ICON_DEL + '</button>' +
      '<input class="p-note" type="text" placeholder="Añadir nota" aria-label="Nota del punto ' + (i + 1) + '">';
    if (corrActive(p) && !q.sky) {
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
    $("lightbox").hidden = false; layerOpen("lightbox", hideLightbox);
  });
}
function hideLightbox() { $("lightbox").hidden = true; }
function closeLightbox() { hideLightbox(); layerClose("lightbox"); }
$("lbClose").addEventListener("click", closeLightbox);
$("lightbox").addEventListener("click", function (e) { if (e.target === $("lightbox")) closeLightbox(); });

/* Renombrar */
$("btnRename").addEventListener("click", function () { $("inRename").value = proj().name; $("renameBox").hidden = false; $("inRename").focus(); });
$("btnRenameNo").addEventListener("click", function () { $("renameBox").hidden = true; });
$("btnRenameOk").addEventListener("click", function () {
  var v = $("inRename").value.trim(); if (v) { proj().name = v; touch(); }
  $("renameBox").hidden = true; renderPoints();
});

/* ---------------- Proyectos ---------------- */
var ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
function hideSheet() { $("sheet").hidden = true; $("sheetBg").hidden = true; }
function openSheet() { renderProjects(); $("sheet").hidden = false; $("sheetBg").hidden = false; layerOpen("sheet", hideSheet); }
function closeSheet() { hideSheet(); layerClose("sheet"); }
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
  var cur = proj(); n.lat = cur.lat; n.lon = cur.lon; n.locSource = cur.locSource; n.acc = cur.acc;
  if (cur.hz) n.hz = JSON.parse(JSON.stringify(cur.hz));
  db.projects.push(n); db.currentId = n.id; save();
  closeSheet(); renderPoints(); renderCounts();
  $("inRename").value = n.name; $("renameBox").hidden = false; $("inRename").select();
  maybeAutoGps();
});

/* ---------------- Exportación ---------------- */
function csvText(sep) {
  var p = proj();
  var corr = corrActive(p), ef = effPoints(p), dec = function (v, d) { return v == null ? "" : v.toFixed(d).replace(".", ","); };
  var head = ["n", "azimut_sur_deg", "rumbo_norte_deg", "elevacion_deg", "desviacion_deg", "nota", "fecha_hora", "ref_norte", "tipo"];
  if (corr) head = head.concat(["distancia_m", "azimut_corregido_deg", "elevacion_corregida_deg"]);
  var rows = [head];
  p.points.forEach(function (q, i) {
    var r = [i + 1, dec(q.az, 1), dec(q.head, 1), dec(q.elev, 1), dec(q.sd, 2),
      (q.note || "").replace(/[;\t\r\n]/g, " "), new Date(q.t).toISOString(), q.abs ? "si" : "no", q.sky ? "cielo" : "obstaculo"];
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
    var meas = points.filter(function (q) { return q.az >= azMin && q.az <= azMax; });
    var pts = IDAE.expandProfile(meas);
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
    if (!dashed) meas.forEach(function (q) {
      g.beginPath(); g.arc(X(q.az), Y(Math.max(0, q.elev)), q.sky ? 4 : 3, 0, 7);
      if (q.sky) { g.strokeStyle = css("--winter"); g.lineWidth = 2; g.fillStyle = surface; g.fill(); g.stroke(); }
      else { g.fillStyle = color; g.fill(); }
    });
  }
  /* relieve del terreno (PVGIS): relleno suave y línea discontinua, por debajo de lo medido */
  var terrOn = hzOn(p), tf = terrOn ? terrFn(p) : null, terrC = css("--terrain");
  function terrain(fillA) {
    var tp = []; for (var a = azMin; a <= azMax; a += 1) tp.push([a, Math.max(0, tf(a))]);
    if (fillA) {
      g.beginPath(); g.moveTo(X(azMin), Y(0)); tp.forEach(function (q) { g.lineTo(X(q[0]), Y(q[1])); }); g.lineTo(X(azMax), Y(0)); g.closePath();
      g.globalAlpha = fillA; g.fillStyle = terrC; g.fill(); g.globalAlpha = 1;
    }
    g.strokeStyle = terrC; g.lineWidth = 1.6; g.setLineDash([5, 3]);
    g.beginPath(); tp.forEach(function (q, i) { i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])); }); g.stroke(); g.setLineDash([]);
  }
  if (terrOn) terrain(.22);
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
    });
    if (terrOn) terrain(0);
    silhouette(effPoints(p), ink, 0, false);
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
  var k = p.points.length ? '<span><i style="background:' + ink + ';opacity:.6"></i>' + escapeHtml(p.name) + '</span>' : '';
  if (terrOn) k += '<span><i class="k-terr"></i>Relieve (PVGIS)</span>';
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

/* ---------------- Vista 3D ----------------
   three.js y el módulo de la vista se cargan solo al abrirla. */
function loadScript(src) {
  return new Promise(function (res, rej) {
    if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
    var sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = function () { rej(new Error("No se ha podido cargar " + src)); };
    document.head.appendChild(sc);
  });
}
$("btn3d").addEventListener("click", async function () {
  var b = this; b.disabled = true;
  try {
    await loadScript("vendor/three.min.js"); await loadScript("vista3d.js");
    var p = proj(), ef = effPoints(p), day = null, hour = null;
    if (query) { var y0 = new Date(query.getFullYear(), 0, 0); day = Math.floor((query - y0) / 86400000); hour = 12 + solarAt(query, p.lat, p.lon).H / 15; }
    Vista3D.open({
      lat: p.lat, lon: p.lon, points: ef, prof: shadeProfile(p), wallProf: IDAE.profileFn(ef), terr: hzOn(p) ? terrFn(p) : null, day: day, hour: hour,
      sensors: function () { if (!sens.gotData) return null; var a = average(150); return a ? { head: a.head, elev: a.elev } : null; },
      enableSensors: enableSensors, compassWarning: compassWarning, live: queryLive,
      /* día del año y hora solar verdadera de este momento en la ubicación del proyecto */
      now: function () { var d = new Date(), y0 = new Date(d.getFullYear(), 0, 0); return { day: Math.floor((d - y0) / 86400000), hour: 12 + solarAt(d, p.lat, p.lon).H / 15 }; },
      onClose: function () { layerClose("v3d"); }
    });
    layerOpen("v3d", function () { Vista3D.close(); });
  } catch (e) { toast("No se ha podido abrir la vista 3D: " + (e && e.message || e), 4000); }
  finally { b.disabled = false; }
});

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
var query = null;                              /* fecha y hora consultada */
var queryLive = true;                          /* true: la consulta sigue la hora actual */

/* Matriz mes × franja: -1 sol bajo el horizonte; 0…1 fracción en sombra */
function calendarData(p) {
  var prof = shadeProfile(p), y = new Date().getFullYear(), cols = (CAL.h1 - CAL.h0) * 60 / CAL.step, out = [];
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
  $("calSummary").textContent = hasProfile(p) ?
    "En los días representados, " + (hzOn(p) ? "el horizonte" : "el obstáculo") + " tapa el sol " + fmt(r.shadeH, 1) + " h de " + fmt(r.sunH, 1) + " h de sol (" + fmt(100 * r.shadeH / Math.max(1, r.sunH), 0) + " %). Es tiempo de sol, no energía: una hora de invierno al amanecer pesa mucho menos que una de mediodía."
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
function setQuery(d, live) {
  query = d; queryLive = !!live; $("btnNow").setAttribute("aria-pressed", String(queryLive));
  $("inQDate").value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  $("inQTime").value = pad(d.getHours()) + ":" + pad(d.getMinutes());
  renderQuery(); renderCalendar(); drawChart();
}
function onQueryInput() {
  var dv = $("inQDate").value, tv = $("inQTime").value; if (!dv || !tv) return;
  var a = dv.split("-").map(Number), b = tv.split(":").map(Number);
  query = new Date(a[0], a[1] - 1, a[2], b[0], b[1]); queryLive = false; $("btnNow").setAttribute("aria-pressed", "false"); renderQuery(); renderCalendar(); drawChart();
}
$("inQDate").addEventListener("change", onQueryInput); $("inQTime").addEventListener("change", onQueryInput);
function nowQuery() { var d = new Date(); d.setSeconds(0, 0); setQuery(d, true); }
$("btnNow").addEventListener("click", nowQuery);
/* en tiempo real, el sol del diagrama avanza solo mientras se mira la pestaña */
setInterval(function () { if (queryLive && currentView === "chart" && !document.hidden) nowQuery(); }, 30000);
function renderQuery() {
  var out = $("queryRes");
  if (!query) { out.innerHTML = ""; return; }
  var p = proj(), s = solarAt(query, p.lat, p.lon), h = shadeProfile(p)(s.az);
  var when = query.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + " a las " + pad(query.getHours()) + ":" + pad(query.getMinutes());
  var st = s.el <= 0 ? '<span class="st night">Sol bajo el horizonte</span>' : s.el < h ? '<span class="st shade">En sombra</span>' : '<span class="st sun">Sol directo</span>';
  out.innerHTML = escapeHtml(when) + ": sol a <b>" + fmt(s.el, 1) + "°</b> de altura y <b>" + sgn(s.az, 0) + "°</b> de azimut" +
    (s.el > 0 && h > 0 ? "; " + (hzOn(p) ? "el horizonte" : "el obstáculo") + " llega a <b>" + fmt(h, 1) + "°</b> en esa dirección" : "") + ".<br>" + st;
}

/* ---------------- Pérdidas por sombras (IDAE) ---------------- */
function lossTable() {
  var p = proj();
  if (p.idaeTable && p.idaeTable !== "auto") for (var i = 0; i < IDAE.TABLES.length; i++) if (IDAE.TABLES[i].id === p.idaeTable) return IDAE.TABLES[i];
  return IDAE.pick(p.beta, p.alphaMod);
}
function lossResult() { var p = proj(); return IDAE.compute(shadeProfile(p), p.lat, lossTable()); }
function tLabel(t) { return "Tabla " + t.id + " · β " + t.beta + "°" + (t.beta ? ", α " + (t.alpha > 0 ? "+" : "") + t.alpha + "°" : ""); }
function renderLoss() {
  if (!window.IDAE) { $("lossPanel").hidden = true; return; }
  var p = proj(), t = lossTable(), auto = IDAE.pick(p.beta, p.alphaMod);
  $("inBeta").value = p.beta; $("inAlpha").value = p.alphaMod; $("inCase").value = p.idaeCase;
  var sel = $("inTable"); sel.innerHTML = "";
  var o = document.createElement("option"); o.value = "auto"; o.textContent = "Automática (" + auto.id + ")"; sel.appendChild(o);
  IDAE.TABLES.forEach(function (x) { var op = document.createElement("option"); op.value = x.id; op.textContent = tLabel(x); sel.appendChild(op); });
  sel.value = p.idaeTable || "auto";
  var r = IDAE.compute(shadeProfile(p), p.lat, t), lim = IDAE.LIMITS.filter(function (l) { return l.key === p.idaeCase; })[0] || IDAE.LIMITS[0];
  var has = hasProfile(p);
  $("lossBasis").innerHTML = has ? "Horizonte usado: <b></b>" : ""; if (has) $("lossBasis").lastChild.textContent = basisText(p);
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
  touch(); renderLoss(); drawChart(); renderPvgis();
}
["inBeta", "inAlpha", "inTable", "inCase"].forEach(function (id) { $(id).addEventListener("change", onLossInput); });

/* ---------------- Producción con PVGIS 6 ----------------
   API de PVGIS 6 (JRC, Comisión Europea). Admite consultas desde la web (CORS abierto).
   Devuelve la potencia hora a hora de la serie pedida; la app calcula la media anual y mensual. */
var PVGIS = "https://photovoltaic-geographic-information-system.ec.europa.eu/api/v6/";
var PV_Y0 = 2015, PV_Y1 = 2024;
async function pvgisGet(path, params) {
  var q = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
  var url = PVGIS + path + "?" + q, status = 0, text = "";
  try { var res = await fetch(url); status = res.status; text = await res.text(); }
  catch (e) {
    if (!isNative) throw new Error("No hay conexión con PVGIS. Compruebe la conexión a internet.");
    var H = plugin("CapacitorHttp");
    var r = await H.get({ url: url, connectTimeout: 30000, readTimeout: 90000, responseType: "text" });
    status = r.status; text = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
  }
  var data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(/<html|<!doctype/i.test(text) ? "PVGIS ha rechazado la consulta o está en mantenimiento (respuesta " + status + "). Inténtelo más tarde." : "PVGIS ha devuelto una respuesta no válida."); }
  if (status !== 200) {
    var det = data && data.detail; if (det && typeof det !== "string") det = JSON.stringify(det).slice(0, 160);
    throw new Error(det || "PVGIS respondió " + status);
  }
  return data;
}
/* Potencia horaria (W) → energía media mensual y anual (kWh) */
function energyFromHourly(power) {
  var m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], t0 = Date.UTC(PV_Y0, 0, 1), years = PV_Y1 - PV_Y0 + 1;
  for (var i = 0; i < power.length; i++) { var v = power[i]; if (v == null || isNaN(v)) continue; m[new Date(t0 + i * 3600000).getUTCMonth()] += v; }
  var Em = m.map(function (x) { return x / 1000 / years; });
  return { Ey: Em.reduce(function (a, b) { return a + b; }, 0), Em: Em };
}
/* Horizonte: 36 alturas cada 10°, empezando por el norte y en sentido horario.
   Se toma el mayor entre el relieve de PVGIS y los obstáculos medidos. */
function horizonFor(p) {
  var prof = shadeProfile(p), out = [];
  for (var i = 0; i < 36; i++) { var az = norm180(i * 10 - 180); out.push(Math.max(0, Math.round(prof(az) * 10) / 10)); }
  return out;
}
async function runPvgis() {
  var p = proj();
  if (p.useHz !== false) await ensureHorizon(p);
  if (!hasProfile(p)) { toast("Mida primero el perfil de obstáculos"); return; }
  var btn = $("btnPvgis"); btn.disabled = true; btn.textContent = "Consultando PVGIS…";
  try {
    var kwp = p.kwp || 1, loss = p.sysLoss == null ? 14 : p.sysLoss;
    var base = { latitude: p.lat, longitude: p.lon, surface_orientation: norm360(180 + p.alphaMod), surface_tilt: p.beta,
      start_time: PV_Y0 + "-01-01T00:00:00", end_time: PV_Y1 + "-12-31T23:59:59", frequency: "Hourly",
      "peak-power": kwp, system_efficiency: +(1 - loss / 100).toFixed(3), analysis: "None", angle_output_units: "Degrees" };
    /* sin horizonte de ningún tipo (cielo libre) y con el horizonte del diagrama */
    base.horizon_profile = new Array(36).fill(0).join(",");
    var r0 = await pvgisGet("performance/broadband", base);
    var withObs = {}; for (var k in base) withObs[k] = base[k];
    withObs.horizon_profile = horizonFor(p).join(",");
    var r1 = await pvgisGet("performance/broadband", withObs);
    if (!r0.power || !r1.power) throw new Error("PVGIS no ha devuelto la serie de producción.");
    p.pvgis = { t: Date.now(), kwp: kwp, loss: loss, angle: p.beta, aspect: p.alphaMod, db: "PVGIS 6, SARAH-3, " + PV_Y0 + "–" + PV_Y1,
      base: energyFromHourly(r0.power), shaded: energyFromHourly(r1.power), horizon: withObs.horizon_profile, basis: basisText(p), lat: p.lat, lon: p.lon };
    touch(); renderPvgis();
  } catch (e) {
    toast("No se ha podido consultar PVGIS: " + (e && e.message || e), 5000);
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
  var stale = pvStale(p);
  $("pvMeta").textContent = "Calculado el " + new Date(r.t).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) + " con " + r.kwp.toString().replace(".", ",") + " kWp, " + r.loss + " % de pérdidas, β " + r.angle + "° y α " + r.aspect + "° (" + r.db + ")." + (r.basis ? " Horizonte: " + r.basis + "." : "") +
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

/* Indica si el cálculo de PVGIS guardado ya no corresponde al proyecto */
function pvStale(p) {
  var r = p.pvgis; if (!r) return false;
  /* solo cuenta lo que cambia el resultado: ubicación, inclinación, orientación, potencia, pérdidas y horizonte */
  var lossNow = p.sysLoss == null ? 14 : p.sysLoss;
  if (r.angle !== p.beta || r.aspect !== p.alphaMod || r.kwp !== (p.kwp || 1) || r.loss !== lossNow) return true;
  if (r.lat != null && (Math.abs(r.lat - p.lat) > 1e-4 || Math.abs(r.lon - p.lon) > 1e-4)) return true;
  if (r.horizon) return r.horizon !== horizonFor(p).join(",");
  return p.updated > r.t + 2000;
}
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

/* ---------------- Guías de ayuda ----------------
   Cada guía es una hoja con pasos (.help-step); se abre con cualquier botón data-open-help="nombre"
   y, si lleva data-help-step, directamente en ese paso. */
var helpCur = null, helpStep = 0;
function helpSheet(name) { return document.querySelector('.sheet.help[data-help="' + name + '"]'); }
function showHelp(i) {
  var sh = helpSheet(helpCur), steps = sh.querySelectorAll(".help-step");
  helpStep = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach(function (el, k) {
    el.hidden = k !== helpStep; el.classList.remove("play");
    if (k === helpStep) { void el.offsetWidth; el.classList.add("play"); }
  });
  sh.querySelector(".dots").innerHTML = Array.prototype.map.call(steps, function (_, k) { return '<i class="' + (k === helpStep ? "on" : "") + '"></i>'; }).join("");
  sh.querySelector(".help-prev").disabled = helpStep === 0;
  sh.querySelector(".help-next").textContent = helpStep === steps.length - 1 ? "Entendido" : "Siguiente";
  sh.scrollTop = 0;
}
function openHelp(name, step) {
  hideHelp(); helpCur = name;
  helpSheet(name).hidden = false; $("helpBg").hidden = false; showHelp(step || 0);
  layerOpen("help", hideHelp);
}
function hideHelp() {
  document.querySelectorAll(".sheet.help").forEach(function (sh) { sh.hidden = true; });
  $("helpBg").hidden = true; helpCur = null;
}
function closeHelp() { hideHelp(); layerClose("help"); }
document.querySelectorAll("[data-open-help]").forEach(function (b) {
  b.addEventListener("click", function (e) { e.stopPropagation(); openHelp(b.dataset.openHelp, +(b.dataset.helpStep || 0)); });
});
$("helpBg").addEventListener("click", closeHelp);
document.querySelectorAll(".sheet.help").forEach(function (sh) {
  sh.querySelector(".help-close").addEventListener("click", closeHelp);
  sh.querySelector(".help-prev").addEventListener("click", function () { showHelp(helpStep - 1); });
  sh.querySelector(".help-next").addEventListener("click", function () {
    if (helpStep === sh.querySelectorAll(".help-step").length - 1) closeHelp(); else showHelp(helpStep + 1);
  });
  var x0 = null;
  sh.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  sh.addEventListener("touchend", function (e) {
    if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) showHelp(helpStep + (dx < 0 ? 1 : -1));
  });
});

/* ---------------- Copia de seguridad ----------------
   Archivo JSON con los proyectos y, si se pide, las fotos en base64. Al importar no se pisa nada:
   si el proyecto ya existe en este móvil, se añade como copia con identificadores nuevos. */
var BK_FORMAT = "clinometro-solar";
function dataURLToBlob(u) {
  var parts = u.split(","), mime = (parts[0].match(/data:([^;]+)/) || [])[1] || "image/jpeg", bin = atob(parts[1]), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function exportBackup() {
  var scope = $("inBkScope").value, withPhotos = $("inBkPhotos").checked;
  var list = scope === "current" ? [proj()] : db.projects;
  var out = { formato: BK_FORMAT, version: 1, exportado: new Date().toISOString(), app: VERSION, proyectos: JSON.parse(JSON.stringify(list)), fotos: {} };
  var nPhotos = 0;
  if (withPhotos) {
    for (var i = 0; i < list.length; i++) for (var k = 0; k < list[i].points.length; k++) {
      var q = list[i].points[k]; if (!q.photo) continue;
      var b = await Photos.get(q.id).catch(function () { return null; });
      if (b) { out.fotos[q.id] = await blobToDataURL(b); nPhotos++; }
    }
  } else out.proyectos.forEach(function (p) { p.points.forEach(function (q) { delete q.photo; }); });
  var base = scope === "current" ? fileName("json").replace(/\.json$/, "") : "clinometro_copia_" + new Date().toISOString().slice(0, 10);
  await shareText(JSON.stringify(out), base + ".json", "application/json");
  $("bkInfo").textContent = "Copia creada: " + list.length + (list.length === 1 ? " proyecto" : " proyectos") + (withPhotos ? " y " + nPhotos + " fotos." : ", sin fotos.");
}
$("btnBkExport").addEventListener("click", function () {
  $("busy").hidden = false; $("busyMsg").textContent = "Preparando la copia…";
  exportBackup().catch(function (e) { if (!/cancel/i.test(String(e && e.message))) toast("No se ha podido exportar la copia: " + (e && e.message || e), 5000); })
    .finally(function () { $("busy").hidden = true; $("busyMsg").textContent = "Generando informe…"; });
});
$("btnBkImport").addEventListener("click", function () { $("inBkFile").value = ""; $("inBkFile").click(); });
$("inBkFile").addEventListener("change", function () {
  var f = this.files && this.files[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function () { importBackup(String(rd.result)).catch(function (e) { toast(e.message || "No se ha podido importar", 5000); }); };
  rd.readAsText(f);
});
async function importBackup(text) {
  var data;
  try { data = JSON.parse(text.replace(/^\ufeff/, "")); } catch (e) { throw new Error("El archivo no es una copia de Clinómetro Solar."); }
  if (!data || data.formato !== BK_FORMAT || !Array.isArray(data.proyectos)) throw new Error("El archivo no es una copia de Clinómetro Solar.");
  var fotos = data.fotos || {}, nP = 0, nF = 0, first = null;
  var known = {}; db.projects.forEach(function (p) { known[p.id] = true; p.points.forEach(function (q) { known[q.id] = true; }); });
  for (var i = 0; i < data.proyectos.length; i++) {
    var p = data.proyectos[i];
    if (!p || !Array.isArray(p.points) || typeof p.lat !== "number") continue;
    var dup = known[p.id];
    if (dup) { p.id = uid(); p.name = (p.name || "Proyecto") + " (importado)"; }
    if (!p.id) p.id = uid();
    for (var k = 0; k < p.points.length; k++) {
      var q = p.points[k], oldId = q.id;
      if (!q.id || known[q.id]) q.id = uid();
      if (fotos[oldId]) { try { await Photos.put(q.id, dataURLToBlob(fotos[oldId])); q.photo = true; nF++; } catch (e) { q.photo = false; } }
      else q.photo = false;
    }
    withDefaults(p); p.updated = p.updated || Date.now();
    db.projects.push(p); nP++; if (!first) first = p;
  }
  if (!nP) throw new Error("La copia no contiene proyectos válidos.");
  db.currentId = first.id; save(); renderCounts(); renderSettings();
  $("bkInfo").textContent = "Importados " + nP + (nP === 1 ? " proyecto" : " proyectos") + (nF ? " y " + nF + " fotos" : "") + ". Están en la lista de proyectos; el primero queda abierto.";
  toast("Copia importada: " + nP + (nP === 1 ? " proyecto" : " proyectos"));
}

/* ---------------- Ajustes ---------------- */
function renderSettings() {
  var p = proj();
  $("inLat").value = p.lat.toFixed(4); $("inLon").value = p.lon.toFixed(4); $("inDecl").value = p.decl.toFixed(1);
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
    " · declinación " + fmt(p.decl, 1) + "° (" + (p.declSource === "wmm" ? "WMM2025" : "manual") + ")" + (p.acc ? " · precisión ±" + Math.round(p.acc) + " m" : "") +
    (p.locSource === "map" ? " · marcada en el mapa" : p.locSource === "manual" ? " · escrita a mano" : "");
}
function manualLocation() {
  var p = proj();
  if (p.declSource === "wmm") { var d = wmmDecl(p.lat, p.lon); if (d != null) p.decl = +d.toFixed(1); }
  p.acc = null; p.locSource = "manual"; touch(); renderSettings();
}
/* Distancia aproximada en metros entre dos puntos */
function distM(a1, o1, a2, o2) { var x = (o2 - o1) * D2R * Math.cos((a1 + a2) / 2 * D2R), y = (a2 - a1) * D2R; return 6371000 * Math.hypot(x, y); }
function setLocation(lat, lon, source) {
  var p = proj();
  p.lat = lat; p.lon = lon; p.locSource = source; p.acc = null;
  var d = wmmDecl(lat, lon); if (d != null && p.declSource === "wmm") p.decl = +d.toFixed(1);
  touch(); gpsMsg(""); renderSettings();
}
$("btnMap").addEventListener("click", async function () {
  var b = this; b.disabled = true;
  try {
    if (!document.querySelector('link[href="vendor/leaflet/leaflet.css"]')) {
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "vendor/leaflet/leaflet.css"; document.head.appendChild(l);
    }
    await loadScript("vendor/leaflet/leaflet.js"); await loadScript("mapa.js");
    var p = proj();
    Mapa.open({ lat: p.lat, lon: p.lon, zoom: p.locSource || p.acc ? 18 : 11,
      onPick: function (lat, lon) { setLocation(lat, lon, "map"); toast("Ubicación marcada en el mapa · declinación " + fmt(proj().decl, 1) + "°"); },
      onClose: function () { layerClose("map"); } });
    layerOpen("map", function () { Mapa.close(); });
    if (navigator.onLine === false) toast("Sin conexión: el mapa necesita internet para cargarse", 3500);
  } catch (e) { toast("No se ha podido abrir el mapa: " + (e && e.message || e), 4000); }
  finally { b.disabled = false; }
});
$("inLat").addEventListener("change", function () { var v = parseFloat(this.value); if (!isNaN(v) && Math.abs(v) <= 90) { proj().lat = v; manualLocation(); } else renderSettings(); });
$("inLon").addEventListener("change", function () { var v = parseFloat(this.value); if (!isNaN(v) && Math.abs(v) <= 180) { proj().lon = v; manualLocation(); } else renderSettings(); });
$("inDecl").addEventListener("change", function () { var v = parseFloat(this.value); if (!isNaN(v) && Math.abs(v) <= 30) { proj().decl = v; proj().declSource = "manual"; touch(); gpsInfo(); } else renderSettings(); });
$("btnDeclAuto").addEventListener("click", function () { var p = proj(), d = wmmDecl(p.lat, p.lon); if (d == null) return; p.decl = +d.toFixed(1); p.declSource = "wmm"; touch(); renderSettings(); toast("Declinación según WMM2025: " + fmt(p.decl, 1) + "°"); });
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
    /* la búsqueda automática no sustituye una ubicación elegida en el mapa o escrita a mano */
    if (silent && (p.locSource === "map" || p.locSource === "manual")) {
      var dm = distM(p.lat, p.lon, c.latitude, c.longitude);
      if (dm > 1000) toast("Está a unos " + fmt(dm / 1000, dm < 10000 ? 1 : 0) + " km de la ubicación del proyecto", 4000);
      if (dm > 1000) gpsMsg("Está a unos " + fmt(dm / 1000, dm < 10000 ? 1 : 0) + " km de la ubicación del proyecto (" + (p.locSource === "map" ? "marcada en el mapa" : "escrita a mano") + "). Si va a medir aquí, pulse «Usar GPS».", "warn");
      return;
    }
    p.locSource = "gps";
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
/* Si la ubicación del proyecto se eligió en el mapa (o a mano) y se mide en otro sitio, se avisa.
   Solo si el permiso de ubicación ya está concedido, y una vez por proyecto en cada sesión. */
var farChecked = {};
function checkFar(p) {
  if (farChecked[p.id] || !(p.locSource === "map" || p.locSource === "manual")) return;
  farChecked[p.id] = true;
  try { navigator.permissions.query({ name: "geolocation" }).then(function (r) { if (r.state === "granted") locate(true); }).catch(function () {}); } catch (e) {}
}
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
  if (currentView === "chart") { drawChart(); renderCalendar(); renderPvgis(); }
}
document.querySelectorAll("[data-theme-opt]").forEach(function (b) {
  b.addEventListener("click", function () { S.theme = b.dataset.themeOpt; save(); applyTheme(); renderSettings(); });
});
if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (S.theme === "system") applyTheme(); if (currentView === "chart") { renderCalendar(); renderPvgis(); } });

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
  var p = proj(), t = lossTable(), r = IDAE.compute(shadeProfile(p), p.lat, t);
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
  txt("Fracción tapada exacta, sin redondear: " + dot(r.exact, 2) + " %. Horizonte: " + basisText(p) + ".", bx + 70, y + 24.5, { maxWidth: bw - 76 });
  y += bh + 8;

  /* datos del estudio */
  section("Datos del estudio");
  var kv = [
    ["Ubicación", dot(Math.abs(p.lat), 4) + "° " + (p.lat >= 0 ? "N" : "S") + ", " + dot(Math.abs(p.lon), 4) + "° " + (p.lon >= 0 ? "E" : "O")],
    ["Origen de la ubicación", p.locSource === "map" ? "marcada en el mapa" : p.locSource === "manual" ? "escrita a mano" : p.locSource === "gps" ? "GPS del teléfono" + (p.acc ? " (±" + Math.round(p.acc) + " m)" : "") : "sin indicar"],
    ["Horizonte", hzOn(p) ? (p.points.length ? "obstáculos medidos combinados con el relieve de PVGIS (modelo digital del terreno); en cada dirección se toma el mayor" : "solo el relieve de PVGIS (modelo digital del terreno), sin obstáculos medidos") : "solo los obstáculos medidos"],
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
  kv.forEach(function (row) {
    font("normal", 9.5, INK); var ln = doc.splitTextToSize(pdfSafe(row[1]), W - 48);
    font("normal", 9, INK2); txt(row[0], M, y); font("normal", 9.5, INK); doc.text(ln, M + 48, y);
    y += Math.max(6.2, ln.length * 4.3 + 1.9);
  });
  y += 4;

  var ch = 92; need(ch + 24);
  section("Perfil de obstáculos sobre las trayectorias solares");
  doc.addImage(chartImage("full", W, ch), "JPEG", M, y, W, ch); y += ch + 4;
  font("normal", 8, INK2);
  txt("Trayectoria del sol el día 21 de cada mes (azul: diciembre; naranja: junio) y horas solares. Zona gris: silueta medida de los obstáculos." + (hzOn(p) ? " Línea discontinua verde: relieve del terreno según PVGIS." : "") + " Azimut 0° = sur, este negativo.", M, y, { maxWidth: W }); y += 10;

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
  } else { font("normal", 9.5, INK); txt("Ninguna porción queda tapada por el horizonte.", M, y); y += 8; }
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
  var cl = doc.splitTextToSize(pdfSafe("Día 15 de cada mes, en franjas de media hora (hora oficial del dispositivo). Naranja: sol directo; azul oscuro: sol tapado; gris claro: sol bajo el horizonte. En total, " + (hzOn(p) ? "el horizonte" : "el obstáculo") + " tapa el sol " +
    dot(calR.shadeH, 1) + " h de " + dot(calR.sunH, 1) + " h de sol en los días representados."), W);
  doc.text(cl, M, y); y += cl.length * 3.6 + 6;

  /* ---- PVGIS ---- */
  if (p.pvgis) {
    var pv = p.pvgis, lossE = pv.base.Ey - pv.shaded.Ey;
    need(90); section("Producción estimada con PVGIS");
    var nums = [["Sin sombras", Math.round(pv.base.Ey) + " kWh/año"], ["Con sombras", Math.round(pv.shaded.Ey) + " kWh/año"], ["Pérdida", Math.round(lossE) + " kWh/año (" + dot(100 * lossE / pv.base.Ey, 1) + " %)"]];
    nums.forEach(function (n, i) { var x = M + i * (W / 3); font("bold", 7.5, INK2); txt(n[0].toUpperCase(), x, y); font("normal", 13, i === 2 ? SUN : INK); txt(n[1], x, y + 6.5); });
    y += 12;
    var pvImg = withTheme("light", function () { var c = document.createElement("canvas"); drawPvChartOn(c, 640, 200, 2.2, false); return c.toDataURL("image/jpeg", 0.9); });
    doc.addImage(pvImg, "JPEG", M, y, W, W * 200 / 640); y += W * 200 / 640 + 4;
    font("normal", 8, INK2);
    var pl = doc.splitTextToSize(pdfSafe("Producción media mensual (kWh) con y sin sombras. " + pv.db + " (Comisión Europea), instalación conectada a red de " + String(pv.kwp).replace(".", ",") + " kWp, " + pv.loss +
      " % de pérdidas del sistema, inclinación " + pv.angle + "° y orientación " + pv.aspect + "°. Sin sombras: cielo libre hasta el horizonte. Con sombras: " + (pv.basis || "relieve de PVGIS y obstáculos medidos") + ". Consulta del " + new Date(pv.t).toLocaleDateString("es-ES") + "."), W);
    doc.text(pl, M, y); y += pl.length * 3.6 + 3;
    if (pvStale(p)) {
      font("bold", 8.5, BAD);
      var sl = doc.splitTextToSize(pdfSafe("Atención: el proyecto ha cambiado desde esta consulta (inclinación, orientación, potencia, puntos u horizonte). Vuelva a calcular con PVGIS para que estos valores correspondan al estudio."), W);
      doc.text(sl, M, y); y += sl.length * 3.8;
    }
    y += 3;
  }

  /* ---- Puntos ---- */
  section("Puntos medidos");
  var badMag = p.points.filter(function (q) { return q.mag != null && Math.abs(q.mag) > 0.15; }).length;
  if (badMag) { font("normal", 8.5, BAD); txt(badMag + " puntos se midieron con el campo magnético alterado: su azimut puede tener un error de varios grados.", M, y, { maxWidth: W }); y += 7; }
  if (corrActive(p)) {
    var efp = effPoints(p);
    table(["N.º", "Azimut", "Elevación", "Dist.", "Az. corr.", "El. corr.", "Nota"],
      p.points.map(function (q, i) { var d = q.sky ? null : distFor(p, q); return { cells: [String(i + 1), dot(q.az, 1) + "°", q.sky ? "cielo" : dot(q.elev, 1) + "°", d == null ? "-" : dot(d, 1) + " m",
        efp[i].corrected ? dot(efp[i].az, 1) + "°" : "-", efp[i].corrected ? dot(efp[i].elev, 1) + "°" : "-", q.note || ""] }; }),
      [12, 22, 24, 22, 24, 24, W - 128], ["left", "right", "right", "right", "right", "right", "left"]);
  } else table(["N.º", "Azimut", "Rumbo", "Elevación", "Desv.", "Nota"],
    p.points.map(function (q, i) { return { cells: [String(i + 1), dot(q.az, 1) + "°", dot(q.head, 1) + "°", q.sky ? "cielo" : dot(q.elev, 1) + "°", q.sky ? "-" : "±" + q.sd.toFixed(1).replace(".", ",") + "°", q.note || ""] }; }),
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
