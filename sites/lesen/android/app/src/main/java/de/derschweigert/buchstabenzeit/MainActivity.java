package de.derschweigert.buchstabenzeit;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OfflineTtsPlugin.class);
    super.onCreate(savedInstanceState);
    // Draw edge-to-edge so the WebView receives real safe-area insets; the CSS
    // in static/index.html pads content with env(safe-area-inset-*).
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
  }
}
