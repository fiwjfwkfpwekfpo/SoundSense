package app.soundsense;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Installs only a hash-checked APK signed by the installed application's certificate. */
@CapacitorPlugin(name = "Updates")
public class UpdateInstallerPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, AtomicBoolean> jobs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Download> downloads = new ConcurrentHashMap<>();
    private static final class Download {
        final File file; final String sha256; final long size, versionCode;
        Download(File file, String hash, long size, long version) { this.file = file; sha256 = hash; this.size = size; versionCode = version; }
    }
    @PluginMethod public void download(PluginCall call) {
        String id = call.getString("id"), hash = call.getString("sha256");
        Integer size = call.getInt("size"), version = call.getInt("versionCode"); JSArray urls = call.getArray("urls");
        if (id == null || id.length() > 100 || hash == null || !hash.matches("[a-fA-F0-9]{64}") || size == null || size <= 0 || size > 512L * 1024 * 1024 || version == null || version < 1 || urls == null || urls.length() < 1 || urls.length() > 12) { call.reject("Invalid signed update artifact"); return; }
        AtomicBoolean cancelled = new AtomicBoolean();
        if (jobs.putIfAbsent(id, cancelled) != null) { call.reject("Download is already running"); return; }
        io.execute(() -> {
            File directory = new File(getContext().getCacheDir(), "updates"); directory.mkdirs();
            File file = new File(directory, hash.toLowerCase(java.util.Locale.ROOT) + ".apk"), partial = new File(directory, id.replaceAll("[^a-zA-Z0-9-]", "") + ".part");
            try {
                if (!validHash(file, size, hash)) {
                    boolean complete = false; Exception last = null;
                    for (int index = 0; index < urls.length() && !cancelled.get(); index++) {
                        try {
                            fetch(urls.getString(index), partial, size, id, cancelled);
                            if (!validHash(partial, size, hash)) throw new SecurityException("Update hash mismatch");
                            verifyPackage(partial, version);
                            if (!partial.renameTo(file)) throw new java.io.IOException("Cannot commit update");
                            complete = true; break;
                        } catch (Exception error) { last = error; partial.delete(); }
                    }
                    if (!complete) throw last == null ? new InterruptedException("Update cancelled") : last;
                }
                if (cancelled.get()) throw new InterruptedException("Update cancelled");
                verifyPackage(file, version);
                String token = UUID.randomUUID().toString(); downloads.put(token, new Download(file, hash, size, version));
                File[] previous = directory.listFiles();
                if (previous != null) for (File old : previous) if (!old.equals(file) && old.getName().endsWith(".apk")) old.delete();
                JSObject result = new JSObject(); result.put("token", token); call.resolve(result);
            } catch (Exception error) { call.reject("Update verification or download failed", error); }
            finally { partial.delete(); jobs.remove(id, cancelled); }
        });
    }
    private void fetch(String input, File destination, long expected, String id, AtomicBoolean cancelled) throws Exception {
        URL url = new URL(input); HttpURLConnection connection = null;
        try {
            for (int redirect = 0; redirect <= 5; redirect++) {
                if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null) throw new SecurityException("Updates require HTTPS");
                connection = (HttpURLConnection)url.openConnection(); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(12000); connection.setReadTimeout(20000); connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); if (location == null) throw new java.io.IOException("Missing redirect"); url = new URL(url, location); connection.disconnect(); connection = null; continue; }
                if (status != 200) throw new java.io.IOException("Update HTTP " + status);
                String length = connection.getHeaderField("Content-Length"); long reported = length == null ? -1 : Long.parseLong(length); if (reported > 0 && reported != expected) throw new SecurityException("Unexpected update size");
                long total = 0, last = 0; byte[] buffer = new byte[64 * 1024];
                try (InputStream source = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                    int count;
                    while ((count = source.read(buffer)) >= 0) {
                        if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new InterruptedException("Update cancelled");
                        total += count; if (total > expected) throw new SecurityException("Update exceeds signed size"); output.write(buffer, 0, count);
                        long now = SystemClock.elapsedRealtime(); if (now - last >= 150 || total == expected) { JSObject value = new JSObject(); value.put("id", id); value.put("bytes", total); notifyListeners("progress", value); last = now; }
                    }
                }
                if (total != expected) throw new SecurityException("Incomplete update");
                return;
            }
            throw new java.io.IOException("Too many update redirects");
        } finally { if (connection != null) connection.disconnect(); }
    }
    private boolean validHash(File file, long size, String expected) throws Exception {
        if (!file.isFile() || file.length() != size) return false;
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] buffer = new byte[64 * 1024];
        try (FileInputStream input = new FileInputStream(file)) { int count; while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count); }
        StringBuilder hash = new StringBuilder(); for (byte value : digest.digest()) hash.append(String.format("%02x", value)); return hash.toString().equalsIgnoreCase(expected);
    }
    @SuppressWarnings("deprecation") private void verifyPackage(File file, long expectedVersion) throws Exception {
        PackageManager manager = getContext().getPackageManager(); int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), flags), candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (candidate == null || !installed.packageName.equals(candidate.packageName)) throw new SecurityException("Different application");
        long current = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode, next = Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode;
        if (next != expectedVersion || next <= current) throw new SecurityException("Invalid update version");
        Signature[] trusted = Build.VERSION.SDK_INT >= 28 ? installed.signingInfo.getApkContentsSigners() : installed.signatures, received = Build.VERSION.SDK_INT >= 28 ? candidate.signingInfo.getApkContentsSigners() : candidate.signatures;
        if (trusted == null || received == null || trusted.length != received.length) throw new SecurityException("APK signer mismatch");
        for (Signature signature : received) if (!Arrays.asList(trusted).contains(signature)) throw new SecurityException("APK signer mismatch");
    }
    @PluginMethod public void cancel(PluginCall call) { AtomicBoolean flag = jobs.get(call.getString("id", "")); if (flag != null) flag.set(true); call.resolve(); }
    @PluginMethod public void install(PluginCall call) {
        Download download = downloads.get(call.getString("token", "")); if (download == null) { call.reject("Verified download is required"); return; }
        io.execute(() -> {
            try {
                if (!validHash(download.file, download.size, download.sha256)) throw new SecurityException("Update file changed"); verifyPackage(download.file, download.versionCode);
                getActivity().runOnUiThread(() -> {
                    try {
                        JSObject result = new JSObject();
                        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))); result.put("status", "permission");
                        } else {
                            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", download.file);
                            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            getActivity().startActivity(intent); result.put("status", "opened");
                        }
                        call.resolve(result);
                    } catch (Exception error) { call.reject("Cannot open the system installer", error); }
                });
            } catch (Exception error) { call.reject("Update verification failed", error); }
        });
    }
    @Override protected void handleOnDestroy() { for (AtomicBoolean flag : jobs.values()) flag.set(true); io.shutdownNow(); downloads.clear(); }
}
