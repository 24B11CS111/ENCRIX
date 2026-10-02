import '../models/lead.dart';
import '../models/follow_up.dart';
import '../models/call_history_item.dart';

class LeadsService {
  // Local state seeded with assigned leads for Arjun Verma (Vertex Global Education)
  // All contact information is pre-masked at data boundary
  final List<Lead> _leads = [
    const Lead(
      id: 'lead-lv-10294',
      leadCode: 'LV-10294',
      name: 'Pooja S.',
      maskedPhone: '+91 ******3210',
      email: 'p***@gmail.com',
      status: 'ASSIGNED',
      priority: 'HIGH',
      source: 'Google Ads',
      courseInterest: 'MS Computer Science (Canada)',
      city: 'Pune',
      budget: '₹25 - 30 Lakhs',
      notes: 'Inquired for Fall 2027 intake Canada. Has IELTS 7.5.',
      callAttempts: 1,
    ),
    const Lead(
      id: 'lead-lv-10295',
      leadCode: 'LV-10295',
      name: 'Rohan M.',
      maskedPhone: '+91 ******8821',
      email: 'r***@outlook.com',
      status: 'NEW',
      priority: 'URGENT',
      source: 'Facebook Campaign',
      courseInterest: 'MBA International (UK)',
      city: 'Mumbai',
      budget: '₹35 - 40 Lakhs',
      notes: 'High intent. Looking for 1-year London universities with post-study work visa.',
      callAttempts: 0,
    ),
    const Lead(
      id: 'lead-lv-10296',
      leadCode: 'LV-10296',
      name: 'Sneha P.',
      maskedPhone: '+91 ******4590',
      email: 's***@gmail.com',
      status: 'FOLLOW_UP',
      priority: 'HIGH',
      source: 'Direct Portal',
      courseInterest: 'Data Science MSc (Germany)',
      city: 'Bangalore',
      budget: '₹18 - 22 Lakhs',
      notes: 'Wants public university with English taught curriculum.',
      callAttempts: 2,
    ),
    const Lead(
      id: 'lead-lv-10297',
      leadCode: 'LV-10297',
      name: 'Amit K.',
      maskedPhone: '+91 ******7712',
      email: 'a***@yahoo.com',
      status: 'CONTACTED',
      priority: 'MEDIUM',
      source: 'Webinar Lead',
      courseInterest: 'Civil Engg Masters (Australia)',
      city: 'Delhi NCR',
      budget: '₹28 - 32 Lakhs',
      notes: 'Working professional with 3 years experience.',
      callAttempts: 1,
    ),
    const Lead(
      id: 'lead-lv-10298',
      leadCode: 'LV-10298',
      name: 'Deepa R.',
      maskedPhone: '+91 ******1943',
      email: 'd***@gmail.com',
      status: 'INTERESTED',
      priority: 'HIGH',
      source: 'Instagram',
      courseInterest: 'Biotechnology MS (Ireland)',
      city: 'Hyderabad',
      budget: '₹22 - 26 Lakhs',
      notes: 'Documents ready for review. Follow up on fee structure.',
      callAttempts: 3,
    ),
  ];

  final List<FollowUp> _followUps = [
    FollowUp(
      id: 'fu-01',
      leadId: 'lead-lv-10296',
      leadCode: 'LV-10296',
      leadName: 'Sneha P.',
      maskedPhone: '+91 ******4590',
      scheduledAt: DateTime.now().add(const Duration(hours: 2)),
      status: 'PENDING',
      notes: 'Call back regarding Germany public university criteria.',
      priority: 'HIGH',
    ),
    FollowUp(
      id: 'fu-02',
      leadId: 'lead-lv-10294',
      leadCode: 'LV-10294',
      leadName: 'Pooja S.',
      maskedPhone: '+91 ******3210',
      scheduledAt: DateTime.now().add(const Duration(days: 1, hours: 3)),
      status: 'PENDING',
      notes: 'Discuss scholarship opportunities with parents.',
      priority: 'MEDIUM',
    ),
  ];

  final List<CallHistoryItem> _history = [
    CallHistoryItem(
      id: 'call-hist-01',
      leadId: 'lead-lv-10298',
      leadCode: 'LV-10298',
      leadName: 'Deepa R.',
      maskedPhone: '+91 ******1943',
      durationSeconds: 194,
      outcome: 'POSITIVE',
      outcomeNotes: 'Student very keen on Trinity College Dublin. Sending brochure.',
      createdAt: DateTime.now().subtract(const Duration(hours: 1, minutes: 20)),
      recordingUrl: 'https://recordings.leadvault.internal/calls/rec_hist01.mp3',
    ),
    CallHistoryItem(
      id: 'call-hist-02',
      leadId: 'lead-lv-10297',
      leadCode: 'LV-10297',
      leadName: 'Amit K.',
      maskedPhone: '+91 ******7712',
      durationSeconds: 88,
      outcome: 'FOLLOW_UP',
      outcomeNotes: 'Was driving. Asked to call back on Saturday morning.',
      createdAt: DateTime.now().subtract(const Duration(hours: 3)),
      recordingUrl: 'https://recordings.leadvault.internal/calls/rec_hist02.mp3',
    ),
  ];

  Future<List<Lead>> getAssignedLeads(String telecallerId) async {
    // In live staging: queries Supabase leads where assigned_to = telecallerId
    return List.from(_leads);
  }

  Future<List<FollowUp>> getFollowUps(String telecallerId) async {
    return List.from(_followUps);
  }

  Future<List<CallHistoryItem>> getCallHistory(String telecallerId) async {
    return List.from(_history);
  }

  Future<void> recordCallOutcome({
    required String leadId,
    required String outcome,
    required String notes,
    DateTime? followUpDate,
  }) async {
    final index = _leads.indexWhere((l) => l.id == leadId);
    if (index != -1) {
      final current = _leads[index];
      String newStatus = current.status;

      if (outcome == 'POSITIVE') {
        newStatus = 'INTERESTED';
      } else if (outcome == 'NEGATIVE') {
        newStatus = 'NOT_INTERESTED';
      } else if (outcome == 'FOLLOW_UP') {
        newStatus = 'FOLLOW_UP';
      }

      _leads[index] = current.copyWith(
        status: newStatus,
        notes: notes.isNotEmpty ? '${current.notes ?? ""}\n[Outcome Note]: $notes' : current.notes,
        callAttempts: current.callAttempts + 1,
        lastCallDate: DateTime.now().toIso8601String(),
      );

      // Add to call history
      _history.insert(
        0,
        CallHistoryItem(
          id: 'call-${DateTime.now().millisecondsSinceEpoch}',
          leadId: current.id,
          leadCode: current.leadCode,
          leadName: current.name,
          maskedPhone: current.maskedPhone,
          durationSeconds: 45,
          outcome: outcome,
          outcomeNotes: notes,
          createdAt: DateTime.now(),
        ),
      );

      // If follow-up scheduled, add to follow-ups
      if (followUpDate != null) {
        _followUps.insert(
          0,
          FollowUp(
            id: 'fu-${DateTime.now().millisecondsSinceEpoch}',
            leadId: current.id,
            leadCode: current.leadCode,
            leadName: current.name,
            maskedPhone: current.maskedPhone,
            scheduledAt: followUpDate,
            status: 'PENDING',
            notes: notes,
          ),
        );
      }
    }
  }
}
