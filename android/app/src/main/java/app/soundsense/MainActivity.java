package app.soundsense;

import com.getcapacitor.BridgeActivity;
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
        getBridge().getWebView().setBackgroundColor(getColor(R.color.app_background));
        ViewCompat.requestApplyInsets(getBridge().getWebView());
        PlaybackDiagnostics.init(this);
    }
    @Override public void onResume() { super.onResume(); MainThreadWatchdog.start(); }
    @Override public void onPause() { MainThreadWatchdog.stop(); super.onPause(); }
}
