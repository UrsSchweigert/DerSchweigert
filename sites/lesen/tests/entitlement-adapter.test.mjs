import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  trimSelectionToCap,
  getCapsForLimits,
  canAddToSelection,
  canAddLetterSync,
  tryAddLetter,
  createWebEntitlementAdapter,
  createNativeEntitlementAdapter,
  createEntitlementAdapter,
} from '../static/entitlement-adapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('trimSelectionToCap: trims array to cap size', () => {
  const arr = ['a', 'b', 'c', 'd', 'e', 'f'];
  const result = trimSelectionToCap(arr, 3);
  assert.deepStrictEqual(result, ['a', 'b', 'c']);
});

test('trimSelectionToCap: cap=0 means unlimited, returns as-is', () => {
  const arr = ['a', 'b', 'c'];
  const result = trimSelectionToCap(arr, 0);
  assert.deepStrictEqual(result, arr);
});

test('trimSelectionToCap: negative cap means unlimited, returns as-is', () => {
  const arr = ['a', 'b', 'c'];
  const result = trimSelectionToCap(arr, -1);
  assert.deepStrictEqual(result, arr);
});

test('trimSelectionToCap: empty array stays empty', () => {
  const result = trimSelectionToCap([], 5);
  assert.deepStrictEqual(result, []);
});

test('trimSelectionToCap: cap larger than array, returns as-is', () => {
  const arr = ['a', 'b'];
  const result = trimSelectionToCap(arr, 5);
  assert.deepStrictEqual(result, arr);
});

test('trimSelectionToCap: never throws on invalid input', () => {
  // Should not throw
  assert.doesNotThrow(() => {
    trimSelectionToCap(null, 5);
  });
  assert.doesNotThrow(() => {
    trimSelectionToCap(undefined, 5);
  });
});

test('getCapsForLimits: returns 0 (unlimited) when limits is null', () => {
  const result = getCapsForLimits(null, 'consonants');
  assert.equal(result, 0);
});

test('getCapsForLimits: returns cap value from limits object', () => {
  const limits = { consonants: 5, vowels: 5, specials: 1 };
  assert.equal(getCapsForLimits(limits, 'consonants'), 5);
  assert.equal(getCapsForLimits(limits, 'vowels'), 5);
  assert.equal(getCapsForLimits(limits, 'specials'), 1);
});

test('getCapsForLimits: returns 0 for missing category', () => {
  const limits = { consonants: 5 };
  const result = getCapsForLimits(limits, 'vowels');
  assert.equal(result, 0);
});

test('canAddToSelection: cap=0 (unlimited) always returns true', () => {
  const selection = new Set(['a', 'b', 'c']);
  assert.equal(canAddToSelection(selection, 0), true);
});

test('canAddToSelection: under cap returns true', () => {
  const selection = new Set(['a', 'b']);
  assert.equal(canAddToSelection(selection, 5), true);
});

test('canAddToSelection: at cap returns false', () => {
  const selection = new Set(['a', 'b', 'c', 'd', 'e']);
  assert.equal(canAddToSelection(selection, 5), false);
});

test('canAddToSelection: over cap returns false', () => {
  const selection = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(canAddToSelection(selection, 5), false);
});

test('createWebEntitlementAdapter: isUnlocked returns true', () => {
  const adapter = createWebEntitlementAdapter();
  assert.equal(adapter.isUnlocked(), true);
});

test('createWebEntitlementAdapter: getLimits returns null (no limits)', () => {
  const adapter = createWebEntitlementAdapter();
  assert.equal(adapter.getLimits(), null);
});

test('createWebEntitlementAdapter: canToggleLetter always returns true', async () => {
  const adapter = createWebEntitlementAdapter();
  const selection = new Set(['a', 'b', 'c', 'd', 'e']);
  const result = await adapter.canToggleLetter('vowels', selection, 'i');
  assert.equal(result, true);
});

test('createWebEntitlementAdapter: trimBulkLoad returns array as-is', async () => {
  const adapter = createWebEntitlementAdapter();
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const result = await adapter.trimBulkLoad('vowels', arr);
  assert.deepStrictEqual(result, arr);
});

