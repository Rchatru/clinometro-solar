/* Vista 3D del horizonte medido (three.js).
   La cúpula es el cielo visto desde el punto de estudio; la pared es la silueta de los obstáculos.
   Se puede ver desde fuera (órbita) o desde el centro, y desde el centro puede seguir la orientación del móvil.
   Ángulos: la app usa azimut con 0° = sur (este negativo); aquí A es el azimut desde el norte (A = az + 180). */
(function () {
"use strict";
var D2R = Math.PI / 180, R2D = 180 / Math.PI;
var $ = function (id) { return document.getElementById(id); };
var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
var ctx = null, R = null, open = false, needs = true, raf = 0, playing = 0;
var st = { day: 355, hour: 10, inside: false, follow: false };
var cam = { az: 205, el: 26, zoomU: 1, yaw: 180, pitch: 18, hfov: 100 };   /* hfov: campo de visión horizontal desde el centro */

function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function norm180(a) { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }
function decl(n) { return 23.44 * Math.sin(2 * Math.PI * (284 + n) / 365); }
/* Posición del sol: devuelve azimut desde el norte (A) y elevación (h) */
function sun(n, t) {
  var phi = ctx.lat * D2R, d = decl(n) * D2R, H = 15 * (t - 12) * D2R;
  var h = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H)) * R2D;
  var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * R2D;
  return { A: (az + 180 + 360) % 360, h: h, az: az };
}
function obstacle(A) { return Math.max(0, ctx.prof(norm180(A - 180))); }
function measured(A) { return Math.max(0, (ctx.wallProf || ctx.prof)(norm180(A - 180))); }
function terrain(A) { return ctx.terr ? Math.max(0, ctx.terr(norm180(A - 180))) : 0; }
function visible(p) { return p.h > 0 && p.h > obstacle(p.A); }
function dayPath(n) { var out = []; for (var t = 3; t <= 21; t += 1 / 30) { var p = sun(n, t); if (p.h > -0.5) out.push({ t: t, A: p.A, h: Math.max(0, p.h), v: visible(p) }); } return out; }
function sunHours(n) { var a = 0, b = 0; for (var t = 0; t < 24; t += 1 / 60) { var p = sun(n, t); if (p.h > 0) { a++; if (p.h > obstacle(p.A)) b++; } } return [a / 60, b / 60]; }

