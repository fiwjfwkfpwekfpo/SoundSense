package app.soundsense;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.PowerManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

final class WaveformCache {
    static final int POINTS = 1000;
    static final int VERSION = 2;
    /** Rhythm (bass energy) frames per second and the longest track it covers (2 h). */
    static final int RHYTHM_FPS = 20, MAX_RHYTHM = 20 * 7200;
    private final Context context;
    private final File directory;
    WaveformCache(Context context) { this.context = context; directory = new File(context.getFilesDir(), "waveforms"); directory.mkdirs(); }
    private File file(String uri) throws Exception {
        StringBuilder key = new StringBuilder(); for (byte value : MessageDigest.getInstance("SHA-256").digest(("local:" + uri + ":" + VERSION).getBytes(StandardCharsets.UTF_8))) key.append(String.format("%02x", value));
        return new File(directory, key + ".wfm");
    }
    /** File: 1000 amplitude bytes, optionally a 4-byte float loudness (dBFS RMS), optionally rhythm bytes (RHYTHM_FPS per second). */
    synchronized JSObject read(String uri) {
        try {
            File file = file(uri); long length = file.length(); if (length != POINTS && length < POINTS + 4 || length > POINTS + 4 + MAX_RHYTHM) return null;
            byte[] bytes = new byte[(int)length]; try (FileInputStream stream = new FileInputStream(file)) { int offset = 0; while (offset < bytes.length) { int count = stream.read(bytes, offset, bytes.length - offset); if (count < 0) return null; offset += count; } }
            file.setLastModified(System.currentTimeMillis());
            JSObject result = unpack(Arrays.copyOf(bytes, POINTS), true);
            if (length >= POINTS + 4) result.put("loudness", (double)java.nio.ByteBuffer.wrap(bytes, POINTS, 4).getFloat());
            if (length > POINTS + 4) result.put("rhythm", android.util.Base64.encodeToString(Arrays.copyOfRange(bytes, POINTS + 4, (int)length), android.util.Base64.NO_WRAP));
            return result;
        }
        catch (Exception ignored) { return null; }
    }
    synchronized void write(String uri, double[] values) throws Exception { write(uri, values, Double.NaN); }
    synchronized void write(String uri, double[] values, double loudness) throws Exception { write(uri, values, loudness, null); }
    synchronized void write(String uri, double[] values, double loudness, byte[] rhythm) throws Exception {
        File destination = file(uri), temporary = new File(directory, destination.getName() + ".tmp"); boolean withLoudness = !Double.isNaN(loudness) || rhythm != null; byte[] bytes = new byte[POINTS + (withLoudness ? 4 : 0) + (rhythm == null ? 0 : rhythm.length)];
        for (int index = 0; index < POINTS; index++) bytes[index] = (byte)Math.max(0, Math.min(255, Math.round(values[index] * 255)));
        if (withLoudness) java.nio.ByteBuffer.wrap(bytes, POINTS, 4).putFloat((float)(Double.isNaN(loudness) ? -60 : loudness));
        if (rhythm != null) System.arraycopy(rhythm, 0, bytes, POINTS + 4, rhythm.length);
        try (FileOutputStream stream = new FileOutputStream(temporary)) { stream.write(bytes); }
        if (!temporary.renameTo(destination)) { temporary.delete(); throw new java.io.IOException("Waveform cache commit failed"); }
        trim();
    }
    static JSObject unpack(byte[] bytes, boolean cached) throws org.json.JSONException { JSArray samples = new JSArray(); for (byte value : bytes) samples.put((value & 255) / 255.0); JSObject result = new JSObject(); result.put("samples", samples); result.put("progress", 1); result.put("status", "ready"); result.put("cached", cached); return result; }
    long limit() { return context.getSharedPreferences("waveform-cache", Context.MODE_PRIVATE).getLong("limit", 32L * 1024 * 1024); }
    synchronized void setLimit(long bytes) { context.getSharedPreferences("waveform-cache", Context.MODE_PRIVATE).edit().putLong("limit", Math.max(1024 * 1024, Math.min(256L * 1024 * 1024, bytes))).apply(); trim(); }
    synchronized JSObject stats() { long bytes = 0; int count = 0; File[] files = directory.listFiles((dir, name) -> name.endsWith(".wfm")); if (files != null) for (File file : files) { bytes += file.length(); count++; } JSObject value = new JSObject(); value.put("bytes", bytes); value.put("count", count); value.put("limit", limit()); return value; }
    synchronized void clear() { File[] files = directory.listFiles((dir, name) -> name.endsWith(".wfm") || name.endsWith(".tmp")); if (files != null) for (File file : files) file.delete(); }
    private void trim() { File[] files = directory.listFiles((dir, name) -> name.endsWith(".wfm")); if (files == null) return; long bytes = 0; for (File file : files) bytes += file.length(); if (bytes <= limit()) return; Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified())); for (File file : files) { long length = file.length(); if (file.delete()) bytes -= length; if (bytes <= limit()) break; } }
    static boolean defer(Context context) {
        Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int level = battery == null ? 100 : battery.getIntExtra(BatteryManager.EXTRA_LEVEL, 100), scale = battery == null ? 100 : battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        PowerManager power = (PowerManager)context.getSystemService(Context.POWER_SERVICE);
        // Battery saver alone no longer blocks waveforms (it is on permanently on many phones); a nearly empty, discharging battery does.
        int status = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
        return !charging && scale > 0 && level * 100 / scale < 15;
    }
}
