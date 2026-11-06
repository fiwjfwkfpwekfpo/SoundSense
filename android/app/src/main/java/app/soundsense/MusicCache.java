package app.soundsense;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.util.AtomicFile;
import androidx.media3.common.MediaItem;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.PlaceholderDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.exoplayer.offline.Downloader;
import androidx.media3.exoplayer.hls.offline.HlsDownloader;
import androidx.media3.exoplayer.offline.ProgressiveDownloader;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One cache for streamed bytes and complete offline files. Only complete records are playable offline. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class MusicCache {
    private static MusicCache instance;
    public static synchronized MusicCache get(Context context) { if (instance == null) instance = new MusicCache(context.getApplicationContext()); return instance; }
    private final Context context;
    private final SimpleCache cache;
    private final AtomicFile index;
    private final JSONObject entries = new JSONObject();
    private final ExecutorService downloads = Executors.newSingleThreadExecutor(r -> new Thread(() -> { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); r.run(); }, "SoundSenseDownloads"));
    private final Map<String, Long> queued = new HashMap<>();
    private final Set<String> protectedIds = new HashSet<>();
    /** Liked tracks: evicted only after every unliked one. */
    private Set<String> preferred = new HashSet<>();
    private long generation;
    private final Set<String> removals = new HashSet<>();
    private Downloader running;
    private String runningId = "";
    private long limit = 4L * 1024 * 1024 * 1024;
    private boolean automatic = true, wifiOnly = true;
    private volatile Runnable listener;
    private MusicCache(Context context) {
        this.context = context;
        cache = new SimpleCache(new File(context.getFilesDir(), "music-cache"), new NoOpCacheEvictor(), new StandaloneDatabaseProvider(context));
        index = new AtomicFile(new File(context.getFilesDir(), "music-cache-index.json"));
        try { JSONObject saved = new JSONObject(new String(index.readFully(), StandardCharsets.UTF_8)); for (java.util.Iterator<String> it = saved.keys(); it.hasNext();) { String id = it.next(); JSONObject value = saved.getJSONObject(id); if (!"complete".equals(value.optString("state"))) value.put("state", "partial"); entries.put(id, value); } } catch (Exception ignored) { /* First launch or an interrupted atomic write. */ }
        // A killed process may have cached segments before the first index commit.
        for (String key : cache.getKeys()) { String id = key.split("\\|", 2)[0]; if (!entries.has(id)) try { entries.put(id, new JSONObject().put("state", "partial").put("lastUsed", 0)); } catch (Exception ignored) {} }
    }
    public void setListener(Runnable value) { listener = value; }
    private void changed() { Runnable callback = listener; if (callback != null) callback.run(); }
    private synchronized void save() {
        FileOutputStream output = null;
        try { output = index.startWrite(); output.write(entries.toString().getBytes(StandardCharsets.UTF_8)); index.finishWrite(output); }
        catch (Exception error) { if (output != null) index.failWrite(output); }
    }
    public synchronized void configure(boolean auto, boolean wifi, long bytes) { automatic = auto; wifiOnly = wifi; limit = Math.max(128L * 1024 * 1024, bytes); downloads.execute(() -> { trim(); changed(); }); }
    public synchronized void setPreferred(Set<String> ids) { preferred = new HashSet<>(ids); }
    public synchronized void protect(String id, boolean protect) { if (protect) protectedIds.add(id); else { protectedIds.remove(id); if (removals.remove(id)) downloads.execute(() -> { removeNow(id); save(); changed(); }); } }
    public synchronized void touch(String id, String uri) {
        try { JSONObject record = entries.optJSONObject(id); if (record == null) record = new JSONObject().put("state", "partial"); record.put("uri", uri).put("lastUsed", System.currentTimeMillis()); entries.put(id, record); }
        catch (Exception ignored) {}
    }
    public synchronized void touch(String id, String uri, JSONObject headers) {
        touch(id, uri);
        // Only public transport headers are persisted beside cached bytes.
        // OAuth credentials and cookies never enter this cache index.
        JSONObject allowed = new JSONObject();
        for (String key : new String[] {"User-Agent", "Referer", "Origin"}) {
            String value = headers.optString(key, "");
            if (!value.isEmpty() && value.length() <= 1024 && value.indexOf('\r') < 0 && value.indexOf('\n') < 0) try { allowed.put(key, value); } catch (Exception ignored) {}
        }
        try { entries.getJSONObject(id).put("headers", allowed); } catch (Exception ignored) {}
    }
    private static String canonical(Uri uri) {
        Uri.Builder clean = uri.buildUpon().clearQuery().fragment(null);
        for (String name : uri.getQueryParameterNames()) if (!name.matches("(?i)policy|signature|key-pair-id|expires|token|authorization|client_id|track_authorization")) for (String value : uri.getQueryParameters(name)) clean.appendQueryParameter(name, value);
        return clean.build().toString();
    }
    public CacheDataSource.Factory source(String id, boolean offline) {
        Map<String, String> headers = new HashMap<>();
        synchronized (this) { JSONObject record = entries.optJSONObject(id), saved = record == null ? null : record.optJSONObject("headers"); if (saved != null) for (String key : new String[] {"User-Agent", "Referer", "Origin"}) { String value = saved.optString(key, ""); if (!value.isEmpty()) headers.put(key, value); } }
        return new CacheDataSource.Factory().setCache(cache).setCacheKeyFactory(spec -> id + "|" + canonical(spec.uri))
            .setUpstreamDataSourceFactory(offline ? PlaceholderDataSource.FACTORY : new DefaultHttpDataSource.Factory().setUserAgent(headers.containsKey("User-Agent") ? headers.get("User-Agent") : "SoundSense").setDefaultRequestProperties(headers).setConnectTimeoutMs(12000).setReadTimeoutMs(20000))
            // Playback must not wait for the low-priority downloader holding a
            // cache span. Downloaders use createDataSourceForDownloading(),
            // which applies blocking independently of this playback flag.
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }
    /** The last stream address the player used for this track (cached bytes are keyed by it). */
    public synchronized String streamUri(String id) { JSONObject value = entries.optJSONObject(id); String uri = value == null ? null : value.optString("uri", null); return uri == null || uri.isEmpty() ? null : uri; }
    public synchronized String offlineUri(String id) { JSONObject value = entries.optJSONObject(id); if (value == null || !"complete".equals(value.optString("state"))) return null; return value.optString("uri", null); }
    public synchronized JSObject snapshot() {
        JSObject result = new JSObject(); JSONArray list = new JSONArray();
        for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) { String id = it.next(); JSONObject value = entries.optJSONObject(id); if (value == null) continue; JSONObject item = new JSONObject(); try { item.put("id", id).put("state", value.optString("state")).put("progress", value.optDouble("progress", 0)).put("bytes", value.optLong("bytes", 0)).put("error", value.optString("error", "")); list.put(item); } catch (Exception ignored) {} }
        result.put("entries", list); result.put("bytes", cache.getCacheSpace()); result.put("limit", limit); return result;
    }
    private long bytes(String id) { long count = 0; for (String key : cache.getKeys()) if (key.startsWith(id + "|")) for (androidx.media3.datasource.cache.CacheSpan span : cache.getCachedSpans(key)) count += span.length; return count; }
    private boolean unmetered() { ConnectivityManager manager = (ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE); return manager != null && manager.getActiveNetwork() != null && !manager.isActiveNetworkMetered(); }
    public void listened(String id, String uri) { synchronized (this) { if (!automatic) return; } enqueue(id, uri, false); }
    public void enqueue(String id, String uri, boolean manual) {
        final long token;
        synchronized (this) {
            if (!id.matches("[A-Za-z0-9_-]{1,160}") || !uri.startsWith("https://") || offlineUri(id) != null || queued.containsKey(id)) return;
            token = ++generation; queued.put(id, token); removals.remove(id);
            try { JSONObject record = entries.optJSONObject(id); if (record == null) record = new JSONObject(); record.put("uri", uri).put("state", "queued").put("lastUsed", System.currentTimeMillis()).put("progress", 0).put("error", ""); if (manual) record.put("manual", true); entries.put(id, record); } catch (Exception ignored) {}
        }
        changed();
        downloads.execute(() -> download(id, uri, token));
    }
    private boolean current(String id, long token) { return Long.valueOf(token).equals(queued.get(id)); }
    private void download(String id, String uri, long token) {
        Downloader downloader = null;
        try {
            boolean fill; synchronized (this) { if (!current(id, token)) return; fill = !wifiOnly || unmetered(); runningId = id; }
            // A full listen may already be complete on a metered connection. Verify cached bytes without requesting more.
            downloader = uri.contains(".m3u8") ? new HlsDownloader(MediaItem.fromUri(uri), source(id, !fill)) : new ProgressiveDownloader(MediaItem.fromUri(uri), source(id, !fill));
            synchronized (this) { if (!current(id, token)) return; running = downloader; entries.getJSONObject(id).put("state", "downloading"); }
            changed(); final long[] report = { 0 };
            downloader.download((length, downloaded, percent) -> {
                if (System.currentTimeMillis() - report[0] < 350) return; report[0] = System.currentTimeMillis();
                synchronized (MusicCache.this) { JSONObject record = entries.optJSONObject(id); if (record != null && current(id, token)) try { record.put("progress", Math.max(0, percent / 100.0)).put("bytes", downloaded); } catch (Exception ignored) {} }
                changed();
            });
            synchronized (this) { JSONObject record = entries.optJSONObject(id); if (record != null && current(id, token)) record.put("state", "complete").put("progress", 1).put("bytes", bytes(id)).put("lastUsed", System.currentTimeMillis()); }
            PlaybackDiagnostics.record("offline.complete", id, null, null, null);
        } catch (Exception error) {
            synchronized (this) { JSONObject record = entries.optJSONObject(id); if (record != null && current(id, token)) try { record.put("state", "partial").put("error", wifiOnly && !unmetered() ? "wifi" : "network"); } catch (Exception ignored) {} }
            PlaybackDiagnostics.record("offline.partial", id, "incomplete", null, null);
        } finally {
            synchronized (this) { if (current(id, token)) queued.remove(id); if (running == downloader) { running = null; runningId = ""; } }
            trim(); save(); changed();
        }
    }
    private synchronized void trim() {
        if (cache.getCacheSpace() <= limit) return;
        ArrayList<String> ids = new ArrayList<>(); for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) ids.add(it.next());
        // Eviction order: automatic cache of unliked tracks, then liked ones, then manual downloads; oldest first in each group.
        java.util.function.ToIntFunction<String> rank = id -> (entries.optJSONObject(id).optBoolean("manual") ? 2 : 0) + (preferred.contains(id) ? 1 : 0);
        Collections.sort(ids, (left, right) -> { int order = Integer.compare(rank.applyAsInt(left), rank.applyAsInt(right)); return order != 0 ? order : Long.compare(entries.optJSONObject(left).optLong("lastUsed"), entries.optJSONObject(right).optLong("lastUsed")); });
        for (String id : ids) { if (cache.getCacheSpace() <= limit) break; if (!protectedIds.contains(id) && !queued.containsKey(id)) removeNow(id); }
        save();
    }
    private synchronized void removeNow(String id) { for (String key : new HashSet<>(cache.getKeys())) if (key.startsWith(id + "|")) cache.removeResource(key); entries.remove(id); }
    public void remove(String id) { synchronized (this) { queued.remove(id); if (runningId.equals(id) && running != null) running.cancel(); entries.remove(id); if (protectedIds.contains(id)) removals.add(id); } changed(); downloads.execute(() -> { synchronized (this) { if (!protectedIds.contains(id) && !queued.containsKey(id)) removeNow(id); } save(); changed(); }); }
    public void clear() { synchronized (this) { queued.clear(); if (running != null) running.cancel(); removals.addAll(protectedIds); for (java.util.Iterator<String> it = entries.keys(); it.hasNext();) { it.next(); it.remove(); } } changed(); downloads.execute(() -> { synchronized (this) { for (String key : new HashSet<>(cache.getKeys())) { String id = key.split("\\|", 2)[0]; if (!protectedIds.contains(id) && !queued.containsKey(id)) cache.removeResource(key); } } save(); changed(); }); }
}
