/// Fake backend — simulates a real API call with network delay.
/// Always succeeds, but the returned map is missing "bio" on purpose.
/// The bug is not here — it's in how the caller reads this data.
class ProfileApi {
  static Future<Map<String, String?>> fetchProfile() async {
    await Future.delayed(const Duration(milliseconds: 400));
    return const {
      'name': 'Jordan Rivera',
      'email': 'jordan@flutter-medic.test',
      'bio': null,
    };
  }
}
