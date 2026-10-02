import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/call_session.dart';
import '../models/lead.dart';
import '../services/telephony_service.dart';

class CallProvider extends ChangeNotifier {
  final MobileTelephonyService _telephonyService = MobileTelephonyService();

  CallSession? _currentSession;
  Timer? _ticker;
  Timer? _ringingTimer;
  Timer? _connectedTimer;

  CallSession? get currentSession => _currentSession;
  bool get isCallActive =>
      _currentSession != null && _currentSession!.state != CallState.completed && _currentSession!.state != CallState.failed;

  String get formattedDuration {
    if (_currentSession == null) return '00:00';
    final seconds = _currentSession!.durationSeconds;
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  Future<void> startCall({
    required Lead lead,
    required String telecallerId,
  }) async {
    _cleanTimers();

    // 1. Initiate outbound call session through gateway
    // NOTE: lead.id and masked credentials used. Raw phone is NEVER present.
    _currentSession = await _telephonyService.initiateCall(
      leadId: lead.id,
      telecallerId: telecallerId,
      leadName: lead.name,
      maskedPhone: lead.maskedPhone,
    );
    notifyListeners();

    // 2. Progression to RINGING state after 1.4s
    _ringingTimer = Timer(const Duration(milliseconds: 1400), () {
      if (_currentSession != null && _currentSession!.state == CallState.initiated) {
        _currentSession = _currentSession!.copyWith(state: CallState.ringing);
        notifyListeners();
      }
    });

    // 3. Progression to CONNECTED state after 3.2s
    _connectedTimer = Timer(const Duration(milliseconds: 3200), () {
      if (_currentSession != null &&
          (_currentSession!.state == CallState.ringing || _currentSession!.state == CallState.initiated)) {
        _currentSession = _currentSession!.copyWith(state: CallState.connected);
        _startTicker();
        notifyListeners();
      }
    });
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_currentSession != null && _currentSession!.state == CallState.connected) {
        _currentSession = _currentSession!.copyWith(
          durationSeconds: _currentSession!.durationSeconds + 1,
        );
        notifyListeners();
      }
    });
  }

  Future<void> toggleMute() async {
    if (_currentSession == null) return;
    final newMute = !_currentSession!.isMuted;
    await _telephonyService.toggleMute(_currentSession!.callId, _currentSession!.isMuted);
    _currentSession = _currentSession!.copyWith(isMuted: newMute);
    notifyListeners();
  }

  Future<CallEndResult> hangUp() async {
    if (_currentSession == null) {
      return const CallEndResult(duration: 0, recordingUrl: '');
    }

    _cleanTimers();
    final result = await _telephonyService.endCall(
      _currentSession!.callId,
      _currentSession!.startedAt,
    );

    _currentSession = _currentSession!.copyWith(
      state: CallState.completed,
      durationSeconds: result.duration,
    );
    notifyListeners();

    return result;
  }

  void clearSession() {
    _cleanTimers();
    _currentSession = null;
    notifyListeners();
  }

  void _cleanTimers() {
    _ticker?.cancel();
    _ringingTimer?.cancel();
    _connectedTimer?.cancel();
    _ticker = null;
    _ringingTimer = null;
    _connectedTimer = null;
  }

  @override
  void dispose() {
    _cleanTimers();
    super.dispose();
  }
}
