package app.soundsense;

import android.content.*;
import android.media.AudioManager;
import android.net.Uri;
import android.os.IBinder;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PlaybackGainTest {
    private final CompletableFuture<AudioPlaybackService> connected = new CompletableFuture<>();
    private final ServiceConnection connection = new ServiceConnection() {
        public void onServiceConnected(ComponentName name, IBinder binder) { connected.complete(((AudioPlaybackService.LocalBinder) binder).service()); }
        public void onServiceDisconnected(ComponentName name) { }
    };
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private AudioPlaybackService service;
    private ActivityScenario<MainActivity> activity;
    private File file;

    private static class Reply extends PluginCall {
        final CompletableFuture<JSObject> result = new CompletableFuture<>();
        Reply() { super(null, "", "", "", new JSObject()); }
        @Override public void resolve() { result.complete(new JSObject()); }
        @Override public void resolve(JSObject data) { result.complete(data); }
        @Override public void reject(String msg, String code, Exception ex, JSObject data) { result.completeExceptionally(new IllegalStateException(msg, ex)); }
        JSObject await() throws Exception { return result.get(5, TimeUnit.SECONDS); }
    }
    @Before public void open() throws Exception {
        activity = ActivityScenario.launch(MainActivity.class);
        assertTrue(context.bindService(new Intent(context, AudioPlaybackService.class), connection, Context.BIND_AUTO_CREATE));
        service = connected.get(5, TimeUnit.SECONDS);
        file = File.createTempFile("envelope-", ".wav", context.getCacheDir());
        int length = 8 * 8000 * 2;
        ByteBuffer wav = ByteBuffer.allocate(44 + length).order(ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes("US-ASCII")).putInt(36 + length).put("WAVEfmt ".getBytes("US-ASCII")).putInt(16);
        wav.putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16);
        wav.put("data".getBytes("US-ASCII")).putInt(length);
        try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(wav.array()); }
        prepare("a", "old", file); prepare("b", "new", file);
        command("start", "a");
    }
    @After public void close() {
        if (service != null) { command("stop", "a"); command("stop", "b"); context.unbindService(connection); }
        if (activity != null) activity.close();
        if (file != null) file.delete();
    }
    private void prepare(String slot, String track, File source) throws Exception {
        Reply reply = new Reply();
        service.prepare(slot, Uri.fromFile(source).toString(), track, track, "", new JSONObject(), reply);
        reply.await();
    }
    private void command(String action, String slot, Object... pairs) {
        JSObject data = new JSObject(); data.put("action", action); data.put("slot", slot);
        for (int i = 0; i < pairs.length; i += 2) data.put((String)pairs[i], pairs[i + 1]);
        service.command(data);
    }
    private JSONObject slot(String name) throws Exception {
        Reply reply = new Reply(); service.diagnostics(reply); return reply.await().getJSONObject("slots").getJSONObject(name);
    }
    private void overlap() throws Exception {
        command("crossfade", "a", "to", "b", "seconds", 4);
        double gain = 0;
        for (int i = 0; i < 40 && gain < .05; i++) { Thread.sleep(25); gain = slot("b").getDouble("envelope"); }
        assertTrue("incoming track is mid-envelope", gain >= .05 && gain < 1);
    }
    @Test public void seekAndPauseDuringOverlapRestoreTheIncomingSlot() throws Exception {
        overlap(); command("seek", "b", "position", 2);
        assertEquals(1, slot("b").getDouble("effectiveGain"), .001);
        assertFalse(slot("a").getBoolean("playing"));
        command("start", "a"); overlap(); command("pause", "b"); command("start", "b");
        assertEquals(1, slot("b").getDouble("effectiveGain"), .001);
    }
    @Test public void skippedOrFailedSlotCannotAttenuateItsSuccessor() throws Exception {
        overlap(); command("stop", "a");
        assertEquals(1, slot("b").getDouble("effectiveGain"), .001);
        command("fadeOut", "b", "seconds", .2);
        JSObject processing = new JSObject(); processing.put("volume", .45);
        command("processing", "b", "trackId", "third", "processing", processing);
        assertEquals(1, slot("b").getDouble("volume"), .001);
        try { prepare("b", "broken", new File(file + ".missing")); fail("missing media"); }
        catch (java.util.concurrent.ExecutionException expected) { }
        prepare("b", "third", file); command("start", "b");
        assertEquals(.45, slot("b").getDouble("effectiveGain"), .001);
        assertEquals(1, slot("b").getDouble("envelope"), .001);
    }
    @Test public void duckSurvivesAnInterruptedFadeUntilFocusReturns() throws Exception {
        overlap(); service.audioFocusChanged(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);
        command("stop", "a"); assertEquals(.2, slot("b").getDouble("effectiveGain"), .001);
        service.audioFocusChanged(AudioManager.AUDIOFOCUS_GAIN);
        assertEquals(1, slot("b").getDouble("effectiveGain"), .001);
    }
}
