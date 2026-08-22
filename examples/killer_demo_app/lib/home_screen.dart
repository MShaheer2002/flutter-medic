import 'package:flutter/material.dart';

import 'task_api.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<String> _tasks = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadTasks();
  }

  Future<void> _loadTasks() async {
    final tasks = await TaskApi.fetchTasks();
    // BUG: fetched tasks are never assigned to _tasks.
    setState(() {
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Upcoming Tasks', style: TextStyle(fontSize: 20)),
            const SizedBox(height: 12),
            if (_loading)
              const CircularProgressIndicator()
            else if (_tasks.isEmpty)
              const Text(
                'No tasks to show.',
                key: ValueKey('empty_tasks_message'),
              )
            else
              Expanded(
                child: ListView(
                  key: const ValueKey('tasks_list'),
                  children: _tasks.map((t) => ListTile(title: Text(t))).toList(),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
