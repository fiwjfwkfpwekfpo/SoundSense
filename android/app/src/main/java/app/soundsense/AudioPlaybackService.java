package app.soundsense;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.graphics.Bitmap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.common.util.UnstableApi;

/** Media I/O and envelopes have their own looper, independent of WebView animation work. */
@androidx.annotation.OptIn(markerClass = UnstableApi.class)
public class AudioPlaybackService extends Service {
    public interface EventListener { void accept(String event, JSObject data); }
    public class LocalBinder extends Binder { AudioPlaybackService service() { return AudioPlaybackService.this; } }
    private final LocalBinder binder = new LocalBinder();
    private static final String CHANNEL = "soundsense_playback";
    private static final int NOTIFICATION = 40;
    private HandlerThread thread;
    private Handler audio;
    private AudioManager manager;
    private AudioFocusRequest focus;
    private MediaSession session;
    private final ExecutorService artworkIo = Executors.newSingleThreadExecutor();
    private Bitmap logo;
    private org.json.JSONObject labels = new org.json.JSONObject();
    private volatile EventListener listener;
    private final Slot a = new Slot("a"), b = new Slot("b");
    private Slot current = a, fadingFrom, fadingTo;
    private long envelopeStart, envelopeDuration;
    private float envelopeGain = 1, duck = 1;
    private boolean foreground = false, resumeAfterFocus = false;
    private long lastNotification = 0;
    private long lastReport = 0;
    /** Position reports to the WebView: 250 ms while it is visible, rarer in the background (fewer wake-ups). */
    private long reportEvery = 250;
    /*
     * Native hand-off to the next track. The WebView prepares the next slot and "arms" it; the
     * switch itself (crossfade, gapless start at the end, notification "next") then happens here,
     * on the audio looper. With the screen off Android throttles WebView timers (after ~5 min
     * to about one wake-up per minute), so a switch driven by JavaScript could be missed.
     */
    private Slot armedFrom, armedTo; private String armedTrack = "";
    private double armAt = -1, armUntil = Double.MAX_VALUE, armDuration = 0, armPosition = 0;
    private class Slot {
        boolean loop;
        final String id; MediaPlayer player; ExoPlayer stream; boolean ready, playing, ended, buffering; float gain = 1;
        String title = "", artist = "", trackId = "", artworkUri = ""; PluginCall pending;
        Bitmap artwork; int artworkGeneration; boolean liked, hasPrevious, hasNext;
        String failureReason, failureMessage, sourceUri = ""; boolean offline;
        Integer failureStatus; int requests;
        org.json.JSONObject sourceHeaders = new org.json.JSONObject();
        long bufferingAt;
        float rate = 1, pitch = 1, boost = 1; android.media.audiofx.LoudnessEnhancer loudness;
        Slot(String id) { this.id = id; }
    }
    private Slot slot(String id) { return "b".equals(id) ? b : a; }
    private void emit(String event, JSObject value) { EventListener callback = listener; if (callback != null) { try { callback.accept(event, value); } catch (RuntimeException ignored) { /* A detached WebView cannot stop foreground audio. */ } } }
    public void setListener(EventListener callback) { listener = callback; }
    public void diagnostics(PluginCall call) { audio.post(() -> {
        JSObject value = new JSObject(); value.put("entries", PlaybackDiagnostics.snapshot());
        PowerManager power = (PowerManager)getSystemService(POWER_SERVICE);
        value.put("screenOn", power.isInteractive()); value.put("powerSave", power.isPowerSaveMode()); value.put("unrestricted", power.isIgnoringBatteryOptimizations(getPackageName()));
        JSObject slots = new JSObject(); for (Slot target : new Slot[] {a, b}) { JSObject item = new JSObject(); item.put("trackId", target.trackId); item.put("ready", target.ready); item.put("playing", target.playing); item.put("buffering", target.buffering); item.put("offline", target.offline); item.put("position", position(target)); item.put("rate", target.rate); item.put("pitch", target.pitch); item.put("volume", target.boost); item.put("artwork", target.artwork != null); item.put("backend", target.stream != null ? "Media3" : "MediaPlayer"); if (target.stream != null) { item.put("appliedRate", target.stream.getPlaybackParameters().speed); item.put("appliedPitch", target.stream.getPlaybackParameters().pitch); } slots.put(target.id, item); }
        value.put("slots", slots); value.put("current", current.id); call.resolve(value);
    }); }
    private void action(String type, Slot slot) {
        JSObject value = new JSObject(); value.put("type", type);
        if (slot != null) { value.put("slot", slot.id); if ("like".equals(type)) value.put("liked", slot.liked); if ("error".equals(type)) { value.put("reason", slot.failureReason == null ? "decoder" : slot.failureReason); value.put("code", slot.failureMessage == null ? "native" : slot.failureMessage); if (slot.failureStatus != null) value.put("status", slot.failureStatus); } }
        PlaybackDiagnostics.record("control." + type, slot == null ? "" : slot.trackId, slot == null ? null : slot.failureMessage, slot == null ? null : slot.failureReason, null);
        emit("action", value);
    }
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> audio.post(() -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) { duck = .2f; volume(a); volume(b); }
        else if (change == AudioManager.AUDIOFOCUS_GAIN) { duck = 1; volume(a); volume(b); if (resumeAfterFocus) { resumeAfterFocus = false; action("play", current); start(current, position(current)); } }
        else if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) { resumeAfterFocus = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT && current.playing; pauseAll(); action("pause", current); }
    });
    private final BroadcastReceiver noisy = new BroadcastReceiver() { @Override public void onReceive(Context context, Intent intent) { audio.post(() -> { pauseAll(); action("pause", current); }); } };

    @Override public void onCreate() {
        super.onCreate(); thread = new HandlerThread("SoundSenseAudio"); thread.start(); audio = new Handler(thread.getLooper()); manager = (AudioManager) getSystemService(AUDIO_SERVICE);
        PlaybackDiagnostics.init(this);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "SoundSense", NotificationManager.IMPORTANCE_LOW); channel.setSound(null, null); getSystemService(NotificationManager.class).createNotificationChannel(channel);
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes()).setOnAudioFocusChangeListener(focusListener, audio).build();
        }
        session = new MediaSession(this, "SoundSense");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setPlaybackToLocal(attributes());
        session.setSessionActivity(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        android.os.Bundle slots = new android.os.Bundle(); slots.putBoolean("android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_PREVIOUS", true); slots.putBoolean("android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_NEXT", true); session.setExtras(slots);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { audio.post(() -> { action("play", current); start(current, position(current)); }); }
            @Override public void onPause() { audio.post(() -> { pauseAll(); action("pause", current); }); }
            @Override public void onSkipToNext() { audio.post(() -> skipNext()); }
            @Override public void onSkipToPrevious() { action("previous", current); }
            @Override public void onSeekTo(long position) { audio.post(() -> {
                seek(current, position / 1000.0); updateNotification();
                JSObject value = new JSObject(); value.put("type", "seek"); value.put("slot", current.id); value.put("position", position / 1000.0); emit("action", value);
            }); }
            @Override public void onCustomAction(String command, android.os.Bundle extras) { if ("soundsense.like".equals(command)) audio.post(() -> { current.liked = !current.liked; action("like", current); updateNotification(); }); }
            @Override public void onStop() { audio.post(() -> { pauseAll(); action("pause", current); stopForeground(true); foreground = false; stopSelf(); }); }
        }, audio);
        session.setActive(true);
        artworkIo.execute(() -> { try { Bitmap bitmap = MediaArtwork.load(this, ""); audio.post(() -> { logo = bitmap; if (current.ready) { updateMetadata(); updateNotification(); } }); } catch (Exception ignored) {} });
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(noisy, filter);
        audio.post(pulse);
    }
    private AudioAttributes attributes() { return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(); }
    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (!foreground) { startForeground(NOTIFICATION, notification()); foreground = true; }
        String action = intent == null ? null : intent.getAction();
        if (action != null) audio.post(() -> {
            if ("toggle".equals(action)) { if (current.playing) { pauseAll(); action("pause", current); } else { action("play", current); start(current, position(current)); } }
            else if ("next".equals(action)) skipNext();
            else if ("previous".equals(action)) action(action, current);
            else if ("like".equals(action)) { current.liked = !current.liked; action("like", current); updateNotification(); }
            else if ("stop".equals(action)) { pauseAll(); action("pause", current); stopForeground(true); foreground = false; stopSelf(); }
        });
        return START_NOT_STICKY;
    }
    public void prepare(String id, String uri, String trackId, String title, String artist, org.json.JSONObject headers, PluginCall call) {
        audio.post(() -> { Slot target = slot(id); int request = ++target.requests; prepareNow(target, request, uri, trackId, title, artist, headers, call); });
    }
    private void prepareNow(Slot target, int request, String uri, String trackId, String title, String artist, org.json.JSONObject headers, PluginCall call) {
        if (target.requests != request) { call.reject("Audio preparation superseded"); return; }
        // The slot is still fading out after a native hand-off: let the fade finish first.
        long fading = target == fadingFrom ? envelopeStart + envelopeDuration - SystemClock.elapsedRealtime() : 0;
        if (fading > 0) { audio.postDelayed(() -> prepareNow(target, request, uri, trackId, title, artist, headers, call), fading + 30); return; }
        {
            release(target); target.title = title; target.artist = artist; target.trackId = trackId; target.pending = call; target.buffering = true; target.bufferingAt = SystemClock.elapsedRealtime(); target.sourceHeaders = headers;
            PlaybackDiagnostics.record("prepare.start", trackId, null, null, null);
            try {
                Uri source = Uri.parse(uri); String scheme = source.getScheme();
                if ("soundsense-cache".equals(scheme)) { String cached = MusicCache.get(this).offlineUri(trackId); if (cached == null) throw new IllegalArgumentException("Offline audio is unavailable"); source = Uri.parse(cached); scheme = source.getScheme(); target.offline = true; }
                target.sourceUri = source.toString(); MusicCache.get(this).protect(trackId, true);
                if (!("content".equals(scheme) || "file".equals(scheme) || "https".equals(scheme))) throw new IllegalArgumentException("Unsupported media scheme");
                if ("https".equals(scheme)) { prepareStream(target, source); return; }
                MediaPlayer player = new MediaPlayer(); target.player = player; player.setAudioAttributes(attributes()); player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
                player.setOnPreparedListener(ready -> {
                    if (target.player != ready) return; target.ready = true; target.buffering = false; applyProcessing(target); applyLoop(target); volume(target);
                    if (target.pending != null) { target.pending.resolve(); target.pending = null; } report(target);
                });
                player.setOnSeekCompleteListener(ready -> { if (target.player == ready) { target.buffering = false; report(target); } });
                player.setOnErrorListener((failed, what, extra) -> {
                    if (target.player != failed) return true; target.playing = false; target.buffering = false;
                    if (target.pending != null) { target.pending.reject("Audio decoder error " + what + "/" + extra); target.pending = null; }
                    target.failureReason = "decoder"; target.failureMessage = "MediaPlayer:" + what + "/" + extra; action("error", target); report(target); return true;
                });
                player.setOnInfoListener((p, what, extra) -> { if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) target.buffering = true; else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END) target.buffering = false; return false; });
                player.setOnCompletionListener(complete -> { if (target.player == complete) { target.playing = false; target.ended = true; report(target); endedHandOff(target); } });
                player.setDataSource(this, source); player.prepareAsync();
                audio.postDelayed(() -> { if (target.player == player && target.pending != null) { target.pending.reject("Audio preparation timed out"); target.pending = null; release(target); } }, 25000);
            } catch (Exception error) { if (target.pending != null) { target.pending.reject("Unable to open audio", error); target.pending = null; } release(target); }
        }
    }
    /**
     * A larger AudioTrack buffer (~1 s instead of ~250 ms): with the screen off the CPU
     * sleeps longer between wakeups, and time-stretching (speed/pitch presets such as
     * Nightcore) needs more headroom, otherwise playback stutters.
     */
    private androidx.media3.exoplayer.RenderersFactory renderers() {
        return new androidx.media3.exoplayer.DefaultRenderersFactory(this) {
            @Override protected androidx.media3.exoplayer.audio.AudioSink buildAudioSink(android.content.Context context, boolean enableFloatOutput, boolean enableAudioTrackPlaybackParams) {
                return new androidx.media3.exoplayer.audio.DefaultAudioSink.Builder(context).setEnableFloatOutput(enableFloatOutput)
                    // Speed/pitch (Nightcore, Slowed) is applied by the platform AudioTrack inside audioserver, like the
                    // WebView <audio> element Muriel uses, instead of the in-app Sonic processor that starves when the screen is off.
                    .setEnableAudioTrackPlaybackParams(true)
                    .setAudioTrackBufferSizeProvider(new androidx.media3.exoplayer.audio.DefaultAudioTrackBufferSizeProvider.Builder().setMinPcmBufferDurationUs(750_000).setMaxPcmBufferDurationUs(1_500_000).setPcmBufferMultiplicationFactor(8).build())
                    .build();
            }
        };
    }
    /**
     * Audio is small, so buffer far ahead: with the screen off (and in power saving) Android
     * throttles network access in bursts, and a 50 s buffer ran dry repeatedly. Up to five
     * minutes (capped at 48 MB) are fetched while the radio is awake, so a whole track usually
     * sits in memory after the first minute.
     */
    private androidx.media3.exoplayer.LoadControl loadControl() {
        return new androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(120_000, 300_000, 1_500, 4_000)
            .setTargetBufferBytes(48 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
    }
    private void prepareStream(Slot target, Uri uri) {
        MusicCache.get(this).touch(target.trackId, uri.toString(), target.sourceHeaders);
        ExoPlayer stream = new ExoPlayer.Builder(this, renderers()).setLooper(audio.getLooper()).setLoadControl(loadControl()).setMediaSourceFactory(new DefaultMediaSourceFactory(MusicCache.get(this).source(target.trackId, target.offline))).build();
        target.stream = stream;
        applyProcessing(target); applyLoop(target);
        stream.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), false);
        stream.setWakeMode(C.WAKE_MODE_NETWORK);
        stream.addListener(new Player.Listener() {
            @Override public void onAudioSessionIdChanged(int sessionId) { if (target.stream == stream) applyBoost(target, sessionId); }
            @Override public void onPlaybackStateChanged(int state) {
                if (target.stream != stream) return;
                boolean buffering = state == Player.STATE_BUFFERING;
                if (buffering && !target.buffering) { target.bufferingAt = SystemClock.elapsedRealtime(); PlaybackDiagnostics.record("stream.buffering", target.trackId, ((PowerManager)getSystemService(POWER_SERVICE)).isInteractive() ? "screen-on" : "screen-off", null, null); }
                if (!buffering && target.bufferingAt > 0) { PlaybackDiagnostics.record("stream.buffer.ready", target.trackId, Long.toString(SystemClock.elapsedRealtime() - target.bufferingAt) + "ms", null, null); target.bufferingAt = 0; }
                target.buffering = buffering;
                if (state == Player.STATE_READY) { target.ready = true; volume(target); if (target.pending != null) { target.pending.resolve(); target.pending = null; } }
                if (state == Player.STATE_ENDED) { target.ended = true; target.playing = false; if (!target.offline) MusicCache.get(AudioPlaybackService.this).listened(target.trackId, target.sourceUri); }
                report(target);
                if (state == Player.STATE_ENDED) endedHandOff(target);
            }
            @Override public void onIsPlayingChanged(boolean playing) { if (target.stream == stream) { target.playing = playing; report(target); } }
            @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) { if (target.stream == stream) { target.buffering = stream.getPlaybackState() == Player.STATE_BUFFERING; report(target); } }
            @Override public void onPlayerError(PlaybackException error) {
                if (target.stream != stream) return; target.playing = false; target.buffering = false;
                target.failureMessage = error.getErrorCodeName(); target.failureReason = error.errorCode >= 6000 && error.errorCode < 7000 ? "protected" : error.errorCode >= 2000 && error.errorCode < 3000 ? "network" : "decoder";
                Throwable cause = error.getCause(); Integer status = null;
                for (Throwable nested = cause; nested != null; nested = nested.getCause()) if (nested instanceof androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) { status = ((androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException)nested).responseCode; break; }
                target.failureStatus = status;
                if (Integer.valueOf(401).equals(status) || Integer.valueOf(403).equals(status)) target.failureReason = "auth";
                else if (Integer.valueOf(451).equals(status)) target.failureReason = "region";
                else if (Integer.valueOf(404).equals(status)) target.failureReason = "unavailable";
                String complete = MusicCache.get(AudioPlaybackService.this).offlineUri(target.trackId);
                if (Integer.valueOf(416).equals(status) && !target.offline && complete != null) {
                    // A CDN range may expire while a completed download is already
                    // available. Resume verified cache bytes without another HTTP request.
                    long resumeAt = stream.getCurrentPosition(); boolean resumePlaying = stream.getPlayWhenReady();
                    target.offline = true; target.buffering = true; target.failureReason = null; target.failureMessage = null; target.failureStatus = null;
                    PlaybackDiagnostics.record("stream.range.retry.cached", target.trackId, null, null, status);
                    stream.setMediaSource(new DefaultMediaSourceFactory(MusicCache.get(AudioPlaybackService.this).source(target.trackId, true)).createMediaSource(MediaItem.fromUri(complete)));
                    stream.seekTo(resumeAt); stream.prepare(); stream.setPlayWhenReady(resumePlaying); report(target); return;
                }
                PlaybackDiagnostics.record("stream.failed", target.trackId, error.getErrorCodeName(), target.failureReason, status);
                if (target.pending != null) { target.pending.reject("Stream error " + error.getErrorCodeName(), status == null ? error.getErrorCodeName() : "HTTP_" + status); target.pending = null; }
                action("error", target); report(target);
            }
        });
        stream.addAnalyticsListener(new AnalyticsListener() {
            @Override public void onAudioUnderrun(AnalyticsListener.EventTime eventTime, int bufferSize, long bufferSizeMs, long elapsedSinceLastFeedMs) {
                if (target.stream == stream) PlaybackDiagnostics.record("stream.audio.underrun", target.trackId, Long.toString(elapsedSinceLastFeedMs) + "ms", ((PowerManager)getSystemService(POWER_SERVICE)).isInteractive() ? "screen-on" : "screen-off", null);
            }
        });
        stream.setMediaItem(MediaItem.fromUri(uri)); stream.prepare();
        audio.postDelayed(() -> { if (target.stream == stream && target.pending != null) { target.pending.reject("Stream preparation timed out"); target.pending = null; release(target); } }, 30000);
    }
    public void command(JSObject options) {
        audio.post(() -> {
            Slot target = slot(options.optString("slot", "a")); String command = options.optString("action");
            try {
                if ("start".equals(command)) { if (target == armedTo) disarm("start"); start(target, options.optDouble("position", 0)); }
                else if ("arm".equals(command)) arm(target, options);
                else if ("disarm".equals(command)) disarm("js");
                else if ("reporting".equals(command)) { reportEvery = Math.max(100, Math.min(5000, options.optLong("ms", 250))); lastReport = 0; }
                else if ("select".equals(command)) {
                    org.json.JSONObject metadata = options.optJSONObject("metadata");
                    if (metadata != null) { boolean prepared = target.ready && target.trackId.equals(metadata.optString("trackId")); target.trackId = metadata.optString("trackId"); target.title = metadata.optString("title"); target.artist = metadata.optString("artist"); target.buffering = !prepared; target.failureReason = null; target.failureStatus = null; current = target; applyMetadata(metadata); updateMetadata(); updateNotification(); }
                }
                else if ("failure".equals(command)) { target.failureReason = options.optString("reason", "unavailable"); target.failureMessage = options.optString("message", "Playback unavailable"); target.buffering = false; target.playing = false; current = target; updateNotification(); }
                else if ("pause".equals(command)) { pause(target); updateNotification(); }
                else if ("stop".equals(command)) { target.requests++; release(target); }
                else if ("seek".equals(command)) seek(target, options.optDouble("position", 0));
                // Repeat-one loops natively: with the screen off the WebView may be frozen when the track ends.
                else if ("loop".equals(command)) { target.loop = options.optBoolean("loop", false); applyLoop(target); }
                else if ("gain".equals(command)) { target.gain = (float)Math.max(0, Math.min(1, options.optDouble("gain", 1))); if (target != fadingFrom && target != fadingTo) volume(target); }
                else if ("processing".equals(command)) { org.json.JSONObject value = options.optJSONObject("processing"); if (value != null) { target.rate = (float)Math.max(.25, Math.min(4, value.optDouble("rate", 1))); target.pitch = (float)Math.max(.25, Math.min(4, value.optDouble("pitch", 1))); target.boost = (float)Math.max(0, Math.min(2, value.optDouble("volume", 1))); applyProcessing(target); volume(target); } }
                else if ("metadata".equals(command)) applyMetadata(options.optJSONObject("metadata"));
                else if ("fadeOut".equals(command)) { disarm("fadeOut"); fadingFrom = target; fadingTo = null; envelopeGain = target.gain; envelopeStart = SystemClock.elapsedRealtime(); envelopeDuration = Math.max(1, (long)(options.optDouble("seconds", .18) * 1000)); }
                else if ("crossfade".equals(command)) {
                    disarm("crossfade"); Slot to = slot(options.optString("to")); to.gain = 0; start(to, options.optDouble("position", 0));
                    fadingFrom = target; fadingTo = to; envelopeGain = target.gain; envelopeStart = SystemClock.elapsedRealtime(); envelopeDuration = Math.max(1, (long)(options.optDouble("seconds", 3) * 1000));
                }
                else if ("dispose".equals(command)) { release(a); release(b); stopForeground(true); foreground = false; stopSelf(); }
            } catch (Exception error) { action("error", target); }
        });
    }
    private void applyMetadata(org.json.JSONObject metadata) {
        if (metadata == null) return;
        String id = metadata.optString("trackId"); Slot target = current.trackId.equals(id) ? current : a.trackId.equals(id) ? a : b.trackId.equals(id) ? b : null; if (target == null) return;
        target.liked = metadata.optBoolean("liked"); target.hasPrevious = metadata.optBoolean("previous"); target.hasNext = metadata.optBoolean("next");
        org.json.JSONObject translated = metadata.optJSONObject("labels"); if (translated != null) labels = translated;
        String uri = metadata.optString("artwork", "");
        if (!uri.equals(target.artworkUri)) {
            target.artworkUri = uri; int generation = ++target.artworkGeneration;
            artworkIo.execute(() -> {
                try { Bitmap bitmap = MediaArtwork.load(this, uri); audio.post(() -> { if (target.artworkGeneration != generation) return; target.artwork = bitmap; if (current == target) { updateMetadata(); updateNotification(); } }); }
                catch (Exception ignored) { /* The app logo remains visible if a provider has no cover. */ }
            });
        }
        if (current == target) { updateMetadata(); updateNotification(); }
    }
    private double position(Slot target) { try { return target.stream != null ? target.stream.getCurrentPosition() / 1000.0 : target.ready && target.player != null ? target.player.getCurrentPosition() / 1000.0 : 0; } catch (Exception error) { return 0; } }
    private long duration(Slot target) { try { return target.stream != null ? Math.max(0, target.stream.getDuration()) : target.ready && target.player != null ? target.player.getDuration() : 0; } catch (Exception error) { return 0; } }
    private void start(Slot target, double position) {
        if (!target.ready || target.player == null && target.stream == null) return;
        int granted = Build.VERSION.SDK_INT >= 26 ? manager.requestAudioFocus(focus) : manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { action("pause", target); return; }
        current = target; seek(target, position); volume(target); if (target.stream != null) target.stream.play(); else target.player.start(); target.playing = true; target.ended = false;
        ContextCompat.startForegroundService(this, new Intent(this, AudioPlaybackService.class)); updateMetadata(); report(target); updateNotification();
        String id = target.trackId, uri = target.sourceUri;
        if (!target.offline && uri.startsWith("https://")) audio.postDelayed(() -> { if (target.playing && target.trackId.equals(id) && target.sourceUri.equals(uri)) MusicCache.get(this).listened(id, uri); }, 3000);
    }
    private void seek(Slot target, double position) { if (target.ready) { long length = duration(target), milliseconds = Math.max(0, length > 0 ? Math.min(length, (long)(position * 1000)) : (long)(position * 1000)); target.buffering = true; if (target.stream != null) { target.stream.seekTo(milliseconds); target.buffering = target.stream.getPlaybackState() == Player.STATE_BUFFERING; } else if (target.player != null) { if (Build.VERSION.SDK_INT >= 26) target.player.seekTo(milliseconds, MediaPlayer.SEEK_CLOSEST); else target.player.seekTo((int)milliseconds); } target.ended = false; report(target); } }
    private void pause(Slot target) { if (target.stream != null) target.stream.pause(); else if (target.player != null && target.ready && target.playing) target.player.pause(); target.playing = false; report(target); }
    private void pauseAll() { fadingFrom = null; fadingTo = null; pause(a); pause(b); updateNotification(); }
    private void volume(Slot target) { float gain = target.gain * duck * Math.min(1, target.boost); if (target.stream != null) target.stream.setVolume(gain); else if (target.player != null && target.ready) target.player.setVolume(gain, gain); }
    private void applyLoop(Slot target) {
        try {
            if (target.stream != null) target.stream.setRepeatMode(target.loop ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            else if (target.player != null && target.ready) target.player.setLooping(target.loop);
        } catch (RuntimeException ignored) { /* A released player cannot loop. */ }
    }
    private void applyProcessing(Slot target) {
        try {
            if (target.stream != null) { target.stream.setPlaybackParameters(new androidx.media3.common.PlaybackParameters(target.rate, target.pitch)); applyBoost(target, target.stream.getAudioSessionId()); }
            else if (target.player != null && target.ready) { boolean playing = target.playing; target.player.setPlaybackParams(new android.media.PlaybackParams().allowDefaults().setSpeed(target.rate).setPitch(target.pitch)); if (!playing) target.player.pause(); applyBoost(target, target.player.getAudioSessionId()); }
            PlaybackDiagnostics.record("processing.applied", target.trackId, "rate=" + target.rate + ",pitch=" + target.pitch + ",gain=" + target.boost, null, null);
        } catch (RuntimeException error) { PlaybackDiagnostics.record("processing.failed", target.trackId, error.getClass().getSimpleName(), "unsupported", null); }
    }
    private void applyBoost(Slot target, int sessionId) {
        if (sessionId <= 0) return;
        if (target.boost <= 1) { if (target.loudness != null) target.loudness.setEnabled(false); return; }
        try { if (target.loudness == null) target.loudness = new android.media.audiofx.LoudnessEnhancer(sessionId); target.loudness.setTargetGain((int)Math.max(0, 2000 * Math.log10(Math.max(1, target.boost)))); target.loudness.setEnabled(target.boost > 1); }
        catch (RuntimeException error) { PlaybackDiagnostics.record("processing.gain.unsupported", target.trackId, error.getClass().getSimpleName(), "unsupported", null); }
    }
    private void release(Slot target) {
        Slot another = target == a ? b : a;
        if (!another.ready || !another.trackId.equals(target.trackId)) MusicCache.get(this).protect(target.trackId, false);
        if (target == fadingFrom || target == fadingTo) { fadingFrom = null; fadingTo = null; }
        if (target == armedFrom || target == armedTo) disarm("release");
        if (target.pending != null) { target.pending.reject("Audio preparation superseded"); target.pending = null; }
        if (target.player != null) { target.player.release(); target.player = null; }
        if (target.stream != null) { target.stream.release(); target.stream = null; }
        if (target.loudness != null) { target.loudness.release(); target.loudness = null; }
        target.ready = false; target.playing = false; target.ended = false; target.buffering = false; target.gain = 1;
        target.failureReason = null; target.failureMessage = null; target.failureStatus = null; target.bufferingAt = 0;
        target.offline = false; target.sourceUri = ""; target.trackId = "";
        target.artworkGeneration++; target.artwork = null; target.artworkUri = "";
    }
    private void report(Slot target) {
        JSObject value = new JSObject(); value.put("slot", target.id); value.put("position", position(target)); value.put("playing", target.playing); value.put("ended", target.ended); value.put("buffering", target.buffering || !target.ready); value.put("rate", target.rate); value.put("at", System.currentTimeMillis());
        // Context for the beta clock trace: which backend produced the position and the media's own length.
        value.put("duration", duration(target) / 1000.0); value.put("backend", target.stream != null ? "media3" : target.player != null ? "mediaplayer" : ""); value.put("offline", target.offline);
        emit("state", value);
    }
    private final Runnable pulse = new Runnable() {
        @Override public void run() {
            try {
                checkHandOff();
                if (fadingFrom != null) {
                    double fraction = Math.max(0, Math.min(1, (SystemClock.elapsedRealtime() - envelopeStart) / (double)envelopeDuration));
                    fadingFrom.gain = (float)(envelopeGain * (fadingTo == null ? 1 - fraction : Math.cos(fraction * Math.PI / 2))); volume(fadingFrom);
                    if (fadingTo != null) { fadingTo.gain = (float)Math.sin(fraction * Math.PI / 2); volume(fadingTo); }
                    if (fraction >= 1) { pause(fadingFrom); fadingFrom = null; fadingTo = null; }
                }
                // Paused/idle slots report on their own transitions; the WebView extrapolates the clock between reports.
                if (SystemClock.elapsedRealtime() - lastReport >= reportEvery) { if (a.playing || a.buffering) report(a); if (b.playing || b.buffering) report(b); lastReport = SystemClock.elapsedRealtime(); }
                if (SystemClock.elapsedRealtime() - lastNotification > 1000 && foreground) { updatePlaybackState(); lastNotification = SystemClock.elapsedRealtime(); }
            } catch (Exception ignored) { /* A released slot cannot kill the audio looper. */ }
            long delay = fadingFrom != null ? 16 : (a.playing || b.playing ? 200 : 1000);
            // Wake up close to an armed crossfade point instead of up to 200 ms late.
            if (armedFrom != null && armedFrom.playing && armAt >= 0) { double remain = (armAt - position(armedFrom)) / Math.max(.25, armedFrom.rate); if (remain < .4) delay = Math.min(delay, Math.max(8, (long)(remain * 1000))); }
            audio.postDelayed(this, delay);
        }
    };
    private void arm(Slot from, JSObject options) {
        Slot to = slot(options.optString("to"));
        if (to == from) return;
        armedFrom = from; armedTo = to; armedTrack = options.optString("trackId", to.trackId);
        armAt = options.optDouble("at", -1); armUntil = options.has("until") ? options.optDouble("until") : Double.MAX_VALUE;
        armDuration = Math.max(0, options.optDouble("duration", 0)); armPosition = Math.max(0, options.optDouble("position", 0));
        applyMetadata(options.optJSONObject("metadata"));
        PlaybackDiagnostics.record("handoff.arm", armedTrack, "at=" + Math.round(armAt * 1000) + "ms,dur=" + Math.round(armDuration * 1000) + "ms", to.ready ? "ready" : "preparing", null);
    }
    private void disarm(String reason) {
        if (armedFrom == null) return;
        PlaybackDiagnostics.record("handoff.disarm", armedTrack, reason, null, null);
        armedFrom = null; armedTo = null; armedTrack = ""; armAt = -1; armUntil = Double.MAX_VALUE; armDuration = 0; armPosition = 0;
    }
    private boolean handOffReady() { return armedFrom != null && armedTo != null && current == armedFrom && armedTo.ready && !armedTo.playing && armedTo.trackId.equals(armedTrack) && fadingFrom == null; }
    private void checkHandOff() {
        if (armAt < 0 || !handOffReady() || !armedFrom.playing || armedFrom.buffering) return;
        double position = position(armedFrom);
        if (position >= armAt && position < armUntil) handOff(Math.max(.05, Math.min(armDuration, armUntil - position)) / Math.max(.25, armedFrom.rate), false);
    }
    private void endedHandOff(Slot target) { if (target == armedFrom && handOffReady()) handOff(0, false); }
    /** Notification, lock screen and headset "next": switch natively when the next track is ready. */
    private void skipNext() { if (handOffReady()) handOff(.3, true); else action("next", current); }
    private void handOff(double seconds, boolean manual) {
        Slot from = armedFrom, to = armedTo; double position = manual ? 0 : armPosition; String track = armedTrack;
        armedFrom = null; armedTo = null; armedTrack = ""; armAt = -1; armUntil = Double.MAX_VALUE;
        long now = SystemClock.elapsedRealtime();
        if (seconds <= .01) { pause(from); to.gain = 1; start(to, position); }
        else if (manual) { to.gain = 1; start(to, position); fadingFrom = from; fadingTo = null; envelopeGain = from.gain; envelopeStart = now; envelopeDuration = Math.max(1, (long)(seconds * 1000)); }
        else { to.gain = 0; start(to, position); fadingFrom = from; fadingTo = to; envelopeGain = from.gain; envelopeStart = now; envelopeDuration = Math.max(1, (long)(seconds * 1000)); }
        boolean screen = ((PowerManager)getSystemService(POWER_SERVICE)).isInteractive();
        PlaybackDiagnostics.record("handoff.done", track, manual ? "manual" : seconds > 0 ? "crossfade" : "end", screen ? "screen-on" : "screen-off", null);
        JSObject value = new JSObject(); value.put("type", "advanced"); value.put("slot", from.id); value.put("to", to.id); value.put("trackId", track);
        value.put("position", position); value.put("seconds", seconds); value.put("manual", manual); value.put("at", System.currentTimeMillis());
        emit("action", value);
    }
    private void updateMetadata() {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, current.title).putString(MediaMetadata.METADATA_KEY_ARTIST, current.artist);
        Bitmap artwork = current.artwork == null ? logo : current.artwork;
        if (artwork != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork).putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
        if (current.ready) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, duration(current)); session.setMetadata(metadata.build());
    }
    private void updatePlaybackState() {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
        if (current.hasNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (current.hasPrevious) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        int state = current.failureReason != null ? PlaybackState.STATE_ERROR : current.buffering ? PlaybackState.STATE_BUFFERING : current.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState.Builder status = new PlaybackState.Builder().setActions(actions).setState(state, (long)(position(current) * 1000), current.playing && !current.buffering ? current.rate : 0);
        if (current.failureReason != null) status.setErrorMessage(current.failureMessage);
        status.addCustomAction(new PlaybackState.CustomAction.Builder("soundsense.like", labels.optString(current.liked ? "unlike" : "like", current.liked ? "Unlike" : "Like"), current.liked ? R.drawable.ic_media_liked : R.drawable.ic_media_like).build());
        session.setPlaybackState(status.build());
    }
    private PendingIntent control(String action, int request) { return PendingIntent.getService(this, request, new Intent(this, AudioPlaybackService.class).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); }
    private Notification notification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Intent launch = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return builder.setContentTitle(current.title.isEmpty() ? "SoundSense" : current.title).setContentText(current.artist).setSmallIcon(R.drawable.ic_playback)
            .setLargeIcon(current.artwork == null ? logo : current.artwork)
            .setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(current.playing)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, labels.optString("previous", "Previous"), control("previous", 1)).build())
            .addAction(new Notification.Action.Builder(current.playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, labels.optString(current.playing ? "pause" : "play", current.playing ? "Pause" : "Play"), control("toggle", 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, labels.optString("next", "Next"), control("next", 3)).build())
            .addAction(new Notification.Action.Builder(current.liked ? R.drawable.ic_media_liked : R.drawable.ic_media_like, labels.optString(current.liked ? "unlike" : "like", "Like"), control("like", 4)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    // MediaSession notifications are exempt from the Android 13 runtime permission.
    @SuppressLint({"NotificationPermission", "MissingPermission"})
    private void updateNotification() { updatePlaybackState(); if (foreground) getSystemService(NotificationManager.class).notify(NOTIFICATION, notification()); }
    @Override public void onDestroy() {
        listener = null; unregisterReceiver(noisy); session.release(); artworkIo.shutdownNow();
        audio.post(() -> { audio.removeCallbacksAndMessages(null); release(a); release(b); if (Build.VERSION.SDK_INT >= 26) manager.abandonAudioFocusRequest(focus); else manager.abandonAudioFocus(focusListener); thread.quitSafely(); }); super.onDestroy();
    }
}
