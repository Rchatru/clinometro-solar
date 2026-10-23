/* Pérdidas de radiación solar por sombras — método del Anexo III del Pliego de Condiciones Técnicas
   de Instalaciones Conectadas a Red (IDAE, PCT-C-REV, julio 2011).

   Cada porción del diagrama (A1…D14) es el recorrido del sol durante una hora solar a lo largo de una
   franja de declinaciones. Las tablas V-1 a V-11 dan el porcentaje de irradiación global anual que se
   pierde si una porción queda tapada, según la inclinación (β) y el azimut (α) de la superficie.

   La geometría de las porciones se calcula para la latitud real del proyecto (el pliego dibuja el
   diagrama para Madrid y propone desplazarlo 12° hacia arriba en Canarias). Los valores de las tablas
   son los del pliego. */
(function () {
"use strict";
var D2R = Math.PI / 180, R2D = 180 / Math.PI;
var ORDER = [13, 11, 9, 7, 5, 3, 1, 2, 4, 6, 8, 10, 12, 14];
function T(id, beta, alpha, rows, note) {
  var cells = {};
  ORDER.forEach(function (n, i) { ["A", "B", "C", "D"].forEach(function (L, j) { cells[L + n] = rows[i][j]; }); });
  return { id: id, beta: beta, alpha: alpha, cells: cells, note: note || "" };
}
var TABLES = [
  T("V-1", 35, 0, [[0,0,0,.03],[0,.01,.12,.44],[.13,.41,.62,1.49],[1,.95,1.27,2.76],[1.84,1.5,1.83,3.87],[2.7,1.88,2.21,4.67],[3.15,2.12,2.43,5.04],
                   [3.17,2.12,2.33,4.99],[2.7,1.89,2.01,4.46],[1.79,1.51,1.65,3.63],[.98,.99,1.08,2.55],[.11,.42,.52,1.33],[0,.02,.1,.4],[0,0,0,.02]]),
  T("V-2", 0, 0, [[0,0,0,.18],[0,.01,.18,1.05],[.05,.32,.7,2.23],[.52,.77,1.32,3.56],[1.11,1.26,1.85,4.66],[1.75,1.6,2.2,5.44],[2.1,1.81,2.4,5.78],
                  [2.11,1.8,2.3,5.73],[1.75,1.61,2,5.19],[1.09,1.26,1.65,4.37],[.51,.82,1.11,3.28],[.05,.33,.57,1.98],[0,.02,.15,.96],[0,0,0,.17]]),
  T("V-3", 90, 0, [[0,0,0,.15],[0,.01,.02,.15],[.23,.5,.37,.1],[1.66,1.06,.93,.78],[2.76,1.62,1.43,1.68],[3.83,2,1.77,2.36],[4.36,2.23,1.98,2.69],
                   [4.4,2.23,1.91,2.66],[3.82,2.01,1.62,2.26],[2.68,1.62,1.3,1.58],[1.62,1.09,.79,.74],[.19,.49,.32,.1],[0,.02,.02,.13],[0,0,0,.13]]),
  T("V-4", 35, 30, [[0,0,0,.1],[0,0,.03,.06],[.02,.1,.19,.56],[.54,.55,.78,1.8],[1.32,1.12,1.4,3.06],[2.24,1.6,1.92,4.14],[2.89,1.98,2.31,4.87],
                    [3.16,2.15,2.4,5.2],[2.93,2.08,2.23,5.02],[2.14,1.82,2,4.46],[1.33,1.36,1.48,3.54],[.18,.71,.88,2.26],[0,.06,.32,1.17],[0,0,0,.22]]),
  T("V-5", 90, 30, [[.1,0,0,.33],[.06,.01,.15,.51],[.56,.06,.14,.43],[1.8,.04,.07,.31],[3.06,.55,.22,.11],[4.14,1.16,.87,.67],[4.87,1.73,1.49,1.86],
                    [5.2,2.15,1.88,2.79],[5.02,2.34,2.02,3.29],[4.46,2.28,2.05,3.36],[3.54,1.92,1.71,2.98],[2.26,1.19,1.19,2.12],[1.17,.12,.53,1.22],[.22,0,0,.24]],
    "En el pliego, la columna A de esta tabla coincide con la columna D de la tabla V-4; probablemente es una errata del original."),
  T("V-6", 35, 60, [[0,0,0,.14],[0,0,.08,.16],[.02,.04,.04,.02],[.02,.13,.31,1.02],[.64,.68,.97,2.39],[1.55,1.24,1.59,3.7],[2.35,1.74,2.12,4.73],
                    [2.85,2.05,2.38,5.4],[2.86,2.14,2.37,5.53],[2.24,2,2.27,5.25],[1.51,1.61,1.81,4.49],[.23,.94,1.2,3.18],[0,.09,.52,1.96],[0,0,0,.55]]),
  T("V-7", 90, 60, [[0,0,0,.43],[0,.01,.27,.78],[.09,.21,.33,.76],[.21,.18,.27,.7],[.1,.11,.21,.52],[.45,.03,.05,.25],[1.73,.8,.62,.55],
                    [2.91,1.56,1.42,2.26],[3.59,2.13,1.97,3.6],[3.35,2.43,2.37,4.45],[2.67,2.35,2.28,4.65],[.47,1.64,1.82,3.95],[0,.19,.97,2.93],[0,0,0,1]]),
  T("V-8", 35, -30, [[0,0,0,.22],[0,.03,.37,1.26],[.21,.7,1.05,2.5],[1.34,1.28,1.73,3.79],[2.17,1.79,2.21,4.7],[2.9,2.05,2.43,5.2],[3.12,2.13,2.47,5.2],
                     [2.88,1.96,2.19,4.77],[2.22,1.6,1.73,3.91],[1.27,1.11,1.25,2.84],[.52,.57,.65,1.64],[.02,.1,.15,.5],[0,0,.03,.05],[0,0,0,.08]]),
  T("V-9", 90, -30, [[0,0,0,.24],[0,.05,.6,1.28],[.43,1.17,1.38,2.3],[2.42,1.82,1.98,3.15],[3.43,2.24,2.24,3.51],[4.12,2.29,2.18,3.38],[4.05,2.11,1.93,2.77],
                     [3.45,1.71,1.41,1.81],[2.43,1.14,.79,.64],[1.24,.54,.2,.11],[.4,.03,.06,.31],[.01,.06,.12,.39],[0,.01,.13,.45],[0,0,0,.27]]),
  T("V-10", 35, -60, [[0,0,0,.56],[0,.04,.6,2.09],[.27,.91,1.42,3.49],[1.51,1.51,2.1,4.76],[2.25,1.95,2.48,5.48],[2.8,2.08,2.56,5.68],[2.78,2.01,2.43,5.34],
                      [2.32,1.7,2,4.59],[1.52,1.22,1.42,3.46],[.62,.67,.85,2.2],[.02,.14,.26,.92],[.02,.04,.03,.02],[0,.01,.07,.14],[0,0,0,.12]]),
  T("V-11", 90, -60, [[0,0,0,1.01],[0,.08,1.1,3.08],[.55,1.6,2.11,4.28],[2.66,2.19,2.61,4.89],[3.36,2.37,2.56,4.61],[3.49,2.06,2.1,3.67],[2.81,1.52,1.44,2.22],
                      [1.69,.78,.58,.53],[.44,.03,.05,.24],[.1,.13,.19,.48],[.22,.18,.26,.69],[.08,.21,.28,.68],[0,.02,.24,.67],[0,0,0,.36]])
];

/* Franjas de declinación (A = invierno … D = verano) */
var BANDS = { A: [-23.45, -11.725], B: [-11.725, 0], C: [0, 11.725], D: [11.725, 23.45] };
/* Intervalo horario de la porción n: impares por la mañana, pares por la tarde */
function hours(n) { var k = Math.ceil(n / 2); return n % 2 ? [-k, -(k - 1)] : [k - 1, k]; }

function sunPos(lat, decl, hDeg) {
  var phi = lat * D2R, d = decl * D2R, H = hDeg * D2R;
  var el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H)) * R2D;
  var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * R2D;
  return [az, el];
}

