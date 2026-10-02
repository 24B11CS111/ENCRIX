import 'package:flutter_test/flutter_test.dart';
import 'package:leadvault_telecaller/models/lead.dart';
import 'package:leadvault_telecaller/models/profile.dart';
import 'package:leadvault_telecaller/services/telephony_service.dart';
import 'package:leadvault_telecaller/services/leads_service.dart';

void main() {
  group('LEADVAULT Android Mobile Telecaller Tests', () {
    test('1. Lead model strictly enforces zero raw phone exposure & data masking', () {
      final rawData = {
        'id': 'lead-999',
        'lead_code': 'LV-99999',
        'name': 'Vikramaditya Singhania',
        'phone': '+91 9876543210',
        'email': 'vikramaditya@corporation.com',
        'status': 'NEW',
        'priority': 'HIGH',
      };

      final lead = Lead.fromJson(rawData);

      // Verify that full surname is masked
      expect(lead.name, equals('Vikramaditya S.'));
      // Verify that raw phone is NEVER stored
      expect(lead.maskedPhone, equals('+91 ******3210'));
      expect(lead.maskedPhone.contains('987654'), isFalse);
      // Verify email masking
      expect(lead.email, equals('v***@corporation.com'));
    });

    test('2. TelecallerProfile correctly maps organization and credentials', () {
      final json = {
        'id': 'tc-arjun-01',
        'user_id': 'user-arjun-verma',
        'organization_id': 'org-vertex-001',
        'organization_name': 'Vertex Global Education',
        'full_name': 'Arjun Verma',
        'role': 'TELECALLER',
        'status': 'ACTIVE',
        'assigned_count': 18,
        'calls_today': 12,
        'positive_count': 4,
      };

      final profile = TelecallerProfile.fromJson(json);
      expect(profile.id, equals('tc-arjun-01'));
      expect(profile.organizationId, equals('org-vertex-001'));
      expect(profile.fullName, equals('Arjun Verma'));
      expect(profile.role, equals('TELECALLER'));
    });

    test('3. MobileTelephonyService dispatches call by leadId without raw phone transmission', () async {
      final service = MobileTelephonyService();
      final session = await service.initiateCall(
        leadId: 'lead-test-101',
        telecallerId: 'tc-arjun-01',
        leadName: 'Pooja S.',
        maskedPhone: '+91 ******3210',
      );

      expect(session.callId.startsWith('CA-mob-'), isTrue);
      expect(session.leadId, equals('lead-test-101'));
      expect(session.maskedPhone, equals('+91 ******3210'));
      expect(session.isMuted, isFalse);

      // Test end call
      final endResult = await service.endCall(session.callId, session.startedAt);
      expect(endResult.duration, greaterThanOrEqualTo(1));
      expect(endResult.recordingUrl.contains('.mp3'), isTrue);
    });

    test('4. LeadsService records POSITIVE outcome and updates lead status to INTERESTED', () async {
      final service = LeadsService();
      final initialLeads = await service.getAssignedLeads('tc-arjun-01');
      expect(initialLeads.isNotEmpty, isTrue);

      final target = initialLeads.first;
      await service.recordCallOutcome(
        leadId: target.id,
        outcome: 'POSITIVE',
        notes: 'Candidate very interested in September admission',
      );

      final updatedLeads = await service.getAssignedLeads('tc-arjun-01');
      final updated = updatedLeads.firstWhere((l) => l.id == target.id);
      expect(updated.status, equals('INTERESTED'));
      expect(updated.notes?.contains('September admission'), isTrue);
      expect(updated.callAttempts, equals(target.callAttempts + 1));
    });

    test('5. LeadsService schedules FOLLOW_UP and inserts into callback queue', () async {
      final service = LeadsService();
      final targetLeadId = 'lead-lv-10295';
      final followUpTime = DateTime.now().add(const Duration(days: 2));

      await service.recordCallOutcome(
        leadId: targetLeadId,
        outcome: 'FOLLOW_UP',
        notes: 'Call on Thursday afternoon',
        followUpDate: followUpTime,
      );

      final followUps = await service.getFollowUps('tc-arjun-01');
      final added = followUps.firstWhere((f) => f.leadId == targetLeadId);
      expect(added.status, equals('PENDING'));
      expect(added.notes, equals('Call on Thursday afternoon'));
    });
  });
}
