/// Fake backend — simulates a real API call with network delay.
/// Always succeeds and returns 5 tasks. The bug is not here.
class TaskApi {
  static Future<List<String>> fetchTasks() async {
    await Future.delayed(const Duration(milliseconds: 400));
    return const [
      'Buy groceries',
      'Finish quarterly report',
      'Call the dentist',
      'Review pull request #42',
      'Water the plants',
    ];
  }
}