test('createNativeEntitlementAdapter: isUnlocked uses plugin', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: true })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const result = await adapter.isUnlocked();
  assert.equal(result, true);
});

test('createNativeEntitlementAdapter: isUnlocked caches result on second call', async () => {
  let callCount = 0;
  const plugin = {
    isUnlocked: async () => {
      callCount++;
      return { unlocked: true };
    }
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  await adapter.isUnlocked();
  await adapter.isUnlocked();
  assert.equal(callCount, 1);
});

test('createNativeEntitlementAdapter: isUnlocked returns false on plugin error', async () => {
  const plugin = {
    isUnlocked: async () => {
      throw new Error('Plugin error');
    }
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const result = await adapter.isUnlocked();
  assert.equal(result, false);
});

test('createNativeEntitlementAdapter: getLimits returns null when unlocked', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: true })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const result = await adapter.getLimits();
  assert.equal(result, null);
});

test('createNativeEntitlementAdapter: getLimits returns free tier limits when not unlocked', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: false })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const result = await adapter.getLimits();
  assert.deepStrictEqual(result, { consonants: 5, vowels: 5, specials: 1 });
});

test('createNativeEntitlementAdapter: canToggleLetter allows toggle-off', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: false })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const selection = new Set(['a', 'b', 'c']);
  const result = await adapter.canToggleLetter('vowels', selection, 'a');
  assert.equal(result, true); // Can always toggle off
});

test('createNativeEntitlementAdapter: canToggleLetter allows add when under cap', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: false })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const selection = new Set(['a', 'b']);
  const result = await adapter.canToggleLetter('vowels', selection, 'e');
  assert.equal(result, true);
});

test('createNativeEntitlementAdapter: canToggleLetter denies add when at cap', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: false })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const selection = new Set(['a', 'e', 'i', 'o', 'u']);
  const result = await adapter.canToggleLetter('vowels', selection, 'y');
  assert.equal(result, false);
});

test('createNativeEntitlementAdapter: canToggleLetter returns free-tier behavior on isUnlocked error', async () => {
  const plugin = {
    isUnlocked: async () => {
      throw new Error('Plugin error');
    }
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const selection = new Set(['a']);
  const result = await adapter.canToggleLetter('vowels', selection, 'e');
  // On error in getLimits, defaults to FREE_TIER_LIMITS, so with 1 vowel and cap 5, can add
  assert.equal(result, true);
});

test('createNativeEntitlementAdapter: trimBulkLoad trims when not unlocked', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: false })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const arr = ['a', 'e', 'i', 'o', 'u', 'y'];
  const result = await adapter.trimBulkLoad('vowels', arr);
  assert.deepStrictEqual(result, ['a', 'e', 'i', 'o', 'u']);
});

