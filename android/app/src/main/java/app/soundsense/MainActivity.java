package app.soundsense;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.EdgeToEdge;
import androidx.core.view.ViewCompat;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemUiPlugin.class);
        registerPlugin(AudioEnginePlugin.class);
        registerPlugin(UpdateInstallerPlugin.class);
        registerPlugin(StateStorePlugin.class);
        registerPlugin(MusicCachePlugin.class);
        registerPlugin(AccountsPlugin.class);
        registerPlugin(PlaybackPowerPlugin.class);
        ReleaseChannel.init(this);
        super.onCreate(savedInstanceState);
        // Remote WebView inspection follows the channel chosen in Settings, not the build.
        android.webkit.WebView.setWebContentsDebuggingEnabled(ReleaseChannel.debug);
        EdgeToEdge.enable(this);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        WebView web = getBridge().getWebView();
        web.setBackgroundColor(getColor(R.color.app_background));
        /*
         * The player logic (next track, links, retries) runs in the WebView. By default its
         * renderer is "waived" once the activity is hidden: Android may freeze or kill it while
         * the music service plays, and the queue stops after the armed track. Keep the renderer
         * as important as the app itself (a media foreground service while playing).
         */
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        // A renderer killed in the background must not take the app (and the music service) down with it.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                PlaybackDiagnostics.record("webview.gone", "", detail.didCrash() ? "crash" : "killed", null, null);
                rendererGone = true;
                if (hasWindowFocus()) recreate();
                return true;
            }
        });
        ViewCompat.requestApplyInsets(getBridge().getWebView());
        PlaybackDiagnostics.init(this);
    }
    private boolean rendererGone = false;
    @Override public void onResume() { super.onResume(); MainThreadWatchdog.start(); if (rendererGone) { rendererGone = false; recreate(); } }
    @Override public void onPause() { MainThreadWatchdog.stop(); super.onPause(); }
}
