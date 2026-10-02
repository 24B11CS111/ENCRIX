class Lead {
  final String id;
  final String leadCode;
  final String name; // Masked surname (e.g. Pooja S.)
  final String maskedPhone; // Strictly masked (e.g. +91 ******3210)
  final String? email; // Masked email (e.g. p***@gmail.com)
  final String status;
  final String priority;
  final String source;
  final String? notes;
  final String? courseInterest;
  final String? city;
  final String? budget;
  final String? lastCallDate;
  final int callAttempts;

  const Lead({
    required this.id,
    required this.leadCode,
    required this.name,
    required this.maskedPhone,
    this.email,
    required this.status,
    required this.priority,
    this.source = 'Website',
    this.notes,
    this.courseInterest,
    this.city,
    this.budget,
    this.lastCallDate,
    this.callAttempts = 0,
  });

  factory Lead.fromJson(Map<String, dynamic> json) {
    // Enforce data masking on creation if not already masked by server
    final rawName = json['name'] as String? ?? 'Lead';
    final rawPhone = json['phone'] as String? ?? json['masked_phone'] as String? ?? '+91 ******0000';
    
    // Mask name if not already masked (e.g. "Pooja Sharma" -> "Pooja S.")
    final maskedName = _maskName(rawName);
    // Mask phone if not already masked (e.g. "+91 9876543210" -> "+91 ******3210")
    final safePhone = _maskPhone(rawPhone);

    return Lead(
      id: json['id'] as String,
      leadCode: json['lead_code'] as String? ?? 'LV-00000',
      name: maskedName,
      maskedPhone: safePhone,
      email: json['email'] != null ? _maskEmail(json['email'] as String) : null,
      status: json['status'] as String? ?? 'NEW',
      priority: json['priority'] as String? ?? 'MEDIUM',
      source: json['source'] as String? ?? 'Direct',
      notes: json['notes'] as String?,
      courseInterest: json['metadata']?['course'] as String? ?? json['course_interest'] as String?,
      city: json['metadata']?['city'] as String? ?? json['city'] as String?,
      budget: json['metadata']?['budget'] as String? ?? json['budget'] as String?,
      lastCallDate: json['last_call_date'] as String?,
      callAttempts: json['call_attempts'] as int? ?? 0,
    );
  }

  static String _maskName(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length <= 1) return name;
    final first = parts.first;
    final lastInitial = parts.last[0].toUpperCase();
    return '$first $lastInitial.';
  }

  static String _maskPhone(String phone) {
    if (phone.contains('******')) return phone;
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 4) return '+91 ******0000';
    final last4 = digits.substring(digits.length - 4);
    return '+91 ******$last4';
  }

  static String _maskEmail(String email) {
    final parts = email.split('@');
    if (parts.length != 2) return '***@***.com';
    final user = parts[0];
    final domain = parts[1];
    final maskedUser = user.isNotEmpty ? '${user[0]}***' : '***';
    return '$maskedUser@$domain';
  }

  Lead copyWith({
    String? status,
    String? notes,
    int? callAttempts,
    String? lastCallDate,
  }) {
    return Lead(
      id: id,
      leadCode: leadCode,
      name: name,
      maskedPhone: maskedPhone,
      email: email,
      status: status ?? this.status,
      priority: priority,
      source: source,
      notes: notes ?? this.notes,
      courseInterest: courseInterest,
      city: city,
      budget: budget,
      lastCallDate: lastCallDate ?? this.lastCallDate,
      callAttempts: callAttempts ?? this.callAttempts,
    );
  }
}
