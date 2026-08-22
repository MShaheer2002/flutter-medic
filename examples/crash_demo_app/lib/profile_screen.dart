import 'package:flutter/material.dart';

import 'profile_api.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, String?>? _profile;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final profile = await ProfileApi.fetchProfile();
    setState(() {
      _profile = profile;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: _profile == null
            ? const CircularProgressIndicator()
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_profile!['name']!, key: const ValueKey('profile_name')),
                  Text(_profile!['email']!, key: const ValueKey('profile_email')),
                  // BUG: bio is null (see profile_api.dart) — this non-null
                  // assertion crashes during build.
                  Text(_profile!['bio']!.toUpperCase(), key: const ValueKey('profile_bio')),
                ],
              ),
      ),
    );
  }
}
