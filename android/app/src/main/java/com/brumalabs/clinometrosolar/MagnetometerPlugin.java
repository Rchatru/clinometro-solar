package com.brumalabs.clinometrosolar;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lectura del magnetómetro para detectar interferencias (estructuras metálicas, cuadros eléctricos).
 * Envía a la página la intensidad del campo en µT y la precisión que declara el sistema
 * (0 = no fiable, 1 = baja, 2 = media, 3 = alta). La página la compara con el modelo WMM.
 */
@CapacitorPlugin(name = "Magnetometro")
public class MagnetometerPlugin extends Plugin implements SensorEventListener {

    private SensorManager manager;
    private Sensor sensor;
    private boolean running = false;
    private long last = 0;

    @PluginMethod
    public void start(PluginCall call) {
        manager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        sensor = manager != null ? manager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) : null;
        if (sensor == null) {
            call.reject("El dispositivo no tiene magnetómetro");
            return;
        }
        manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI);
        running = true;
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (manager != null) manager.unregisterListener(this);
        running = false;
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        long now = System.currentTimeMillis();
        if (now - last < 200) return;
        last = now;
        float x = event.values[0], y = event.values[1], z = event.values[2];
        JSObject data = new JSObject();
        data.put("total", Math.sqrt(x * x + y * y + z * z));
        data.put("accuracy", event.accuracy);
        notifyListeners("field", data);
    }

    @Override
    public void onAccuracyChanged(Sensor s, int accuracy) {
        JSObject data = new JSObject();
        data.put("accuracy", accuracy);
        notifyListeners("accuracy", data);
    }

    @Override
    protected void handleOnPause() {
        if (manager != null && running) manager.unregisterListener(this);
    }

    @Override
    protected void handleOnResume() {
        if (manager != null && sensor != null && running) manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI);
    }
}
