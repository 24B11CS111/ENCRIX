import React, { useState } from 'react';
import Papa from 'papaparse';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { ColumnMapping, ParsedLeadRow, ImportSummary } from '@/types';
import {
  Upload,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
  Sparkles,
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

    rawRows.forEach((raw) => {
      const rawName = nameCol ? raw[nameCol]?.trim() || '' : '';
      const name = sanitizeFormulaInjection(sanitizeText(rawName));
      const phone = phoneCol ? raw[phoneCol]?.trim() || '' : '';
      const email = emailCol ? raw[emailCol]?.trim() : undefined;
      const rawSource = sourceCol ? raw[sourceCol]?.trim() || 'CSV Import' : 'CSV Import';
      const source = sanitizeFormulaInjection(sanitizeText(rawSource));
      const rawPriority = priorityCol ? (raw[priorityCol]?.trim().toUpperCase() as any) : 'MEDIUM';
      const rawNotes = notesCol ? raw[notesCol]?.trim() : undefined;
      const notes = rawNotes ? sanitizeFormulaInjection(sanitizeText(rawNotes)) : undefined;

      const errors: string[] = [];

      // Check required name
      if (!name || name.length < 2) {
        errors.push('Missing or invalid name');
      }

      // Check phone regex & length
      const cleanPhone = phone.replace(/[\s-()]/g, '');
      if (!phone || cleanPhone.length < 7) {
        errors.push('Invalid phone format');
      }

      // Check duplicates
      let isDuplicate = false;
      if (seenPhones.has(cleanPhone)) {
        isDuplicate = true;
        errors.push('Duplicate phone in batch');
        duplicateCount++;
      } else if (cleanPhone) {
        seenPhones.add(cleanPhone);
      }

      // Check email format if present
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Invalid email address');
      }

      const isValid = errors.length === 0;
      if (isValid) {
        validCount++;
      } else if (!isDuplicate) {
        invalidCount++;
      }

      rows.push({
        name,
        phone,
        email,
        source,
        priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(rawPriority) ? rawPriority : 'MEDIUM',
        notes,
        raw,
        isValid,
        isDuplicate,
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

      db.importLeads(validLeadsToInsert, profile);
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
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">Lead Import Engine</h1>
        <p className="text-xs text-slate-400 mt-1">
          Secure multi-column CSV/XLSX parser with automated duplicate detection & validation.
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
              className={`p-2.5 rounded-lg border text-xs font-medium flex items-center gap-2 transition-all ${
                step === item.stepNum
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                  : step > item.stepNum
                  ? 'bg-slate-900 border-slate-800 text-slate-400'
                  : 'bg-slate-950 border-slate-900 text-slate-600'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === item.stepNum
                    ? 'bg-emerald-500 text-slate-950'
                    : step > item.stepNum
                    ? 'bg-slate-800 text-slate-300'
                    : 'bg-slate-900 text-slate-600'
                }`}
              >
                {step > item.stepNum ? '✓' : item.stepNum}
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: UPLOAD */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-slate-800 hover:border-emerald-500/50 rounded-2xl p-12 text-center bg-slate-950/40 transition-colors">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-4">
              <Upload className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">
              Select or Drop CSV / Excel File
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
              Files are processed in memory and validated against phone and email compliance before persistence.
            </p>

            <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg cursor-pointer shadow-sm transition-all">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Browse CSV File</span>
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* Quick Demo Preloader */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              <div>
                <div className="text-xs font-semibold text-white">Don't have a CSV right now?</div>
                <div className="text-[11px] text-slate-400">Load sample batch with valid, invalid, and duplicate test cases</div>
              </div>
            </div>
            <button
              onClick={handleLoadSample}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
            >
              Load Sample Batch
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: MAP COLUMNS */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
            <div>
              <span className="text-xs text-slate-400">File uploaded:</span>
              <div className="text-sm font-semibold text-white">{fileName}</div>
            </div>
            <div className="text-xs text-slate-400 font-mono">
              {rawRows.length} rows detected
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 space-y-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Map CSV Columns to LeadVault Fields
            </h3>

            <div className="space-y-2">
              {mappings.map((mapping, idx) => (
                <div
                  key={mapping.csvColumn}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-300 font-semibold">{mapping.csvColumn}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                  </div>

                  <select
                    value={mapping.targetField}
                    onChange={(e) => {
                      const next = [...mappings];
                      next[idx].targetField = e.target.value as any;
                      setMappings(next);
                    }}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
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

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                Back
              </button>
              <button
                onClick={handleValidate}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
              >
                Validate & Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: PREVIEW & STATS */}
      {step === 3 && (
        <div className="space-y-5">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Total Rows</span>
              <span className="text-2xl font-bold text-white">{summary.totalRows}</span>
            </div>
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
              <span className="text-[11px] text-emerald-400 block">Valid Leads</span>
              <span className="text-2xl font-bold text-emerald-400">{summary.validRows}</span>
            </div>
            <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30">
              <span className="text-[11px] text-amber-400 block">Duplicates Filtered</span>
              <span className="text-2xl font-bold text-amber-400">{summary.duplicateRows}</span>
            </div>
            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/30">
              <span className="text-[11px] text-rose-400 block">Invalid Rows</span>
              <span className="text-2xl font-bold text-rose-400">{summary.invalidRows}</span>
            </div>
          </div>

          {/* Preview Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Parsed Rows Preview
              </span>
              <span className="text-xs text-slate-400">
                Only valid leads will be added to PostgreSQL
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Phone</th>
                    <th className="py-2.5 px-3">Email</th>
                    <th className="py-2.5 px-3">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {parsedRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3">
                        {row.isValid ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                            <CheckCircle className="w-3.5 h-3.5" /> Valid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" /> {row.validationErrors[0]}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-200 font-medium">{row.name || '—'}</td>
                      <td className="py-2 px-3 text-slate-300 font-mono">{row.phone || '—'}</td>
                      <td className="py-2 px-3 text-slate-400">{row.email || '—'}</td>
                      <td className="py-2 px-3 text-slate-400">{row.source || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white"
            >
              Adjust Mappings
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={isImporting || summary.validRows === 0}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              {isImporting ? 'Ingesting Leads...' : `Confirm & Ingest ${summary.validRows} Leads`}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: RESULT */}
      {step === 4 && (
        <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white">Import Successfully Completed!</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            <strong className="text-emerald-400">{summary.validRows} leads</strong> have been persisted with status{' '}
            <span className="font-mono text-white">NEW</span>. You can now distribute them via round-robin or assign them directly to telecallers.
          </p>

          <div className="flex items-center justify-center gap-3 pt-4">
            <button
              onClick={() => navigate('/owner/assignments')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Assign Leads Now
            </button>
            <button
              onClick={() => navigate('/owner/leads')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
            >
              View in Lead Vault
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