test('createNativeEntitlementAdapter: trimBulkLoad returns full array when unlocked', async () => {
  const plugin = {
    isUnlocked: async () => ({ unlocked: true })
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const arr = ['a', 'e', 'i', 'o', 'u', 'y'];
  const result = await adapter.trimBulkLoad('vowels', arr);
  assert.deepStrictEqual(result, arr);
});

test('createNativeEntitlementAdapter: trimBulkLoad returns array trimmed on error (safe default)', async () => {
  const plugin = {
    isUnlocked: async () => {
      throw new Error('Plugin error');
    }
  };
  const adapter = createNativeEntitlementAdapter(plugin);
  const arr = ['a', 'e', 'i', 'o', 'u', 'y'];
  const result = await adapter.trimBulkLoad('vowels', arr);
  // On error, getLimits returns FREE_TIER_LIMITS as safe default, so array is trimmed
  assert.deepStrictEqual(result, ['a', 'e', 'i', 'o', 'u']);
});

test('createEntitlementAdapter: returns native adapter when plugin exists', () => {
  const mockWin = {
    Capacitor: {
      Plugins: {
        Entitlement: {}
      }
    }
  };
  const adapter = createEntitlementAdapter(mockWin);
  assert.equal(adapter.kind, 'native');
});

test('createEntitlementAdapter: returns web adapter when no plugin', () => {
  const mockWin = {};
  const adapter = createEntitlementAdapter(mockWin);
  assert.equal(adapter.kind, 'web');
});

test('createEntitlementAdapter: returns web adapter when Capacitor missing', () => {
  const mockWin = {
    Capacitor: {}
  };
  const adapter = createEntitlementAdapter(mockWin);
  assert.equal(adapter.kind, 'web');
});

test('PARITY TEST: Static analysis of index.html and sounds.mjs - no numeric caps outside entitlement-adapter.mjs', async () => {
  const indexHtmlPath = path.join(__dirname, '..', 'static', 'index.html');
  const soundsPath = path.join(__dirname, '..', 'static', 'sounds.mjs');
  const entitlementAdapterPath = path.join(__dirname, '..', 'static', 'entitlement-adapter.mjs');
  
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const sounds = fs.readFileSync(soundsPath, 'utf8');
  const entitlementAdapter = fs.readFileSync(entitlementAdapterPath, 'utf8');
  
  // Patterns that would indicate cap logic outside adapter
  // We're looking for numeric literals (especially 5, 1) near cap-like keywords
  const capPatterns = [
    /(?<![\w.])5\s*(?:consonant|vowel|special)/gi,
    /(?<![\w.])1\s*(?:special)/gi,
    /(?:consonant|vowel|special).*?[=<>]\s*5/gi,
    /(?:special).*?[=<>]\s*1/gi,
  ];
  
  const checkFile = (content, filename, shouldIgnore = false) => {
    for (const pattern of capPatterns) {
      const matches = content.match(pattern) || [];
      // Filter out false positives (numbers in unrelated contexts)
      const realMatches = matches.filter(m => {
        // Ignore matches in comments
        const lineStart = content.lastIndexOf('\n', content.indexOf(m));
        const lineEnd = content.indexOf('\n', content.indexOf(m));
        const line = content.substring(lineStart, lineEnd);
        if (line.includes('//') && line.indexOf('//') < line.indexOf(m)) {
          return false;
        }
        return true;
      });
      
      if (realMatches.length > 0 && !shouldIgnore) {
        assert.fail(`Found cap logic in ${filename}: ${realMatches.join(', ')}`);
      }
    }
  };
  
  checkFile(sounds, 'sounds.mjs', false);
  checkFile(indexHtml, 'index.html', false);
  
  // Verify that entitlement-adapter.mjs DOES contain the cap literals
  checkFile(entitlementAdapter, 'entitlement-adapter.mjs', true);
  
  // At minimum, entitlement-adapter.mjs should contain FREE_TIER_LIMITS
  assert.ok(entitlementAdapter.includes('FREE_TIER_LIMITS'), 
    'entitlement-adapter.mjs should define FREE_TIER_LIMITS');
  assert.ok(entitlementAdapter.includes('consonants: 5'), 
    'entitlement-adapter.mjs should define consonants: 5');
  assert.ok(entitlementAdapter.includes('vowels: 5'), 
    'entitlement-adapter.mjs should define vowels: 5');
  assert.ok(entitlementAdapter.includes('specials: 1'), 
    'entitlement-adapter.mjs should define specials: 1');
});

test('CONCURRENT TOGGLE RACE CONDITION: Two rapid clicks at cap-1 do not exceed cap using tryAddLetter', async () => {
  // This test verifies that tryAddLetter prevents race conditions when two concurrent
  // clicks happen at cap-1. We use an adapter whose getLimits resolves after a microtask
  // delay to simulate concurrent async behavior.
  
  let getLimitsCallCount = 0;
  const plugin = {
    isUnlocked: async () => ({ unlocked: false }) // Free tier with caps
  };
  
  const adapter = createNativeEntitlementAdapter(plugin);
  
  // Wrap getLimits to introduce a microtask delay
  const originalGetLimits = adapter.getLimits.bind(adapter);
  adapter.getLimits = async () => {
    getLimitsCallCount++;
    // Simulate concurrency with a microtask delay
    await new Promise(resolve => setTimeout(resolve, 0));
    return originalGetLimits();
  };
  
  // Start with empty selection, vowel cap is 5
  const selection = new Set();
  
  // Two concurrent tryAddLetter calls at cap-1 (0 items, cap 1)
  // Both will fetch limits concurrently, but only one should succeed in adding
  // We need a lower cap to test properly
  const plugin2 = {
    isUnlocked: async () => ({ unlocked: false })
  };
  const adapterWithCap1 = createNativeEntitlementAdapter(plugin2);
  
  // Override getLimits to return cap=1 for vowels
  const origGetLimits2 = adapterWithCap1.getLimits.bind(adapterWithCap1);
  adapterWithCap1.getLimits = async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    return { consonants: 5, vowels: 1, specials: 1 };
  };
  
  const selectionCap1 = new Set();
  
  // Two concurrent calls at cap=1, both should start with size=0 which is < cap=1
  const add1Promise = tryAddLetter(adapterWithCap1, 'vowels', selectionCap1, 'a');
  const add2Promise = tryAddLetter(adapterWithCap1, 'vowels', selectionCap1, 'e');
  
  const [added1, added2] = await Promise.all([add1Promise, add2Promise]);
  
  // Exactly one should succeed (the first one executed)
  const totalAdded = Number(added1) + Number(added2);
  assert.equal(totalAdded, 1, 'Exactly one letter should be added when concurrent adds race at cap=1');
  
  // Selection size should never exceed cap
  assert.ok(selectionCap1.size <= 1, 'Selection size should not exceed cap of 1');
  assert.ok(selectionCap1.size === 1, 'Selection should have exactly 1 item');
  
  // Verify one of the two was added
  assert.ok(selectionCap1.has('a') || selectionCap1.has('e'), 'One of the two letters should be in selection');
  assert.ok(!(selectionCap1.has('a') && selectionCap1.has('e')), 'Both letters should not be in selection');
});

