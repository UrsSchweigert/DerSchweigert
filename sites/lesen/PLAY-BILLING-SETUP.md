# Play Console checklist: free download with one-time unlock

Owner/human checklist for the decision in [ANDROID-PLAN.md](ANDROID-PLAN.md) §6.
No CI or automation covers these steps. Dated 2026-11-01: verify each step
against the current Play Console UI and policies at submission time.

## 1. Before the first public release

- [ ] Set the app's price to **Free**. Free cannot later be changed back to paid.
- [ ] Confirm the merchant/payments profile is complete.
- [ ] Create the in-app product: type **one-time / managed (non-consumable)**,
      product ID exactly `unlock_all_letters`, German and English title and
      description, price, status **Active**.
- [ ] Upload a signed bundle to a testing track. The product can only be tested
      once a build with the billing library is on a Play track.

## 2. Declarations

- [ ] Data safety: the app collects no data itself. Purchases are processed by
      Google Play. Answer the form accordingly and re-check after any change.
- [ ] Permissions: the app declares **no INTERNET permission**. Play Billing
      talks to the Play Store app on the device. The `com.android.vending.BILLING`
      permission is added by the billing library at build time. Check the merged
      manifest of the release bundle; if INTERNET appears, investigate before
      release.
- [ ] Target audience / Families: complete the questionnaire. The purchase prompt
      sits behind a parental gate and is shown only when a free-tier limit is
      reached. Confirm the wording is calm and non-pushy against current policy.
- [ ] Store listing: state that the app is free with a one-time unlock for all
      letters, that exercises work offline, and that read-aloud depends on the
      device (see §6 of the plan). Do not promise speech on every device.

## 3. Testing (real device, closed track)

- [ ] Add licence testers (Settings, License testing).
- [ ] Free tier: at most 5 consonants, 5 vowels and 1 special per round, in both
      languages; the paywall appears only when a limit is hit.
- [ ] Parental gate blocks both Unlock and Restore until answered.
- [ ] Purchase with a test account: limits disappear immediately, no restart.
- [ ] Reinstall, then Restore: limits stay removed.
- [ ] Airplane mode after purchase: still unlocked.
- [ ] Cancel the purchase and run a pending-payment test: app stays locked, no crash.
- [ ] Refund a test purchase: limits return on the next launch.
- [ ] TalkBack: the paywall and gate are announced and focus returns correctly.

## 4. Release

- [ ] Run `npm test` and a release build on a machine with the Android SDK and
      JDK 17 or 21 (`npm run build:release` in `sites/lesen`).
- [ ] Only then promote from the closed track.
