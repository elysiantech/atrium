package com.wmondesir.atrium;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.identity.RevokeAccessRequest;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

@CapacitorPlugin(name = "AtriumNative")
public class AtriumNativePlugin extends Plugin {
    private static final String TAG = "AtriumNative";
    private static final String PHOTO_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
    private static final int AUTH_REQUEST_CODE = 7301;
    private static final long MAX_CACHE_BYTES = 5L * 1024L * 1024L * 1024L;
    private static final String PREFS = "atrium.photos";
    private static final String KEY_CONNECTED = "connected";
    private static final String KEY_SESSION_ID = "session_id";
    private static final String KEY_SESSION_EXPIRES = "session_expires";
    private static final String KEY_LAST_SYNC = "last_sync";

    private final AtomicBoolean syncing = new AtomicBoolean(false);
    private Consumer<String> pendingAuthorizationSuccess;
    private Consumer<String> pendingAuthorizationFailure;

    private AuthorizationClient authorizationClient() {
        return Identity.getAuthorizationClient(getActivity());
    }

    private List<Scope> photoScopes() {
        return Collections.singletonList(new Scope(PHOTO_SCOPE));
    }

    private AuthorizationRequest authorizationRequest() {
        return AuthorizationRequest.builder()
                .setRequestedScopes(photoScopes())
                .build();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, 0);
    }

    private File photosDir() {
        File dir = new File(getContext().getFilesDir(), "photos");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File manifestFile() {
        return new File(photosDir(), "manifest.json");
    }

    @PluginMethod
    public void authorizePhotos(PluginCall call) {
        requestAccessToken(true, token -> {
            prefs().edit().putBoolean(KEY_CONNECTED, true).apply();
            JSObject result = new JSObject();
            result.put("connected", true);
            call.resolve(result);
        }, call::reject);
    }

    @PluginMethod
    public void getPhotoStatus(PluginCall call) {
        if (call.getBoolean("sync", false)) syncSilently();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void syncPhotos(PluginCall call) {
        if (!prefs().getBoolean(KEY_CONNECTED, false)) {
            call.reject("Connect Google Photos before downloading selections.");
            return;
        }
        if (syncing.getAndSet(true)) {
            call.reject("A photo download is already in progress.");
            return;
        }
        requestAccessToken(false, token -> execute(() -> {
            try {
                boolean complete = syncCurrentSession(token);
                if (!complete) {
                    call.reject("Google Photos did not finish the selection. Reopen the picker, select photos, and tap Done.");
                    return;
                }
                call.resolve(statusObject());
            } catch (Exception e) {
                Log.e(TAG, "Photo download failed", e);
                call.reject("Photo download failed: " + e.getMessage());
            } finally {
                syncing.set(false);
            }
        }), message -> {
            syncing.set(false);
            call.reject(message);
        });
    }

    @PluginMethod
    public void listPhotos(PluginCall call) {
        JSArray items = new JSArray();
        JSONArray manifest = readManifest();
        for (int i = 0; i < manifest.length(); i++) {
            JSONObject item = manifest.optJSONObject(i);
            if (item == null) continue;
            File file = new File(photosDir(), item.optString("path"));
            if (!file.isFile()) continue;
            JSObject out = new JSObject();
            out.put("id", item.optString("id"));
            out.put("filename", item.isNull("filename") ? null : item.optString("filename"));
            out.put("uri", Uri.fromFile(file).toString());
            items.put(out);
        }
        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    @PluginMethod
    public void startPhotoPicker(PluginCall call) {
        requestAccessToken(false, token -> execute(() -> {
            try {
                JSONObject session = requestJson(
                        "POST",
                        "https://photospicker.googleapis.com/v1/sessions?requestId=" + UUID.randomUUID(),
                        token,
                        "{}"
                );
                String sessionId = session.getString("id");
                String pickerUri = session.getString("pickerUri");
                String expiresAt = session.optString("expireTime", null);
                prefs().edit()
                        .putString(KEY_SESSION_ID, sessionId)
                        .putString(KEY_SESSION_EXPIRES, expiresAt)
                        .apply();

                getActivity().runOnUiThread(() -> {
                    try {
                        String launchUri = pickerUri.endsWith("/")
                                ? pickerUri + "autoclose"
                                : pickerUri + "/autoclose";
                        getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(launchUri)));
                        JSObject result = new JSObject();
                        result.put("pickerUri", pickerUri);
                        result.put("sessionId", sessionId);
                        result.put("expiresAt", expiresAt);
                        call.resolve(result);
                    } catch (Exception e) {
                        call.reject("Unable to open Google Photos Picker: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                call.reject("Unable to create Google Photos Picker session: " + e.getMessage());
            }
        }), call::reject);
    }

    @PluginMethod
    public void disconnectPhotos(PluginCall call) {
        revokePhotos(call, false);
    }

    @PluginMethod
    public void signOutPhotos(PluginCall call) {
        revokePhotos(call, true);
    }

    @PluginMethod
    public void openAccountSettings(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Settings.ACTION_SYNC_SETTINGS));
            call.resolve();
        } catch (Exception e) {
            call.reject("Unable to open Android account settings: " + e.getMessage());
        }
    }

    private void revokePhotos(PluginCall call, boolean keepPhotos) {
        RevokeAccessRequest request = RevokeAccessRequest.builder()
                .setScopes(photoScopes())
                .build();
        authorizationClient().revokeAccess(request).addOnCompleteListener(task -> {
            prefs().edit().clear().apply();
            if (!keepPhotos) clearLocalPhotos();
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("revoked", task.isSuccessful());
            call.resolve(result);
        });
    }

    private void requestAccessToken(boolean interactive, Consumer<String> success, Consumer<String> failure) {
        authorizationClient().authorize(authorizationRequest())
                .addOnSuccessListener(result -> {
                    if (!result.hasResolution()) {
                        String token = result.getAccessToken();
                        if (token == null || token.isEmpty()) failure.accept("Google authorization returned no access token");
                        else success.accept(token);
                        return;
                    }
                    if (!interactive) {
                        failure.accept("Google Photos authorization is required. Tap Connect Google Photos first.");
                        return;
                    }
                    if (pendingAuthorizationSuccess != null) {
                        failure.accept("A Google authorization request is already open");
                        return;
                    }
                    PendingIntent pendingIntent = result.getPendingIntent();
                    if (pendingIntent == null) {
                        failure.accept("Google authorization could not be opened");
                        return;
                    }
                    pendingAuthorizationSuccess = success;
                    pendingAuthorizationFailure = failure;
                    try {
                        getActivity().startIntentSenderForResult(
                                pendingIntent.getIntentSender(), AUTH_REQUEST_CODE, null, 0, 0, 0
                        );
                    } catch (Exception e) {
                        pendingAuthorizationSuccess = null;
                        pendingAuthorizationFailure = null;
                        failure.accept("Unable to open Google authorization: " + e.getMessage());
                    }
                })
                .addOnFailureListener(e -> failure.accept("Google authorization failed: " + e.getMessage()));
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != AUTH_REQUEST_CODE || pendingAuthorizationSuccess == null) return;
        Consumer<String> success = pendingAuthorizationSuccess;
        Consumer<String> failure = pendingAuthorizationFailure;
        pendingAuthorizationSuccess = null;
        pendingAuthorizationFailure = null;
        if (resultCode != Activity.RESULT_OK || data == null) {
            failure.accept("Google authorization was cancelled");
            return;
        }
        try {
            AuthorizationResult result = authorizationClient().getAuthorizationResultFromIntent(data);
            String token = result.getAccessToken();
            if (token == null || token.isEmpty()) failure.accept("Google authorization returned no access token");
            else success.accept(token);
        } catch (ApiException e) {
            failure.accept("Google authorization failed: " + e.getStatusCode());
        }
    }

    private void syncSilently() {
        if (!prefs().getBoolean(KEY_CONNECTED, false) || !syncing.compareAndSet(false, true)) return;
        authorizationClient().authorize(authorizationRequest())
                .addOnSuccessListener(result -> {
                    if (result.hasResolution() || result.getAccessToken() == null) {
                        syncing.set(false);
                        return;
                    }
                    execute(() -> {
                        try {
                            syncCurrentSession(result.getAccessToken());
                        } catch (Exception e) {
                            Log.w(TAG, "Background photo sync failed; keeping existing cache", e);
                            // Keep the last successful cache available offline.
                        } finally {
                            syncing.set(false);
                        }
                    });
                })
                .addOnFailureListener(e -> syncing.set(false));
    }

    private boolean syncCurrentSession(String token) throws Exception {
        String sessionId = prefs().getString(KEY_SESSION_ID, null);
        if (sessionId == null || sessionId.isEmpty()) return true;

        JSONObject session = requestJson(
                "GET",
                "https://photospicker.googleapis.com/v1/sessions/" + Uri.encode(sessionId),
                token,
                null
        );
        if (!session.optBoolean("mediaItemsSet", false)) return false;

        List<JSONObject> selected = listSelectedMedia(sessionId, token);
        JSONArray oldManifest = readManifest();
        Map<String, JSONObject> oldById = new HashMap<>();
        for (int i = 0; i < oldManifest.length(); i++) {
            JSONObject item = oldManifest.optJSONObject(i);
            if (item != null) oldById.put(item.optString("id"), item);
        }

        JSONArray nextManifest = new JSONArray();
        Set<String> retainedPaths = new HashSet<>();
        long cacheBytes = 0;
        int eligibleImages = 0;
        int failedDownloads = 0;
        for (JSONObject media : selected) {
            JSONObject mediaFile = media.optJSONObject("mediaFile");
            if (mediaFile == null) continue;
            String mime = mediaFile.optString("mimeType", "");
            if (!mime.startsWith("image/")) continue;
            eligibleImages++;
            String id = media.optString("id");
            String filename = mediaFile.optString("filename", null);
            if (id.isEmpty()) continue;

            JSONObject previous = oldById.get(id);
            File file = previous == null ? null : new File(photosDir(), previous.optString("path"));
            if (file == null || !file.isFile()) {
                String path = cacheName(id, mime);
                file = new File(photosDir(), path);
                String baseUrl = mediaFile.optString("baseUrl");
                if (baseUrl.isEmpty()) {
                    failedDownloads++;
                    continue;
                }
                long remaining = MAX_CACHE_BYTES - cacheBytes;
                if (!downloadFile(baseUrl + "=w2560-h1440", token, file, remaining)) {
                    failedDownloads++;
                    continue;
                }
            }
            if (cacheBytes + file.length() > MAX_CACHE_BYTES) {
                failedDownloads++;
                continue;
            }
            cacheBytes += file.length();
            retainedPaths.add(file.getName());

            JSONObject saved = new JSONObject();
            saved.put("id", id);
            saved.put("filename", filename == null ? JSONObject.NULL : filename);
            saved.put("mime", mime);
            saved.put("path", file.getName());
            nextManifest.put(saved);
        }

        if (eligibleImages == 0) {
            throw new IOException("The completed selection did not contain any photos.");
        }
        if (failedDownloads > 0 || nextManifest.length() != eligibleImages) {
            throw new IOException(
                    "Downloaded " + nextManifest.length() + " of " + eligibleImages
                            + " photos. The selection was kept so you can retry."
            );
        }

        writeManifest(nextManifest);
        deleteUnretainedFiles(retainedPaths);
        prefs().edit()
                .putString(KEY_LAST_SYNC, Instant.now().toString())
                .remove(KEY_SESSION_ID)
                .remove(KEY_SESSION_EXPIRES)
                .apply();
        try {
            requestJson(
                    "DELETE",
                    "https://photospicker.googleapis.com/v1/sessions/" + Uri.encode(sessionId),
                    token,
                    null
            );
        } catch (Exception ignored) {
            // The local cache is already complete; remote cleanup is best effort.
        }
        notifyListeners("photosChanged", statusObject());
        return true;
    }

    private List<JSONObject> listSelectedMedia(String sessionId, String token) throws Exception {
        List<JSONObject> items = new ArrayList<>();
        String pageToken = null;
        do {
            String url = "https://photospicker.googleapis.com/v1/mediaItems?sessionId="
                    + Uri.encode(sessionId) + "&pageSize=100";
            if (pageToken != null) url += "&pageToken=" + Uri.encode(pageToken);
            JSONObject response = requestJson("GET", url, token, null);
            JSONArray page = response.optJSONArray("mediaItems");
            if (page != null) {
                for (int i = 0; i < page.length(); i++) {
                    JSONObject item = page.optJSONObject(i);
                    if (item != null) items.add(item);
                }
            }
            pageToken = response.optString("nextPageToken", null);
            if (pageToken != null && pageToken.isEmpty()) pageToken = null;
        } while (pageToken != null);
        return items;
    }

    private JSONObject requestJson(String method, String url, String token, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (BufferedOutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = connection.getResponseCode();
        InputStream raw = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String text = raw == null ? "" : readText(raw);
        connection.disconnect();
        if (status < 200 || status >= 300) throw new IOException("HTTP " + status + ": " + text);
        return text.isEmpty() ? new JSONObject() : new JSONObject(text);
    }

    private String readText(InputStream input) throws IOException {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString(StandardCharsets.UTF_8);
        }
    }

    private boolean downloadFile(String url, String token, File target, long maxBytes) throws IOException {
        if (maxBytes <= 0) return false;
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            return false;
        }
        long written = 0;
        try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(temp))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                written += read;
                if (written > maxBytes) {
                    temp.delete();
                    return false;
                }
                output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
        if (target.exists()) target.delete();
        if (!temp.renameTo(target)) {
            temp.delete();
            return false;
        }
        return true;
    }

    private String cacheName(String id, String mime) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = digest.digest(id.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : bytes) hex.append(String.format("%02x", b));
        String extension = mime.contains("png") ? ".png" : mime.contains("webp") ? ".webp" : ".jpg";
        return hex.substring(0, 40) + extension;
    }

    private JSONArray readManifest() {
        File file = manifestFile();
        if (!file.isFile()) return new JSONArray();
        try (FileInputStream input = new FileInputStream(file)) {
            return new JSONArray(readText(input));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void writeManifest(JSONArray manifest) throws IOException {
        File target = manifestFile();
        File temp = new File(target.getParentFile(), "manifest.json.tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(manifest.toString(2).getBytes(StandardCharsets.UTF_8));
        } catch (JSONException e) {
            throw new IOException(e);
        }
        if (target.exists()) target.delete();
        if (!temp.renameTo(target)) throw new IOException("Unable to store photo manifest");
    }

    private void deleteUnretainedFiles(Set<String> retained) {
        File[] files = photosDir().listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.getName().equals("manifest.json")) continue;
            if (!retained.contains(file.getName())) file.delete();
        }
    }

    private JSObject statusObject() {
        SharedPreferences preferences = prefs();
        JSONArray manifest = readManifest();
        int cachedCount = 0;
        long cacheBytes = 0;
        for (int i = 0; i < manifest.length(); i++) {
            JSONObject item = manifest.optJSONObject(i);
            if (item == null) continue;
            File file = new File(photosDir(), item.optString("path"));
            if (!file.isFile()) continue;
            cachedCount++;
            cacheBytes += file.length();
        }
        JSObject status = new JSObject();
        status.put("connected", preferences.getBoolean(KEY_CONNECTED, false));
        status.put("hasSession", preferences.contains(KEY_SESSION_ID));
        status.put("sessionExpiresAt", preferences.getString(KEY_SESSION_EXPIRES, null));
        status.put("lastSyncAt", preferences.getString(KEY_LAST_SYNC, null));
        status.put("pickedCount", manifest.length());
        status.put("cachedCount", cachedCount);
        status.put("cacheBytes", cacheBytes);
        return status;
    }

    private void clearLocalPhotos() {
        prefs().edit().clear().apply();
        File[] files = photosDir().listFiles();
        if (files == null) return;
        for (File file : files) file.delete();
    }
}
