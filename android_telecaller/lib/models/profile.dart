class TelecallerProfile {
  final String id;
  final String userId;
  final String organizationId;
  final String organizationName;
  final String fullName;
  final String role;
  final String status;
  final int assignedCount;
  final int callsToday;
  final int positiveCount;

  const TelecallerProfile({
    required this.id,
    required this.userId,
    required this.organizationId,
    required this.organizationName,
    required this.fullName,
    required this.role,
    required this.status,
    this.assignedCount = 0,
    this.callsToday = 0,
    this.positiveCount = 0,
  });

  factory TelecallerProfile.fromJson(Map<String, dynamic> json) {
    return TelecallerProfile(
      id: json['id'] as String,
      userId: json['user_id'] as String? ?? json['id'] as String,
      organizationId: json['organization_id'] as String? ?? 'org-vertex-001',
      organizationName: json['organization_name'] as String? ?? 'Vertex Global Education',
      fullName: json['full_name'] as String? ?? 'Telecaller',
      role: json['role'] as String? ?? 'TELECALLER',
      status: json['status'] as String? ?? 'ACTIVE',
      assignedCount: json['assigned_count'] as int? ?? 0,
      callsToday: json['calls_today'] as int? ?? 0,
      positiveCount: json['positive_count'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'user_id': userId,
    'organization_id': organizationId,
    'organization_name': organizationName,
    'full_name': fullName,
    'role': role,
    'status': status,
    'assigned_count': assignedCount,
    'calls_today': callsToday,
    'positive_count': positiveCount,
  };
}
