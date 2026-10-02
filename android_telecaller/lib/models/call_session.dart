enum CallState { initiated, ringing, connected, completed, failed }

class CallSession {
  final String callId;
  final String leadId;
  final String leadName;
  final String maskedPhone;
  final CallState state;
  final DateTime startedAt;
  final int durationSeconds;
  final bool isMuted;

  const CallSession({
    required this.callId,
    required this.leadId,
    required this.leadName,
    required this.maskedPhone,
    required this.state,
    required this.startedAt,
    this.durationSeconds = 0,
    this.isMuted = false,
  });

  CallSession copyWith({
    CallState? state,
    int? durationSeconds,
    bool? isMuted,
  }) {
    return CallSession(
      callId: callId,
      leadId: leadId,
      leadName: leadName,
      maskedPhone: maskedPhone,
      state: state ?? this.state,
      startedAt: startedAt,
      durationSeconds: durationSeconds ?? this.durationSeconds,
      isMuted: isMuted ?? this.isMuted,
    );
  }
}

class CallEndResult {
  final int duration;
  final String recordingUrl;

  const CallEndResult({
    required this.duration,
    required this.recordingUrl,
  });
}
