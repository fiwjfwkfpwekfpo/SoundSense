package app.soundsense;

import android.content.Intent;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Account credentials never share library state, WebView storage or backups. */
@CapacitorPlugin(name = "Accounts")
public class AccountsPlugin extends Plugin {
    private static final String ALIAS = "SoundSenseAccountsV1";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry)store.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private AtomicFile file(PluginCall call) throws Exception {
        String name = call.getString("key", ""); if (!"yandex".equals(name)) throw new IllegalArgumentException("Unknown account");
        File directory = new File(getContext().getFilesDir(), "account-secrets"); if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Account directory unavailable");
        return new AtomicFile(new File(directory, name + ".bin"));
    }
    @PluginMethod public void read(PluginCall call) { io.execute(() -> {
        try {
            AtomicFile file = file(call); JSObject result = new JSObject();
            if (!file.getBaseFile().exists()) { result.put("value", (String)null); call.resolve(result); return; }
            byte[] bytes = file.readFully(); if (bytes.length < 30 || bytes[0] != 1) throw new IllegalStateException("Invalid account record");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(bytes, 1, 13)));
            result.put("value", new String(cipher.doFinal(Arrays.copyOfRange(bytes, 13, bytes.length)), StandardCharsets.UTF_8)); call.resolve(result);
        } catch (Exception error) { call.reject("Account credentials could not be read"); }
    }); }
    @PluginMethod public void write(PluginCall call) { io.execute(() -> {
        FileOutputStream output = null; AtomicFile target = null;
        try {
            String value = call.getString("value", ""); if (value.length() > 32000) throw new IllegalArgumentException("Account record too large");
            target = file(call); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            output = target.startWrite(); output.write(1); output.write(cipher.getIV()); output.write(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8))); target.finishWrite(output); call.resolve();
        } catch (Exception error) { if (target != null && output != null) target.failWrite(output); call.reject("Account credentials could not be saved"); }
    }); }
    @PluginMethod public void remove(PluginCall call) { io.execute(() -> { try { file(call).delete(); call.resolve(); } catch (Exception error) { call.reject("Account credentials could not be removed"); } }); }
    @PluginMethod public void openAuthorization(PluginCall call) {
        Uri uri = Uri.parse(call.getString("url", "")); String host = uri.getHost();
        boolean allowed = "oauth.yandex.ru".equals(host) || "oauth.yandex.com".equals(host) || "ya.ru".equals(host) && ("/device".equals(uri.getPath()) || "/device/".equals(uri.getPath()));
        if (!"https".equals(uri.getScheme()) || !allowed || uri.getUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443) { call.reject("Invalid authorization page"); return; }
        getActivity().runOnUiThread(() -> { try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri)); call.resolve(); } catch (RuntimeException error) { call.reject("Could not open authorization page"); } });
    }
    @Override protected void handleOnDestroy() { io.shutdown(); }
}
