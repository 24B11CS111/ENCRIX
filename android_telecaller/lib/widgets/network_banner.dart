import 'package:flutter/material.dart';

enum NetworkStatus { online, offline, syncing }

class NetworkBanner extends StatelessWidget {
  final NetworkStatus status;

  const NetworkBanner({super.key, this.status = NetworkStatus.online});

  @override
  Widget build(BuildContext context) {
    if (status == NetworkStatus.online) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        color: const Color(0xFF0F172A),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.shield_outlined, size: 14, color: Color(0xFF10B981)),
            SizedBox(width: 6),
            Text(
              'ENCRYPTED GATEWAY ONLINE • ZERO RAW PHONE STORAGE',
              style: TextStyle(
                color: Color(0xFF10B981),
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.8,
              ),
            ),
          ],
        ),
      );
    } else if (status == NetworkStatus.syncing) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        color: const Color(0xFF1E293B),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 10,
              height: 10,
              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF38BDF8)),
            ),
            SizedBox(width: 8),
            Text(
              'SYNCING QUEUE UPDATES...',
              style: TextStyle(
                color: Color(0xFF38BDF8),
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.8,
              ),
            ),
          ],
        ),
      );
    } else {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        color: const Color(0xFFEF4444),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.wifi_off, size: 14, color: Colors.white),
            SizedBox(width: 6),
            Text(
              'OFFLINE • OUTBOUND CALLING TEMPORARILY PAUSED',
              style: TextStyle(
                color: Colors.white,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.8,
              ),
            ),
          ],
        ),
      );
    }
  }
}
