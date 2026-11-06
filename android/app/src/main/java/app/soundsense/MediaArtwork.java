package app.soundsense;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class MediaArtwork {
    static Bitmap load(Context context, String uri) throws Exception {
        if (uri == null || uri.isEmpty()) {
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeResource(context.getResources(), R.drawable.soundsense_logo, options);
            options.inSampleSize = 1; while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 512) options.inSampleSize *= 2;
            options.inJustDecodeBounds = false; return BitmapFactory.decodeResource(context.getResources(), R.drawable.soundsense_logo, options);
        }
        if (uri.startsWith("content://") || uri.startsWith("file://")) { try (InputStream stream = context.getContentResolver().openInputStream(Uri.parse(uri))) { if (stream == null) return null; return decode(bytes(stream)); } }
        URL url = new URL(uri); if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null) return null;
        File directory = new File(context.getCacheDir(), "media-art"); directory.mkdirs(); StringBuilder hash = new StringBuilder(); for (byte value : MessageDigest.getInstance("SHA-256").digest(uri.getBytes(StandardCharsets.UTF_8))) hash.append(String.format("%02x", value)); File cached = new File(directory, hash + ".img");
        if (cached.exists()) { try (InputStream stream = new FileInputStream(cached)) { return decode(bytes(stream)); } }
        for (int redirects = 0; redirects < 4; redirects++) {
            HttpURLConnection connection = (HttpURLConnection)url.openConnection(); connection.setConnectTimeout(10000); connection.setReadTimeout(10000); connection.setInstanceFollowRedirects(false);
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { url = new URL(url, connection.getHeaderField("Location")); if (!"https".equals(url.getProtocol())) return null; continue; }
                if (status != 200) return null;
                byte[] data; try (InputStream stream = connection.getInputStream()) { data = bytes(stream); }
                Bitmap bitmap = decode(data); if (bitmap == null) return null;
                try (FileOutputStream stream = new FileOutputStream(cached)) { stream.write(data); }
                File[] files = directory.listFiles(); if (files != null && files.length > 64) { java.util.Arrays.sort(files, (a,b) -> Long.compare(a.lastModified(), b.lastModified())); for (int index = 0; index < files.length - 64; index++) files[index].delete(); }
                return bitmap;
            } finally { connection.disconnect(); }
        }
        return null;
    }
    private static byte[] bytes(InputStream stream) throws Exception { ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count; while ((count = stream.read(buffer)) >= 0) { if (output.size() + count > 3 * 1024 * 1024) throw new java.io.IOException("Artwork too large"); output.write(buffer, 0, count); } return output.toByteArray(); }
    private static Bitmap decode(byte[] data) { BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(data, 0, data.length, options); options.inSampleSize = 1; while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 512) options.inSampleSize *= 2; options.inJustDecodeBounds = false; return BitmapFactory.decodeByteArray(data, 0, data.length, options); }
}
