package com.wmondesir.atrium;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private final Handler gestureHandler = new Handler(Looper.getMainLooper());
    private final Handler kioskHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideSystemBars = this::hideSystemBarsNow;
    private int gesturePointerCount = 0;
    private final Runnable runAdminGesture = () -> {
        int pointers = gesturePointerCount;
        gesturePointerCount = 0;
        if (pointers >= 4) {
            showSystemUi();
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        } else {
            getBridge().getWebView().loadUrl("https://localhost/connect");
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtriumNativePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        scheduleImmersiveMode();

        // Observe, but never consume, touch events. Existing one-finger React
        // pointer gestures continue to flow directly to the WebView.
        getBridge().getWebView().setOnTouchListener((view, event) -> {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_UP
                    || action == MotionEvent.ACTION_POINTER_UP
                    || action == MotionEvent.ACTION_CANCEL
                    || event.getPointerCount() < 3) {
                cancelAdminGesture();
            } else if (gesturePointerCount != event.getPointerCount()) {
                cancelAdminGesture();
                gesturePointerCount = event.getPointerCount();
                gestureHandler.postDelayed(runAdminGesture, 2000);
            }
            return false;
        });
        routeFromIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        routeFromIntent(intent);
    }

    private void routeFromIntent(Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra("atrium_path");
        if (!"/connect".equals(path) && !"/".equals(path)) return;
        getBridge().getWebView().post(() ->
                getBridge().getWebView().loadUrl("https://localhost" + path));
    }

    @Override
    public void onResume() {
        super.onResume();
        scheduleImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) scheduleImmersiveMode();
    }

    @Override
    public void onPause() {
        cancelAdminGesture();
        super.onPause();
    }

    private void cancelAdminGesture() {
        gesturePointerCount = 0;
        gestureHandler.removeCallbacks(runAdminGesture);
    }

    private void scheduleImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
        kioskHandler.removeCallbacks(hideSystemBars);
        decor.post(hideSystemBars);
        kioskHandler.postDelayed(hideSystemBars, 250);
        kioskHandler.postDelayed(hideSystemBars, 1000);
    }

    private void hideSystemBarsNow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController platformController = getWindow().getInsetsController();
            if (platformController != null) {
                platformController.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                platformController.hide(WindowInsets.Type.systemBars());
            }
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void showSystemUi() {
        kioskHandler.removeCallbacks(hideSystemBars);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController platformController = getWindow().getInsetsController();
            if (platformController != null) {
                platformController.show(WindowInsets.Type.systemBars());
            }
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getWindow(), getWindow().getDecorView());
        controller.show(WindowInsetsCompat.Type.systemBars());
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
}
