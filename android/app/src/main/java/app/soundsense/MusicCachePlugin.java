package app.soundsense;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name = "MusicCache")
public class MusicCachePlugin extends Plugin {
    private final java.util.concurrent.ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor();
    private MusicCache cache;
    private final java.util.concurrent.atomic.AtomicBoolean scheduled = new java.util.concurrent.atomic.AtomicBoolean();
    /**
     * Download progress fires several times a second; each event carries the whole index
     * through the WebView bridge (evaluated on the UI thread). Coalesce to one per second.
     */
    private void changed() { if (scheduled.compareAndSet(false, true)) io.schedule(() -> { scheduled.set(false); MusicCache value = cache; if (value != null) notifyListeners("change", value.snapshot()); }, 1000, java.util.concurrent.TimeUnit.MILLISECONDS); }
    @Override public void load() { io.execute(() -> { cache = MusicCache.get(getContext()); cache.setListener(this::changed); }); }
    private interface Task { void run(MusicCache cache); }
    private void access(PluginCall call, Task task) { io.execute(() -> { try { task.run(MusicCache.get(getContext())); } catch (Exception error) { call.reject("Music cache operation failed", error); } }); }
    @PluginMethod public void getSnapshot(PluginCall call) { access(call, value -> call.resolve(value.snapshot())); }
    @PluginMethod public void configure(PluginCall call) { access(call, value -> { value.configure(call.getBoolean("automatic", true), call.getBoolean("wifiOnly", true), (long)call.getInt("limitMb", 4096) * 1024 * 1024); call.resolve(); }); }
    @PluginMethod public void source(PluginCall call) { access(call, value -> { JSObject result = new JSObject(); result.put("available", value.offlineUri(call.getString("id", "")) != null); call.resolve(result); }); }
    @PluginMethod public void download(PluginCall call) { access(call, value -> { String id = call.getString("id", ""), uri = call.getString("uri", ""); value.touch(id, uri, call.getObject("headers", new JSObject())); value.enqueue(id, uri, true); call.resolve(); }); }
    @PluginMethod public void setPreferred(PluginCall call) { access(call, value -> { java.util.Set<String> ids = new java.util.HashSet<>(); com.getcapacitor.JSArray list = call.getArray("ids"); if (list != null) for (int index = 0; index < list.length(); index++) { String id = list.optString(index, ""); if (!id.isEmpty()) ids.add(id); } value.setPreferred(ids); call.resolve(); }); }
    @PluginMethod public void remove(PluginCall call) { access(call, value -> { value.remove(call.getString("id", "")); call.resolve(); }); }
    @PluginMethod public void clear(PluginCall call) { access(call, value -> { value.clear(); call.resolve(); }); }
    @Override protected void handleOnDestroy() { if (cache != null) cache.setListener(null); io.shutdown(); }
}