/* Tabla más parecida a la superficie de estudio */
function pick(beta, alpha) {
  if (beta < 17.5) return TABLES[1];
  var b = beta < 62.5 ? 35 : 90;
  var a = Math.max(-60, Math.min(60, Math.round(alpha / 30) * 30));
  for (var i = 0; i < TABLES.length; i++) if (TABLES[i].beta === b && TABLES[i].alpha === a) return TABLES[i];
  return TABLES[0];
}

/* Perfil de obstáculos: elevación en función del azimut (interpolación lineal, 0 fuera de lo medido) */
/* Perfil como polilínea. Los puntos de cielo (sky) marcan huecos sin obstáculo: junto a ellos el perfil
   cae en vertical a 0 en el último punto del obstáculo, en lugar de bajar en rampa hasta el hueco. */
function expandProfile(points) {
  var p = points.slice().sort(function (a, b) { return a.az - b.az; }), out = [];
  for (var i = 0; i < p.length; i++) {
    var q = p[i], prev = p[i - 1], next = p[i + 1];
    if (q.sky) { out.push({ az: q.az, elev: 0, sky: true }); continue; }
    if (prev && prev.sky) out.push({ az: q.az, elev: 0 });
    out.push({ az: q.az, elev: q.elev });
    if (next && next.sky) out.push({ az: q.az, elev: 0 });
  }
  return out;
}
/* Si los puntos dan casi la vuelta completa (hueco de cierre de 30° o menos),
   el perfil se cierra uniendo el último punto con el primero a través de ±180° (norte). */
