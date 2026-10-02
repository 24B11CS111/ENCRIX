import 'package:flutter/foundation.dart';
import '../models/lead.dart';
import '../models/follow_up.dart';
import '../models/call_history_item.dart';
import '../services/leads_service.dart';

class LeadsProvider extends ChangeNotifier {
  final LeadsService _leadsService = LeadsService();

  List<Lead> _leads = [];
  List<FollowUp> _followUps = [];
  List<CallHistoryItem> _history = [];
  bool _isLoading = false;
  String _selectedFilter = 'ALL';
  String _searchQuery = '';

  List<Lead> get leads {
    return _leads.where((l) {
      final matchesFilter = _selectedFilter == 'ALL' || l.status == _selectedFilter;
      final matchesSearch = _searchQuery.isEmpty ||
          l.name.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          l.leadCode.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          (l.courseInterest != null && l.courseInterest!.toLowerCase().contains(_searchQuery.toLowerCase()));
      return matchesFilter && matchesSearch;
    }).toList();
  }

  List<FollowUp> get followUps => _followUps;
  List<CallHistoryItem> get callHistory => _history;
  bool get isLoading => _isLoading;
  String get selectedFilter => _selectedFilter;
  String get searchQuery => _searchQuery;

  // Queue Analytics Metrics
  int get assignedTotal => _leads.length;
  int get contactedToday => _leads.where((l) => l.status == 'CONTACTED' || l.status == 'INTERESTED').length;
  int get positiveTotal => _leads.where((l) => l.status == 'INTERESTED' || l.status == 'CONVERTED').length;
  int get pendingFollowUpsCount => _followUps.where((f) => f.status == 'PENDING').length;

  Future<void> fetchAllData(String telecallerId) async {
    _isLoading = true;
    notifyListeners();

    try {
      _leads = await _leadsService.getAssignedLeads(telecallerId);
      _followUps = await _leadsService.getFollowUps(telecallerId);
      _history = await _leadsService.getCallHistory(telecallerId);
    } catch (_) {
      // Fallback
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void setFilter(String filter) {
    _selectedFilter = filter;
    notifyListeners();
  }

  void setSearchQuery(String query) {
    _searchQuery = query;
    notifyListeners();
  }

  Future<void> submitCallOutcome({
    required String leadId,
    required String outcome,
    required String notes,
    DateTime? followUpDate,
  }) async {
    await _leadsService.recordCallOutcome(
      leadId: leadId,
      outcome: outcome,
      notes: notes,
      followUpDate: followUpDate,
    );
    notifyListeners();
  }
}
