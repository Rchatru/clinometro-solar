package com.brumalabs.clinometrosolar;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.location.LocationManager;
import android.provider.Settings;
import androidx.core.location.LocationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.Priority;

/**
 * Estado de la ubicación del sistema. Si está desactivada, muestra el diálogo de Android
 * "Para continuar, activa la ubicación del dispositivo" (servicios de Google) o abre los ajustes.
 */
@CapacitorPlugin(name = "Dispositivo")
public class DevicePlugin extends Plugin {

    static final int REQUEST_LOCATION_ON = 4711;
    private static DevicePlugin instance;
    private PluginCall pending;

    @Override
    public void load() { instance = this; }

    private boolean locationEnabled() {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        return lm != null && LocationManagerCompat.isLocationEnabled(lm);
    }

    @PluginMethod
    public void locationStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("enabled", locationEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void requestLocationOn(PluginCall call) {
        if (locationEnabled()) { resolveEnabled(call, true); return; }
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000).build();
        LocationSettingsRequest settings = new LocationSettingsRequest.Builder().addLocationRequest(req).setAlwaysShow(true).build();
        LocationServices.getSettingsClient(getActivity()).checkLocationSettings(settings)
            .addOnSuccessListener(r -> resolveEnabled(call, true))
            .addOnFailureListener(e -> {
                if (e instanceof ResolvableApiException) {
                    try {
                        pending = call;
                        ((ResolvableApiException) e).startResolutionForResult(getActivity(), REQUEST_LOCATION_ON);
                        return;
                    } catch (IntentSender.SendIntentException ignored) { }
                }
                resolveEnabled(call, locationEnabled());
            });
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Llamado desde MainActivity cuando el usuario responde al diálogo del sistema. */
    static void onResolution(int resultCode) {
        if (instance == null || instance.pending == null) return;
        PluginCall c = instance.pending;
        instance.pending = null;
        instance.resolveEnabled(c, resultCode == Activity.RESULT_OK || instance.locationEnabled());
    }

    private void resolveEnabled(PluginCall call, boolean enabled) {
        JSObject r = new JSObject();
        r.put("enabled", enabled);
        call.resolve(r);
    }
}