function init() {
  var T = window.THREE, canvas = $("c3d");
  var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new T.Scene(), camera = new T.PerspectiveCamera(42, 1, 0.01, 50);
  function sph(A, h, r) { r = r || 1; var a = A * D2R, e = h * D2R; return new T.Vector3(r * Math.cos(e) * Math.sin(a), r * Math.sin(e), -r * Math.cos(e) * Math.cos(a)); }
  var M = {
    ground: new T.MeshBasicMaterial({ side: T.DoubleSide }),
    dome: new T.MeshBasicMaterial({ transparent: true, opacity: 0.08, side: T.DoubleSide, depthWrite: false }),
    grid: new T.LineBasicMaterial({ transparent: true, opacity: 0.55 }),
    wall: new T.MeshBasicMaterial({ transparent: true, opacity: 0.78, side: T.DoubleSide, depthWrite: false }),
    terr: new T.MeshBasicMaterial({ transparent: true, opacity: 0.42, side: T.DoubleSide, depthWrite: false }),
    terrEdge: new T.LineDashedMaterial({ dashSize: 0.02, gapSize: 0.014 }),
    edge: new T.LineBasicMaterial({}),
    ref: new T.LineDashedMaterial({ dashSize: 0.03, gapSize: 0.025, transparent: true, opacity: 0.9 }),
    path: new T.LineBasicMaterial({ vertexColors: true }),
    dots: new T.PointsMaterial({ vertexColors: true, size: 2.6 * Math.min(window.devicePixelRatio || 1, 2), sizeAttenuation: false }),
    glow: new T.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthTest: false, depthWrite: false }),
    sun: new T.MeshBasicMaterial({}),
    ray: new T.LineBasicMaterial({ transparent: true, opacity: 0.75 }),
    pt: new T.MeshBasicMaterial({}), sky: new T.MeshBasicMaterial({}), obs: new T.MeshBasicMaterial({})
  };
  var ground = new T.Mesh(new T.CircleGeometry(1, 120), M.ground); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  scene.add(new T.Mesh(new T.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), M.dome));
  function line(pts, mat, loop) { var g = new T.BufferGeometry().setFromPoints(pts); return loop ? new T.LineLoop(g, mat) : new T.Line(g, mat); }
  [0, 30, 60].forEach(function (h) { var p = []; for (var A = 0; A < 360; A += 3) p.push(sph(A, h)); scene.add(line(p, M.grid, true)); });
  for (var A = 0; A < 360; A += 45) { var p = []; for (var h = 0; h <= 90; h += 3) p.push(sph(A, h)); scene.add(line(p, M.grid)); }
  var obs = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.07, 16), M.obs); obs.position.y = 0.035; scene.add(obs);
  M.sun.depthTest = false;
  var sunMesh = new T.Mesh(new T.SphereGeometry(0.05, 24, 16), M.sun); sunMesh.renderOrder = 10; scene.add(sunMesh);
  var glow = new T.Mesh(new T.SphereGeometry(0.09, 24, 16), M.glow); glow.renderOrder = 9; scene.add(glow);
  var rayGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]); var ray = new T.Line(rayGeo, M.ray); scene.add(ray);
  var dyn = [];   /* objetos que dependen del proyecto o del día */
  function clearDyn(list) { list.forEach(function (o) { scene.remove(o); if (o.geometry) o.geometry.dispose(); }); list.length = 0; }
  var wallObjs = [], pathObjs = [];
  /* banda de la silueta: f da la altura en cada azimut; r es el radio */
  function band(f, r, mat) {
    var pos = [];
    for (var A = 0; A < 360; A += 1) {
      var h1 = f(A), h2 = f(A + 1);
      if (h1 <= 0 && h2 <= 0) continue;
      var a = sph(A, 0, r), b = sph(A, h1, r), c = sph(A + 1, 0, r), d = sph(A + 1, h2, r);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    }
    var g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    return new T.Mesh(g, mat);
  }
  function buildWall() {
    clearDyn(wallObjs);
    if (ctx.terr) {
      var tm = band(terrain, 0.985, M.terr); tm.renderOrder = 1; scene.add(tm); wallObjs.push(tm);
      var tt = []; for (var B = 0; B < 360; B += 1) tt.push(sph(B, terrain(B), 0.986));
      var tl0 = line(tt, M.terrEdge, true); tl0.computeLineDistances(); scene.add(tl0); wallObjs.push(tl0);
    }
    var pos = [], top = [];
    for (var A = 0; A < 360; A += 1) {
      var h1 = measured(A), h2 = measured(A + 1);
      top.push(sph(A, h1, 0.996));
      if (h1 <= 0 && h2 <= 0) continue;
      var a = sph(A, 0, .995), b = sph(A, h1, .995), c = sph(A + 1, 0, .995), d = sph(A + 1, h2, .995);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    }
    var g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    var wm = new T.Mesh(g, M.wall); scene.add(wm); wallObjs.push(wm);
    var tl = line(top, M.edge, true); tl.renderOrder = 2; wm.renderOrder = 2; scene.add(tl); wallObjs.push(tl);
    ctx.points.forEach(function (q) {
      var m = new T.Mesh(new T.SphereGeometry(q.sky ? 0.02 : 0.016, 12, 8), q.sky ? M.sky : M.pt);
      m.position.copy(sph(q.az + 180, Math.max(0, q.elev), 0.998)); scene.add(m); wallObjs.push(m);
    });
    [172, 80, 355].forEach(function (n) {
      var l = line(dayPath(n).map(function (p) { return sph(p.A, p.h, 1.002); }), M.ref); l.computeLineDistances(); scene.add(l); wallObjs.push(l);
    });
  }
  function buildPath() {
    clearDyn(pathObjs);
    var pts = dayPath(st.day), pos = [], col = [], cv = new T.Color(css("--sun")), ch = new T.Color(css("--v3d-hidden"));
    pts.forEach(function (p) { var v = sph(p.A, p.h, 1.006); pos.push(v.x, v.y, v.z); var c = p.v ? cv : ch; col.push(c.r, c.g, c.b); });
    var g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    var l = new T.Line(g, M.path); scene.add(l); pathObjs.push(l);
    var dots = new T.Points(g.clone(), M.dots); scene.add(dots); pathObjs.push(dots);
  }
  function colors() {
    var C = function (n) { return new T.Color(css(n)); };
    renderer.setClearColor(C("--v3d-sky"));
    M.ground.color = C("--v3d-ground"); M.dome.color = C("--winter"); M.grid.color = C("--v3d-grid");
    M.wall.color = C("--v3d-wall"); M.edge.color = C("--ink"); M.terr.color = C("--terrain"); M.terrEdge.color = C("--terrain"); M.ref.color = C("--ink-2");
    M.ray.color = C("--sun"); M.obs.color = C("--ink"); M.pt.color = C("--sun"); M.sky.color = C("--winter");
  }
  function updateSun() {
    var p = sun(st.day, st.hour), v = sph(p.A, Math.max(p.h, -2), 1);
    sunMesh.position.copy(v); sunMesh.visible = p.h > -1; glow.position.copy(v); glow.visible = p.h > -1;
    M.sun.color = new T.Color(visible(p) ? css("--sun") : css("--v3d-hidden")); M.glow.color = M.sun.color;
    rayGeo.setFromPoints([new T.Vector3(0, 0.05, 0), v]); ray.visible = p.h > 0;
  }
  function placeCamera() {
    if (st.inside) {
      if (st.follow && ctx.sensors) { var s = ctx.sensors(); if (s) { cam.yaw = s.head; cam.pitch = Math.max(-10, Math.min(88, s.elev)); } }
      /* el campo de visión se fija en horizontal para que no dependa de la forma de la pantalla */
      var asp = camera.aspect || 1;
      camera.fov = Math.min(140, 2 * Math.atan(Math.tan(cam.hfov / 2 * D2R) / asp) * R2D); camera.position.set(0, 0.05, 0);
      camera.lookAt(sph(cam.yaw, cam.pitch, 1).add(new T.Vector3(0, 0.05, 0)));
      camera.clearViewOffset(); camera.zoom = 1;
    } else {
      camera.fov = 40; var q = sph(cam.az, cam.el, 3.4); camera.position.set(q.x, q.y, q.z); camera.lookAt(0, 0.35, 0);
      frameDome();
      return;
    }
    camera.updateProjectionMatrix();
  }
  /* Encuadre automático: se proyecta el contorno de la cúpula (con las letras de los puntos cardinales)
     y se ajustan el zoom y el desplazamiento de la vista para centrarla y ocupar el hueco disponible. */
  var FRAME = [];
  for (var fa = 0; fa < 360; fa += 20) { FRAME.push(sph(fa, 0, 1.13)); FRAME.push(sph(fa, 35, 1)); FRAME.push(sph(fa, 65, 1)); }
  FRAME.push(new T.Vector3(0, 1, 0));
  function frameDome() {
    camera.clearViewOffset(); camera.zoom = 1; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    var x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    FRAME.forEach(function (p) { var v = p.clone().project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
    var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    /* márgenes: arriba queda la barra con los botones (unos 64 px) */
    var topPx = 64, side = 0.94, avail = (h - topPx - 12) / h;
    var z = Math.min(side / ((x1 - x0) / 2), (2 * avail * 0.96) / (y1 - y0)) * cam.zoomU;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var targetY = -topPx / h;                     /* centro del hueco libre, en coordenadas normalizadas */
    camera.setViewOffset(w, h, cx * z * w / 2, -(cy * z - targetY) * h / 2, w, h);
    camera.zoom = z; camera.updateProjectionMatrix();
  }
  /* Etiquetas proyectadas */
  var LBL = [["N", 0, 0], ["NE", 45, 0], ["E", 90, 0], ["SE", 135, 0], ["S", 180, 0], ["SO", 225, 0], ["O", 270, 0], ["NO", 315, 0], ["30°", 180, 30, "s"], ["60°", 180, 60, "s"], ["Cénit", 0, 90, "s"]];
  var lblBox = $("v3dLabels"); lblBox.textContent = "";
  LBL.forEach(function (l) { var d = document.createElement("div"); d.className = "v3d-lbl" + (l[3] ? " " + l[3] : ""); d.textContent = l[0]; lblBox.appendChild(d); l.el = d; });
  function placeLabels() {
    var w = canvas.clientWidth, h = canvas.clientHeight, dir = new T.Vector3(); camera.getWorldDirection(dir);
    LBL.forEach(function (l) {
      var p = sph(l[1], l[2], l[2] === 0 ? 1.1 : 1.03), v = p.clone().project(camera), show = v.z < 1 && p.clone().sub(camera.position).dot(dir) > 0;
      if (l[0] === "Cénit" && !st.inside) show = false;
      l.el.hidden = !show; if (show) { l.el.style.left = ((v.x + 1) / 2 * w) + "px"; l.el.style.top = ((1 - v.y) / 2 * h) + "px"; }
    });
  }
  function resize() {
    var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; needs = true;
  }
  function render() { placeCamera(); renderer.render(scene, camera); placeLabels(); }
  return { buildWall: buildWall, buildPath: buildPath, colors: colors, updateSun: updateSun, resize: resize, render: render };
}

/* ---------- Lecturas ---------- */
function fmtH(x) { x = ((x % 24) + 24) % 24; var h = Math.floor(x), m = Math.round((x - h) * 60); if (m === 60) { h = (h + 1) % 24; m = 0; } return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); }
function fmtDur(x) { var h = Math.floor(x), m = Math.round((x - h) * 60); return h + " h " + String(m).padStart(2, "0") + " min"; }
function dateOf(n) { var y = new Date().getFullYear(); return new Date(y, 0, n, 12); }
function fmt(n, d) { return (n < 0 ? "−" : "") + Math.abs(n).toFixed(d).replace(".", ","); }
function readouts() {
  var p = sun(st.day, st.hour), hh = obstacle(p.A), d = dateOf(st.day);
  $("v3dDayLbl").textContent = d.getDate() + " de " + MESES[d.getMonth()];
  /* hora oficial aproximada: hora solar − longitud/15 + desfase del huso del móvil ese día (sin ecuación del tiempo) */
  var off = -d.getTimezoneOffset() / 60, official = st.hour - ctx.lon / 15 + off;
  $("v3dHourLbl").textContent = fmtH(st.hour) + " · ≈ " + fmtH(official) + " oficial";
  var s = $("v3dState");
  if (p.h <= 0) { s.className = "st night"; s.textContent = "Sol bajo el horizonte"; }
  else if (p.h > hh) { s.className = "st sun"; s.textContent = "Sol directo"; }
  else { s.className = "st shade"; s.textContent = "Sol tapado"; }
  $("v3dRead").textContent = p.h > 0 ? "altura " + fmt(p.h, 1) + "° · azimut " + (p.az > 0 ? "+" : "") + fmt(p.az, 0) + "°" + (hh > 0 ? " · obstáculo " + fmt(hh, 1) + "°" : "") : "";
  var sh = sunHours(st.day);
  $("v3dSunH").textContent = "Sol ese día: " + fmtDur(sh[1]) + " de " + fmtDur(sh[0]);
}

