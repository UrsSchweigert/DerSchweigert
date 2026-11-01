package de.derschweigert.buchstabenzeit;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import com.android.billingclient.api.Purchase;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;
import org.mockito.Mockito;

/**
 * Unit tests for EntitlementPlugin pure logic helpers.
 *
 * <p>Tests static methods isAnyPurchased() and needsAcknowledgement()
 * using Mockito mocks of Purchase objects. These tests verify the purchase
 * state logic in isolation without requiring BillingClient or device integration.
 *
 * <p>Real purchase-flow correctness (BillingClient integration, user interaction,
 * lazy initialization, stale-state handling) requires manual testing on a real
 * device/emulator with Play Services.
 */
public class EntitlementPluginTest {
  private static final String PRODUCT_ID = "unlock_all_letters";

  /**
   * Test isAnyPurchased: null list returns false.
   */
  @Test
  public void testIsAnyPurchasedWithNullList() {
    assertFalse(
      "null purchase list should return false",
      EntitlementPlugin.isAnyPurchased(null)
    );
  }

  /**
   * Test isAnyPurchased: empty list returns false.
   */
  @Test
  public void testIsAnyPurchasedWithEmptyList() {
    assertFalse(
      "empty purchase list should return false",
      EntitlementPlugin.isAnyPurchased(new ArrayList<>())
    );
  }

  /**
   * Test isAnyPurchased: purchase with PURCHASED state and correct product ID returns true.
   */
  @Test
  public void testIsAnyPurchasedWithValidPurchase() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PURCHASED);
    when(mockPurchase.getProducts()).thenReturn(Collections.singletonList(PRODUCT_ID));

    assertTrue(
      "purchase with PURCHASED state and correct product ID should return true",
      EntitlementPlugin.isAnyPurchased(Arrays.asList(mockPurchase))
    );
  }

  /**
   * Test isAnyPurchased: purchase with PENDING state returns false.
   */
  @Test
  public void testIsAnyPurchasedWithPendingPurchase() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PENDING);
    when(mockPurchase.getProducts()).thenReturn(Collections.singletonList(PRODUCT_ID));

    assertFalse(
      "purchase with PENDING state should return false",
      EntitlementPlugin.isAnyPurchased(Arrays.asList(mockPurchase))
    );
  }

  /**
   * Test isAnyPurchased: purchase with PURCHASED state but wrong product ID returns false.
   */
  @Test
  public void testIsAnyPurchasedWithWrongProductId() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PURCHASED);
    when(mockPurchase.getProducts()).thenReturn(Collections.singletonList("wrong_product"));

    assertFalse(
      "purchase with wrong product ID should return false",
      EntitlementPlugin.isAnyPurchased(Arrays.asList(mockPurchase))
    );
  }

  /**
   * Test isAnyPurchased: multiple purchases, one valid.
   */
  @Test
  public void testIsAnyPurchasedWithMultiplePurchases() {
    Purchase mockPurchase1 = Mockito.mock(Purchase.class);
    when(mockPurchase1.getPurchaseState()).thenReturn(Purchase.PurchaseState.PENDING);
    when(mockPurchase1.getProducts()).thenReturn(Collections.singletonList(PRODUCT_ID));

    Purchase mockPurchase2 = Mockito.mock(Purchase.class);
    when(mockPurchase2.getPurchaseState()).thenReturn(Purchase.PurchaseState.PURCHASED);
    when(mockPurchase2.getProducts()).thenReturn(Collections.singletonList(PRODUCT_ID));

    assertTrue(
      "should return true if any purchase is PURCHASED with correct product ID",
      EntitlementPlugin.isAnyPurchased(Arrays.asList(mockPurchase1, mockPurchase2))
    );
  }

  /**
   * Test needsAcknowledgement: PURCHASED unacknowledged purchase returns true.
   */
  @Test
  public void testNeedsAcknowledgementWithUnacknowledgedPurchase() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PURCHASED);
    when(mockPurchase.isAcknowledged()).thenReturn(false);

    assertTrue(
      "PURCHASED unacknowledged purchase should need acknowledgement",
      EntitlementPlugin.needsAcknowledgement(mockPurchase)
    );
  }

  /**
   * Test needsAcknowledgement: PURCHASED acknowledged purchase returns false.
   */
  @Test
  public void testNeedsAcknowledgementWithAcknowledgedPurchase() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PURCHASED);
    when(mockPurchase.isAcknowledged()).thenReturn(true);

    assertFalse(
      "PURCHASED acknowledged purchase should not need acknowledgement",
      EntitlementPlugin.needsAcknowledgement(mockPurchase)
    );
  }

  /**
   * Test needsAcknowledgement: PENDING purchase returns false (not yet purchased).
   */
  @Test
  public void testNeedsAcknowledgementWithPendingPurchase() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PENDING);
    when(mockPurchase.isAcknowledged()).thenReturn(false);

    assertFalse(
      "PENDING purchase should not need acknowledgement",
      EntitlementPlugin.needsAcknowledgement(mockPurchase)
    );
  }

  /**
   * Test consistency: isAnyPurchased returns true iff there exists a purchase P where
   * getPurchaseState()==PURCHASED and getProducts().contains(PRODUCT_ID).
   * This confirms the logic is pure and deterministic.
   */
  @Test
  public void testIsAnyPurchasedConsistency() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PURCHASED);
    when(mockPurchase.getProducts()).thenReturn(Collections.singletonList(PRODUCT_ID));

    boolean result1 = EntitlementPlugin.isAnyPurchased(Arrays.asList(mockPurchase));
    boolean result2 = EntitlementPlugin.isAnyPurchased(Arrays.asList(mockPurchase));

    assertEquals(
      "isAnyPurchased should return consistent results for same input",
      result1,
      result2
    );
    assertTrue("both calls should return true", result1 && result2);
  }

  /**
   * Test needsAcknowledgement consistency: pure function should always return
   * the same result for the same input state.
   */
  @Test
  public void testNeedsAcknowledgementConsistency() {
    Purchase mockPurchase = Mockito.mock(Purchase.class);
    when(mockPurchase.getPurchaseState()).thenReturn(Purchase.PurchaseState.PURCHASED);
    when(mockPurchase.isAcknowledged()).thenReturn(false);

    boolean result1 = EntitlementPlugin.needsAcknowledgement(mockPurchase);
    boolean result2 = EntitlementPlugin.needsAcknowledgement(mockPurchase);

    assertEquals(
      "needsAcknowledgement should return consistent results for same input",
      result1,
      result2
    );
    assertTrue("both calls should return true", result1 && result2);
  }
}


