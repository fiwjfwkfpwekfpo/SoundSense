package app.soundsense;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.os.PowerManager;
import android.os.Handler;
import android.graphics.Rect;
import android.database.Cursor;
import android.content.ClipData;
import android.provider.OpenableColumns;
import android.media.MediaMetadataRetriever;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.provider.DocumentsContract;
import com.getcapacitor.JSArray;
import android.net.Uri;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ConcurrentHashMap;

/** Observe real Android insets without padding the native view or consuming the event. */
@CapacitorPlugin(name = "SystemUi")
public class SystemUiPlugin extends Plugin {
    private static final int JSON_EXPORT_MAX_BYTES = 100_000;
    private static final int DIAGNOSTICS_EXPORT_MAX_BYTES = 8 * 1024 * 1024;
    private final AtomicBoolean jsonExportPending = new AtomicBoolean(false);
    private final AtomicBoolean audioPickerPending = new AtomicBoolean(false);
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final ExecutorService analysis = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, AtomicBoolean> waveJobs = new ConcurrentHashMap<>();
    private WaveformCache waveCache;
    private boolean powerRegistered;
    private final FrameSampler frames = new FrameSampler();
    private final BroadcastReceiver powerReceiver = new BroadcastReceiver() { @Override public void onReceive(Context context, Intent intent) { JSObject value = new JSObject(); value.put("deferred", WaveformCache.defer(context)); notifyListeners("powerChanged", value, true); } };
    private synchronized WaveformCache cache() { if (waveCache == null) waveCache = new WaveformCache(getContext()); return waveCache; }

