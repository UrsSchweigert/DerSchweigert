package de.derschweigert.buchstabenzeit;

import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.Log;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * OfflineTtsPlugin: A Capacitor plugin wrapping Android's TextToSpeech API
 * with enforcement of offline-only voice policy.
 *
 * <p>This plugin filters voices to exclude those requiring network connectivity,
 * ensuring that speech synthesis operates without depending on cloud services.
 * Engine metadata inspection does not guarantee actual offline playback behavior;
 * offline capability must be verified empirically on target devices.
 */
@CapacitorPlugin(name = "OfflineTts")
public class OfflineTtsPlugin extends com.getcapacitor.Plugin {
  private static final String TAG = "OfflineTtsPlugin";

  /** Prefer standard German (de-DE) over other German variants such as de-AT/de-CH. */
  private static final Comparator<Voice> DE_DE_FIRST = Comparator.comparingInt(voice ->
    isStandardGermanLocale(voice.getLocale()) ? 0 : 1
  );

  @Nullable
  private TextToSpeech tts;

  private boolean ttsReady = false;

  /**
   * Initialize the TextToSpeech engine asynchronously.
   *
   * <p>Resolves with: { status: "ready" | "error", languageAvailable: boolean }
   */
  @PluginMethod
  public void initialize(final PluginCall call) {
    if (tts != null && ttsReady) {
      // Already initialized and ready; return current state
      JSObject result = new JSObject();
      result.put("status", "ready");
      result.put("languageAvailable", isLanguageAvailable());
      call.resolve(result);
      return;
    }
    if (tts != null && !ttsReady) {
      // A previous initialization is still pending or failed; do not report ready.
      call.reject("TTS initialization already in progress or previously failed.");
      return;
    }

    tts = new TextToSpeech(
      getContext(),
      status -> {
        if (status == TextToSpeech.SUCCESS) {
          ttsReady = true;
          JSObject result = new JSObject();
          result.put("status", "ready");
          result.put("languageAvailable", isLanguageAvailable());
          call.resolve(result);
          Log.d(TAG, "TTS initialized successfully");
        } else {
          JSObject result = new JSObject();
          result.put("status", "error");
          call.resolve(result);
          Log.e(TAG, "TTS initialization failed with status: " + status);
          // Reset so a later initialize() can retry from a clean state.
          if (tts != null) {
            tts.shutdown();
            tts = null;
          }
          ttsReady = false;
        }
      }
    );
  }

  /**
   * List voices available for offline use in a given language.
   *
   * <p>A voice is offline-suitable iff:
   * - Its locale language matches the requested language
   * - It does NOT require network connection
   * - It does NOT have the NOT_INSTALLED feature
   *
   * <p>Params: { lang: "de-DE" (default) }
   *
   * <p>Resolves with: { voices: [ { name, locale, networkRequired, notInstalled } ... ], suitableCount: number }
   */
  @PluginMethod
  public void listOfflineVoices(final PluginCall call) {
    if (tts == null || !ttsReady) {
      call.reject("TTS not initialized. Call initialize() first.");
      return;
    }

    String lang = call.getString("lang", "de-DE");
    String targetLanguage = extractLanguage(lang);

    JSObject result = new JSObject();
    com.getcapacitor.JSArray voicesArray = new com.getcapacitor.JSArray();
    int suitableCount = 0;

    Set<Voice> voices = tts.getVoices();
    if (voices != null) {
      List<Voice> orderedVoices = new ArrayList<>(voices);
      // List.sort is stable, so equal-ranked voices keep the engine's order.
      orderedVoices.sort(DE_DE_FIRST);

      for (Voice voice : orderedVoices) {
        String voiceLanguage = extractLanguage(voice.getLocale().toString());

        JSObject voiceObj = new JSObject();
        voiceObj.put("name", voice.getName());
        voiceObj.put("locale", voice.getLocale().toString());

        boolean networkRequired = voice.isNetworkConnectionRequired();
        boolean notInstalled = voice.getFeatures() != null &&
          voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);

        voiceObj.put("networkRequired", networkRequired);
        voiceObj.put("notInstalled", notInstalled);

        voicesArray.put(voiceObj);

        // Count voices that are offline-suitable for this language
        if (
          voiceLanguage.equals(targetLanguage) &&
          !networkRequired &&
          !notInstalled
        ) {
          suitableCount++;
        }
      }
    }

