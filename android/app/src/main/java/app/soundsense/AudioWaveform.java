package app.soundsense;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.atomic.AtomicBoolean;

/** Streaming aggregates: fixed memory, no PCM resampling, bounded input batches. */
final class AudioWaveform {
    interface Progress { void accept(JSObject value); }
    static JSObject read(Context context, String uri, double duration, AtomicBoolean cancelled, Progress progress, WaveformCache cache) throws Exception {
        if (!uri.startsWith("content://") || duration <= 0) throw new IllegalArgumentException("Invalid audio document");
        return read(context, uri, null, duration, cancelled, progress, cache);
    }
    /** `key` names the cache entry and progress events; `source` (if any) supplies streamed bytes. */
    static JSObject read(Context context, String key, android.media.MediaDataSource source, double duration, AtomicBoolean cancelled, Progress progress, WaveformCache cache) throws Exception {
        if (duration <= 0) throw new IllegalArgumentException("Unknown duration");
        String uri = key;
        MediaExtractor extractor = new MediaExtractor(); MediaCodec codec = null;
        final int count = WaveformCache.POINTS; double[] squares = new double[count], peaks = new double[count]; long[] measured = new long[count];
        // Rhythm: bass energy (two cascaded one-pole low-passes, ~140 Hz) in 50 ms frames, for beat visuals.
        final int frames = Math.max(1, Math.min(WaveformCache.MAX_RHYTHM, (int)Math.ceil(duration * WaveformCache.RHYTHM_FPS))); double[] bass = new double[frames]; long[] bassCount = new long[frames]; double low1 = 0, low2 = 0, alpha = 0; int alphaRate = 0;
        long started = SystemClock.elapsedRealtime(), lastProgress = started; int completed = 0;
        try {
            if (source != null) extractor.setDataSource(source); else extractor.setDataSource(context, Uri.parse(uri), null);
            MediaFormat format = null; long base = -1;
            for (int index = 0; index < extractor.getTrackCount(); index++) { MediaFormat candidate = extractor.getTrackFormat(index); String mime = candidate.getString(MediaFormat.KEY_MIME); if (mime != null && mime.startsWith("audio/")) { format = candidate; extractor.selectTrack(index); break; } }
            if (format == null) throw new IllegalArgumentException("No audio track");
            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)); codec.configure(format, null, null, 0); codec.start();
            int rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE), channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT), encoding = AudioFormat.ENCODING_PCM_16BIT;
            boolean inputEnded = false, outputEnded = false; MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (!outputEnded) {
                if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new InterruptedException("Waveform superseded");
                if (SystemClock.elapsedRealtime() - started > 240000) throw new IllegalStateException("Waveform decoder timed out");
                // Feed all currently available buffers without a per-packet blocking wait.
                for (int batch = 0; batch < 8 && !inputEnded; batch++) {
                    int input = codec.dequeueInputBuffer(0); if (input < 0) break;
                    ByteBuffer buffer = codec.getInputBuffer(input); int size = extractor.readSampleData(buffer, 0);
                    if (size < 0) { codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true; }
                    else { codec.queueInputBuffer(input, 0, size, extractor.getSampleTime(), 0); extractor.advance(); }
                }
                int output = codec.dequeueOutputBuffer(info, 2000);
                if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat decoded = codec.getOutputFormat(); rate = decoded.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = decoded.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    if (Build.VERSION.SDK_INT >= 24 && decoded.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = decoded.getInteger(MediaFormat.KEY_PCM_ENCODING);
                } else if (output >= 0) {
                    ByteBuffer buffer = codec.getOutputBuffer(output).order(ByteOrder.LITTLE_ENDIAN); buffer.position(info.offset); buffer.limit(info.offset + info.size);
                    int bytes = encoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : encoding == AudioFormat.ENCODING_PCM_8BIT ? 1 : 2, samples = info.size / bytes;
                    // HLS/TS timestamps may not start at zero.
                    if (base < 0 && info.size > 0) base = info.presentationTimeUs;
                    double startBin = Math.max(0, info.presentationTimeUs - Math.max(0, base)) * count / (duration * 1_000_000.0), binsPerSample = count / (duration * channels * rate);
                    // Read only the first channel of each frame: half the work on stereo, same envelope.
                    int stride = Math.max(1, channels);
                    if (alphaRate != rate) { alphaRate = rate; alpha = 1 - Math.exp(-2 * Math.PI * 140.0 / rate); }
                    double startFrame = Math.max(0, info.presentationTimeUs - Math.max(0, base)) / 1_000_000.0 * WaveformCache.RHYTHM_FPS, framesPerSample = WaveformCache.RHYTHM_FPS / (double)(channels * rate);
                    for (int index = 0; index < samples; index += stride) {
                        int at = info.offset + index * bytes;
                        double value = bytes == 4 ? buffer.getFloat(at) : bytes == 1 ? ((buffer.get(at) & 255) - 128) / 128.0 : buffer.getShort(at) / 32768.0;
                        if (Double.isNaN(value) || Double.isInfinite(value)) continue;
                        int bin = Math.max(0, Math.min(count - 1, (int)(startBin + index * binsPerSample)));
                        squares[bin] += value * value; peaks[bin] = Math.max(peaks[bin], Math.abs(value)); measured[bin]++; completed = Math.max(completed, bin);
                        low1 += alpha * (value - low1); low2 += alpha * (low1 - low2);
                        int frame = Math.max(0, Math.min(frames - 1, (int)(startFrame + index * framesPerSample))); bass[frame] += low2 * low2; bassCount[frame]++;
                    }
                    outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0; codec.releaseOutputBuffer(output, false);
                }
                long now = SystemClock.elapsedRealtime();
                if (now - lastProgress >= 250 && completed > 0) {
                    if (WaveformCache.defer(context)) { JSObject deferred = new JSObject(); deferred.put("samples", new JSArray()); deferred.put("status", "deferred"); return deferred; }
                    JSObject partial = result(squares, peaks, measured, completed / (double)count, false); partial.put("uri", uri); progress.accept(partial); lastProgress = now;
                }
            }
            double[] values = values(squares, peaks, measured);
            // Whole-track RMS in dBFS for loudness normalization.
            double energy = 0; long total = 0; for (int index = 0; index < count; index++) { energy += squares[index]; total += measured[index]; }
            double loudness = total > 0 && energy > 0 ? 10 * Math.log10(energy / total) : -60;
            byte[] rhythm = rhythm(bass, bassCount);
            cache.write(uri, values, loudness, rhythm);
            JSObject result = result(squares, peaks, measured, 1, true); result.put("loudness", loudness); result.put("rhythm", android.util.Base64.encodeToString(rhythm, android.util.Base64.NO_WRAP)); result.put("computeMs", SystemClock.elapsedRealtime() - started); return result;
        } finally { extractor.release(); if (codec != null) { try { codec.stop(); } catch (Exception ignored) {} codec.release(); } }
    }
    /** Bass RMS per frame, scaled so the loudest 2% of frames reach 255. */
    private static byte[] rhythm(double[] bass, long[] counts) {
        double[] level = new double[bass.length]; for (int index = 0; index < bass.length; index++) level[index] = Math.sqrt(bass[index] / Math.max(1, counts[index]));
        double[] sorted = level.clone(); java.util.Arrays.sort(sorted); double top = Math.max(1e-4, sorted[Math.min(sorted.length - 1, (int)(sorted.length * .98))]);
        byte[] bytes = new byte[level.length]; for (int index = 0; index < level.length; index++) bytes[index] = (byte)Math.max(0, Math.min(255, Math.round(level[index] / top * 255)));
        return bytes;
    }
    private static double[] values(double[] squares, double[] peaks, long[] measured) { double[] values = new double[squares.length]; double maximum = .001; for (int index = 0; index < values.length; index++) { values[index] = Math.sqrt(squares[index] / Math.max(1, measured[index])) * .65 + peaks[index] * .35; maximum = Math.max(maximum, values[index]); } for (int index = 0; index < values.length; index++) values[index] /= maximum; return values; }
    private static JSObject result(double[] squares, double[] peaks, long[] measured, double progress, boolean complete) throws org.json.JSONException { JSArray samples = new JSArray(); for (double value : values(squares, peaks, measured)) samples.put(value); JSObject result = new JSObject(); result.put("samples", samples); result.put("progress", progress); result.put("status", complete ? "ready" : "building"); result.put("cached", false); return result; }
}
