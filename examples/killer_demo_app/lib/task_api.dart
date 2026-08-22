import 'dart:convert';
import 'dart:io';

/// Real backend — a genuine HTTP round trip over loopback, not an in-memory
/// fake. The app starts its own tiny local server on first use and calls it
/// via a real HttpClient GET, so this shows up in Dart VM service's HTTP
/// profiling exactly like a real API call would. Always succeeds and
/// returns 5 tasks. The bug is not here.
class TaskApi {
  static HttpServer? _server;

  static Future<int> _ensureServer() async {
    final server = _server ??= await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) {
      request.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode(const [
          'Buy groceries',
          'Finish quarterly report',
          'Call the dentist',
          'Review pull request #42',
          'Water the plants',
        ]))
        ..close();
    });
    return server.port;
  }

  static Future<List<String>> fetchTasks() async {
    final port = await _ensureServer();
    final client = HttpClient();
    final request = await client.getUrl(Uri.parse('http://127.0.0.1:$port/tasks'));
    final response = await request.close();
    final body = await response.transform(utf8.decoder).join();
    return (jsonDecode(body) as List).cast<String>();
  }
}
