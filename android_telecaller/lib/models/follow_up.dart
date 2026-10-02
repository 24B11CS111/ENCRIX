class FollowUp {
  final String id;
  final String leadId;
  final String leadCode;
  final String leadName;
  final String maskedPhone;
  final DateTime scheduledAt;
  final String status; // PENDING, COMPLETED, MISSED
  final String? notes;
  final String priority;

  const FollowUp({
    required this.id,
    required this.leadId,
    required this.leadCode,
    required this.leadName,
    required this.maskedPhone,
    required this.scheduledAt,
    required this.status,
    this.notes,
    this.priority = 'HIGH',
  });

  factory FollowUp.fromJson(Map<String, dynamic> json) {
    return FollowUp(
      id: json['id'] as String,
      leadId: json['lead_id'] as String,
      leadCode: json['lead_code'] as String? ?? 'LV-00000',
      leadName: json['lead_name'] as String? ?? 'Lead',
      maskedPhone: json['masked_phone'] as String? ?? '+91 ******0000',
      scheduledAt: DateTime.tryParse(json['scheduled_at'] as String? ?? '') ?? DateTime.now(),
      status: json['status'] as String? ?? 'PENDING',
      notes: json['notes'] as String?,
      priority: json['priority'] as String? ?? 'MEDIUM',
    );
  }
}
