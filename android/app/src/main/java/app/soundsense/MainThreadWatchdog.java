package app.soundsense;

import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;

/**
 * Finds what freezes the interface: input and WebView frames are delivered by the Android
 * main thread, so a stall there shows up as a long frame without any JavaScript long task.
 * While the app is visible a background thread pings the main thread every 250 ms; when a
 * ping is late by more than 300 ms the main thread's stack is sampled and, once it recovers,
 * recorded in native diagnostics ("main.blocked": duration and the frames it was stuck in).
 */
final class MainThreadWatchdog {
    private static HandlerThread thread;
    private static Handler watcher;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static volatile long sentAt, answeredAt;
    private static String sample;
    private static boolean running;

    static synchronized void start() {
        if (running || !ReleaseChannel.debug) return;
        running = true;
        if (thread == null) { thread = new HandlerThread("SoundSenseWatchdog"); thread.start(); watcher = new Handler(thread.getLooper()); }
        watcher.post(MainThreadWatchdog::ping);
    }
    static synchronized void stop() { running = false; if (watcher != null) watcher.removeCallbacksAndMessages(null); }

    private static void ping() {
        if (!running) return;
        sentAt = SystemClock.uptimeMillis(); answeredAt = 0; sample = null;
        main.post(() -> answeredAt = SystemClock.uptimeMillis());
        watcher.postDelayed(MainThreadWatchdog::check, 50);
    }
    private static void check() {
        if (!running) return;
        long now = SystemClock.uptimeMillis(), answered = answeredAt, waited = now - sentAt;
        if (answered == 0) {
            if (waited >= 300 && sample == null) sample = stack();
            watcher.postDelayed(MainThreadWatchdog::check, waited > 2000 ? 250 : 50);
            return;
        }
        long blocked = answered - sentAt;
        if (blocked >= 300) PlaybackDiagnostics.record("main.blocked", "", blocked + "ms", sample == null ? "" : sample, null);
        watcher.postDelayed(MainThreadWatchdog::ping, 250);
    }
    private static String stack() {
        StringBuilder text = new StringBuilder();
        int count = 0;
        for (StackTraceElement frame : Looper.getMainLooper().getThread().getStackTrace()) {
            String name = frame.getClassName();
            if (name.startsWith("android.os.Looper") || name.startsWith("android.os.MessageQueue") || name.startsWith("android.app.ActivityThread") || name.startsWith("java.lang.reflect") || name.startsWith("com.android.internal.os")) continue;
            if (text.length() > 0) text.append(" < ");
            text.append(name.substring(name.lastIndexOf('.') + 1)).append('.').append(frame.getMethodName());
            if (frame.getLineNumber() > 0) text.append(':').append(frame.getLineNumber());
            if (++count >= 12) break;
        }
        return text.toString();
    }
}
