package app.soundsense;

import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** A user-controlled system exemption; audio wake/network locks remain the player's responsibility. */
@CapacitorPlugin(name = "PlaybackPower")
public class PlaybackPowerPlugin extends Plugin {
    private JSObject status() {
        PowerManager power = getContext().getSystemService(PowerManager.class);
        JSObject result = new JSObject(); result.put("unrestricted", power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName())); result.put("powerSave", power != null && power.isPowerSaveMode()); return result;
    }
    @PluginMethod public void getStatus(PluginCall call) { call.resolve(status()); }
    @PluginMethod public void request(PluginCall call) {
        if (status().optBoolean("unrestricted")) { call.resolve(); return; }
        getActivity().runOnUiThread(() -> {
            try { getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()))); call.resolve(); }
            catch (RuntimeException error) {
                try { getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); call.resolve(); }
                catch (RuntimeException unavailable) { call.reject("Battery settings are unavailable"); }
            }
        });
    }
    @Override protected void handleOnResume() { notifyListeners("change", status()); }
}
