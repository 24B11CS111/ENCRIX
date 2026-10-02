class CallHistoryItem {
  final String id;
  final String leadId;
  final String leadCode;
  final String leadName;
  final String maskedPhone;
  final int durationSeconds;
  final String outcome; // POSITIVE, NEGATIVE, FOLLOW_UP, NO_ANSWER
  final String? outcomeNotes;
  final DateTime createdAt;
  final String? recordingUrl;

  const CallHistoryItem({
    required this.id,
    required this.leadId,
    required this.leadCode,
    required this.leadName,
    required this.maskedPhone,
    required this.durationSeconds,
    required this.outcome,
    this.outcomeNotes,
    required this.createdAt,
    this.recordingUrl,
  });

  factory CallHistoryItem.fromJson(Map<String, dynamic> json) {
    return CallHistoryItem(
      id: json['id'] as String,
      leadId: json['lead_id'] as String,
      leadCode: json['lead_code'] as String? ?? 'LV-00000',
      leadName: json['lead_name'] as String? ?? 'Lead',
      maskedPhone: json['masked_phone'] as String? ?? '+91 ******0000',
      durationSeconds: json['duration_seconds'] as int? ?? 0,
      outcome: json['outcome'] as String? ?? 'COMPLETED',
      outcomeNotes: json['outcome_notes'] as String?,
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
      recordingUrl: json['recording_url'] as String?,
    );
  }
}
