import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_medic_bridge/flutter_medic_bridge.dart';

void main() {
  if (kDebugMode) {
    FlutterMedicBridge.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
        home: Scaffold(body: Center(child: Text('Hello'))));
  }
}
