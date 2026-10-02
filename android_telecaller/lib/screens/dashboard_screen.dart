import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/leads_provider.dart';
import '../providers/call_provider.dart';
import '../widgets/masked_lead_card.dart';
import 'lead_details_screen.dart';
import 'call_screen.dart';

class DashboardScreen extends StatelessWidget {
  final VoidCallback onNavigateToLeads;

  const DashboardScreen({super.key, required this.onNavigateToLeads});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final leadsProv = context.watch<LeadsProvider>();
    final profile = auth.profile;

    final urgentLeads = leadsProv.leads.where((l) => l.status == 'NEW' || l.status == 'ASSIGNED').toList();

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              profile?.fullName ?? 'Telecaller',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            Text(
              profile?.organizationName ?? 'Vertex Consultancy',
              style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
            ),
          ],
        ),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 0,
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Row(
              children: [
                Icon(Icons.shield, size: 14, color: Color(0xFF10B981)),
                SizedBox(width: 4),
                Text(
                  'STAGING',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF334155),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Hero Action Banner: Start Calling Queue
            Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF0F172A).withValues(alpha: 0.15),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Active Calling Queue',
                        style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      Icon(Icons.headset_mic_outlined, color: Color(0xFF38BDF8), size: 22),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${urgentLeads.length} uncontacted candidate leads ready in your queue today.',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    height: 42,
                    child: ElevatedButton.icon(
                      onPressed: urgentLeads.isNotEmpty
                          ? () {
                              final firstLead = urgentLeads.first;
                              final callProv = context.read<CallProvider>();
                              callProv.startCall(lead: firstLead, telecallerId: profile!.id);
                              Navigator.push(
                                context,
                                MaterialPageRoute(builder: (_) => CallScreen(lead: firstLead)),
                              );
                            }
                          : onNavigateToLeads,
                      icon: const Icon(Icons.play_arrow_rounded, size: 20),
                      label: Text(
                        urgentLeads.isNotEmpty ? 'Start Next Call (${urgentLeads.first.name})' : 'View All Leads',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0284C7),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Performance KPI Grid
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.6,
                children: [
                  _buildKpiCard(
                    title: 'Assigned Leads',
                    value: '${leadsProv.assignedTotal}',
                    icon: Icons.people_outline,
                    color: const Color(0xFF3B82F6),
                  ),
                  _buildKpiCard(
                    title: 'Calls Today',
                    value: '${profile?.callsToday ?? 12}',
                    icon: Icons.phone_forwarded,
                    color: const Color(0xFF10B981),
                  ),
                  _buildKpiCard(
                    title: 'Interested',
                    value: '${leadsProv.positiveTotal}',
                    icon: Icons.star_outline,
                    color: const Color(0xFF8B5CF6),
                  ),
                  _buildKpiCard(
                    title: 'Follow-Ups Due',
                    value: '${leadsProv.pendingFollowUpsCount}',
                    icon: Icons.event_available,
                    color: const Color(0xFFF59E0B),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Section: Urgent Leads
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Priority Next Leads',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                  ),
                  TextButton(
                    onPressed: onNavigateToLeads,
                    child: const Text('See All', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 4),

            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: urgentLeads.take(3).length,
              itemBuilder: (context, index) {
                final lead = urgentLeads[index];
                return MaskedLeadCard(
                  lead: lead,
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => LeadDetailsScreen(lead: lead)),
                    );
                  },
                  onCall: () {
                    final callProv = context.read<CallProvider>();
                    callProv.startCall(lead: lead, telecallerId: profile!.id);
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => CallScreen(lead: lead)),
                    );
                  },
                );
              },
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildKpiCard({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF64748B)),
              ),
              Icon(icon, size: 18, color: color),
            ],
          ),
          Text(
            value,
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
          ),
        ],
      ),
    );
  }
}