/* ---------- Interacción ---------- */
var ptrs = {}, pinch0 = 0, dist0 = 0;
function bindOnce() {
  var v = $("v3dStage");
  v.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".v3d-top,.v3d-follow")) return;
    hideHint();
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; try { v.setPointerCapture(e.pointerId); } catch (x) {}
    var k = Object.keys(ptrs); if (k.length === 2) { var a = ptrs[k[0]], b = ptrs[k[1]]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = st.inside ? cam.hfov : cam.zoomU; }
  });
  v.addEventListener("pointermove", function (e) {
    var p = ptrs[e.pointerId]; if (!p) return;
    var k = Object.keys(ptrs);
    if (k.length === 2) {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var a = ptrs[k[0]], b = ptrs[k[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 && !st.inside) { cam.zoomU = Math.max(0.6, Math.min(3, dist0 * d / pinch0)); needs = true; }
      if (pinch0 && st.inside) { cam.hfov = Math.max(35, Math.min(125, dist0 * pinch0 / d)); needs = true; }
      return;
    }
    var dx = e.clientX - p.x, dy = e.clientY - p.y; ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (st.inside) { if (st.follow) return; var k2 = cam.hfov / (v.clientWidth || 400); cam.yaw -= dx * k2; cam.pitch = Math.max(-10, Math.min(88, cam.pitch + dy * k2)); }
    else { cam.az -= dx * 0.35; cam.el = Math.max(3, Math.min(88, cam.el + dy * 0.3)); }
    needs = true;
  });
  function up(e) { delete ptrs[e.pointerId]; pinch0 = 0; }
  v.addEventListener("pointerup", up); v.addEventListener("pointercancel", up);
  v.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (st.inside) { cam.hfov = Math.max(35, Math.min(125, cam.hfov * (e.deltaY > 0 ? 1.08 : 0.93))); needs = true; return; }
    cam.zoomU = Math.max(0.6, Math.min(3, cam.zoomU * (e.deltaY > 0 ? 0.93 : 1.08))); needs = true; }, { passive: false });
  $("v3dClose").addEventListener("click", close);
  $("v3dOut").addEventListener("click", function () { setInside(false); });
  $("v3dIn").addEventListener("click", function () { setInside(true); });
  $("v3dFollow").addEventListener("click", function () { st.follow = !st.follow; this.setAttribute("aria-pressed", String(st.follow)); hint(); needs = true; });
  $("v3dDay").addEventListener("input", function () { st.day = +this.value; R.buildPath(); R.updateSun(); readouts(); needs = true; });
  $("v3dHour").addEventListener("input", function () { st.hour = +this.value; R.updateSun(); readouts(); needs = true; });
  document.querySelectorAll(".v3d-presets button").forEach(function (b) {
    b.addEventListener("click", function () {
      var d = b.dataset.d;
      if (d === "today") { var now = new Date(), y0 = new Date(now.getFullYear(), 0, 0); st.day = Math.floor((now - y0) / 86400000); }
      else st.day = +d;
      $("v3dDay").value = st.day; R.buildPath(); R.updateSun(); readouts(); needs = true;
    });
  });
  $("v3dPlay").addEventListener("click", function () {
    var btn = this;
    if (playing) { cancelAnimationFrame(playing); playing = 0; btn.textContent = "Reproducir el día"; return; }
    btn.textContent = "Pausar";
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, last = performance.now();
    (function step(now) {
      var dt = (now - last) / 1000; last = now;
      st.hour += reduce ? 0.25 : dt * 1.2; if (st.hour > 20) st.hour = 4;
      $("v3dHour").value = st.hour; R.updateSun(); readouts(); needs = true;
      playing = requestAnimationFrame(step);
    })(last);
  });
  window.addEventListener("resize", function () { if (open) R.resize(); });
  if (window.ResizeObserver) new ResizeObserver(function () { if (open) R.resize(); }).observe($("v3dStage"));
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (open) { R.colors(); R.buildPath(); R.updateSun(); needs = true; } });
}
var hintTimer = 0;
function hint() {
  var h = $("v3dHint");
  h.textContent = !st.inside ? "Arrastre para girar · pellizque para acercar" : st.follow ? "Mueva el móvil para mirar · pellizque para acercar" : "Arrastre para mirar · pellizque para acercar";
  h.classList.remove("gone"); clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 3500);
}
function hideHint() { clearTimeout(hintTimer); $("v3dHint").classList.add("gone"); }
function setInside(v) {
  st.inside = v;
  $("v3dOut").setAttribute("aria-pressed", String(!v)); $("v3dIn").setAttribute("aria-pressed", String(v));
  $("v3dFollow").hidden = !(v && ctx.sensors && ctx.sensors());
  if (!v) { st.follow = false; $("v3dFollow").setAttribute("aria-pressed", "false"); }
  hint(); needs = true;
}
function loop() {
  if (!open) return;
  if (needs || (st.inside && st.follow)) { R.render(); needs = false; }
  raf = requestAnimationFrame(loop);
}
var bound = false;
function openView(c) {
  ctx = c;
  if (!R) R = init();
  if (!bound) { bindOnce(); bound = true; }
  $("v3d").hidden = false; open = true; $("v3dTerrKey").hidden = !c.terr;
  if (c.day) st.day = c.day; if (c.hour != null) st.hour = c.hour;
  $("v3dDay").value = st.day; $("v3dHour").value = st.hour;
  /* desde fuera, mirar desde el lado opuesto a los obstáculos para verlos de frente */
  var sx = 0, sy = 0; ctx.points.forEach(function (q) { if (!q.sky) { sx += Math.sin((q.az + 180) * D2R); sy += Math.cos((q.az + 180) * D2R); } });
  if (sx || sy) cam.az = (Math.atan2(sx, sy) * R2D + 180 + 360) % 360;
  R.colors(); R.buildWall(); R.buildPath(); R.updateSun(); R.resize(); readouts(); setInside(st.inside);
  needs = true; loop();
}
function close() {
  open = false; cancelAnimationFrame(raf);
  if (playing) { cancelAnimationFrame(playing); playing = 0; $("v3dPlay").textContent = "Reproducir el día"; }
  $("v3d").hidden = true;
  if (ctx && ctx.onClose) ctx.onClose();
}
window.Vista3D = { open: openView, close: close, isOpen: function () { return open; } };
})();
