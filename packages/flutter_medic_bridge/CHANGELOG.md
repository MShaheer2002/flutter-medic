## 0.1.1

- Fix: lower the minimum Flutter SDK from `>=3.47.1` to `>=3.27.0` (matching `marionette_flutter`'s own requirement). `3.47.1` was mistakenly baked in from a local testing toolchain and broke resolution for apps on any older, still-current SDK.

## 0.1.0

- Initial release. Wraps `marionette_flutter`'s binding behind `FlutterMedicBridge.ensureInitialized()`.
