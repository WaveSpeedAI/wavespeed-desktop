package ai.wavespeed.mobile;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private PermissionRequest pendingPermissionRequest;
    private ActivityResultLauncher<String[]> permissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Initialize permission launcher for runtime permissions
        permissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                if (pendingPermissionRequest != null) {
                    // Check if all required permissions were granted
                    boolean allGranted = true;
                    for (Boolean granted : result.values()) {
                        if (!granted) {
                            allGranted = false;
                            break;
                        }
                    }

                    if (allGranted) {
                        // Grant the WebView permission request
                        pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
                    } else {
                        // Deny the WebView permission request
                        pendingPermissionRequest.deny();
                    }
                    pendingPermissionRequest = null;
                }
            }
        );
    }

    @Override
    public void onStart() {
        super.onStart();

        // Get the WebView and set up permission handling for getUserMedia
        WebView webView = getBridge().getWebView();
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] resources = request.getResources();
                    List<String> androidPermissions = new ArrayList<>();

                    // Map WebView permission resources to Android permissions
                    for (String resource : resources) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            androidPermissions.add(Manifest.permission.RECORD_AUDIO);
                        }
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            androidPermissions.add(Manifest.permission.CAMERA);
                        }
                    }

                    if (androidPermissions.isEmpty()) {
                        // No recognized permissions, grant anyway for other resources
                        request.grant(resources);
                        return;
                    }

                    // Check if all permissions are already granted
                    boolean allGranted = true;
                    for (String permission : androidPermissions) {
                        if (ContextCompat.checkSelfPermission(MainActivity.this, permission)
                                != PackageManager.PERMISSION_GRANTED) {
                            allGranted = false;
                            break;
                        }
                    }

                    if (allGranted) {
                        // All permissions already granted, approve the request
                        request.grant(resources);
                    } else {
                        // Need to request permissions from user
                        pendingPermissionRequest = request;
                        permissionLauncher.launch(androidPermissions.toArray(new String[0]));
                    }
                });
            }
        });
    }
}
