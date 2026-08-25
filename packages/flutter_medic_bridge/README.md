# flutter_medic_bridge

Wires a Flutter app into [flutter-medic](https://github.com/MShaheer2002/flutter-medic)'s device bridge, so an AI coding agent can drive and inspect the running app.

## Usage

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter_medic_bridge/flutter_medic_bridge.dart';

void main() {
  if (kDebugMode) {
    FlutterMedicBridge.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

`npx flutter-medic init` wires this in automatically — you shouldn't need to do this by hand.

Built on [marionette_flutter](https://pub.dev/packages/marionette_flutter) (Apache-2.0).
