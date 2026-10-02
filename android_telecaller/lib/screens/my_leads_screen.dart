import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/leads_provider.dart';
import '../providers/call_provider.dart';
import '../widgets/masked_lead_card.dart';
import 'lead_details_screen.dart';
import 'call_screen.dart';

class MyLeadsScreen extends StatelessWidget {
  const MyLeadsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final leadsProv = context.watch<LeadsProvider>();
    final leads = leadsProv.leads;

    final filterOptions = ['ALL', 'NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP'];

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          'My Assigned Leads',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
        ),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 0,
      ),
      body: Column(
        children: [
          // Search & Filter Section
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Column(
              children: [
                // Search Input
                TextField(
                  onChanged: leadsProv.setSearchQuery,
                  decoration: InputDecoration(
                    hintText: 'Search by lead code, candidate name, course...',
                    hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                    prefixIcon: const Icon(Icons.search, size: 18),
                    filled: true,
                    fillColor: const Color(0xFFF1F5F9),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 10),

                // Horizontal Filter Chips
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: filterOptions.map((f) {
                      final isSelected = leadsProv.selectedFilter == f;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ChoiceChip(
                          label: Text(f, style: TextStyle(fontSize: 11, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal)),
                          selected: isSelected,
                          onSelected: (_) => leadsProv.setFilter(f),
                          selectedColor: const Color(0xFF0F172A),
                          labelStyle: TextStyle(color: isSelected ? Colors.white : const Color(0xFF475569)),
                          backgroundColor: const Color(0xFFF1F5F9),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ],
            ),
          ),

          // Count and Masking notice
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${leads.length} Leads Assigned',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF64748B)),
                ),
                const Row(
                  children: [
                    Icon(Icons.shield_outlined, size: 12, color: Color(0xFF10B981)),
                    SizedBox(width: 4),
                    Text(
                      'Zero Raw Phone Exposure',
                      style: TextStyle(fontSize: 11, color: Color(0xFF10B981), fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Leads List
          Expanded(
            child: leads.isEmpty
                ? const Center(
                    child: Text(
                      'No matching leads found',
                      style: TextStyle(color: Color(0xFF94A3B8)),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.only(bottom: 24),
                    itemCount: leads.length,
                    itemBuilder: (context, index) {
                      final lead = leads[index];
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
                          callProv.startCall(lead: lead, telecallerId: auth.profile!.id);
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => CallScreen(lead: lead)),
                          );
                        },
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
