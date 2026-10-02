import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/leads_provider.dart';
import '../widgets/network_banner.dart';
import 'dashboard_screen.dart';
import 'my_leads_screen.dart';
import 'follow_ups_screen.dart';
import 'call_history_screen.dart';
import 'profile_screen.dart';

class HomeContainer extends StatefulWidget {
  const HomeContainer({super.key});

  @override
  State<HomeContainer> createState() => _HomeContainerState();
}

class _HomeContainerState extends State<HomeContainer> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final leadsProv = context.watch<LeadsProvider>();

    final pages = [
      DashboardScreen(onNavigateToLeads: () => setState(() => _currentIndex = 1)),
      const MyLeadsScreen(),
      const FollowUpsScreen(),
      const CallHistoryScreen(),
      const ProfileScreen(),
    ];

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Security & Network Status Banner at top of every screen
            const NetworkBanner(status: NetworkStatus.online),
            Expanded(child: pages[_currentIndex]),
          ],
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        type: BottomNavigationBarType.fixed,
        selectedItemColor: const Color(0xFF0284C7),
        unselectedItemColor: const Color(0xFF64748B),
        selectedFontSize: 11,
        unselectedFontSize: 11,
        backgroundColor: Colors.white,
        elevation: 8,
        items: [
          const BottomNavigationBarItem(
            icon: Icon(Icons.dashboard_outlined),
            activeIcon: Icon(Icons.dashboard),
            label: 'Dashboard',
          ),
          BottomNavigationBarItem(
            icon: Badge(
              label: Text('${leadsProv.assignedTotal}'),
              child: const Icon(Icons.people_outline),
            ),
            activeIcon: Badge(
              label: Text('${leadsProv.assignedTotal}'),
              child: const Icon(Icons.people),
            ),
            label: 'My Leads',
          ),
          BottomNavigationBarItem(
            icon: leadsProv.pendingFollowUpsCount > 0
                ? Badge(
                    label: Text('${leadsProv.pendingFollowUpsCount}'),
                    backgroundColor: const Color(0xFFF59E0B),
                    child: const Icon(Icons.calendar_today_outlined),
                  )
                : const Icon(Icons.calendar_today_outlined),
            activeIcon: const Icon(Icons.calendar_today),
            label: 'Follow-Ups',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.history_outlined),
            activeIcon: Icon(Icons.history),
            label: 'History',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.person_outline),
            activeIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
