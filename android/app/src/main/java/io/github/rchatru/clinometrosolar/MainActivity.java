package io.github.rchatru.clinometrosolar;

import android.content.Context;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MagnetometerPlugin.class);
        super.onCreate(savedInstanceState);
        // La pantalla no se apaga mientras se mide.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /**
     * Botones de volumen como disparador. Se pregunta a la página si quiere el disparo
     * (pestaña Medir abierta y opción activada); si no, el botón cambia el volumen como siempre.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode != KeyEvent.KEYCODE_VOLUME_DOWN && keyCode != KeyEvent.KEYCODE_VOLUME_UP) {
            return super.onKeyDown(keyCode, event);
        }
        if (event.getRepeatCount() > 0) return true;
        final int direction = keyCode == KeyEvent.KEYCODE_VOLUME_UP ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER;
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return super.onKeyDown(keyCode, event);
        webView.evaluateJavascript("(window.__volShutter && window.__volShutter()) ? 'si' : 'no'", value -> {
            if (value == null || !value.contains("si")) {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am != null) am.adjustSuggestedStreamVolume(direction, AudioManager.USE_DEFAULT_STREAM_TYPE, AudioManager.FLAG_SHOW_UI);
            }
        });
        return true;
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) return true;
        return super.onKeyUp(keyCode, event);
    }
}
