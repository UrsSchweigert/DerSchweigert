package de.derschweigert.buchstabenzeit;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OfflineTtsPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
