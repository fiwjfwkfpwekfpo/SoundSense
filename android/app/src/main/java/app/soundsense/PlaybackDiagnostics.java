package app.soundsense;

import android.content.Context;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Bounded local diagnostics survive a detached WebView; no signed URLs are recorded. */
final class PlaybackDiagnostics {
    private static final ArrayDeque<JSObject> entries = new ArrayDeque<>();
    private static final ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor();
    private static AtomicFile file; private static boolean scheduled;
    static synchronized void init(Context context) {
        ReleaseChannel.init(context);
        if (file != null) return;
        File directory = new File(context.getFilesDir(), "diagnostics"); directory.mkdirs(); file = new AtomicFile(new File(directory, "native.json"));
        io.execute(() -> {
            try {
                JSArray saved = new JSArray(new String(file.readFully(), StandardCharsets.UTF_8));
                synchronized (PlaybackDiagnostics.class) {
                    ArrayDeque<JSObject> merged = new ArrayDeque<>();
                    for (int index = Math.max(0, saved.length() - 180); index < saved.length(); index++) merged.add(JSObject.fromJSONObject(saved.getJSONObject(index)));
                    merged.addAll(entries); entries.clear(); entries.addAll(merged); trim();
                }
            } catch (Exception ignored) { /* First run or a removed diagnostic file. */ }
        });
    }
    private static void trim() { while (entries.size() > 200) entries.removeFirst(); }
    static synchronized void record(String event, String trackId, String code, String reason, Integer status) {
        if (!ReleaseChannel.debug) return;
        JSObject entry = new JSObject(); entry.put("atMs", System.currentTimeMillis()); entry.put("event", event); entry.put("trackId", trackId == null ? "" : trackId);
        if (code != null) entry.put("code", code); if (reason != null) entry.put("reason", reason); if (status != null) entry.put("status", status);
        entries.add(entry); trim();
        if (!scheduled && file != null) { scheduled = true; io.schedule(PlaybackDiagnostics::persist, 250, TimeUnit.MILLISECONDS); }
    }
    static synchronized JSArray snapshot() { JSArray result = new JSArray(); for (org.json.JSONObject entry : entries) result.put(entry); return result; }
    private static void persist() {
        JSArray data; synchronized (PlaybackDiagnostics.class) { data = snapshot(); scheduled = false; }
        FileOutputStream output = null;
        try { output = file.startWrite(); output.write(data.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); }
        catch (Exception ignored) { if (output != null) file.failWrite(output); }
    }
}
