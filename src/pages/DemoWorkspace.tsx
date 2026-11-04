import React, { useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, Bell, CalendarClock, Check, ChevronDown, CircleHelp,
  ClipboardList, Clock3, LayoutDashboard, Plus, Search, ShieldCheck, Sparkles,
  Users, UserRoundCheck, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

type DemoStatus = 'New' | 'Contacted' | 'Interested' | 'Follow-up' | 'Converted' | 'Not interested';
type Section = 'Overview' | 'Leads' | 'Follow-ups' | 'Team' | 'Activity';
type DemoLead = {
  id: string; name: string; email: string; source: string; status: DemoStatus;
  assignedTo: string; created: string; note: string; lastTouch: string;
};
type DemoFollowUp = { id: string; leadId: string; due: string; owner: string; status: 'Pending' | 'Completed' };
type DemoEvent = { id: string; text: string; when: string };

const PEOPLE = [
  { id: 'tc-1', name: 'Asha Rao', initials: 'AR', color: 'bg-violet-100 text-violet-700', workload: 18, calls: 32, conversions: 5 },
  { id: 'tc-2', name: 'Kabir Shah', initials: 'KS', color: 'bg-sky-100 text-sky-700', workload: 15, calls: 28, conversions: 4 },
  { id: 'tc-3', name: 'Mira Das', initials: 'MD', color: 'bg-amber-100 text-amber-700', workload: 12, calls: 24, conversions: 3 },
];
const INITIAL_LEADS: DemoLead[] = [
  { id: 'EN-2048', name: 'Anika Sharma', email: 'anika.01@example.test', source: 'Website', status: 'Interested', assignedTo: 'tc-1', created: 'Today, 9:20 AM', note: 'Interested in the August intake.', lastTouch: 'Today, 10:05 AM' },
  { id: 'EN-2047', name: 'Dev Patel', email: 'dev.02@example.test', source: 'Referral', status: 'Follow-up', assignedTo: 'tc-2', created: 'Today, 8:45 AM', note: 'Asked for a course comparison.', lastTouch: 'Today, 9:12 AM' },
  { id: 'EN-2046', name: 'Ira Menon', email: 'ira.03@example.test', source: 'Campaign', status: 'Contacted', assignedTo: 'tc-3', created: 'Yesterday', note: 'Prefers a call after 4 PM.', lastTouch: 'Yesterday, 4:18 PM' },
  { id: 'EN-2045', name: 'Neil Kapoor', email: 'neil.04@example.test', source: 'Website', status: 'New', assignedTo: '', created: 'Yesterday', note: '', lastTouch: 'Not contacted' },
  { id: 'EN-2044', name: 'Tara Iyer', email: 'tara.05@example.test', source: 'Walk-in', status: 'Converted', assignedTo: 'tc-1', created: 'Mon, 11:30 AM', note: 'Converted in this sample workspace.', lastTouch: 'Mon, 2:40 PM' },
  { id: 'EN-2043', name: 'Rohan Bose', email: 'rohan.06@example.test', source: 'Referral', status: 'New', assignedTo: 'tc-2', created: 'Mon, 10:15 AM', note: '', lastTouch: 'Not contacted' },
];
const INITIAL_FOLLOWUPS: DemoFollowUp[] = [
  { id: 'fu-1', leadId: 'EN-2047', due: '2026-11-06T11:30', owner: 'tc-2', status: 'Pending' },
  { id: 'fu-2', leadId: 'EN-2046', due: '2026-11-06T15:00', owner: 'tc-3', status: 'Pending' },
  { id: 'fu-3', leadId: 'EN-2048', due: '2026-11-07T10:00', owner: 'tc-1', status: 'Pending' },
];
const INITIAL_EVENTS: DemoEvent[] = [
  { id: 'ev-1', text: 'Asha marked Anika Sharma as interested', when: '10:05 AM' },
  { id: 'ev-2', text: 'Kabir scheduled a follow-up with Dev Patel', when: '9:12 AM' },
  { id: 'ev-3', text: 'Ira Menon was assigned to Mira Das', when: 'Yesterday' },
];
const STATUSES: DemoStatus[] = ['New', 'Contacted', 'Interested', 'Follow-up', 'Converted', 'Not interested'];

function statusStyle(status: DemoStatus) {
  if (status === 'Converted') return 'bg-emerald-50 text-emerald-700';
  if (status === 'Interested') return 'bg-violet-50 text-violet-700';
  if (status === 'Follow-up') return 'bg-amber-50 text-amber-700';
  if (status === 'Contacted') return 'bg-sky-50 text-sky-700';
  if (status === 'Not interested') return 'bg-slate-100 text-slate-600';
  return 'bg-blue-50 text-blue-700';
}

export const DemoWorkspace: React.FC = () => {
  const [section, setSection] = useState<Section>('Overview');
  const [leads, setLeads] = useState(INITIAL_LEADS);
  const [nextLeadNumber, setNextLeadNumber] = useState(2049);
  const [followUps, setFollowUps] = useState(INITIAL_FOLLOWUPS);
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [editingLead, setEditingLead] = useState<DemoLead | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DemoLead | null>(null);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadSource, setLeadSource] = useState('Website');
  const [followLead, setFollowLead] = useState('');
  const [followDue, setFollowDue] = useState('');
  const [notice, setNotice] = useState('');

  const filteredLeads = useMemo(() => leads.filter((lead) => {
    const matchesText = `${lead.name} ${lead.id} ${lead.email} ${lead.source}`.toLowerCase().includes(query.toLowerCase());
    return matchesText && (filter === 'All statuses' || lead.status === filter);
  }), [leads, query, filter]);
  const pendingCount = followUps.filter((followUp) => followUp.status === 'Pending').length;
  const convertedCount = leads.filter((lead) => lead.status === 'Converted').length;
  const contactedCount = leads.filter((lead) => !['New'].includes(lead.status)).length;

  const addEvent = (text: string) => setEvents((current) => [{ id: crypto.randomUUID(), text, when: 'Just now' }, ...current]);
  const updateLead = (id: string, patch: Partial<DemoLead>) => setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, ...patch } : lead));
  const addLead = (event: React.FormEvent) => {
    event.preventDefault();
    const name = leadName.trim();
    if (!name) return;
    const id = `EN-${nextLeadNumber}`;
    setNextLeadNumber((current) => current + 1);
    setLeads((current) => [{ id, name, email: leadEmail.trim() || 'not-provided@example.test', source: leadSource, status: 'New', assignedTo: '', created: 'Just now', note: '', lastTouch: 'Not contacted' }, ...current]);
    addEvent(`New sample lead ${name} was created`);
    setLeadName(''); setLeadEmail(''); setShowLeadForm(false); setSection('Leads'); setNotice('Sample lead created in this demo session.');
  };
  const beginEdit = (lead: DemoLead) => { setEditingLead(lead); setEditName(lead.name); setEditNote(lead.note); };
  const saveEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingLead || !editName.trim()) return;
    updateLead(editingLead.id, { name: editName.trim(), note: editNote.trim() });
    addEvent(`Sample lead ${editingLead.id} was updated`);
    setNotice('Lead details updated in this demo session.'); setEditingLead(null);
  };
  const deleteLead = () => {
    if (!deleteCandidate) return;
    const removed = deleteCandidate;
    setLeads((current) => current.filter((lead) => lead.id !== removed.id));
    setFollowUps((current) => current.filter((followUp) => followUp.leadId !== removed.id));
    addEvent(`Sample lead ${removed.name} was removed`);
    setDeleteCandidate(null); setNotice(`${removed.name} removed from this demo session.`);
  };
  const assignLead = (lead: DemoLead, assignee: string) => {
    const person = PEOPLE.find((member) => member.id === assignee);
    updateLead(lead.id, { assignedTo: assignee });
    if (person) { addEvent(`${lead.name} was assigned to ${person.name}`); setNotice(`Sample assignment updated for ${lead.name}.`); }
  };
  const recordInteraction = (lead: DemoLead) => {
    updateLead(lead.id, { status: lead.status === 'New' ? 'Contacted' : lead.status, lastTouch: 'Just now' });
    addEvent(`Sample interaction recorded for ${lead.name}`);
    setNotice(`Sample interaction recorded for ${lead.name}; no call was placed.`);
  };
  const scheduleFollowUp = (event: React.FormEvent) => {
    event.preventDefault();
    const lead = leads.find((item) => item.id === followLead);
    if (!lead || !followDue) return;
    setFollowUps((current) => [{ id: crypto.randomUUID(), leadId: lead.id, due: followDue, owner: lead.assignedTo || 'tc-1', status: 'Pending' }, ...current]);
    updateLead(lead.id, { status: 'Follow-up' });
    addEvent(`A sample follow-up was scheduled for ${lead.name}`);
    setFollowLead(''); setFollowDue(''); setNotice(`Sample follow-up scheduled for ${lead.name}.`);
  };
  const completeFollowUp = (item: DemoFollowUp) => {
    setFollowUps((current) => current.map((followUp) => followUp.id === item.id ? { ...followUp, status: 'Completed' } : followUp));
    const lead = leads.find((entry) => entry.id === item.leadId);
    addEvent(`Sample follow-up completed${lead ? ` for ${lead.name}` : ''}`);
    setNotice('Follow-up marked complete in this demo session.');
  };

  const nav: { label: Section; icon: React.ElementType }[] = [
    { label: 'Overview', icon: LayoutDashboard }, { label: 'Leads', icon: ClipboardList },
    { label: 'Follow-ups', icon: CalendarClock }, { label: 'Team', icon: Users }, { label: 'Activity', icon: Activity },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-900 sm:text-sm">
        DEMO MODE <span className="font-normal">· Synthetic sample workspace · Changes reset when you leave · No live calls, emails, payments, or customer records</span>
      </div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0B1F3A] font-bold text-white">E</div>
            <div><div className="font-bold tracking-tight text-[#0B1F3A]">ENCRIX <span className="font-normal text-slate-400">/ Demo workspace</span></div><div className="text-xs text-slate-500">Northstar Learning · Owner preview</div></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 sm:inline-flex">Synthetic data only</span>
            <Link to="/" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"><ArrowLeft size={15} /> Exit demo</Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-8">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 px-3 pt-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Workspace</div>
          <nav aria-label="Demo navigation" className="flex gap-1 overflow-x-auto lg:flex-col">
            {nav.map(({ label, icon: Icon }) => <button key={label} onClick={() => setSection(label)} aria-current={section === label ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${section === label ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={17} />{label}</button>)}
          </nav>
          <div className="mt-5 hidden rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 lg:block"><ShieldCheck size={17} className="mb-2 text-emerald-700" /><strong className="block text-slate-800">Sandbox boundary</strong>This preview uses in-memory sample state. It does not authenticate to an organization or write to a backend.</div>
        </aside>

        <main className="min-w-0">
          {notice && <div role="status" className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button></div>}
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800"><Sparkles size={14} /> INTERACTIVE PRODUCT PREVIEW</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{section === 'Overview' ? 'Good morning, Vikram' : section}</h1><p className="mt-1 text-sm text-slate-500">Explore a working CRM flow with fictional sample data.</p></div>
            <button onClick={() => { setShowLeadForm((value) => !value); setSection('Leads'); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#15345b]"><Plus size={17} /> Add sample lead</button>
          </div>

          {showLeadForm && <form onSubmit={addLead} className="mb-5 grid gap-3 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm sm:grid-cols-4" aria-label="Create sample lead"><label className="text-xs font-semibold text-slate-600">Name<input required value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Sample lead name" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-slate-600">Email (optional)<input type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} placeholder="name@example.test" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-slate-600">Source<select value={leadSource} onChange={(e) => setLeadSource(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>Website</option><option>Referral</option><option>Campaign</option><option>Walk-in</option></select></label><div className="flex items-end gap-2"><button className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white">Create</button><button type="button" onClick={() => setShowLeadForm(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button></div></form>}
          {editingLead && <form onSubmit={saveEdit} aria-label="Edit sample lead" className="mb-5 grid gap-3 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_2fr_auto]"><label className="text-xs font-semibold text-slate-600">Lead name<input required value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-slate-600">Notes<textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} /></label><div className="flex items-end gap-2"><button className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white">Save changes</button><button type="button" onClick={() => setEditingLead(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button></div></form>}
          {deleteCandidate && <div role="alertdialog" aria-labelledby="delete-demo-lead-title" className="mb-5 flex flex-col justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center"><div><h2 id="delete-demo-lead-title" className="text-sm font-bold text-rose-900">Remove {deleteCandidate.name} from this demo?</h2><p className="text-xs text-rose-800">Its sample follow-ups will also be removed. This affects only this browser session.</p></div><div className="flex gap-2"><button onClick={deleteLead} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white">Remove sample lead</button><button onClick={() => setDeleteCandidate(null)} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-900">Keep lead</button></div></div>}

          {section === 'Overview' && <>
            <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[
              ['Total leads', leads.length, `${leads.filter((lead) => lead.status === 'New').length} new`], ['Contacted', contactedCount, 'Across the sample team'], ['Converted', convertedCount, `${leads.length ? Math.round(convertedCount / leads.length * 100) : 0}% sample conversion`], ['Pending follow-ups', pendingCount, 'Next due tomorrow'],
            ].map(([label, value, detail]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold text-slate-900">{value}</div><div className="mt-1 text-xs text-slate-500">{detail}</div></div>)}</div>
            <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Team activity</h2><p className="text-xs text-slate-500">Sample calls and conversions this week</p></div><span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">This week</span></div><div className="flex h-40 items-end justify-around gap-3 border-b border-slate-100 px-3">{[42, 68, 52, 85, 61, 92, 72].map((height, index) => <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><div title={`${height} sample calls`} className="w-full max-w-9 rounded-t-md bg-blue-200 hover:bg-blue-400" style={{ height: `${height}%` }} /><span className="pb-2 text-[10px] text-slate-400">{['M','T','W','T','F','S','S'][index]}</span></div>)}</div><div className="mt-3 text-[11px] text-slate-400">Illustrative sample activity · not live analytics</div></section>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Recent activity</h2><p className="text-xs text-slate-500">Updates in this demo session</p></div><Activity size={18} className="text-slate-400" /></div><div className="space-y-4">{events.slice(0, 4).map((event) => <div key={event.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" /><div className="min-w-0 flex-1"><p className="text-sm text-slate-700">{event.text}</p><p className="mt-0.5 text-xs text-slate-400">{event.when}</p></div></div>)}</div><div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold text-slate-600"><Bell size={14} className="mr-1 inline" />Sample notifications</div><ul className="space-y-1 text-xs text-slate-500"><li>• Follow-up due tomorrow for Dev Patel</li><li>• Neil Kapoor is unassigned</li><li>• Anika Sharma status changed to Interested</li></ul></div></section>
            </div>
              <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Recent leads</h2><p className="text-xs text-slate-500">Make a sample update from the lead list.</p></div><button onClick={() => setSection('Leads')} className="text-xs font-semibold text-blue-800">View all leads →</button></div><LeadTable leads={leads.slice(0, 4)} onAssign={assignLead} onStatus={(lead, status) => { updateLead(lead.id, { status }); addEvent(`${lead.name} status changed to ${status}`); }} onInteract={recordInteraction} onEdit={beginEdit} onDelete={setDeleteCandidate} /></section>
          </>}

          {section === 'Leads' && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="mb-4 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input aria-label="Search demo leads" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, lead ID, email or source" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></label><select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>All statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></div><LeadTable leads={filteredLeads} onAssign={assignLead} onStatus={(lead, status) => { updateLead(lead.id, { status }); addEvent(`${lead.name} status changed to ${status}`); setNotice(`${lead.name} updated in the demo.`); }} onInteract={recordInteraction} onEdit={beginEdit} onDelete={setDeleteCandidate} /></section>}

          {section === 'Follow-ups' && <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]"><form onSubmit={scheduleFollowUp} className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Schedule a sample follow-up</h2><p className="mb-4 mt-1 text-xs text-slate-500">This creates an in-memory demo reminder. No email or notification is sent.</p><label className="mb-3 block text-xs font-semibold text-slate-600">Lead<select required value={followLead} onChange={(e) => setFollowLead(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Choose a lead</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label><label className="mb-4 block text-xs font-semibold text-slate-600">Date and time<input required type="datetime-local" value={followDue} onChange={(e) => setFollowDue(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><button className="w-full rounded-lg bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white">Schedule follow-up</button></form><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Follow-up queue <span className="ml-1 text-sm font-normal text-slate-400">{pendingCount} pending</span></h2><div className="mt-4 space-y-2">{followUps.map((item) => { const lead = leads.find((entry) => entry.id === item.leadId); const owner = PEOPLE.find((person) => person.id === item.owner); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><div className="text-sm font-semibold text-slate-800">{lead?.name ?? 'Sample lead'}</div><div className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 size={13} />{new Date(item.due).toLocaleString()} · {owner?.name ?? 'Team member'}</div></div>{item.status === 'Pending' ? <button onClick={() => completeFollowUp(item)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"><Check size={14} /> Mark complete</button> : <span className="text-xs font-semibold text-emerald-700">Completed</span>}</div>; })}</div></section></div>}

          {section === 'Team' && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="mb-4"><h2 className="font-bold text-slate-900">Your sample team</h2><p className="text-xs text-slate-500">Illustrative roles and performance · invitations are disabled in the public demo.</p></div><div className="grid gap-3 md:grid-cols-3">{PEOPLE.map((person) => <div key={person.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${person.color}`}>{person.initials}</span><div><div className="font-semibold text-slate-900">{person.name}</div><div className="text-xs text-slate-500">Telecaller · Sample account</div></div></div><div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center"><div><div className="font-bold">{person.workload}</div><div className="text-[10px] text-slate-500">Assigned</div></div><div><div className="font-bold">{person.calls}</div><div className="text-[10px] text-slate-500">Calls*</div></div><div><div className="font-bold">{person.conversions}</div><div className="text-[10px] text-slate-500">Converted*</div></div></div></div>)}</div><p className="mt-3 text-[11px] text-slate-400">*Illustrative sample figures, not real performance data.</p><button disabled title="Team invitations require a verified live subscription and organization setup" className="mt-4 cursor-not-allowed rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400"><UserRoundCheck size={14} className="mr-1 inline" />Live invitations unavailable in demo</button></section>}

          {section === 'Activity' && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Demo activity timeline</h2><p className="mb-5 mt-1 text-xs text-slate-500">Only actions made during this browser session appear here.</p><div className="space-y-5">{events.map((event) => <div key={event.id} className="flex gap-3"><span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-800"><Activity size={14} /></span><div><div className="text-sm text-slate-700">{event.text}</div><div className="mt-1 text-xs text-slate-400">{event.when} · Demo activity</div></div></div>)}</div></section>}

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500"><CircleHelp size={16} className="mt-0.5 shrink-0 text-slate-400" /><p><strong className="text-slate-700">Live vs demo:</strong> Lead, assignment, follow-up, status and activity interactions here are simulated in browser memory. Live CRM writes require an authenticated organization and verified backend prerequisites. This demo never submits data to ENCRIX servers.</p></div>
        </main>
      </div>
    </div>
  );
};

const LeadTable: React.FC<{
  leads: DemoLead[];
  onAssign: (lead: DemoLead, assignee: string) => void;
  onStatus: (lead: DemoLead, status: DemoStatus) => void;
  onInteract: (lead: DemoLead) => void;
  onEdit: (lead: DemoLead) => void;
  onDelete: (lead: DemoLead) => void;
}> = ({ leads, onAssign, onStatus, onInteract, onEdit, onDelete }) => <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400"><th className="pb-3 pr-4 font-semibold">Lead</th><th className="pb-3 pr-4 font-semibold">Status</th><th className="pb-3 pr-4 font-semibold">Assigned to</th><th className="pb-3 pr-4 font-semibold">Last interaction</th><th className="pb-3 font-semibold">Demo actions</th></tr></thead><tbody className="divide-y divide-slate-100">{leads.map((lead) => <tr key={lead.id}><td className="py-3 pr-4"><div className="font-semibold text-slate-800">{lead.name}</div><div className="text-xs text-slate-500">{lead.email}</div><div className="text-xs text-slate-400">{lead.id} · {lead.source}{lead.note ? ` · ${lead.note}` : ''}</div></td><td className="py-3 pr-4"><select aria-label={`Status for ${lead.name}`} value={lead.status} onChange={(e) => onStatus(lead, e.target.value as DemoStatus)} className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold ${statusStyle(lead.status)}`}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></td><td className="py-3 pr-4"><select aria-label={`Assign ${lead.name}`} value={lead.assignedTo} onChange={(e) => onAssign(lead, e.target.value)} className="max-w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"><option value="">Unassigned</option>{PEOPLE.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></td><td className="py-3 pr-4 text-xs text-slate-500">{lead.lastTouch}</td><td className="py-3"><div className="flex items-center gap-1.5"><button onClick={() => onInteract(lead)} className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ChevronDown size={13} className="mr-1 inline" />Record sample interaction</button><button onClick={() => onEdit(lead)} aria-label={`Edit ${lead.name}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700">Edit</button><button onClick={() => onDelete(lead)} aria-label={`Delete ${lead.name}`} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700">Delete</button></div></td></tr>)}{leads.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-500">No sample leads match. Try a different search or filter.</td></tr>}</tbody></table></div>;

