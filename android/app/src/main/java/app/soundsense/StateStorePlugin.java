package app.soundsense;

import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** App state is committed to disk independently of WebView's delayed localStorage flush. */
@CapacitorPlugin(name = "StateStore")
public class StateStorePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private File directory() { File directory = new File(getContext().getFilesDir(), "state"); directory.mkdirs(); return directory; }
    private AtomicFile file(String key) {
        if (key == null || !key.matches("ss_[a-zA-Z0-9_.-]{1,100}")) throw new IllegalArgumentException("Invalid state key");
        return new AtomicFile(new File(directory(), key + ".json"));
    }
    @PluginMethod public void read(PluginCall call) {
        io.execute(() -> {
            try {
                JSObject result = new JSObject(); File[] files = directory().listFiles((dir, name) -> name.matches("ss_[a-zA-Z0-9_.-]{1,100}\\.json(?:\\.bak)?"));
                if (files != null) for (File entry : files) {
                    String name = entry.getName().replaceFirst("\\.bak$", ""), key = name.substring(0, name.length() - 5);
                    try (FileInputStream input = file(key).openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[8192]; int count;
                        while ((count = input.read(buffer)) >= 0) { if (output.size() + count > 12 * 1024 * 1024) throw new java.io.IOException("State too large"); output.write(buffer, 0, count); }
                        result.put(key, new String(output.toByteArray(), StandardCharsets.UTF_8));
                    }
                }
                call.resolve(result);
            } catch (Exception error) { call.reject("Cannot read application state", error); }
        });
    }
    @PluginMethod public void write(PluginCall call) {
        String key = call.getString("key"), value = call.getString("value");
        if (value == null || value.length() > 12 * 1024 * 1024) { call.reject("Invalid application state"); return; }
        io.execute(() -> {
            AtomicFile target; FileOutputStream output = null;
            try { target = file(key); }
            catch (Exception error) { call.reject("Invalid state key", error); return; }
            try { output = target.startWrite(); output.write(value.getBytes(StandardCharsets.UTF_8)); target.finishWrite(output); call.resolve(); }
            catch (Exception error) { if (output != null) target.failWrite(output); call.reject("Cannot commit application state", error); }
        });
    }
    /** Large values arrive in pieces (see storage.ts); the file is committed once the last piece is in. */
    private final java.util.Map<String, StringBuilder> parts = new java.util.HashMap<>();
    private final java.util.Map<String, String> partIds = new java.util.HashMap<>();
    @PluginMethod public void writeChunk(PluginCall call) {
        String key = call.getString("key"), id = call.getString("id"), data = call.getString("data");
        int index = call.getInt("index", -1), count = call.getInt("count", 0);
        if (key == null || id == null || data == null || index < 0 || count <= 0 || index >= count) { call.reject("Invalid application state"); return; }
        io.execute(() -> {
            String value = null;
            synchronized (parts) {
                StringBuilder builder = parts.get(key);
                if (index == 0 || builder == null || !id.equals(partIds.get(key))) { if (index != 0) { call.reject("Out of order state piece"); return; } builder = new StringBuilder(data.length() * count); parts.put(key, builder); partIds.put(key, id); }
                builder.append(data);
                if (builder.length() > 12 * 1024 * 1024) { parts.remove(key); partIds.remove(key); call.reject("Invalid application state"); return; }
                if (index == count - 1) { value = builder.toString(); parts.remove(key); partIds.remove(key); }
            }
            if (value == null) { call.resolve(); return; }
            AtomicFile target; FileOutputStream output = null;
            try { target = file(key); } catch (Exception error) { call.reject("Invalid state key", error); return; }
            try { output = target.startWrite(); output.write(value.getBytes(StandardCharsets.UTF_8)); target.finishWrite(output); call.resolve(); }
            catch (Exception error) { if (output != null) target.failWrite(output); call.reject("Cannot commit application state", error); }
        });
    }
    @PluginMethod public void remove(PluginCall call) { io.execute(() -> { try { file(call.getString("key")).delete(); call.resolve(); } catch (Exception error) { call.reject("Cannot remove application state", error); } }); }
    @Override protected void handleOnDestroy() { io.shutdown(); }
}