test('canAddLetterSync: returns true when under cap', () => {
  const selection = new Set(['a', 'b']);
  const limits = { consonants: 5, vowels: 5, specials: 1 };
  const result = canAddLetterSync(selection, 'vowels', limits);
  assert.equal(result, true);
});

test('canAddLetterSync: returns false when at cap', () => {
  const selection = new Set(['a', 'e', 'i', 'o', 'u']);
  const limits = { consonants: 5, vowels: 5, specials: 1 };
  const result = canAddLetterSync(selection, 'vowels', limits);
  assert.equal(result, false); // 5 items, cap is 5, cannot add
});

test('canAddLetterSync: returns true when limits is null (unlocked)', () => {
  const selection = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
  const result = canAddLetterSync(selection, 'vowels', null);
  assert.equal(result, true); // Unlocked: can always add
});

test('tryAddLetter: after adapter.restore(), allows adds past free caps without language switch', async () => {
  // This test verifies that tryAddLetter respects the updated limits after restore()
  // invalidates the cache. We simulate a purchase/unlock flow.
  
  let unlockedState = false;
  const plugin = {
    isUnlocked: async () => ({ unlocked: unlockedState }),
    purchase: async () => {
      unlockedState = true;
    },
    restore: async () => {
      unlockedState = true;
    }
  };
  
  const adapter = createNativeEntitlementAdapter(plugin);
  
  // Initially free tier: vowel cap is 5
  const selection = new Set();
  
  // Add 5 vowels (at cap)
  for (let i = 0; i < 5; i++) {
    const vowel = ['a', 'e', 'i', 'o', 'u'][i];
    const added = await tryAddLetter(adapter, 'vowels', selection, vowel);
    assert.equal(added, true, `Should add vowel ${vowel} when under cap`);
  }
  
  // Try to add 6th vowel - should fail (at cap)
  const sixthAdded = await tryAddLetter(adapter, 'vowels', selection, 'y');
  assert.equal(sixthAdded, false, 'Should not add 6th vowel when at free tier cap');
  assert.equal(selection.size, 5, 'Selection should still be 5');
  
  // Now call restore() to simulate purchase/unlock
  await adapter.restore();
  
  // Try to add 6th vowel again - should now succeed (cache invalidated, limits are null)
  const sixthAddedAfterRestore = await tryAddLetter(adapter, 'vowels', selection, 'y');
  assert.equal(sixthAddedAfterRestore, true, 'Should add 6th vowel after restore/unlock');
  assert.equal(selection.size, 6, 'Selection should now be 6');
});
