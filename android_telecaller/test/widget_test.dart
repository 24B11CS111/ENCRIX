import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leadvault_telecaller/widgets/network_banner.dart';
import 'package:leadvault_telecaller/widgets/masked_lead_card.dart';
import 'package:leadvault_telecaller/models/lead.dart';

void main() {
  testWidgets('NetworkBanner renders encrypted gateway notice', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: NetworkBanner(status: NetworkStatus.online),
        ),
      ),
    );

    expect(find.text('ENCRYPTED GATEWAY ONLINE • ZERO RAW PHONE STORAGE'), findsOneWidget);
    expect(find.byIcon(Icons.shield_outlined), findsOneWidget);
  });

  testWidgets('MaskedLeadCard renders masked candidate name and masked phone', (WidgetTester tester) async {
    const lead = Lead(
      id: 'lead-test-01',
      leadCode: 'LV-10294',
      name: 'Pooja S.',
      maskedPhone: '+91 ******3210',
      status: 'ASSIGNED',
      priority: 'HIGH',
      courseInterest: 'MS Computer Science',
      city: 'Pune',
    );

    bool callTapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MaskedLeadCard(
            lead: lead,
            onTap: () {},
            onCall: () {
              callTapped = true;
            },
          ),
        ),
      ),
    );

    expect(find.text('LV-10294'), findsOneWidget);
    expect(find.text('Pooja S.'), findsOneWidget);
    expect(find.text('+91 ******3210'), findsOneWidget);
    expect(find.text('ASSIGNED'), findsOneWidget);
    expect(find.text('MS Computer Science'), findsOneWidget);

    // Tap Call button
    await tester.tap(find.text('Call'));
    expect(callTapped, isTrue);
  });
}
