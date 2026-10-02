import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config/env.dart';
import '../models/profile.dart';

class AuthService {
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  TelecallerProfile? _currentProfile;

  TelecallerProfile? get currentProfile => _currentProfile;
  bool get isAuthenticated => _currentProfile != null;

  // Staging / Demo Telecaller profiles
  static const Map<String, Map<String, dynamic>> _demoProfiles = {
    'arjun@leadvault.io': {
      'id': 'tc-arjun-01',
      'user_id': 'user-arjun-verma',
      'organization_id': 'org-vertex-001',
      'organization_name': 'Vertex Global Education',
      'full_name': 'Arjun Verma',
      'role': 'TELECALLER',
      'status': 'ACTIVE',
      'assigned_count': 18,
      'calls_today': 12,
      'positive_count': 4,
    },
    'rahul@leadvault.io': {
      'id': 'tc-rahul-02',
      'user_id': 'user-rahul-mehta',
      'organization_id': 'org-vertex-001',
      'organization_name': 'Vertex Global Education',
      'full_name': 'Rahul Mehta',
      'role': 'TELECALLER',
      'status': 'ACTIVE',
      'assigned_count': 15,
      'calls_today': 9,
      'positive_count': 2,
    },
  };

  Future<TelecallerProfile?> checkSession() async {
    try {
      final savedJson = await _storage.read(key: 'leadvault_mobile_session');
      if (savedJson != null) {
        final data = jsonDecode(savedJson) as Map<String, dynamic>;
        _currentProfile = TelecallerProfile.fromJson(data);
        return _currentProfile;
      }
    } catch (_) {
      // Storage read error fallback
    }
    return null;
  }

  Future<TelecallerProfile> login(String email, String password) async {
    final cleanEmail = email.trim().toLowerCase();

    // 1. In Dev / Staging demo shortcut mode:
    if (AppConfig.current.enableDemoShortcuts) {
      final match = _demoProfiles[cleanEmail] ?? _demoProfiles['arjun@leadvault.io']!;
      _currentProfile = TelecallerProfile.fromJson(match);
      await _storage.write(
        key: 'leadvault_mobile_session',
        value: jsonEncode(_currentProfile!.toJson()),
      );
      return _currentProfile!;
    }

    // 2. Production Supabase Auth integration:
    // When live credentials configured:
    // final res = await Supabase.instance.client.auth.signInWithPassword(email: cleanEmail, password: password);
    // Fetch profile from profiles table:
    // final profileData = await Supabase.instance.client.from('profiles').select().eq('user_id', res.user!.id).single();

    throw Exception('Live Supabase credentials not set or invalid login.');
  }

  Future<void> logout() async {
    _currentProfile = null;
    await _storage.delete(key: 'leadvault_mobile_session');
  }
}
