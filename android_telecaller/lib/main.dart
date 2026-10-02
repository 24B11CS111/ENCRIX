import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'providers/leads_provider.dart';
import 'providers/call_provider.dart';
import 'screens/splash_screen.dart';
import 'config/env.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const LeadVaultApp());
}

class LeadVaultApp extends StatelessWidget {
  const LeadVaultApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => LeadsProvider()),
        ChangeNotifierProvider(create: (_) => CallProvider()),
      ],
      child: MaterialApp(
        title: AppConfig.current.appTitle,
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF0284C7),
            primary: const Color(0xFF0F172A),
            secondary: const Color(0xFF0284C7),
            surface: Colors.white,
          ),
          scaffoldBackgroundColor: const Color(0xFFF8FAFC),
          appBarTheme: const AppBarTheme(
            backgroundColor: Colors.white,
            foregroundColor: Color(0xFF0F172A),
            elevation: 0,
            scrolledUnderElevation: 0,
          ),
        ),
        home: const SplashScreen(),
      ),
    );
  }
}
