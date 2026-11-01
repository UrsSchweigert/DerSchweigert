package de.derschweigert.buchstabenzeit;

import android.app.Activity;
import android.util.Log;
import androidx.annotation.Nullable;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * EntitlementPlugin: A Capacitor plugin wrapping Google Play Billing Library
 * for managing a single non-consumable product "unlock_all_letters".
 *
 * <p>This plugin handles querying purchase ownership (including offline cache),
 * launching the purchase flow, acknowledging purchases, and restoring purchases.
 */
@CapacitorPlugin(name = "Entitlement")
public class EntitlementPlugin
  extends com.getcapacitor.Plugin
  implements PurchasesUpdatedListener {
  private static final String TAG = "EntitlementPlugin";
  private static final String PRODUCT_ID = "unlock_all_letters";
  private static final String PRODUCT_TYPE = BillingClient.ProductType.INAPP;
  private static final long STALE_PURCHASE_WINDOW_MS = 120000; // 2 minutes

  @Nullable
  private BillingClient billingClient;

  private boolean clientReady = false;
  private boolean isConnecting = false;
  private final Queue<ReadyCallback> readyCallbacks = new ConcurrentLinkedQueue<>();

  private boolean purchaseInProgress = false;
  private long lastPurchaseStartTime = 0;

  @Nullable
  private PluginCall pendingPurchaseCall;

  /**
   * Callback interface for ready-state callbacks.
   * Each callback can either succeed (onReady) or fail (onFailure).
   */
  private interface ReadyCallback {
    void onReady();
    void onFailure(String message);
  }

  /**
   * Ensure BillingClient is created and connected, or reject with graceful error.
   * Multiple concurrent callers are queued. Calmly rejects on setup failure.
   */
  private void ensureReady(final ReadyCallback callback) {
    if (clientReady && billingClient != null) {
      // Already ready; execute immediately
      callback.onReady();
      return;
    }

    if (isConnecting) {
      // Connection in progress; queue this callback
      readyCallbacks.offer(callback);
      return;
    }

    // Need to initialize; mark as connecting
    isConnecting = true;
    readyCallbacks.offer(callback);

    Activity activity = getActivity();
    if (activity == null) {
      isConnecting = false;
      Log.e(TAG, "Activity not available for BillingClient creation");
      drainReadyCallbacksOnFailure("Activity not available for BillingClient creation");
      return;
    }

    // Create BillingClient with PurchasesUpdatedListener
    billingClient =
      BillingClient
        .newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(
          PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
        )
        .build();

    // Start connection
    billingClient.startConnection(
      new com.android.billingclient.api.BillingClientStateListener() {
        @Override
        public void onBillingSetupFinished(BillingResult billingResult) {
          if (
            billingResult.getResponseCode() ==
            BillingClient.BillingResponseCode.OK
          ) {
            clientReady = true;
            Log.d(TAG, "Billing client ready");
            processReadyCallbacks();
          } else {
            Log.e(
              TAG,
              "Billing setup failed: " + billingResult.getResponseCode()
            );
            isConnecting = false;
            drainReadyCallbacksOnFailure("Billing setup failed: " + billingResult.getResponseCode());
          }
        }

        @Override
        public void onBillingServiceDisconnected() {
          clientReady = false;
          if (billingClient != null) {
            billingClient.endConnection();
          }
          Log.d(TAG, "Billing service disconnected");
        }
      }
    );
  }

  /**
   * Drain the ready callbacks queue and invoke onFailure on each.
   */
  private void drainReadyCallbacksOnFailure(String message) {
    ReadyCallback callback;
    while ((callback = readyCallbacks.poll()) != null) {
      callback.onFailure(message);
    }
  }

  /**
   * Process all queued callbacks after billing is ready.
   */
  private void processReadyCallbacks() {
    isConnecting = false;
    ReadyCallback callback;
    while ((callback = readyCallbacks.poll()) != null) {
      callback.onReady();
    }
  }

  /**
   * Initialize the BillingClient asynchronously (optional public method).
   *
   * <p>Uses the shared ensureReady path. Resolves with: { status: "ready" | "unavailable", unlocked: boolean }
   * Rejects on network/connection errors.
   */
  @PluginMethod
  public void initialize(final PluginCall call) {
    ensureReady(
      new ReadyCallback() {
        @Override
        public void onReady() {
          if (!clientReady || billingClient == null) {
            JSObject result = new JSObject();
            result.put("status", "unavailable");
            result.put("unlocked", false);
            call.resolve(result);
            return;
          }
          queryAndResolveInitialization(call);
        }

        @Override
        public void onFailure(String message) {
          JSObject result = new JSObject();
          result.put("status", "unavailable");
          result.put("unlocked", false);
          call.resolve(result);
          Log.e(TAG, "Initialization failed: " + message);
        }
      }
    );
  }

  /**
   * Query the current purchase state and resolve the initialization call.
   */
  private void queryAndResolveInitialization(final PluginCall call) {
    if (billingClient == null || !clientReady) {
      call.reject("Billing client not ready");
      return;
    }

    queryPurchasesAsync(
      new QueryCallback() {
        @Override
        public void onSuccess(boolean unlocked) {
          JSObject result = new JSObject();
          result.put("status", "ready");
          result.put("unlocked", unlocked);
          call.resolve(result);
        }

        @Override
        public void onError(String error) {
          // Billing is available but query failed; still consider it initialized
          JSObject result = new JSObject();
          result.put("status", "ready");
          result.put("unlocked", false); // Assume locked if query fails
          call.resolve(result);
          Log.e(TAG, "Failed to query purchases during init: " + error);
        }
      }
    );
  }

  /**
   * Check if the product is unlocked based on purchase ownership.
   *
   * <p>Lazy initialization: ensures BillingClient is ready.
   * Resolves with: { unlocked: boolean }
   * This query uses the local Play cache for offline availability.
   * When billing is unavailable, rejects calmly and lets JS adapter use cache.
   */
  @PluginMethod
  public void isUnlocked(final PluginCall call) {
    ensureReady(
      new ReadyCallback() {
        @Override
        public void onReady() {
          if (!clientReady || billingClient == null) {
            // Billing unavailable; reject calmly so JS keeps its in-session cache
            call.reject("Billing unavailable");
            return;
          }

          queryPurchasesAsync(
            new QueryCallback() {
              @Override
              public void onSuccess(boolean unlocked) {
                JSObject result = new JSObject();
                result.put("unlocked", unlocked);
                call.resolve(result);
              }

              @Override
              public void onError(String error) {
                // On error, assume locked to be safe
                JSObject result = new JSObject();
                result.put("unlocked", false);
                call.resolve(result);
                Log.e(TAG, "Query failed in isUnlocked: " + error);
              }
            }
          );
        }

        @Override
        public void onFailure(String message) {
          call.reject("Billing unavailable: " + message);
        }
      }
    );
  }

  /**
   * Launch the purchase flow for "unlock_all_letters".
   *
   * <p>Lazy initialization: ensures BillingClient is ready.
   * Resolves when purchase is acknowledged and valid.
   * Rejects if billing is unavailable, user cancels, or acknowledgement fails.
   * Defensive stale-state reset: if a new purchase() arrives more than 2 minutes
   * after the last one started and purchaseInProgress is still true, reject the
   * stale call exactly once and reset state, then FALL THROUGH for the new call.
   */
  @PluginMethod
  public void purchase(final PluginCall call) {
    // Check for stale purchase state
    if (purchaseInProgress) {
      long elapsedSinceLastPurchase = System.currentTimeMillis() - lastPurchaseStartTime;
      if (elapsedSinceLastPurchase > STALE_PURCHASE_WINDOW_MS) {
        // Stale state detected; reject old call and reset
        if (pendingPurchaseCall != null) {
          pendingPurchaseCall.reject("Previous purchase hung; state reset. Retry.");
          pendingPurchaseCall = null;
        }
        purchaseInProgress = false;
        lastPurchaseStartTime = 0;
        // Fall through to proceed with the current call
      } else {
        // Within 2 minute window; still in progress
        call.reject("Purchase already in progress.");
        return;
      }
    }

    ensureReady(
      new ReadyCallback() {
        @Override
        public void onReady() {
          if (!clientReady || billingClient == null) {
            call.reject("Billing unavailable");
            return;
          }

          Activity activity = getActivity();
          if (activity == null) {
            call.reject("Activity not available");
            return;
          }

          purchaseInProgress = true;
          lastPurchaseStartTime = System.currentTimeMillis();
          pendingPurchaseCall = call;

          // Query product details first
          List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
          productList.add(
            QueryProductDetailsParams.Product
              .newBuilder()
              .setProductId(PRODUCT_ID)
              .setProductType(PRODUCT_TYPE)
              .build()
          );

          QueryProductDetailsParams params = QueryProductDetailsParams
            .newBuilder()
            .setProductList(productList)
            .build();

          billingClient.queryProductDetailsAsync(
            params,
            (billingResult, productDetailsList) -> {
              if (
                billingResult.getResponseCode() !=
                BillingClient.BillingResponseCode.OK ||
                productDetailsList == null ||
                productDetailsList.isEmpty()
              ) {
                purchaseInProgress = false;
                pendingPurchaseCall = null;
                lastPurchaseStartTime = 0;
                call.reject(
                  "Product not available: " + billingResult.getDebugMessage()
                );
                Log.e(TAG, "Failed to query product details");
                return;
              }

              ProductDetails productDetails = productDetailsList.get(0);
              launchBillingFlow(productDetails, call);
            }
          );
        }

        @Override
        public void onFailure(String message) {
          call.reject("Billing unavailable: " + message);
        }
      }
    );
  }

  /**
   * Launch the billing flow for the given product.
   */
  private void launchBillingFlow(
    ProductDetails productDetails,
    PluginCall call
  ) {
    if (billingClient == null || !clientReady) {
      purchaseInProgress = false;
      pendingPurchaseCall = null;
      lastPurchaseStartTime = 0;
      call.reject("Billing not ready");
      return;
    }

    Activity activity = getActivity();
    if (activity == null) {
      purchaseInProgress = false;
      pendingPurchaseCall = null;
      lastPurchaseStartTime = 0;
      call.reject("Activity not available");
      return;
    }

    // Get the offer token (for subscriptions) or use the first one for INAPP
    String offerToken = null;
    if (
      productDetails.getSubscriptionOfferDetails() != null &&
      !productDetails.getSubscriptionOfferDetails().isEmpty()
    ) {
      offerToken =
        productDetails.getSubscriptionOfferDetails().get(0).getOfferToken();
    }

    BillingFlowParams.ProductDetailsParams.Builder productDetailsParamsBuilder =
      BillingFlowParams.ProductDetailsParams
        .newBuilder()
        .setProductDetails(productDetails);

    if (offerToken != null) {
      productDetailsParamsBuilder.setOfferToken(offerToken);
    }

    BillingFlowParams billingFlowParams = BillingFlowParams
      .newBuilder()
      .addProductDetailsParams(productDetailsParamsBuilder.build())
      .build();

    BillingResult billingResult = billingClient.launchBillingFlow(
      activity,
      billingFlowParams
    );

    if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
      purchaseInProgress = false;
      pendingPurchaseCall = null;
      lastPurchaseStartTime = 0;
      call.reject(
        "Failed to launch billing flow: " + billingResult.getDebugMessage()
      );
      Log.e(TAG, "Billing flow launch failed");
    }
    // Success will be handled in onPurchasesUpdated callback
  }

  /**
   * Restore purchases by re-querying the purchase state.
   *
   * <p>Lazy initialization: ensures BillingClient is ready.
   * Resolves with: { restored: boolean, unlocked: boolean }
   * This queries Play's local cache for offline availability.
   */
  @PluginMethod
  public void restore(final PluginCall call) {
    ensureReady(
      new ReadyCallback() {
        @Override
        public void onReady() {
          if (!clientReady || billingClient == null) {
            call.reject("Billing unavailable");
            return;
          }

          queryPurchasesAsync(
            new QueryCallback() {
              @Override
              public void onSuccess(boolean unlocked) {
                JSObject result = new JSObject();
                result.put("restored", true);
                result.put("unlocked", unlocked);
                call.resolve(result);
              }

              @Override
              public void onError(String error) {
                // On error, still resolve with restored: true but report unlocked: false
                JSObject result = new JSObject();
                result.put("restored", true);
                result.put("unlocked", false);
                call.resolve(result);
                Log.e(TAG, "Query failed in restore: " + error);
              }
            }
          );
        }

        @Override
        public void onFailure(String message) {
          call.reject("Billing unavailable: " + message);
        }
      }
    );
  }

  /**
   * Query purchases asynchronously using queryPurchasesAsync (works with local cache).
   */
  private void queryPurchasesAsync(QueryCallback callback) {
    if (billingClient == null) {
      callback.onError("Billing client not initialized");
      return;
    }

    QueryPurchasesParams params = QueryPurchasesParams
      .newBuilder()
      .setProductType(PRODUCT_TYPE)
      .build();

    billingClient.queryPurchasesAsync(
      params,
      (billingResult, purchases) -> {
        if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
          callback.onError(
            "Query failed: " + billingResult.getDebugMessage()
          );
          return;
        }

        // Check if any purchase is valid and unacknowledged (acknowledge it)
        boolean unlocked = isAnyPurchased(purchases);
        if (purchases != null) {
          for (Purchase purchase : purchases) {
            if (needsAcknowledgement(purchase)) {
              acknowledgePurchase(purchase);
            }
          }
        }

        callback.onSuccess(unlocked);
      }
    );
  }

  /**
   * Pure static helper: determine if any purchase is for our product and in PURCHASED state.
   * Tests this method to verify purchase ownership logic.
   */
  static boolean isAnyPurchased(@Nullable List<Purchase> purchases) {
    if (purchases == null || purchases.isEmpty()) {
      return false;
    }
    for (Purchase purchase : purchases) {
      if (
        purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED &&
        purchase.getProducts().contains(PRODUCT_ID)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Pure static helper: determine if a purchase needs acknowledgement.
   * Tests this method to verify acknowledgement logic.
   */
  static boolean needsAcknowledgement(Purchase purchase) {
    return (
      purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED &&
      !purchase.isAcknowledged()
    );
  }

  /**
   * Acknowledge a purchase to prevent auto-refund.
   */
  private void acknowledgePurchase(Purchase purchase) {
    if (billingClient == null) {
      return;
    }

    AcknowledgePurchaseParams params = AcknowledgePurchaseParams
      .newBuilder()
      .setPurchaseToken(purchase.getPurchaseToken())
      .build();

    billingClient.acknowledgePurchase(
      params,
      billingResult -> {
        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
          Log.d(TAG, "Purchase acknowledged successfully");
        } else {
          Log.e(
            TAG,
            "Failed to acknowledge purchase: " + billingResult.getDebugMessage()
          );
        }
      }
    );
  }

  /**
   * Callback for when the purchase flow completes (user buys or cancels).
   * This is called by PurchasesUpdatedListener.
   */
  @Override
  public void onPurchasesUpdated(
    BillingResult billingResult,
    @Nullable List<Purchase> purchases
  ) {
    if (pendingPurchaseCall == null) {
      return; // No pending purchase call
    }

    PluginCall call = pendingPurchaseCall;
    purchaseInProgress = false;
    pendingPurchaseCall = null;
    lastPurchaseStartTime = 0;

    if (
      billingResult.getResponseCode() ==
      BillingClient.BillingResponseCode.USER_CANCELED
    ) {
      call.reject("Purchase canceled by user");
      return;
    }

    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.ITEM_UNAVAILABLE) {
      call.reject("Item unavailable");
      return;
    }

    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE) {
      call.reject("Billing service unavailable");
      return;
    }

    if (
      billingResult.getResponseCode() ==
      BillingClient.BillingResponseCode.BILLING_UNAVAILABLE
    ) {
      call.reject("Billing unavailable");
      return;
    }

    if (
      billingResult.getResponseCode() !=
      BillingClient.BillingResponseCode.OK ||
      purchases == null ||
      purchases.isEmpty()
    ) {
      call.reject(
        "Purchase failed: " + billingResult.getDebugMessage()
      );
      Log.e(TAG, "Purchase failed with code: " + billingResult.getResponseCode());
      return;
    }

    // Purchase succeeded; find our product and acknowledge it
    boolean foundOurProduct = false;
    for (Purchase purchase : purchases) {
      if (
        purchase.getProducts().contains(PRODUCT_ID) &&
        purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED
      ) {
        foundOurProduct = true;
        if (needsAcknowledgement(purchase)) {
          acknowledgePurchase(purchase);
        }
        break;
      }
    }

    if (foundOurProduct) {
      JSObject result = new JSObject();
      result.put("success", true);
      call.resolve(result);
      Log.d(TAG, "Purchase successful and acknowledged");
    } else {
      call.reject("Purchase not found for our product");
    }
  }

  /**
   * Clean up resources when the activity is destroyed.
   */
  @Override
  protected void handleOnDestroy() {
    if (pendingPurchaseCall != null) {
      pendingPurchaseCall.reject("Activity destroyed");
      pendingPurchaseCall = null;
    }
    if (billingClient != null && billingClient.isReady()) {
      billingClient.endConnection();
      billingClient = null;
      clientReady = false;
      purchaseInProgress = false;
      lastPurchaseStartTime = 0;
      Log.d(TAG, "Billing client disconnected");
    }
  }

  /**
   * Callback interface for query results.
   */
  private interface QueryCallback {
    void onSuccess(boolean unlocked);
    void onError(String error);
  }
}
