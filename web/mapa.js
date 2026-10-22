/* Elegir la ubicación del proyecto en un mapa (Leaflet).
   El pin queda fijo en el centro: se mueve el mapa hasta dejarlo sobre el sitio y se confirma.
   Capas: callejero de OpenStreetMap y ortofoto (PNOA del IGN en Canarias, Esri en el resto).
   El buscador usa Nominatim (OpenStreetMap) y entiende también coordenadas y enlaces de Google Maps. */
(function () {
"use strict";
var $ = function (id) { return document.getElementById(id); };
var map = null, ctx = null, layers = null, cur = "street", bound = false;

function fmtC(v, pos, neg) { return Math.abs(v).toFixed(5).replace(".", ",") + "° " + (v >= 0 ? pos : neg); }
function readout() {
  var c = map.getCenter();
  $("mapCoords").textContent = fmtC(c.lat, "N", "S") + ", " + fmtC(wrap(c.lng), "E", "O");
}
function wrap(l) { return ((l + 180) % 360 + 360) % 360 - 180; }

function makeLayers() {
  var L = window.L;
  var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>" });
  var esri = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, maxNativeZoom: 18, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics" });
  var pnoa = L.tileLayer("https://www.ign.es/wmts/pnoa-ma?layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}", {
    maxZoom: 20, maxNativeZoom: 19, bounds: [[27.55, -18.25], [29.45, -13.30]], attribution: "PNOA © <a href=\"https://www.ign.es\">IGN</a>" });
  return { street: L.layerGroup([osm]), photo: L.layerGroup([esri, pnoa]) };
}
function setLayer(k) {
  cur = k;
  Object.keys(layers).forEach(function (n) { if (n === k) layers[n].addTo(map); else map.removeLayer(layers[n]); });
  $("mapStreet").setAttribute("aria-pressed", String(k === "street")); $("mapPhoto").setAttribute("aria-pressed", String(k === "photo"));
  try { localStorage.setItem("cs.mapLayer", k); } catch (e) {}
}

/* Coordenadas escritas a mano o dentro de un enlace de Google Maps / OpenStreetMap */
function parseCoords(t) {
  t = t.trim();
  var m = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || t.match(/[?&](?:q|query|ll|mlat)=(-?\d+(?:\.\d+)?)(?:,|%2C|&mlon=)(-?\d+(?:\.\d+)?)/i) ||
          t.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  var a = parseFloat(m[1].replace(",", ".")), b = parseFloat(m[2].replace(",", "."));
  if (isNaN(a) || isNaN(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [a, b];
}
var lastSearch = 0;
async function search(q) {
  var box = $("mapResults"); box.textContent = ""; box.hidden = true;
  q = q.trim(); if (!q) return;
  var c = parseCoords(q);
  if (c) { map.setView(c, Math.max(map.getZoom(), 17)); $("mapQ").blur(); return; }
  /* Nominatim pide como máximo una consulta por segundo */
  var wait = 1100 - (Date.now() - lastSearch); if (wait > 0) await new Promise(function (r) { setTimeout(r, wait); });
  lastSearch = Date.now();
  $("mapGo").disabled = true;
  try {
    var b = map.getBounds().pad(4);
    var url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=es&q=" + encodeURIComponent(q) +
      "&viewbox=" + [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(function (v) { return v.toFixed(3); }).join(",");
    var res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("respuesta " + res.status);
    var list = await res.json();
    if (!list.length) { note("No se ha encontrado «" + q + "». Pruebe con el municipio o escriba las coordenadas."); return; }
    list.forEach(function (r) {
      var li = document.createElement("li"), bt = document.createElement("button"); bt.type = "button";
      var parts = String(r.display_name).split(", ");
      bt.innerHTML = "<b></b><span></span>"; bt.firstChild.textContent = parts[0]; bt.lastChild.textContent = parts.slice(1, 4).join(", ");
      bt.addEventListener("click", function () {
        box.hidden = true; $("mapQ").blur();
        var z = r.addresstype === "municipality" || r.addresstype === "city" || r.addresstype === "town" ? 14 : r.addresstype === "village" ? 16 : 18;
        map.setView([+r.lat, +r.lon], z);
      });
      li.appendChild(bt); box.appendChild(li);
    });
    box.hidden = false;
  } catch (e) { note("No se ha podido buscar. Compruebe la conexión a internet."); }
  finally { $("mapGo").disabled = false; }
}
function note(t) { var box = $("mapResults"); box.innerHTML = '<li class="map-note"></li>'; box.firstChild.textContent = t; box.hidden = false; }

function bindOnce() {
  $("mapBack").addEventListener("click", close);
  $("mapStreet").addEventListener("click", function () { setLayer("street"); });
  $("mapPhoto").addEventListener("click", function () { setLayer("photo"); });
  $("mapForm").addEventListener("submit", function (e) { e.preventDefault(); search($("mapQ").value); });
  $("mapQ").addEventListener("input", function () { if (!this.value) $("mapResults").hidden = true; });
  $("mapUse").addEventListener("click", function () {
    var c = map.getCenter(), cb = ctx && ctx.onPick;
    close(); if (cb) cb(+c.lat.toFixed(5), +wrap(c.lng).toFixed(5));
  });
}
function openMap(c) {
  ctx = c;
  if (!bound) { bindOnce(); bound = true; }
  $("mapv").hidden = false; $("mapResults").hidden = true; $("mapQ").value = "";
  if (!map) {
    map = window.L.map("mapEl", { zoomControl: false, attributionControl: true, worldCopyJump: true });
    map.attributionControl.setPrefix(false);
    window.L.control.zoom({ position: "bottomright" }).addTo(map);
    layers = makeLayers();
    var saved = null; try { saved = localStorage.getItem("cs.mapLayer"); } catch (e) {}
    setLayer(saved === "photo" ? "photo" : "street");
    map.on("move", readout);
    map.on("movestart", function () { $("mapResults").hidden = true; });
  }
  map.invalidateSize();
  map.setView([c.lat, c.lon], c.zoom || 17, { animate: false });
  readout();
}
function close() {
  if ($("mapv").hidden) return;
  $("mapv").hidden = true;
  if (ctx && ctx.onClose) ctx.onClose();
}
window.Mapa = { open: openMap, close: close, parseCoords: parseCoords };
})();
