# Clinómetro Solar

Herramienta para el estudio de sombras en instalaciones fotovoltaicas. Mide con la cámara, la brújula y los sensores del móvil el perfil de obstáculos (azimut y elevación), lo dibuja sobre las trayectorias solares del lugar y calcula las pérdidas por sombras con el método del Anexo III del Pliego de Condiciones Técnicas del IDAE.

- **Web (versión 1):** https://rchatru.github.io/clinometro-solar/
- **Web (versión 2, en pruebas):** https://rchatru.github.io/clinometro-solar/web/
- **Android:** proyecto Capacitor en `android/`

## Estructura

| Carpeta | Contenido |
|---|---|
| `web/` | La app: `index.html`, `styles.css`, `app.js`, `idae.js` (tablas y cálculo del IDAE), fuentes y librerías |
| `android/` | Proyecto Android generado por Capacitor |
| `design/` | Script del icono y la pantalla de inicio |

## Compilar el APK

```
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Licencias de terceros

- jsPDF (MIT) · geomagnetism / WMM2025 (Apache 2.0) · Instrument Sans, Instrument Serif y JetBrains Mono (SIL Open Font License)
