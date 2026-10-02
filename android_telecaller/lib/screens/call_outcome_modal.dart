import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../models/lead.dart';
import '../providers/leads_provider.dart';

class CallOutcomeModal extends StatefulWidget {
  final Lead lead;
  final int durationSeconds;

  const CallOutcomeModal({
    super.key,
    required this.lead,
    required this.durationSeconds,
  });

  @override
  State<CallOutcomeModal> createState() => _CallOutcomeModalState();
}

class _CallOutcomeModalState extends State<CallOutcomeModal> {
  String _selectedOutcome = 'POSITIVE'; // POSITIVE, NEGATIVE, FOLLOW_UP
  final _notesController = TextEditingController();
  DateTime _followUpDate = DateTime.now().add(const Duration(days: 1, hours: 2));
  bool _isSaving = false;

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _selectFollowUpDateTime() async {
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: _followUpDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 60)),
    );

    if (pickedDate != null && mounted) {
      final pickedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(_followUpDate),
      );

      if (pickedTime != null && mounted) {
        setState(() {
          _followUpDate = DateTime(
            pickedDate.year,
            pickedDate.month,
            pickedDate.day,
            pickedTime.hour,
            pickedTime.minute,
          );
        });
      }
    }
  }

  Future<void> _handleSubmit() async {
    setState(() => _isSaving = true);

    final leadsProv = context.read<LeadsProvider>();
    await leadsProv.submitCallOutcome(
      leadId: widget.lead.id,
      outcome: _selectedOutcome,
      notes: _notesController.text.trim(),
      followUpDate: _selectedOutcome == 'FOLLOW_UP' ? _followUpDate : null,
    );

    if (!mounted) return;
    Navigator.pop(context);

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Call outcome logged: $_selectedOutcome for ${widget.lead.name}'),
        backgroundColor: const Color(0xFF10B981),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final m = (widget.durationSeconds ~/ 60).toString().padLeft(2, '0');
    final s = (widget.durationSeconds % 60).toString().padLeft(2, '0');
    final durationStr = '$m:$s';

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: EdgeInsets.only(
        top: 20,
        left: 20,
        right: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle bar
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFCBD5E1),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Modal Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Log Call Outcome',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                    Text(
                      '${widget.lead.name} • ${widget.lead.leadCode}',
                      style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    'Duration: $durationStr',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                      color: Color(0xFF334155),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Outcome Selection Chips
            const Text(
              'Call Result',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: Color(0xFF334155),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _buildOutcomeOption(
                  key: 'POSITIVE',
                  label: 'Interested',
                  icon: Icons.check_circle_outline,
                  color: const Color(0xFF10B981),
                ),
                const SizedBox(width: 8),
                _buildOutcomeOption(
                  key: 'FOLLOW_UP',
                  label: 'Follow-Up',
                  icon: Icons.calendar_today_outlined,
                  color: const Color(0xFFF59E0B),
                ),
                const SizedBox(width: 8),
                _buildOutcomeOption(
                  key: 'NEGATIVE',
                  label: 'Not Interested',
                  icon: Icons.cancel_outlined,
                  color: const Color(0xFFEF4444),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Date / Time picker if FOLLOW_UP
            if (_selectedOutcome == 'FOLLOW_UP') ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFBEB),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.access_time, size: 18, color: Color(0xFFD97706)),
                        const SizedBox(width: 8),
                        Text(
                          DateFormat('EEE, MMM d • hh:mm a').format(_followUpDate),
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF92400E),
                          ),
                        ),
                      ],
                    ),
                    TextButton(
                      onPressed: _selectFollowUpDateTime,
                      child: const Text('Change Time'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Remarks / Notes
            const Text(
              'Interaction Remarks',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: Color(0xFF334155),
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _notesController,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Discussed university criteria, budget fit, next steps...',
                hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                filled: true,
                fillColor: const Color(0xFFF8FAFC),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Save Button
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _isSaving ? null : _handleSubmit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0F172A),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: _isSaving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text(
                        'Save Outcome & Complete',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOutcomeOption({
    required String key,
    required String label,
    required IconData icon,
    required Color color,
  }) {
    final isSelected = _selectedOutcome == key;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _selectedOutcome = key),
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? color.withValues(alpha: 0.12) : const Color(0xFFF8FAFC),
            border: Border.all(
              color: isSelected ? color : const Color(0xFFE2E8F0),
              width: isSelected ? 2 : 1,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            children: [
              Icon(icon, size: 20, color: isSelected ? color : const Color(0xFF64748B)),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  color: isSelected ? color : const Color(0xFF475569),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
