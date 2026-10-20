package io.github.lilythium.lilchess;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        allowInsecureWebSocketsInDebugBuilds();
    }

    /**
     * The app's page is served from https://localhost, and Android's WebView blocks a ws:// connection from a
     * secure page as mixed content. Debug builds are allowed to reach plain-HTTP development servers (see
     * src/debug/res/xml/network_security_config.xml), so they also need to open ws://.
     *
     * Release builds never relax this: the WebView only ever loads the bundled app, but a release build is
     * HTTPS-only end to end. Capacitor's `android.allowMixedContent` option is global to every build, which is why
     * it stays false in capacitor.config.ts and this runtime check is used instead.
     */
    private void allowInsecureWebSocketsInDebugBuilds() {
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        Bridge bridge = getBridge();
        if (debuggable && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
}
