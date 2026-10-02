enum AppEnvironment { dev, staging, prod }

class AppConfig {
  final AppEnvironment environment;
  final String appTitle;
  final String supabaseUrl;
  final String supabaseAnonKey;
  final String telephonyGatewayUrl;
  final bool enableDemoShortcuts;

  const AppConfig({
    required this.environment,
    required this.appTitle,
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.telephonyGatewayUrl,
    required this.enableDemoShortcuts,
  });

  static AppConfig current = const AppConfig(
    environment: AppEnvironment.staging,
    appTitle: 'LEADVAULT Telecaller (Staging)',
    supabaseUrl: 'https://staging-leadvault.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.staging-leadvault-anon-key-placeholder',
    telephonyGatewayUrl: 'https://staging.leadvault.io/api/telephony',
    enableDemoShortcuts: true,
  );
}
