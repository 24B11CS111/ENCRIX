import React, { useState } from 'react';
import Papa from 'papaparse';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { ColumnMapping, ParsedLeadRow, ImportSummary, DistributionResult } from '@/types';
import {
  Upload,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
  Sparkles,
  ArrowUp,
  Shuffle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { sanitizeFormulaInjection, sanitizeText } from '@/lib/validation';
import { MAX_IMPORT_ROWS, MAX_IMPORT_FILE_SIZE_BYTES } from '@/lib/config';

export const LeadImportWizard: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  // Wizard steps: 1 = Upload, 2 = Mapping, 3 = Validation & Preview, 4 = Result
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [fileName, setFileName] = useState<string>('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);

  const [parsedRows, setParsedRows] = useState<ParsedLeadRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary>({
    totalRows: 0,
    validRows: 0,
    duplicateRows: 0,
    invalidRows: 0,
  });

  const [isImporting, setIsImporting] = useState(false);
  const [distributionResult, setDistributionResult] = useState<DistributionResult | null>(null);

  // STEP 1: Handle File Upload & Parse
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      alert('Security Limit Exceeded: File size must not exceed 5MB to prevent memory exhaustion.');
      return;
    }

    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length > MAX_IMPORT_ROWS) {
          alert(`Batch limit exceeded: Maximum allowed batch size is ${MAX_IMPORT_ROWS} rows.`);
          return;
        }

        const headers = results.meta.fields || [];
        setRawHeaders(headers);
        setRawRows(results.data as Record<string, string>[]);

        // Auto-detect and suggest column mappings
        const detectedMappings: ColumnMapping[] = headers.map((header) => {
          const lower = header.toLowerCase();
          let targetField: ColumnMapping['targetField'] = 'ignore';

          if (lower.includes('name') || lower.includes('candidate') || lower.includes('client')) {
            targetField = 'name';
          } else if (lower.includes('phone') || lower.includes('mobile') || lower.includes('cell') || lower.includes('contact')) {
            targetField = 'phone';
          } else if (lower.includes('email') || lower.includes('mail')) {
            targetField = 'email';
          } else if (lower.includes('source') || lower.includes('campaign') || lower.includes('channel')) {
            targetField = 'source';
          } else if (lower.includes('priority')) {
            targetField = 'priority';
          } else if (lower.includes('notes') || lower.includes('comment') || lower.includes('requirement')) {
            targetField = 'notes';
          }

          return { csvColumn: header, targetField };
        });

        setMappings(detectedMappings);
        setStep(2);
      },
    });
  };

  // Preload Sample CSV for instant evaluation
  const handleLoadSample = () => {
    const sampleCsv = `full_name,mobile,email,source,priority,requirement
Vikash Singhania,+91 9845012340,vikash.s@example.com,Google Ads,HIGH,MS Computer Science USA Fall
Deepika Padukone,+91 9845012341,deepika.p@example.com,Website,URGENT,MBA INSEAD France
Kiran Bedi,+91 9845012342,kiran.b@example.com,LinkedIn,MEDIUM,Law LLM Oxford
Sunil Gavaskar,12345,bad-email,Meta Ads,LOW,Invalid contact test
Rahul Dravid,+91 9845012340,rahul.d@duplicate.com,Referral,HIGH,Duplicate phone test`;

    Papa.parse(sampleCsv, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setFileName('enterprise_leads_batch_sample.csv');
        const headers = results.meta.fields || [];
        setRawHeaders(headers);
        setRawRows(results.data as Record<string, string>[]);

        const detectedMappings: ColumnMapping[] = headers.map((header) => {
          const lower = header.toLowerCase();
          let targetField: ColumnMapping['targetField'] = 'ignore';
          if (lower.includes('name')) targetField = 'name';
          else if (lower.includes('mobile') || lower.includes('phone')) targetField = 'phone';
          else if (lower.includes('email')) targetField = 'email';
          else if (lower.includes('source')) targetField = 'source';
          else if (lower.includes('priority')) targetField = 'priority';
          else if (lower.includes('requirement')) targetField = 'notes';
          return { csvColumn: header, targetField };
        });

        setMappings(detectedMappings);
        setStep(2);
      },
    });
  };

  // STEP 4 -> 5: Run Validation on Mapped Columns
  const handleValidate = () => {
    const nameCol = mappings.find((m) => m.targetField === 'name')?.csvColumn;
    const phoneCol = mappings.find((m) => m.targetField === 'phone')?.csvColumn;
    const emailCol = mappings.find((m) => m.targetField === 'email')?.csvColumn;
    const sourceCol = mappings.find((m) => m.targetField === 'source')?.csvColumn;
    const priorityCol = mappings.find((m) => m.targetField === 'priority')?.csvColumn;
    const notesCol = mappings.find((m) => m.targetField === 'notes')?.csvColumn;

    const seenPhones = new Set<string>();
    const rows: ParsedLeadRow[] = [];
    let validCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;

    rawRows.forEach((row, index) => {
      const rawName = nameCol ? row[nameCol] : '';
      const rawPhone = phoneCol ? row[phoneCol] : '';
      const rawEmail = emailCol ? row[emailCol] : '';
      const rawSource = sourceCol ? row[sourceCol] : '';
      const rawPriority = priorityCol ? row[priorityCol] : '';
      const rawNotes = notesCol ? row[notesCol] : '';

      const name = sanitizeFormulaInjection(sanitizeText(rawName || ''));
      const phone = sanitizeFormulaInjection(sanitizeText(rawPhone || ''));
      const email = sanitizeFormulaInjection(sanitizeText(rawEmail || ''));
      const source = sanitizeFormulaInjection(sanitizeText(rawSource || 'CSV Import'));
      const notes = sanitizeFormulaInjection(sanitizeText(rawNotes || ''));

      const errors: string[] = [];

      if (!name) errors.push('Name is required');
      if (!phone) errors.push('Phone number is required');

      // Simple phone format check (must have at least 10 digits)
      const digitsOnly = phone.replace(/\D/g, '');
      if (phone && digitsOnly.length < 10) {
        errors.push('Phone must contain at least 10 digits');
      }

      // Check duplicates within batch
      let isDuplicate = false;
      if (digitsOnly) {
        if (seenPhones.has(digitsOnly)) {
          isDuplicate = true;
          errors.push('Duplicate phone in this batch');
        } else {
          seenPhones.add(digitsOnly);
        }
      }

      const isValid = errors.length === 0;

      if (isValid) validCount++;
      else if (isDuplicate) duplicateCount++;
      else invalidCount++;

      rows.push({
        rowIndex: index + 1,
        name,
        phone,
        email: email || undefined,
        source: source || 'Import',
        priority: (['URGENT', 'HIGH', 'MEDIUM', 'LOW'].includes(rawPriority?.toUpperCase())
          ? rawPriority.toUpperCase()
          : 'MEDIUM') as any,
        notes: notes || undefined,
        isValid,
        validationErrors: errors,
      });
    });

    setParsedRows(rows);
    setSummary({
      totalRows: rawRows.length,
      validRows: validCount,
      duplicateRows: duplicateCount,
      invalidRows: invalidCount,
    });

    setStep(3);
  };

  // STEP 7 -> 8: Confirm and Insert into Database
  const handleConfirmImport = async () => {
    if (!profile) return;
    setIsImporting(true);

    try {
      const validLeadsToInsert = parsedRows
        .filter((r) => r.isValid)
        .map((r) => ({
          name: r.name,
          phone: r.phone,
          email: r.email,
          source: r.source,
          priority: r.priority,
          notes: r.notes,
        }));

      const res = db.importLeads(validLeadsToInsert, profile);
      if (res.distribution) {
        setDistributionResult(res.distribution);
      } else {
        setDistributionResult(null);
      }
      setStep(4);
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Wizard Header & Steps Stepper */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-2xl font-bold text-[#0B1F3A] tracking-tight">Import Leads</h1>
        <p className="text-xs text-[#64748B] mt-1 font-medium">
          Upload your CSV or XLSX file. Secure parser with automated duplicate detection & validation.
        </p>

        {/* Stepper */}
        <div className="grid grid-cols-4 gap-2 mt-6">
          {[
            { stepNum: 1, label: 'Upload File' },
            { stepNum: 2, label: 'Map Columns' },
            { stepNum: 3, label: 'Validate & Preview' },
            { stepNum: 4, label: 'Import Done' },
          ].map((item) => (
            <div
              key={item.stepNum}
              className={`p-2.5 rounded-[10px] border text-xs font-semibold flex items-center gap-2 transition-all ${
                step === item.stepNum
                  ? 'bg-[#EAF2FB] border-[#C7DCF3] text-[#0B1F3A]'
                  : step > item.stepNum
                  ? 'bg-white border-[#DCE4EE] text-[#16845B]'
                  : 'bg-[#F6F8FB] border-[#DCE4EE] text-[#94A3B8]'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === item.stepNum
                    ? 'bg-[#0B1F3A] text-white'
                    : step > item.stepNum
                    ? 'bg-[#16845B] text-white'
                    : 'bg-white border border-[#DCE4EE] text-[#94A3B8]'
                }`}
              >
                {step > item.stepNum ? '✓' : item.stepNum}
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: UPLOAD (Section 14) */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="border border-dashed border-[#DCE4EE] hover:border-[#1E4D8F] rounded-[12px] p-12 text-center bg-white shadow-card transition-colors">
            <div className="w-14 h-14 rounded-[12px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F] flex items-center justify-center mx-auto mb-4">
              <ArrowUp className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#0B1F3A] mb-1">
              Drop your file here
            </h3>
            <p className="text-xs text-[#64748B] max-w-sm mx-auto mb-6">
              CSV or XLSX • Max 5 MB
            </p>

            <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] cursor-pointer shadow-subtle transition-all">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Choose File</span>
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* Sample Dataset Preloader */}
          <div className="flex items-center justify-between p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-subtle">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#1E4D8F]" />
              <div>
                <div className="text-xs font-semibold text-[#0B1F3A]">Don't have a CSV right now?</div>
                <div className="text-[11px] text-[#64748B]">Load sample batch with valid, invalid, and duplicate test cases</div>
              </div>
            </div>
            <button
              onClick={handleLoadSample}
              className="px-3.5 py-1.5 bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#0B1F3A] text-xs font-semibold rounded-[8px] border border-[#DCE4EE] transition-colors"
            >
              Load Sample Batch
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: MAP COLUMNS */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-[12px] border border-[#DCE4EE] shadow-subtle">
            <div>
              <span className="text-xs text-[#64748B]">File uploaded:</span>
              <div className="text-sm font-semibold text-[#0B1F3A]">{fileName}</div>
            </div>
            <div className="text-xs text-[#64748B] font-mono">
              {rawRows.length} rows detected
            </div>
          </div>

          <div className="bg-white rounded-[12px] border border-[#DCE4EE] p-5 shadow-card space-y-4">
            <h3 className="text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
              Map CSV Columns to ENCRIX Fields
            </h3>

            <div className="space-y-2">
              {mappings.map((mapping, idx) => (
                <div
                  key={mapping.csvColumn}
                  className="flex items-center justify-between p-3 rounded-[8px] bg-[#F6F8FB] border border-[#DCE4EE] text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[#0B1F3A] font-semibold">{mapping.csvColumn}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8]" />
                  </div>

                  <select
                    value={mapping.targetField}
                    onChange={(e) => {
                      const next = [...mappings];
                      next[idx].targetField = e.target.value as any;
                      setMappings(next);
                    }}
                    className="px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                  >
                    <option value="name">Name (Required)</option>
                    <option value="phone">Phone (Required)</option>
                    <option value="email">Email</option>
                    <option value="source">Source</option>
                    <option value="priority">Priority</option>
                    <option value="notes">Notes / Requirements</option>
                    <option value="ignore">-- Skip this column --</option>
                  </select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[#DCE4EE]">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-xs font-medium text-[#64748B] hover:text-[#0B1F3A]"
              >
                Back
              </button>
              <button
                onClick={handleValidate}
                className="px-5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
              >
                Validate & Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: PREVIEW & STATS (Section 14 Validation Summary) */}
      {step === 3 && (
        <div className="space-y-5">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card">
              <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">Rows detected</span>
              <span className="text-2xl font-bold text-[#0B1F3A]">{summary.totalRows}</span>
            </div>
            <div className="p-4 rounded-[12px] bg-[#EAF7EE] border border-[#C3EBD0]">
              <span className="text-[11px] font-semibold text-[#16845B] uppercase tracking-wider block">Valid leads</span>
              <span className="text-2xl font-bold text-[#16845B]">{summary.validRows}</span>
            </div>
            <div className="p-4 rounded-[12px] bg-[#FEF6E7] border border-[#FBDFA8]">
              <span className="text-[11px] font-semibold text-[#B7791F] uppercase tracking-wider block">Duplicates</span>
              <span className="text-2xl font-bold text-[#B7791F]">{summary.duplicateRows}</span>
            </div>
            <div className="p-4 rounded-[12px] bg-[#FEECEB] border border-[#F8C8C6]">
              <span className="text-[11px] font-semibold text-[#C53030] uppercase tracking-wider block">Invalid records</span>
              <span className="text-2xl font-bold text-[#C53030]">{summary.invalidRows}</span>
            </div>
          </div>

          {/* Preview Table */}
          <div className="rounded-[12px] border border-[#DCE4EE] bg-white shadow-card overflow-hidden">
            <div className="p-4 border-b border-[#DCE4EE] bg-[#F6F8FB] flex items-center justify-between">
              <span className="text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
                Parsed Rows Preview
              </span>
              <span className="text-xs text-[#64748B]">
                Only valid leads will be added to PostgreSQL
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] sticky top-0 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Phone</th>
                    <th className="py-2.5 px-3">Email</th>
                    <th className="py-2.5 px-3">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE4EE]">
                  {parsedRows.map((row, i) => (
                    <tr key={i} className="hover:bg-[#F6F8FB]">
                      <td className="py-2 px-3">
                        {row.isValid ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#16845B] font-medium">
                            <CheckCircle className="w-3.5 h-3.5" /> Valid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#C53030] font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" /> {row.validationErrors[0]}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-[#0B1F3A] font-semibold">{row.name || '—'}</td>
                      <td className="py-2 px-3 text-[#172B4D] font-mono">{row.phone || '—'}</td>
                      <td className="py-2 px-3 text-[#64748B]">{row.email || '—'}</td>
                      <td className="py-2 px-3 text-[#64748B]">{row.source || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs font-semibold text-[#64748B] hover:text-[#0B1F3A]"
            >
              Adjust Mappings
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={isImporting || summary.validRows === 0}
              className="px-6 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
            >
              {isImporting ? 'Ingesting Leads...' : `Confirm & Ingest ${summary.validRows} Leads`}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: RESULT */}
      {step === 4 && (
        <div className="p-8 text-center bg-white border border-[#DCE4EE] rounded-[12px] shadow-card space-y-4">
          <div className="w-14 h-14 rounded-full bg-[#EAF7EE] border border-[#C3EBD0] text-[#16845B] flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-[#0B1F3A]">Import Successfully Completed!</h2>
          <p className="text-xs text-[#64748B] max-w-md mx-auto">
            <strong className="text-[#16845B]">{summary.validRows} leads</strong> have been persisted.
          </p>

          {/* Smart Distribution Result Card */}
          {distributionResult ? (
            <div className="max-w-md mx-auto p-4 rounded-[12px] bg-[#EAF2FB] border border-[#C7DCF3] text-left space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#0B1F3A] flex items-center gap-1.5">
                  <Shuffle className="w-3.5 h-3.5 text-[#1E4D8F]" />
                  Automated Distribution Executed ({distributionResult.mode})
                </span>
                <span className="text-[11px] font-bold text-[#16845B]">
                  {distributionResult.assigned_count} Assigned
                </span>
              </div>
              <p className="text-[11px] text-[#64748B]">
                Leads were automatically distributed across active telecallers according to your organization rules.
              </p>
              {distributionResult.unassigned_count > 0 && (
                <div className="text-[11px] text-[#B7791F] flex items-center gap-1 pt-1 border-t border-[#C7DCF3]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {distributionResult.unassigned_count} leads placed in unassigned queue ({distributionResult.unassigned_reason || 'overflow'}).
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-md mx-auto p-3.5 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE] text-left text-xs text-[#64748B]">
              All leads have been added to the <strong className="text-[#0B1F3A]">Unassigned Queue</strong>. You can distribute them manually or configure automatic rules in Lead Distribution.
            </div>
          )}

          <div className="flex items-center justify-center gap-3 pt-4">
            <button
              onClick={() => navigate('/owner/assignments')}
              className="px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-colors"
            >
              Assign Leads Now
            </button>
            <button
              onClick={() => navigate('/owner/leads')}
              className="px-5 py-2.5 bg-white hover:bg-[#F6F8FB] text-[#0B1F3A] text-xs font-semibold rounded-[10px] border border-[#DCE4EE] shadow-subtle transition-colors"
            >
              View in Leads Table
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
