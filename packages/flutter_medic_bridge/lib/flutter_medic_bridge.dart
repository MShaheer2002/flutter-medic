import 'package:marionette_flutter/marionette_flutter.dart';

/// Initializes flutter-medic's device bridge in this app.
///
/// Use in place of `WidgetsFlutterBinding.ensureInitialized()`:
/// ```dart
/// void main() {
///   if (kDebugMode) {
///     FlutterMedicBridge.ensureInitialized();
///   } else {
///     WidgetsFlutterBinding.ensureInitialized();
///   }
///   runApp(const MyApp());
/// }
/// ```
class FlutterMedicBridge {
  FlutterMedicBridge._();

  static void ensureInitialized(
      [MarionetteConfiguration configuration =
          const MarionetteConfiguration()]) {
    MarionetteBinding.ensureInitialized(configuration);
  }
}