    result.put("voices", voicesArray);
    result.put("suitableCount", suitableCount);
    call.resolve(result);
  }

  /**
   * Speak text using an offline-suitable voice in the given language.
   *
   * <p>Params: { text, lang: "de-DE" (default), rate: 0.8 (default), pitch: 1.0 (default) }
   *
   * <p>Rejects with a clear message if no offline-suitable voice exists for the language.
   * Does NOT fall back to network voices.
   */
  @PluginMethod
  public void speak(final PluginCall call) {
    if (tts == null || !ttsReady) {
      call.reject("TTS not initialized. Call initialize() first.");
      return;
    }

    String text = call.getString("text");
    if (text == null || text.isEmpty()) {
      call.reject("text parameter is required and cannot be empty.");
      return;
    }

    String lang = call.getString("lang", "de-DE");
    float rate = call.getDouble("rate", 0.8).floatValue();
    float pitch = call.getDouble("pitch", 1.0).floatValue();

    String targetLanguage = extractLanguage(lang);

    // Find an offline-suitable voice for the language
    Voice offlineVoice = findOfflineVoiceForLanguage(targetLanguage);
    if (offlineVoice == null) {
      call.reject(
        "No offline-suitable voice available for language: " + lang
      );
      return;
    }

    try {
      tts.setLanguage(new Locale(lang.split("-")[0]));
      tts.setVoice(offlineVoice);
      tts.setSpeechRate(rate);
      tts.setPitch(pitch);
      tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "utteranceId");
      call.resolve();
      Log.d(
        TAG,
        "Speaking text: " + text + " with voice: " + offlineVoice.getName()
      );
    } catch (Exception e) {
      call.reject("Error speaking: " + e.getMessage());
      Log.e(TAG, "Error speaking", e);
    }
  }

  /**
   * Stop current speech synthesis.
   */
  @PluginMethod
  public void stop(final PluginCall call) {
    if (tts != null) {
      tts.stop();
      call.resolve();
      Log.d(TAG, "TTS stopped");
    } else {
      call.reject("TTS not initialized.");
    }
  }

  /**
   * Clean up resources when the activity is destroyed.
   */
  @Override
  protected void handleOnDestroy() {
    if (tts != null) {
      tts.stop();
      tts.shutdown();
      tts = null;
      ttsReady = false;
      Log.d(TAG, "TTS resources released");
    }
  }

  /**
   * Extract the language code (part before '-' or '_') from a locale string.
   *
   * @param locale The locale string (e.g., "de-DE", "de_DE", "de")
   * @return The language code (e.g., "de")
   */
  private String extractLanguage(String locale) {
    if (locale == null || locale.isEmpty()) {
      return "";
    }
    return locale.split("[-_]")[0].toLowerCase(Locale.ROOT);
  }

  /**
   * Check if German language is available in TTS.
   */
  private boolean isLanguageAvailable() {
    if (tts == null) {
      return false;
    }
    int availability = tts.isLanguageAvailable(Locale.GERMANY);
    return availability >= TextToSpeech.LANG_AVAILABLE;
  }

  /**
   * Check whether a locale is standard German (de-DE).
   *
   * @param locale The voice locale.
   * @return true when the locale normalizes to de-DE
   */
  private static boolean isStandardGermanLocale(Locale locale) {
    if (locale == null) {
      return false;
    }
    return locale.toString().replace('_', '-').equalsIgnoreCase("de-DE");
  }

  /**
   * Find an offline-suitable voice for the given language.
   *
   * <p>Network voices are never returned. Among offline-suitable candidates,
   * an exact de-DE voice is preferred over other German variants.
   *
   * @param targetLanguage The language code (e.g., "de")
   * @return A Voice object, or null if no offline voice is available
   */
  @Nullable
  private Voice findOfflineVoiceForLanguage(String targetLanguage) {
    if (tts == null) {
      return null;
    }

    Set<Voice> voices = tts.getVoices();
    if (voices == null) {
      return null;
    }

    Voice firstMatch = null;

    for (Voice voice : voices) {
      String voiceLanguage = extractLanguage(voice.getLocale().toString());
      boolean isNetworkFree = !voice.isNetworkConnectionRequired();
      boolean isInstalled =
        voice.getFeatures() == null ||
        !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);

      if (
        voiceLanguage.equals(targetLanguage) &&
        isNetworkFree &&
        isInstalled
      ) {
        if (isStandardGermanLocale(voice.getLocale())) {
          return voice;
        }
        if (firstMatch == null) {
          firstMatch = voice;
        }
      }
    }

    return firstMatch;
  }
}
