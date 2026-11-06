package app.soundsense;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

@CapacitorPlugin(name = "AudioEngine")
public class AudioEnginePlugin extends Plugin {
    private interface AudioTask { void accept(AudioPlaybackService service); }
    private AudioPlaybackService service;
    private final ArrayList<AudioTask> pending = new ArrayList<>();
    private boolean bound = false;
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            AudioPlaybackService connected = ((AudioPlaybackService.LocalBinder) binder).service();
            connected.setListener((event, data) -> notifyListeners(event, data, "action".equals(event)));
            // Queued tasks only post to the audio thread; running them under the lock keeps their order.
            synchronized (pending) { service = connected; for (AudioTask task : pending) task.accept(connected); pending.clear(); }
        }
        @Override public void onServiceDisconnected(ComponentName name) { synchronized (pending) { service = null; } }
    };
    @Override public void load() {
        getActivity().runOnUiThread(() -> bound = getContext().bindService(new Intent(getContext(), AudioPlaybackService.class), connection, Context.BIND_AUTO_CREATE));
    }
    private void connected(AudioTask task) {
        // Service methods only post to the audio thread, so they run straight from the plugin
        // thread: a busy UI thread must not delay play/pause/seek, and they must not add to it.
        AudioPlaybackService target;
        synchronized (pending) { target = service; if (target == null) { pending.add(task); return; } }
        task.accept(target);
    }
    @PluginMethod public void prepare(PluginCall call) {
        String slot = call.getString("slot"), uri = call.getString("uri");
        if (!("a".equals(slot) || "b".equals(slot)) || uri == null) { call.reject("Invalid audio source"); return; }
        connected(audio -> audio.prepare(slot, uri, call.getString("trackId", ""), call.getString("title", ""), call.getString("artist", ""), call.getObject("headers", new JSObject()), call));
    }
    @PluginMethod public void command(PluginCall call) {
        connected(audio -> { audio.command(call.getData()); call.resolve(new JSObject()); });
    }
    @PluginMethod public void getDiagnostics(PluginCall call) { if (!ReleaseChannel.debug) { call.unavailable("Diagnostics are available in the beta channel"); return; } connected(audio -> audio.diagnostics(call)); }
    @Override protected void handleOnDestroy() {
        if (service != null) service.setListener(null);
        if (bound) { getContext().unbindService(connection); bound = false; }
        pending.clear();
    }
}
