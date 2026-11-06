package app.soundsense;

import android.app.Activity;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.view.FrameMetrics;
import android.view.Window;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Arrays;

/** Native frame profiling, available while the beta channel is selected. */
final class FrameSampler {
    private HandlerThread frameThread;
    private FrameSample frameSample;
    void sample(PluginCall call, Activity activity) {
        if (!ReleaseChannel.debug) { call.unavailable("Profiling is available in the beta channel"); return; }
        if (Build.VERSION.SDK_INT < 24) {
            JSObject result = new JSObject(); result.put("supported", false); result.put("metric", "android.window.totalDuration"); result.put("frames", 0);
            result.put("elapsedMs", 0); result.put("cancelled", false); result.put("p95", 0); result.put("max", 0); result.put("intervalP95", 0); result.put("intervalMax", 0);
            result.put("overBudget", 0); result.put("over50ms", 0); result.put("droppedReports", 0); result.put("refreshRate", 0); call.resolve(result); return;
        }
        Double requested = call.getDouble("duration");
        long duration = Math.max(100L, Math.min(10_000L, requested == null ? 3000L : Math.round(requested)));
        activity.runOnUiThread(() -> {
            if (frameSample != null) frameSample.finish(true);
            if (frameThread == null) { frameThread = new HandlerThread("SoundSenseFrameMetrics"); frameThread.start(); }
            FrameSample sample = new FrameSample(call, activity.getWindow(), activity);
            frameSample = sample;
            sample.window.addOnFrameMetricsAvailableListener(sample, new Handler(frameThread.getLooper()));
            sample.main.postDelayed(sample.timeout, duration);
        });
    }

    @androidx.annotation.RequiresApi(24)
    private final class FrameSample implements Window.OnFrameMetricsAvailableListener {
        // At most 10 seconds at 200 Hz. Keep callback allocation and memory bounded.
        private final long[] totals = new long[2000], intervals = new long[2000], gpu = new long[2000];
        private final PluginCall call;
        private final Window window;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final Runnable timeout = () -> finish(false);
        private final long started = SystemClock.uptimeMillis();
        private final float refreshRate;
        private int count, intervalCount, gpuCount, overBudget, over50ms, droppedReports;
        private long previousVsync;
        private boolean done;

        FrameSample(PluginCall call, Window window, Activity activity) {
            this.call = call; this.window = window;
            refreshRate = activity.getWindowManager().getDefaultDisplay().getRefreshRate();
        }

        @Override public synchronized void onFrameMetricsAvailable(Window window, FrameMetrics metrics, int dropped) {
            if (done) return;
            droppedReports += Math.max(0, dropped);
            long total = metrics.getMetric(FrameMetrics.TOTAL_DURATION);
            if (total >= 0 && count < totals.length) {
                totals[count++] = total;
                if (total > 1_000_000_000d / Math.max(1f, refreshRate)) overBudget++;
                if (total > 50_000_000L) over50ms++;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                long vsync = metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP);
                if (vsync > previousVsync && previousVsync > 0 && intervalCount < intervals.length) intervals[intervalCount++] = vsync - previousVsync;
                if (vsync > 0) previousVsync = vsync;
            }
            if (Build.VERSION.SDK_INT >= 31) {
                long duration = metrics.getMetric(FrameMetrics.GPU_DURATION);
                if (duration >= 0 && gpuCount < gpu.length) gpu[gpuCount++] = duration;
            }
        }

        synchronized void finish(boolean cancelled) {
            if (done) return; done = true;
            main.removeCallbacks(timeout);
            window.removeOnFrameMetricsAvailableListener(this);
            if (frameSample == this) frameSample = null;
            Arrays.sort(totals, 0, count); Arrays.sort(intervals, 0, intervalCount); Arrays.sort(gpu, 0, gpuCount);
            JSObject result = new JSObject();
            result.put("supported", true); result.put("metric", "android.window.totalDuration");
            result.put("frames", count); result.put("elapsedMs", SystemClock.uptimeMillis() - started); result.put("cancelled", cancelled);
            result.put("p95", percentile(totals, count, .95)); result.put("max", percentile(totals, count, 1));
            result.put("intervalP95", percentile(intervals, intervalCount, .95)); result.put("intervalMax", percentile(intervals, intervalCount, 1));
            result.put("overBudget", overBudget); result.put("over50ms", over50ms); result.put("droppedReports", droppedReports); result.put("refreshRate", refreshRate);
            if (Build.VERSION.SDK_INT >= 31) { result.put("gpuP95", percentile(gpu, gpuCount, .95)); result.put("gpuMax", percentile(gpu, gpuCount, 1)); }
            call.resolve(result);
        }

        private double percentile(long[] values, int length, double fraction) { return length == 0 ? 0 : Math.round(values[Math.min(length - 1, (int) (length * fraction))] / 10_000d) / 100d; }
    }

    void dispose() {
        if (Build.VERSION.SDK_INT >= 24 && frameSample != null) frameSample.finish(true);
        if (frameThread != null) frameThread.quitSafely();
    }
}
