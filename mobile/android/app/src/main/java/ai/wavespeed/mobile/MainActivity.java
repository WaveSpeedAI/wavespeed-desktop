package ai.wavespeed.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
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

    // File chooser support
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;

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

        // Initialize file chooser launcher
        fileChooserLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (filePathCallback == null) return;

                Uri[] results = null;
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    Intent data = result.getData();
                    String dataString = data.getDataString();

                    // Handle multiple file selection
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    }
                }

                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        );
    }

    @Override
    public void onStart() {
        super.onStart();

        // Get the WebView and set up permission handling for getUserMedia and file chooser
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

            // Handle file chooser for input type="file"
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                           FileChooserParams fileChooserParams) {
                // Cancel any existing callback
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                try {
                    Intent intent = fileChooserParams.createIntent();
                    // Allow multiple file selection if supported
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    fileChooserLauncher.launch(intent);
                    return true;
                } catch (Exception e) {
                    filePathCallback.onReceiveValue(null);
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
            }
        });
    }
}