    @Override public void load() {
        IntentFilter powerFilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED); powerFilter.addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(powerReceiver, powerFilter, Context.RECEIVER_NOT_EXPORTED); else getContext().registerReceiver(powerReceiver, powerFilter); powerRegistered = true;
        getActivity().runOnUiThread(() -> {
            View webView = getBridge().getWebView();
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
                notifyListeners("insetsChanged", snapshot(insets), true);
                return insets;
            });
            webView.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
                if (insets != null) notifyListeners("insetsChanged", snapshot(insets), true);
            });
            ViewCompat.requestApplyInsets(webView);
        });
    }

    private JSObject snapshot(WindowInsetsCompat windowInsets) {
        Insets insets = windowInsets == null ? Insets.NONE : windowInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        float density = metrics.density;
        Rect bounds;
        if (Build.VERSION.SDK_INT >= 30) bounds = getActivity().getWindowManager().getCurrentWindowMetrics().getBounds();
        else bounds = new Rect(0, 0, metrics.widthPixels, metrics.heightPixels);
        JSObject result = new JSObject();
        result.put("top", insets.top / density);
        result.put("bottom", insets.bottom / density);
        result.put("left", insets.left / density);
        result.put("right", insets.right / density);
        result.put("density", density);
        result.put("windowWidthPx", bounds.width());
        result.put("windowHeightPx", bounds.height());
        result.put("webViewWidthPx", getBridge().getWebView().getWidth());
        result.put("webViewHeightPx", getBridge().getWebView().getHeight());
        return result;
    }

    private String sharedText(Intent intent) {
        if (intent == null) return null;
        String text = Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())
            ? intent.getStringExtra(Intent.EXTRA_TEXT) : Intent.ACTION_VIEW.equals(intent.getAction()) ? intent.getDataString() : null;
        return text == null ? null : text.substring(0, Math.min(8192, text.length()));
    }

    /** A crisp per-bar tick for scrubbing the waveform (Capacitor's selection haptic is a 100 ms buzz). */
    @PluginMethod(returnType = PluginMethod.RETURN_NONE) public void tick(PluginCall call) {
        View view = getBridge().getWebView();
        if (view != null) view.post(() -> view.performHapticFeedback(Build.VERSION.SDK_INT >= 34 ? android.view.HapticFeedbackConstants.SEGMENT_FREQUENT_TICK : android.view.HapticFeedbackConstants.CLOCK_TICK));
    }
    @PluginMethod public void getPendingLink(PluginCall call) {
        String text = sharedText(getActivity().getIntent());
        JSObject result = new JSObject(); if (text != null) result.put("text", text); call.resolve(result);
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        String text = sharedText(intent);
        if (text != null) { JSObject result = new JSObject(); result.put("text", text); notifyListeners("incomingLink", result, true); }
    }

    @PluginMethod public void pickFolder(PluginCall call) { openAudioPicker(call, true); }
    @PluginMethod public void pickAudio(PluginCall call) { openAudioPicker(call, "folder".equals(call.getString("kind"))); }
    private void openAudioPicker(PluginCall call, boolean folder) {
        if (!audioPickerPending.compareAndSet(false, true)) { call.reject("A file picker is already open"); return; }
        Intent intent = new Intent(folder ? Intent.ACTION_OPEN_DOCUMENT_TREE : Intent.ACTION_OPEN_DOCUMENT);
        if (!folder) {
            intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("audio/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"audio/*", "application/ogg", "application/x-flac"});
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        getActivity().runOnUiThread(() -> { try { startActivityForResult(call, intent, folder ? "musicFolderPicked" : "musicFilesPicked"); } catch (Exception error) { audioPickerPending.set(false); call.reject("File picker unavailable", error); } });
    }
    private void persistReadPermission(Uri uri, Intent intent) {
        try { if ((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
        catch (SecurityException ignored) { /* Some document providers grant session-only access. */ }
    }
    private void cancelledPicker(PluginCall call) { audioPickerPending.set(false); if (call != null) { JSObject response = new JSObject(); response.put("files", org.json.JSONObject.NULL); call.resolve(response); } }

    @ActivityCallback private void musicFilesPicked(PluginCall call, ActivityResult result) {
        if (call == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { cancelledPicker(call); return; }
        Intent data = result.getData();
        io.execute(() -> {
            try {
                JSArray files = new JSArray(); ClipData clip = data.getClipData();
                int count = clip == null ? (data.getData() == null ? 0 : 1) : clip.getItemCount();
                java.util.HashSet<String> seen = new java.util.HashSet<>();
                for (int i = 0; i < Math.min(10000, count); i++) {
                    Uri uri = clip == null ? data.getData() : clip.getItemAt(i).getUri();
                    if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()) || !seen.add(uri.toString())) continue;
                    persistReadPermission(uri, data); files.put(describeFile(uri, null));
                }
                JSObject response = new JSObject(); response.put("files", files); response.put("limited", count > 10000); call.resolve(response);
            } catch (Exception error) { call.reject("Unable to read files", error); }
            finally { audioPickerPending.set(false); }
        });
    }

    @ActivityCallback private void musicFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            cancelledPicker(call); return;
        }
        Uri tree = result.getData().getData();
        io.execute(() -> {
            try {
                persistReadPermission(tree, result.getData());
                JSArray files = new JSArray(); int[] visited = new int[]{0};
                String root = DocumentsContract.getTreeDocumentId(tree);
                String name = describeFile(DocumentsContract.buildDocumentUriUsingTree(tree, root), null).optString("name", "");
                boolean limited = scanMusic(tree, root, files, 0, "", visited);
                JSObject response = new JSObject(); response.put("files", files); response.put("name", name); response.put("limited", limited); call.resolve(response);
            } catch (Exception error) { call.reject("Unable to read folder", error); }
            finally { audioPickerPending.set(false); }
        });
    }

    private boolean scanMusic(Uri tree, String parent, JSArray files, int depth, String path, int[] visited) throws Exception {
        if (depth > 20 || files.length() >= 10000 || visited[0]++ >= 25000) return true;
        boolean limited = false;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent);
        try (Cursor cursor = getContext().getContentResolver().query(children,
            new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (cursor == null) return false;
            while (cursor.moveToNext()) {
                if (files.length() >= 10000 || visited[0] >= 25000) { limited = true; break; }
                String id = cursor.getString(0), name = cursor.getString(1), mime = cursor.getString(2);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) limited |= scanMusic(tree, id, files, depth + 1, path + name + "/", visited);
                else if (name != null && (mime != null && mime.startsWith("audio/") || name.matches("(?i).*\\.(flac|mp3|ogg|oga|opus|m4a|aac|wav|aif|aiff|alac|wma)$"))) {
                    JSObject file = describeFile(DocumentsContract.buildDocumentUriUsingTree(tree, id), name); file.put("path", path + name); files.put(file);
                }
            }
        }
        return limited;
    }

    private JSObject describeFile(Uri uri, String fallback) {
        JSObject file = new JSObject(); file.put("uri", uri.toString()); file.put("name", fallback == null ? "" : fallback);
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) { file.put("name", cursor.getString(0)); if (!cursor.isNull(1)) file.put("size", cursor.getLong(1)); }
        } catch (Exception ignored) { /* Metadata scan will report an inaccessible entry individually. */ }
        return file;
    }
    private static Integer leadingNumber(String value) {
        if (value == null) return null; java.util.regex.Matcher match = java.util.regex.Pattern.compile("^\\s*(\\d{1,4})").matcher(value);
        return match.find() ? Integer.valueOf(match.group(1)) : null;
    }
    @PluginMethod public void readAudioMetadata(PluginCall call) {
        JSObject file = call.getObject("file");
        if (file == null || file.getString("uri") == null) { call.reject("A selected audio document is required"); return; }
        io.execute(() -> {
            JSObject metadata = file; MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                Uri uri = Uri.parse(file.getString("uri"));
                if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) throw new IOException("Unsupported document URI");
                retriever.setDataSource(getContext(), uri);
                String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                double seconds = duration == null ? 0 : Double.parseDouble(duration) / 1000;
                if (seconds <= 0) throw new IOException("No audio duration");
                metadata.put("duration", seconds);
                String title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE), artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST), album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
                if (title != null) metadata.put("title", title); if (artist != null) metadata.put("artist", artist); if (album != null) metadata.put("album", album);
                String albumArtist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST), year = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR);
                String trackNo = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER), discNo = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER);
                if (albumArtist != null) metadata.put("albumArtist", albumArtist);
                // "3/12" → 3. The JS side validates the ranges.
                Integer track = leadingNumber(trackNo), disc = leadingNumber(discNo), yearNumber = leadingNumber(year);
                if (track != null) metadata.put("trackNo", track); if (disc != null) metadata.put("discNo", disc); if (yearNumber != null) metadata.put("year", yearNumber);
                try {
                    byte[] picture = retriever.getEmbeddedPicture();
                    if (picture != null && picture.length <= 16 * 1024 * 1024) {
                        StringBuilder hash = new StringBuilder(); for (byte b : MessageDigest.getInstance("SHA-256").digest(file.getString("uri").getBytes(StandardCharsets.UTF_8))) hash.append(String.format("%02x", b));
                        File directory = new File(getContext().getFilesDir(), "artwork"); directory.mkdirs(); File output = new File(directory, hash + ".jpg");
                        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(picture, 0, picture.length, options);
                        options.inSampleSize = 1; while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 1024) options.inSampleSize *= 2;
                        options.inJustDecodeBounds = false; Bitmap bitmap = BitmapFactory.decodeByteArray(picture, 0, picture.length, options);
                        if (bitmap != null) {
                            float scale = Math.min(1f, 512f / Math.max(bitmap.getWidth(), bitmap.getHeight()));
                            Bitmap small = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * scale)), Math.max(1, Math.round(bitmap.getHeight() * scale)), true);
                            try (OutputStream stream = new FileOutputStream(output)) { small.compress(Bitmap.CompressFormat.JPEG, 85, stream); }
                            if (small != bitmap) small.recycle(); bitmap.recycle(); metadata.put("artworkUri", Uri.fromFile(output).toString());
                        }
                    }
                } catch (Exception ignored) { /* Corrupt cover art cannot make a valid song fail import. */ }
            } catch (Exception error) { metadata.put("error", "unreadable"); }
            finally { try { retriever.release(); } catch (Exception ignored) {} }
            call.resolve(metadata);
        });
    }
    @PluginMethod public void readWaveform(PluginCall call) {
        String uri = call.getString("uri"); Double duration = call.getDouble("duration");
        if (uri == null || duration == null) { call.reject("Audio document is required"); return; }
        AtomicBoolean cancelled = new AtomicBoolean(false), previous = waveJobs.put(uri, cancelled); if (previous != null) previous.set(true);
        analysis.execute(() -> {
            try {
                if (cancelled.get()) throw new InterruptedException("Waveform superseded");
                JSObject cached = cache().read(uri);
                if (cached != null && (!call.getBoolean("loudness", false) || cached.has("loudness")) && (!call.getBoolean("rhythm", false) || cached.has("rhythm"))) { call.resolve(cached); return; }
                if (WaveformCache.defer(getContext())) { JSObject deferred = new JSObject(); deferred.put("samples", new JSArray()); deferred.put("status", "deferred"); call.resolve(deferred); return; }
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND - 5);
                JSObject result = AudioWaveform.read(getContext(), uri, duration, cancelled, value -> notifyListeners("waveformProgress", value), cache());
                result.put("uri", uri); notifyListeners("waveformProgress", result); call.resolve(result);
            }
            catch (Exception error) { call.reject("Waveform unavailable", error); }
            finally { waveJobs.remove(uri, cancelled); }
        });
    }
    /** Waveform of a streamed track, read through the playback cache (no second download of played bytes). */
    @PluginMethod public void readStreamWaveform(PluginCall call) {
        String id = call.getString("id"); Double duration = call.getDouble("duration");
        if (id == null || duration == null) { call.reject("Track is required"); return; }
        String key = "stream:" + id;
        AtomicBoolean cancelled = new AtomicBoolean(false), previous = waveJobs.put(key, cancelled); if (previous != null) previous.set(true);
        analysis.execute(() -> {
            CachedMediaSource source = null;
            try {
                if (cancelled.get()) throw new InterruptedException("Waveform superseded");
                JSObject cached = cache().read(key);
                if (cached != null && (!call.getBoolean("loudness", false) || cached.has("loudness")) && (!call.getBoolean("rhythm", false) || cached.has("rhythm"))) { call.resolve(cached); return; }
                if (WaveformCache.defer(getContext())) { JSObject deferred = new JSObject(); deferred.put("samples", new JSArray()); deferred.put("status", "deferred"); call.resolve(deferred); return; }
                MusicCache music = MusicCache.get(getContext()); String offline = music.offlineUri(id), uri = offline != null ? offline : music.streamUri(id);
                if (uri == null) { call.reject("Stream is not prepared yet", "NOT_READY"); return; }
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND - 5);
                source = CachedMediaSource.create(music.source(id, offline != null), android.net.Uri.parse(uri), cancelled);
                JSObject result = AudioWaveform.read(getContext(), key, source, duration, cancelled, value -> notifyListeners("waveformProgress", value), cache());
                result.put("uri", key); notifyListeners("waveformProgress", result); call.resolve(result);
            }
            catch (Exception error) { call.reject("Waveform unavailable", error); }
            finally { if (source != null) source.close(); waveJobs.remove(key, cancelled); }
        });
    }
    @PluginMethod public void cancelWaveform(PluginCall call) { String uri = call.getString("uri"); AtomicBoolean job = uri == null ? null : waveJobs.get(uri); if (job != null) job.set(true); call.resolve(); }
    @PluginMethod public void getWaveCache(PluginCall call) { io.execute(() -> call.resolve(cache().stats())); }
    @PluginMethod public void clearWaveCache(PluginCall call) { io.execute(() -> { cache().clear(); call.resolve(); }); }
    @PluginMethod public void setWaveCacheLimit(PluginCall call) { Integer bytes = call.getInt("bytes"); if (bytes == null) { call.reject("Cache size required"); return; } io.execute(() -> { cache().setLimit(bytes); call.resolve(); }); }

    @PluginMethod public void getInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(snapshot(ViewCompat.getRootWindowInsets(getBridge().getWebView()))));
    }

    @PluginMethod public void setStyle(PluginCall call) {
        boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        getActivity().runOnUiThread(() -> {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getActivity().getWindow(), getActivity().getWindow().getDecorView());
            controller.setAppearanceLightStatusBars(light);
            controller.setAppearanceLightNavigationBars(light);
            call.resolve();
        });
    }

    @PluginMethod public void sampleFrames(PluginCall call) { frames.sample(call, getActivity()); }
    /** Update channel chosen in Settings; beta also enables native diagnostics. */
    @PluginMethod public void setReleaseChannel(PluginCall call) {
        String channel = call.getString("channel", "");
        if (!"stable".equals(channel) && !"beta".equals(channel)) { call.reject("Unknown channel"); return; }
        ReleaseChannel.set(getContext(), channel);
        getActivity().runOnUiThread(() -> android.webkit.WebView.setWebContentsDebuggingEnabled(ReleaseChannel.debug));
        JSObject result = new JSObject(); result.put("channel", channel); call.resolve(result);
    }

    /** The Storage Access Framework grants access only to the document the user creates. */
    private int jsonExportLimit(PluginCall call) {
        return "diagnostics".equals(call.getString("purpose")) ? DIAGNOSTICS_EXPORT_MAX_BYTES : JSON_EXPORT_MAX_BYTES;
    }

    private File jsonExportFile(PluginCall call) throws IOException {
        String id = call.getString("exportId", "");
        if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid export identifier");
        return new File(new File(getContext().getCacheDir(), "json-exports"), id + ".json");
    }

    @PluginMethod public void saveJson(PluginCall call) {
        String text = call.getString("text");
        String filename = call.getString("filename");
        if (text == null || filename == null) {
            call.reject("JSON text and filename are required", "INVALID_JSON_EXPORT");
            return;
        }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > jsonExportLimit(call)) {
            call.reject("JSON export exceeds its UTF-8 byte limit", "EXPORT_TOO_LARGE");
            return;
        }
        if (!jsonExportPending.compareAndSet(false, true)) {
            call.reject("A document export is already open", "EXPORT_BUSY");
            return;
        }
        // Capacitor puts pending call options into the saved Activity Bundle
        // twice. Stage large JSON outside it to avoid TransactionTooLargeException.
        call.getData().remove("text");
        call.getData().put("exportId", java.util.UUID.randomUUID().toString());
        io.execute(() -> {
            File staged = null;
            try {
                staged = jsonExportFile(call);
                File directory = staged.getParentFile();
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Unable to prepare export directory");
                File[] abandoned = directory.listFiles();
                if (abandoned != null) for (File item : abandoned) if (item.lastModified() < System.currentTimeMillis() - 86400000L) item.delete();
                try (FileOutputStream output = new FileOutputStream(staged)) { output.write(bytes); }
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, safeJsonFilename(filename));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                File payload = staged;
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, intent, "jsonDocumentCreated"); }
                    catch (Exception error) {
                        payload.delete(); jsonExportPending.set(false);
                        call.reject("Unable to open the document picker", "EXPORT_UNAVAILABLE", error);
                    }
                });
            } catch (Exception error) {
                if (staged != null) staged.delete();
                jsonExportPending.set(false);
                call.reject("Unable to prepare the document export", "EXPORT_SAVE_FAILED", error);
            }
        });
    }

    private String safeJsonFilename(String filename) {
        String base = Normalizer.normalize(filename, Normalizer.Form.NFKC)
            .replaceAll("[<>:\"/\\\\|?*\\p{Cntrl}]", "_")
            .trim().replaceAll("(?i)\\.json$", "").replaceAll("^[. ]+|[. ]+$", "");
        if (base.isEmpty()) base = "appearance";
        StringBuilder safe = new StringBuilder();
        int byteCount = 0;
        for (int offset = 0; offset < base.length();) {
            int point = base.codePointAt(offset);
            String character = new String(Character.toChars(point));
            int size = character.getBytes(StandardCharsets.UTF_8).length;
            if (byteCount + size > 120) break;
            safe.append(character);
            byteCount += size;
            offset += Character.charCount(point);
        }
        return safe + ".json";
    }

    @ActivityCallback private void jsonDocumentCreated(PluginCall call, ActivityResult result) {
        if (call == null) { jsonExportPending.set(false); return; }
        final File staged;
        try { staged = jsonExportFile(call); }
        catch (Exception error) { jsonExportPending.set(false); call.reject("Export payload unavailable", "EXPORT_SAVE_FAILED", error); return; }
        if (result.getResultCode() != Activity.RESULT_OK) {
            staged.delete();
            jsonExportPending.set(false);
            JSObject response = new JSObject(); response.put("status", "cancelled"); call.resolve(response);
            return;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            staged.delete();
            jsonExportPending.set(false);
            call.reject("The document picker returned no writable document", "EXPORT_SAVE_FAILED");
            return;
        }
        // Provider I/O must not block the UI thread, including remote document providers.
        io.execute(() -> {
            try {
                if (!staged.isFile() || staged.length() > jsonExportLimit(call)) throw new IOException("Invalid export payload");
                try (FileInputStream input = new FileInputStream(staged); OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (stream == null) throw new IOException("Document provider returned no stream");
                    byte[] buffer = new byte[8192]; int length;
                    while ((length = input.read(buffer)) != -1) stream.write(buffer, 0, length);
                    stream.flush();
                }
                JSObject response = new JSObject(); response.put("status", "saved"); call.resolve(response);
            } catch (Exception error) {
                call.reject("Unable to write the JSON document", "EXPORT_SAVE_FAILED", error);
            } finally { staged.delete(); jsonExportPending.set(false); }
        });
    }
    @Override protected void handleOnDestroy() { if (powerRegistered) getContext().unregisterReceiver(powerReceiver); frames.dispose(); for (AtomicBoolean cancelled : waveJobs.values()) cancelled.set(true); io.shutdownNow(); analysis.shutdownNow(); }
}
