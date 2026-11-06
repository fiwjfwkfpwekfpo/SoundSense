package app.soundsense;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * One package, two update channels. The channel is chosen in Settings; beta turns on
 * diagnostics (journal, watchdog, frame metrics). Native code reads the last choice at
 * start, before the WebView reports it again.
 */
final class ReleaseChannel {
    private static final String PREFERENCES = "soundsense_channel", KEY = "channel";
    static volatile boolean debug = "beta".equals(BuildConfig.DEFAULT_CHANNEL);
    static void init(Context context) { debug = "beta".equals(get(context)); }
    static String get(Context context) { return preferences(context).getString(KEY, BuildConfig.DEFAULT_CHANNEL); }
    static void set(Context context, String channel) {
        if (!"stable".equals(channel) && !"beta".equals(channel)) return;
        preferences(context).edit().putString(KEY, channel).apply();
        debug = "beta".equals(channel);
        if (!debug) MainThreadWatchdog.stop();
    }
    private static SharedPreferences preferences(Context context) { return context.getApplicationContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE); }
}