var CLOSE_GAP = 30;
function profileFn(points) {
  var p = expandProfile(points);
  var wrap = p.length >= 3 && p[0].az + 360 - p[p.length - 1].az <= CLOSE_GAP;
  return function (az) {
    if (!p.length) return 0;
    if (az < p[0].az || az > p[p.length - 1].az) {
      if (!wrap) return 0;
      var L = p[p.length - 1], F = p[0], x = az < F.az ? az + 360 : az, w0 = F.az + 360 - L.az;
      return w0 <= 0 ? Math.max(L.elev, F.elev) : L.elev + (F.elev - L.elev) * (x - L.az) / w0;
    }
    var hit = -1; p.forEach(function (v) { if (v.az === az && v.elev > hit) hit = v.elev; });
    if (hit >= 0) return hit;
    for (var i = 1; i < p.length; i++) {
      if (az <= p[i].az) {
        var a = p[i - 1], b = p[i], w = b.az - a.az;
        return w <= 0 ? Math.max(a.elev, b.elev) : a.elev + (b.elev - a.elev) * (az - a.az) / w;
      }
    }
    return p[p.length - 1].elev;
  };
}

/* Factor de llenado según el pliego: valor más próximo a 0,25 / 0,5 / 0,75 / 1 (0 si apenas se tapa) */
function roundFill(f) {
  if (f < 0.125) return 0;
  var opts = [.25, .5, .75, 1], best = 1, bd = 9;
  opts.forEach(function (o) { if (Math.abs(f - o) < bd) { bd = Math.abs(f - o); best = o; } });
  return best;
}

function compute(points, lat, table) {
  var prof = typeof points === "function" ? points : profileFn(points), cells = [], total = 0, exact = 0, N = 16;
  ["A", "B", "C", "D"].forEach(function (L) {
    for (var n = 1; n <= 14; n++) {
      var id = L + n, v = table.cells[id]; if (!v) continue;
      var hr = hours(n), bd = BANDS[L], seen = 0, hid = 0;
      for (var i = 0; i < N; i++) for (var j = 0; j < N; j++) {
        var d = bd[0] + (bd[1] - bd[0]) * (i + .5) / N, h = (hr[0] + (hr[1] - hr[0]) * (j + .5) / N) * 15;
        var s = sunPos(lat, d, h); if (s[1] <= 0) continue;
        seen++; if (s[1] < prof(s[0])) hid++;
      }
      if (!seen) continue;
      var f = hid / seen, r = roundFill(f);
      exact += f * v; total += r * v;
      if (f > 0) cells.push({ id: id, v: v, f: f, fill: r, loss: r * v });
    }
  });
  cells.sort(function (a, b) { return b.loss - a.loss || b.f - a.f; });
  return { cells: cells, total: total, exact: exact };
}

/* Contorno de una porción en coordenadas (azimut, elevación) para dibujarla */
function outline(id, lat) {
  var L = id[0], n = +id.slice(1), bd = BANDS[L], hr = hours(n), pts = [], k;
  for (k = 0; k <= 12; k++) pts.push(sunPos(lat, bd[0], (hr[0] + (hr[1] - hr[0]) * k / 12) * 15));
  for (k = 0; k <= 8; k++) pts.push(sunPos(lat, bd[0] + (bd[1] - bd[0]) * k / 8, hr[1] * 15));
  for (k = 12; k >= 0; k--) pts.push(sunPos(lat, bd[1], (hr[0] + (hr[1] - hr[0]) * k / 12) * 15));
  for (k = 8; k >= 0; k--) pts.push(sunPos(lat, bd[0] + (bd[1] - bd[0]) * k / 8, hr[0] * 15));
  return pts;
}
function center(id, lat) {
  var L = id[0], n = +id.slice(1), bd = BANDS[L], hr = hours(n);
  return sunPos(lat, (bd[0] + bd[1]) / 2, (hr[0] + hr[1]) / 2 * 15);
}
function ids() { var out = []; ["A", "B", "C", "D"].forEach(function (L) { for (var n = 1; n <= 14; n++) out.push(L + n); }); return out; }

/* Límites de la tabla I del pliego (pérdidas por sombras) */
var LIMITS = [{ key: "general", name: "General", max: 10 }, { key: "superposicion", name: "Superposición", max: 15 }, { key: "integracion", name: "Integración arquitectónica", max: 20 }];

var api = { TABLES: TABLES, pick: pick, compute: compute, profileFn: profileFn, expandProfile: expandProfile, outline: outline, center: center, ids: ids, LIMITS: LIMITS, sunPos: sunPos };
if (typeof window !== "undefined") window.IDAE = api;
if (typeof module !== "undefined") module.exports = api;
})();
