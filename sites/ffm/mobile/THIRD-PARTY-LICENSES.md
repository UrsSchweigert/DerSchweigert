# Third-party licences

The app is a Capacitor 8 shell around the game code in `sites/ffm/static`. The
packages in `package.json`/`package-lock.json` keep their own licence metadata;
this file records the purchase plugin the store integration depends on, as the
store integration's outcome requires.

## @capgo/native-purchases 8.9.6

- Purpose: in-app purchases for the one-time unlock `arithmoslayer_full_unlock` — StoreKit 2 on iOS (15+) and Google Play Billing on Android.
- Licence: Mozilla Public License 2.0 (MPL-2.0), see <https://www.mozilla.org/en-US/MPL/2.0/>.
- Source: <https://github.com/Cap-go/capacitor-native-purchases>
- Package: <https://www.npmjs.com/package/@capgo/native-purchases>
- Copyright: Capgo and the plugin's contributors.
- Wrapped by: `game/purchase.js` (`createPurchasesPlugin`, `createPurchaseStore`).
- No backend, no receipt server and no third-party purchase service: purchases are processed by Apple and Google only.

MPL-2.0 is file-level copyleft. The plugin stays an unmodified npm dependency;
changes to its files, if any were ever made, would have to be published under
the same licence.
