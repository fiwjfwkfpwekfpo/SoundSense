package app.soundsense;

import android.media.MediaDataSource;
import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Lets the framework MediaExtractor read a streamed track through the same
 * Media3 cache as playback: bytes already played are not downloaded again.
 * An HLS media playlist is exposed as one stream (init segment + segments),
 * which MediaExtractor parses as fragmented MP4 or MPEG-TS.
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class CachedMediaSource extends MediaDataSource {
    private final DataSource.Factory factory;
    private final List<Uri> parts;
    private final long[] starts, lengths;
    private final AtomicBoolean cancelled;
    private DataSource open;
    private int openPart = -1;
    private long openPosition = -1;

    private CachedMediaSource(DataSource.Factory factory, List<Uri> parts, AtomicBoolean cancelled) {
        this.factory = factory; this.parts = parts; this.cancelled = cancelled;
        starts = new long[parts.size()]; lengths = new long[parts.size()];
        for (int index = 0; index < parts.size(); index++) { starts[index] = index == 0 ? 0 : -1; lengths[index] = C.LENGTH_UNSET; }
    }

    static CachedMediaSource create(DataSource.Factory factory, Uri uri, AtomicBoolean cancelled) throws IOException {
        String head = text(factory, uri, 8);
        if (!head.startsWith("#EXTM3U")) { List<Uri> single = new ArrayList<>(); single.add(uri); return new CachedMediaSource(factory, single, cancelled); }
        return new CachedMediaSource(factory, playlist(factory, uri, 0), cancelled);
    }

    private static List<Uri> playlist(DataSource.Factory factory, Uri uri, int depth) throws IOException {
        if (depth > 2) throw new IOException("Nested HLS playlist");
        String body = text(factory, uri, 2 * 1024 * 1024);
        List<Uri> parts = new ArrayList<>(); String variant = null;
        for (String raw : body.split("\n")) {
            String line = raw.trim(); if (line.isEmpty()) continue;
            if (line.startsWith("#EXT-X-KEY") && !line.contains("METHOD=NONE")) throw new IOException("Encrypted HLS");
            if (line.startsWith("#EXT-X-STREAM-INF")) { variant = ""; continue; }
            if (line.startsWith("#EXT-X-MAP")) { int start = line.indexOf("URI=\""); if (start >= 0) { int end = line.indexOf('"', start + 5); parts.add(resolve(uri, line.substring(start + 5, end))); } continue; }
            if (line.startsWith("#")) continue;
            if (variant != null) return playlist(factory, resolve(uri, line), depth + 1);
            parts.add(resolve(uri, line));
        }
        if (parts.isEmpty()) throw new IOException("Empty HLS playlist");
        return parts;
    }

    private static Uri resolve(Uri base, String value) { return Uri.parse(URI.create(base.toString()).resolve(value).toString()); }

    private static String text(DataSource.Factory factory, Uri uri, int limit) throws IOException {
        DataSource source = factory.createDataSource();
        try {
            source.open(new DataSpec(uri)); ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192];
            while (output.size() < limit) { int count = source.read(buffer, 0, Math.min(buffer.length, limit - output.size())); if (count == C.RESULT_END_OF_INPUT) break; output.write(buffer, 0, count); }
            return output.toString(StandardCharsets.UTF_8.name());
        } finally { source.close(); }
    }

    private void close(boolean quietly) { if (open != null) { try { open.close(); } catch (IOException ignored) {} open = null; openPart = -1; openPosition = -1; } }

    /** Opens `part` at `offset`; records its length when the server reports one. */
    private void openAt(int part, long offset) throws IOException {
        close(true);
        DataSource source = factory.createDataSource();
        long length = source.open(new DataSpec.Builder().setUri(parts.get(part)).setPosition(offset).build());
        if (length != C.LENGTH_UNSET && lengths[part] == C.LENGTH_UNSET) lengths[part] = offset + length;
        open = source; openPart = part; openPosition = offset;
        if (lengths[part] != C.LENGTH_UNSET && part + 1 < parts.size()) starts[part + 1] = starts[part] + lengths[part];
    }

    @Override public synchronized int readAt(long position, byte[] buffer, int offset, int size) throws IOException {
        if (cancelled.get()) throw new IOException("Waveform superseded");
        if (size == 0) return 0;
        // Locate the part containing `position`; unknown boundaries are discovered by reading forward.
        int part = 0;
        while (part + 1 < parts.size() && starts[part + 1] >= 0 && starts[part + 1] <= position) part++;
        while (true) {
            if (starts[part] < 0) return -1;
            long local = position - starts[part];
            if (openPart != part || openPosition != local) {
                if (openPart == part && openPosition >= 0 && openPosition < local && local - openPosition < 256 * 1024) { skip(local - openPosition); }
                else openAt(part, local);
            }
            int count = open.read(buffer, offset, size);
            if (count == C.RESULT_END_OF_INPUT) {
                if (lengths[part] == C.LENGTH_UNSET) lengths[part] = openPosition;
                if (part + 1 < parts.size()) starts[part + 1] = starts[part] + lengths[part];
                close(true);
                if (part + 1 >= parts.size() || position < starts[part] + lengths[part]) return -1;
                part++; continue;
            }
            openPosition += count; return count;
        }
    }

    private void skip(long bytes) throws IOException {
        byte[] scratch = new byte[(int)Math.min(bytes, 16384)];
        while (bytes > 0) { int count = open.read(scratch, 0, (int)Math.min(bytes, scratch.length)); if (count == C.RESULT_END_OF_INPUT) throw new IOException("Unexpected end of stream"); bytes -= count; openPosition += count; }
    }

    @Override public synchronized long getSize() {
        long total = 0; for (int index = 0; index < parts.size(); index++) { if (lengths[index] == C.LENGTH_UNSET) return -1; total += lengths[index]; }
        return total;
    }

    @Override public synchronized void close() { close(true); }
}
