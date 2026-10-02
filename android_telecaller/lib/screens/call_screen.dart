import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/lead.dart';
import '../models/call_session.dart';
import '../providers/call_provider.dart';
import 'call_outcome_modal.dart';

class CallScreen extends StatefulWidget {
  final Lead lead;

  const CallScreen({super.key, required this.lead});

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  bool _isSpeakerOn = false;

  Future<void> _handleHangup() async {
    final call = context.read<CallProvider>();
    final result = await call.hangUp();

    if (!mounted) return;

    // Pop the call screen and open the outcome modal
    Navigator.pop(context);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CallOutcomeModal(
        lead: widget.lead,
        durationSeconds: result.duration,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final call = context.watch<CallProvider>();
    final session = call.currentSession;
    final state = session?.state ?? CallState.initiated;

    String statusText = 'Connecting Gateway...';
    Color statusColor = const Color(0xFF94A3B8);

    if (state == CallState.initiated) {
      statusText = 'Dispatching to Carrier...';
      statusColor = const Color(0xFF38BDF8);
    } else if (state == CallState.ringing) {
      statusText = 'Ringing Customer Device...';
      statusColor = const Color(0xFFFBBF24);
    } else if (state == CallState.connected) {
      statusText = 'Connected • Call in Progress';
      statusColor = const Color(0xFF34D399);
    } else if (state == CallState.completed) {
      statusText = 'Call Ended';
      statusColor = const Color(0xFFEF4444);
    }

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Top Bar: Gateway Encryption Badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.lock_outline, size: 14, color: Color(0xFF34D399)),
                    SizedBox(width: 6),
                    Text(
                      'SECURE TELEPHONY GATEWAY',
                      style: TextStyle(
                        color: Color(0xFF34D399),
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.8,
                      ),
                    ),
                  ],
                ),
              ),

              // Center Section: Customer Info & Status
              Column(
                children: [
                  // Animated Caller Avatar
                  Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: const LinearGradient(
                        colors: [Color(0xFF0284C7), Color(0xFF2563EB)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF0284C7).withValues(alpha: 0.3),
                          blurRadius: 28,
                          spreadRadius: 4,
                        ),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        widget.lead.name.substring(0, 1),
                        style: const TextStyle(
                          fontSize: 38,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Masked Customer Name
                  Text(
                    widget.lead.name,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),

                  // Strictly Masked Phone Number
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.shield_outlined, size: 14, color: Color(0xFF94A3B8)),
                      const SizedBox(width: 6),
                      Text(
                        widget.lead.maskedPhone,
                        style: const TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 15,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Call Status Label
                  Text(
                    statusText,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Live Duration Counter
                  Text(
                    call.formattedDuration,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 36,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w300,
                    ),
                  ),
                ],
              ),

              // Bottom Section: Call Controls (Mute, Speaker, Hangup)
              Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      // Mute Button
                      _ControlButton(
                        icon: session?.isMuted == true ? Icons.mic_off : Icons.mic,
                        label: session?.isMuted == true ? 'Unmute' : 'Mute',
                        isActive: session?.isMuted == true,
                        onPressed: state == CallState.connected ? call.toggleMute : null,
                      ),

                      // Speaker Button
                      _ControlButton(
                        icon: _isSpeakerOn ? Icons.volume_up : Icons.volume_down,
                        label: 'Speaker',
                        isActive: _isSpeakerOn,
                        onPressed: () {
                          setState(() {
                            _isSpeakerOn = !_isSpeakerOn;
                          });
                        },
                      ),

                      // Keypad / Info
                      _ControlButton(
                        icon: Icons.dialpad,
                        label: 'Keypad',
                        isActive: false,
                        onPressed: () {},
                      ),
                    ],
                  ),
                  const SizedBox(height: 36),

                  // Hangup Button
                  SizedBox(
                    width: 72,
                    height: 72,
                    child: ElevatedButton(
                      onPressed: _handleHangup,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFEF4444),
                        foregroundColor: Colors.white,
                        shape: const CircleBorder(),
                        elevation: 6,
                        padding: EdgeInsets.zero,
                      ),
                      child: const Icon(Icons.call_end, size: 34),
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'End Call & Tag Outcome',
                    style: TextStyle(
                      color: Color(0xFF94A3B8),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final VoidCallback? onPressed;

  const _ControlButton({
    required this.icon,
    required this.label,
    required this.isActive,
    this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        IconButton(
          onPressed: onPressed,
          iconSize: 26,
          style: IconButton.styleFrom(
            backgroundColor: isActive ? Colors.white : Colors.white.withValues(alpha: 0.12),
            foregroundColor: isActive ? const Color(0xFF0F172A) : Colors.white,
            padding: const EdgeInsets.all(16),
          ),
          icon: Icon(icon),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF94A3B8),
            fontSize: 11,
          ),
        ),
      ],
    );
  }
}
