"""Pruebas de extremo a extremo de Clinómetro Solar (navegador Chromium sin interfaz).
Uso: python3 tests/flujos.py web [carpeta_salida]
Simula cámara y sensores, recorre todos los flujos y comprueba resultados y persistencia."""
import sys, os, json, threading, http.server, functools, subprocess, math, traceback
from playwright.sync_api import sync_playwright

ROOT = sys.argv[1] if len(sys.argv) > 1 else "web"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/cs-tests"
os.makedirs(OUT, exist_ok=True)
PVG = os.environ.get("PVGIS_FIXTURES")  # carpeta con hz.json, calc.json, calc2.json

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=ROOT))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/index.html"

results = []
def check(name, cond, info=""):
    results.append((name, bool(cond), info)); print(("OK   " if cond else "FALLO") + " " + name + ("" if cond else "  → " + str(info)))

SENS = """window.__o={a:200,b:105,g:0};setInterval(()=>{const e=new Event('deviceorientationabsolute');
e.alpha=__o.a;e.beta=__o.b;e.gamma=__o.g;e.absolute=true;window.dispatchEvent(e)},20)"""
def db(pg): return pg.evaluate("JSON.parse(localStorage.getItem('cs.v2'))")
def P(pg): d = db(pg); return [p for p in d["projects"] if p["id"] == d["currentId"]][0]
def aim(pg, head, elev, decl=-4.0):
    # rumbo magnético = rumbo geográfico − declinación; alpha = 360 − rumbo magnético
    pg.evaluate(f"__o.a={(360 - (head - decl)) % 360};__o.b={90 + elev};__o.g=0")

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    def newpage(scheme="light", init=None):
        ctx = br.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=1, color_scheme=scheme,
                             permissions=["camera", "clipboard-read", "clipboard-write"], accept_downloads=True)
        pg = ctx.new_page(); pg.errs = []
        pg.on("pageerror", lambda e: pg.errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and pg.errs.append(m.text))
        if init: pg.add_init_script(init)
        if PVG:
            def mock(route):
                u = route.request.url; f = "hz.json" if "printhorizon" in u else ("calc2.json" if "userhorizon" in u else "calc.json")
                route.fulfill(status=200, body=open(os.path.join(PVG, f)).read(), headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"})
            pg.route("https://re.jrc.ec.europa.eu/**", mock)
        pg.goto(URL); pg.wait_for_timeout(300)
        return ctx, pg
    try:
        # ---------- 1. Arranque limpio ----------
        ctx, pg = newpage()
        d = db(pg); p = d["projects"][0]
        check("arranque: proyecto inicial", len(d["projects"]) == 1 and p["name"] == "Proyecto 1", d)
        check("arranque: declinación WMM en La Palma ≈ −4°", abs(p["decl"] + 4.0) < 0.3, p["decl"])
        check("arranque: bienvenida visible y cinta oculta", pg.is_visible("#startPanel") and not pg.is_visible("#tape"))

        # ---------- 2. Medición ----------
        pg.click("#btnStart"); pg.evaluate(SENS); pg.wait_for_timeout(1200)
        check("medir: bienvenida se cierra con datos", not pg.is_visible("#startPanel"))
        check("medir: cinta visible", pg.is_visible("#tape"))
        aim(pg, 150, 20); pg.wait_for_timeout(1300)
        el = pg.inner_text("#vElev"); az = pg.inner_text("#vAz")
        check("medir: lectura de elevación 20,0", el.replace("−", "-") in ("20,0", "19,9", "20,1"), el)
        check("medir: lectura de azimut −30", az in ("−30", "−29", "−31"), az)
        pg.click("#btnSave"); pg.wait_for_timeout(700)
        aim(pg, 180, 30); pg.wait_for_timeout(1200); pg.click("#btnSave"); pg.wait_for_timeout(700)
        aim(pg, 210, 12); pg.wait_for_timeout(1200); pg.click("#btnSave"); pg.wait_for_timeout(900)
        pts = P(pg)["points"]
        check("medir: 3 puntos guardados", len(pts) == 3, len(pts))
        check("medir: valores del punto 2 (az 0, el 30)", abs(pts[1]["az"]) < 0.6 and abs(pts[1]["elev"] - 30) < 0.3, pts[1])
        check("medir: fotos guardadas", all(q.get("photo") for q in pts), [q.get("photo") for q in pts])
        check("medir: contador", pg.inner_text("#vCount") == "3")
        pg.click("#btnUndo"); pg.wait_for_timeout(200)
        check("medir: deshacer", len(P(pg)["points"]) == 2)
        # retardo
        pg.click("[data-tab=settings]"); pg.select_option("#inDelay", "2"); pg.click("[data-tab=measure]")
        aim(pg, 210, 12); pg.wait_for_timeout(800); pg.click("#btnSave"); pg.wait_for_timeout(300)
        check("disparo: cuenta atrás visible", pg.is_visible("#countdown"))
        check("disparo: aún no guarda durante la cuenta", len(P(pg)["points"]) == 2)
        pg.wait_for_timeout(2300)
        check("disparo: guarda tras el retardo", len(P(pg)["points"]) == 3)
        pg.click("[data-tab=settings]"); pg.select_option("#inDelay", "0")
        # tocar el visor
        pg.check("#inTap"); pg.click("[data-tab=measure]"); pg.mouse.click(200, 330); pg.wait_for_timeout(400)
        check("disparo: tocar el visor", len(P(pg)["points"]) == 4)
        pg.click("[data-tab=settings]"); pg.uncheck("#inTap"); pg.click("[data-tab=measure]")
        check("volumen: dispara en Medir", pg.evaluate("window.__volShutter()") is True)
        pg.wait_for_timeout(300)
        pg.click("[data-tab=points]")
        check("volumen: no dispara fuera de Medir", pg.evaluate("window.__volShutter()") is False)
        check("puntos: 5 en la lista", pg.locator("#plist li").count() == 5, pg.locator("#plist li").count())

        # ---------- 3. Lista de puntos ----------
        pg.fill("#note-0", "esquina este"); pg.press("#note-0", "Tab"); pg.wait_for_timeout(100)
        pg.locator("#plist li").nth(4).locator(".p-del").click(); pg.wait_for_timeout(200)
        check("puntos: borrar uno", len(P(pg)["points"]) == 4)
        pg.wait_for_timeout(300)
        check("puntos: miniatura de foto", pg.locator(".p-thumb img").first.get_attribute("src") is not None)
        pg.locator(".p-thumb").first.click(); pg.wait_for_timeout(300)
        check("puntos: visor de foto", pg.is_visible("#lightbox")); pg.click("#lbClose")
        pg.reload(); pg.wait_for_timeout(400); pg.click("[data-tab=points]")
        check("persistencia: nota tras recargar", pg.input_value("#note-0") == "esquina este")

        # ---------- 4. Proyectos ----------
        pg.click("#btnRename"); pg.fill("#inRename", "Pérgola taller"); pg.click("#btnRenameOk")
        check("proyectos: renombrar", P(pg)["name"] == "Pérgola taller" and pg.inner_text("#projTitle") == "Pérgola taller")
        pg.click("#btnProjects"); pg.locator(".pj-tools .dup").first.click(); pg.wait_for_timeout(500)
        d = db(pg); cp = [x for x in d["projects"] if x["name"].endswith("(copia)")]
        check("proyectos: duplicar", len(d["projects"]) == 2 and len(cp) == 1 and len(cp[0]["points"]) == 4)
        ids0 = {q["id"] for q in P(pg)["points"]}; ids1 = {q["id"] for q in cp[0]["points"]}
        check("proyectos: la copia tiene identificadores propios", not (ids0 & ids1))
        pg.click("#btnNewProj"); pg.wait_for_timeout(200)
        check("proyectos: nuevo abre renombrar", pg.is_visible("#renameBox"))
        pg.fill("#inRename", "Cubierta norte"); pg.click("#btnRenameOk")
        d = db(pg); check("proyectos: nuevo vacío y activo", len(d["projects"]) == 3 and P(pg)["name"] == "Cubierta norte" and not P(pg)["points"])
        # volver al de la pérgola
        pg.click("#btnProjects"); pg.locator(".pj-main").filter(has=pg.locator("b", has_text="Pérgola taller")).filter(has_not_text="copia").click(); pg.wait_for_timeout(200)
        check("proyectos: cambiar", P(pg)["name"] == "Pérgola taller")
        # borrar la copia (dos toques)
        pg.click("#btnProjects"); li = pg.locator(".projlist li", has_text="(copia)")
        li.locator(".del").click(); check("proyectos: primer toque solo arma", len(db(pg)["projects"]) == 3)
        li.locator(".del").click(); pg.wait_for_timeout(200)
        check("proyectos: segundo toque borra", len(db(pg)["projects"]) == 2)
        pg.click("#sheetBg")

        # ---------- 5. Ajustes ----------
        pg.click("[data-tab=settings]")
        pg.fill("#inLat", "40.4168"); pg.press("#inLat", "Tab"); pg.fill("#inLon", "-3.7038"); pg.press("#inLon", "Tab"); pg.wait_for_timeout(100)
        p = P(pg); check("ajustes: lat/lon a mano", abs(p["lat"] - 40.4168) < 1e-6 and abs(p["lon"] + 3.7038) < 1e-6, p)
        check("ajustes: declinación recalculada (Madrid ≈ +0,7°)", abs(p["decl"] - 0.7) < 0.4 and p["declSource"] == "wmm", p["decl"])
        pg.fill("#inDecl", "-2.5"); pg.press("#inDecl", "Tab"); pg.wait_for_timeout(100)
        check("ajustes: declinación manual", P(pg)["decl"] == -2.5 and P(pg)["declSource"] == "manual")
        pg.fill("#inLat", "200"); pg.press("#inLat", "Tab"); pg.wait_for_timeout(100)
        check("ajustes: latitud inválida se rechaza", abs(P(pg)["lat"] - 40.4168) < 1e-6 and pg.input_value("#inLat") == "40.4168")
        pg.click("#btnDeclAuto"); pg.wait_for_timeout(100)
        check("ajustes: botón declinación WMM", P(pg)["declSource"] == "wmm")
        pg.fill("#inLat", "28.684"); pg.press("#inLat", "Tab"); pg.fill("#inLon", "-17.765"); pg.press("#inLon", "Tab")
        # tema
        pg.click("[data-theme-opt=dark]"); pg.wait_for_timeout(100)
        check("tema: oscuro", pg.evaluate("document.documentElement.dataset.theme") == "dark")
        pg.click("[data-tab=measure]"); bg_dark = pg.evaluate("getComputedStyle(document.querySelector('.readout')).backgroundColor")
        pg.click("[data-tab=settings]"); pg.click("[data-theme-opt=light]"); pg.click("[data-tab=measure]")
        bg_light = pg.evaluate("getComputedStyle(document.querySelector('.readout')).backgroundColor")
        check("tema: el visor cambia con el tema", bg_dark != bg_light, (bg_dark, bg_light))
        pg.click("[data-tab=settings]"); pg.click("[data-theme-opt=system]")
        check("tema: sistema quita el atributo", pg.evaluate("document.documentElement.dataset.theme") is None)
        # ayuda
        pg.click("#btnCorrHelp"); steps = 0
        for i in range(8):
            steps += 1
            nb = '.sheet.help[data-help="corr"] .help-next'
            if pg.inner_text(nb) == "Entendido": pg.click(nb); break
            pg.click(nb)
        check("ayuda: 6 pasos y cierre", steps == 6 and not pg.is_visible('.sheet.help[data-help="corr"]'), steps)

        # ---------- 6. Corrección al punto de estudio ----------
        pg.check("#inCorrOn"); pg.fill("#inDz", "2.5"); pg.press("#inDz", "Tab")
        pg.select_option("#inDistMode", "wall"); pg.fill("#inWallD", "10"); pg.press("#inWallD", "Tab"); pg.fill("#inWallAz", "0"); pg.press("#inWallAz", "Tab")
        pg.wait_for_timeout(100)
        check("corrección: texto de resumen", "puntos corregidos" in pg.inner_text("#corrInfo"), pg.inner_text("#corrInfo"))
        pg.click("[data-tab=points]")
        check("corrección: valores corregidos en la lista", pg.locator(".p-corr b").count() >= 3, pg.locator(".p-corr").all_inner_texts())
        pg.click("[data-tab=settings]"); pg.select_option("#inDistMode", "point"); pg.click("[data-tab=points]")
        check("corrección: modo por punto pide distancias", pg.locator(".p-dist input").count() == 4 and pg.locator(".p-corr .warn").count() == 4)
        pg.fill("#dist-0", "12"); pg.press("#dist-0", "Tab"); pg.wait_for_timeout(100)
        check("corrección: distancia por punto", P(pg)["points"][0].get("dist") == 12 and pg.locator(".p-corr .warn").count() == 3)
        pg.click("[data-tab=settings]"); pg.uncheck("#inCorrOn")

        # ---------- 7. Diagrama, IDAE, calendario ----------
        pg.click("[data-tab=chart]"); pg.wait_for_timeout(300)
        for m in ("#modeFull", "#modeIdae", "#modeSimple"): pg.click(m); pg.wait_for_timeout(100)
        check("diagrama: modos sin errores", not pg.errs, pg.errs)
        check("IDAE: resultado numérico", pg.inner_text("#lossVal") not in ("–", ""), pg.inner_text("#lossVal"))
        pg.fill("#inBeta", "90"); pg.press("#inBeta", "Tab"); pg.fill("#inAlpha", "-60"); pg.press("#inAlpha", "Tab"); pg.wait_for_timeout(100)
        check("IDAE: tabla automática V-11 para β90 α−60", "V-11" in pg.inner_text("#tableNote"), pg.inner_text("#tableNote"))
        pg.select_option("#inTable", "V-5"); pg.wait_for_timeout(100)
        check("IDAE: aviso de la errata de V-5", "errata" in pg.inner_text("#tableNote"))
        pg.select_option("#inTable", "auto"); pg.fill("#inBeta", "30"); pg.press("#inBeta", "Tab"); pg.fill("#inAlpha", "0"); pg.press("#inAlpha", "Tab")
        pg.select_option("#inCase", "integracion"); pg.wait_for_timeout(100)
        check("IDAE: límite según el caso", "20 %" in pg.inner_text("#lossPill"), pg.inner_text("#lossPill"))
        cal = pg.locator("#cal"); cal.scroll_into_view_if_needed(); box = cal.bounding_box()
        cal.click(position={"x": box["width"] * .3, "y": box["height"] * .9}); pg.wait_for_timeout(200)
        check("calendario: casilla rellena fecha y hora", pg.input_value("#inQDate") != "" and pg.input_value("#inQTime") != "")
        check("calendario: estado del sol", any(s in pg.inner_text("#queryRes") for s in ("Sol directo", "En sombra", "Sol bajo el horizonte")))
        pg.click("#btnNow"); pg.wait_for_timeout(100)
        check("calendario: ahora", pg.input_value("#inQDate") != "")
        if PVG:
            pg.click("#btnPvgis"); pg.wait_for_selector("#pvRes:not([hidden])", timeout=20000)
            check("PVGIS: resultados", pg.inner_text("#pvBase") == "1681")
            pg.fill("#inBeta", "35"); pg.press("#inBeta", "Tab"); pg.wait_for_timeout(100)
            check("PVGIS: avisa si el proyecto cambia", "vuelva a calcular" in pg.inner_text("#pvMeta"))

        # comparación
        pg.select_option("#inCompare", label="Cubierta norte (0 pt)"); pg.wait_for_timeout(100)
        check("comparar: seleccionado", db(pg)["settings"]["compareId"] != "")

        # ---------- 8. Exportación ----------
        pg.click("[data-tab=points]")
        with pg.expect_download() as dl: pg.click("#btnShare")
        f = os.path.join(OUT, "export.csv"); dl.value.save_as(f); csv = open(f, encoding="utf-8-sig").read()
        lines = csv.strip().splitlines()
        check("CSV: cabecera y 4 filas", lines[1].startswith("n;azimut_sur_deg") and len(lines) == 6, lines[:2])
        check("CSV: nota exportada", "esquina este" in csv)
        with pg.expect_download(timeout=60000) as dl: pg.click("#btnReport")
        f = os.path.join(OUT, "informe.pdf"); dl.value.save_as(f)
        txt = subprocess.run(["pdftotext", "-layout", f, "-"], capture_output=True, text=True).stdout
        npg = subprocess.run(["pdfinfo", f], capture_output=True, text=True).stdout
        check("informe: secciones", all(s in txt for s in ("Pérgola taller", "PÉRDIDAS POR SOMBRAS", "Datos del estudio", "Calendario de sombras", "Puntos medidos", "Fotografías")), txt[:300])
        check("informe: sin caracteres griegos rotos", "beta" in txt and "β" not in txt)

        # ---------- 9. Borrar todo ----------
        pg.click("#btnClear"); check("borrar: pide confirmación", pg.is_visible("#confirmClear") and len(P(pg)["points"]) == 4)
        pg.click("#btnClearYes"); pg.wait_for_timeout(200)
        check("borrar: lista vacía", len(P(pg)["points"]) == 0 and pg.is_visible("#emptyMsg") and not pg.is_visible("#pointActions"))
        pg.click("[data-tab=chart]"); pg.wait_for_timeout(200)
        check("vacío: IDAE muestra guion", pg.inner_text("#lossVal") == "–")
        check("vacío: calendario pide medir", "Mida el perfil" in pg.inner_text("#calSummary"))

        # ---------- 9b. Punto de cielo ----------
        pg.click("[data-tab=measure]"); pg.click("#btnStart"); pg.evaluate(SENS); pg.wait_for_timeout(1200)
        aim(pg, 120, 30); pg.wait_for_timeout(1300); pg.click("#btnSave"); pg.wait_for_timeout(600)
        aim(pg, 140, 2); pg.wait_for_timeout(800); pg.click("#btnSky"); pg.wait_for_timeout(300)
        aim(pg, 160, 25); pg.wait_for_timeout(1300); pg.click("#btnSave"); pg.wait_for_timeout(600)
        pts = P(pg)["points"]
        check("cielo: guardado con elevación 0", len(pts) == 3 and pts[1].get("sky") and pts[1]["elev"] == 0, pts)
        prof = pg.evaluate("(()=>{const d=JSON.parse(localStorage.getItem('cs.v2'));const p=d.projects.find(x=>x.id===d.currentId);const f=IDAE.profileFn(p.points);return [f(-60),f(-55),f(-45),f(-21),f(-20)]})()")
        check("cielo: el perfil cae a 0 en el hueco", abs(prof[0] - 30) < .5 and prof[1] == 0 and prof[2] == 0 and abs(prof[4] - 25) < .5, prof)
        pg.click("[data-tab=points]")
        check("cielo: aparece en la lista", "sin obstáculo" in pg.inner_text("#plist"))
        # ---------- 9c. Copia de seguridad ----------
        pg.click("[data-tab=settings]"); pg.select_option("#inBkScope", "all"); pg.check("#inBkPhotos")
        with pg.expect_download(timeout=30000) as dl: pg.click("#btnBkExport")
        f = os.path.join(OUT, "copia.json"); dl.value.save_as(f)
        bk = json.loads(open(f, encoding="utf-8-sig").read())
        nproj = len(db(pg)["projects"])
        check("copia: formato y proyectos", bk["formato"] == "clinometro-solar" and len(bk["proyectos"]) == nproj, (bk.get("formato"), len(bk.get("proyectos", []))))
        # añade una foto de prueba al JSON para comprobar la importación de fotos
        q0 = bk["proyectos"][0]["points"][0] if bk["proyectos"][0]["points"] else None
        if q0:
            bk["fotos"][q0["id"]] = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
        json.dump(bk, open(f, "w"))
        pg.set_input_files("#inBkFile", f); pg.wait_for_timeout(800)
        d2 = db(pg)
        check("copia: importación sin pisar (duplica con «(importado)»)", len(d2["projects"]) == 2 * nproj and sum(1 for x in d2["projects"] if x["name"].endswith("(importado)")) == nproj, [x["name"] for x in d2["projects"]])
        ids = [q["id"] for x in d2["projects"] for q in x["points"]]
        check("copia: identificadores únicos tras importar", len(ids) == len(set(ids)))
        check("copia: mensaje de resultado", "Importados" in pg.inner_text("#bkInfo"), pg.inner_text("#bkInfo"))
        bad = os.path.join(OUT, "mala.json"); open(bad, "w").write('{"hola":1}')
        pg.set_input_files("#inBkFile", bad); pg.wait_for_timeout(400)
        check("copia: rechaza archivos ajenos", len(db(pg)["projects"]) == 2 * nproj and "no es una copia" in pg.inner_text("#toast"))
        # ---------- 9d. Guías ----------
        pg.click("[data-tab=measure]"); pg.click(".hud-help"); pg.wait_for_timeout(200)
        check("guía de medición se abre", pg.is_visible('.sheet.help[data-help="measure"]'))
        pg.click('.sheet.help[data-help="measure"] .help-close')
        pg.click("[data-tab=chart]"); pg.click("#lossTitle [data-open-help]"); pg.wait_for_timeout(200)
        check("guía del diagrama abre en el paso del IDAE", pg.evaluate("[...document.querySelectorAll('.sheet.help[data-help=chart] .dots i')].findIndex(i=>i.classList.contains('on'))") == 3)
        pg.click('.sheet.help[data-help="chart"] .help-close')

        # ---------- 10. Ajustes persistentes ----------
        pg.click("[data-tab=settings]"); pg.select_option("#inAvg", "2000"); pg.click("[data-theme-opt=dark]")
        pg.reload(); pg.wait_for_timeout(300)
        check("persistencia: tema y promedio", pg.evaluate("document.documentElement.dataset.theme") == "dark" and db(pg)["settings"]["avg"] == 2000)
        check("sin errores de consola en todo el recorrido", not pg.errs, pg.errs)
        ctx.close()

        # ---------- 11. Migración desde la versión 1 ----------
        v1 = "localStorage.setItem('clino.points',JSON.stringify([{az:-20,head:160,elev:25,sd:.3,note:'v1',date:'2026-10-06T10:00:00Z',abs:true}]));localStorage.setItem('clino.lat','28.7')"
        ctx, pg = newpage(init="if(!sessionStorage.x){sessionStorage.x=1;localStorage.clear();" + v1 + "}")
        p = P(pg)
        check("migración v1: proyecto con los puntos antiguos", p["name"] == "Mediciones anteriores" and len(p["points"]) == 1 and p["points"][0].get("id") and p["lat"] == 28.7, p)
        ctx.close()
    except Exception:
        traceback.print_exc(); results.append(("excepción en la prueba", False, ""))
    br.close()
srv.shutdown()
ok = sum(1 for r in results if r[1]); print(f"\n{ok}/{len(results)} comprobaciones correctas")
sys.exit(0 if ok == len(results) else 1)
