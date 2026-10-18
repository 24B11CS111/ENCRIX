import {
  Organization,
  Profile,
  Lead,
  Call,
  CallOutcome,
  FollowUp,
  Notification,
  ActivityLog,
  SecurityEvent,
} from '@/types';

export const DEMO_ORGS: Organization[] = [
  {
    id: 'org-vertex-001',
    name: 'Vertex Consultancy',
    slug: 'vertex-consultancy',
    owner_id: 'user-owner-001',
    industry: 'Education & Study Abroad',
    company_size: '11-50',
    logo_url: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=128&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'org-prime-002',
    name: 'Prime Careers',
    slug: 'prime-careers',
    owner_id: 'user-owner-002',
    industry: 'Recruitment & Staffing',
    company_size: '51-200',
    logo_url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=128&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_PROFILES: Profile[] = [
  // Admin
  {
    id: 'prof-admin-000',
    user_id: 'user-admin-000',
    organization_id: 'org-vertex-001',
    full_name: 'LeadVault Platform Admin',
    email: 'admin@encrix.io',
    email_verified: true,
    phone: '+1 800 555 0199',
    phone_verified: true,
    role: 'ADMIN',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 100 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  // Vertex Owner
  {
    id: 'prof-owner-001',
    user_id: 'user-owner-001',
    organization_id: 'org-vertex-001',
    full_name: 'Vikram Malhotra',
    email: 'vikram@vertex.com',
    email_verified: true,
    phone: '+91 98200 12345',
    phone_verified: true,
    role: 'OWNER',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  // Prime Careers Owner
  {
    id: 'prof-owner-002',
    user_id: 'user-owner-002',
    organization_id: 'org-prime-002',
    full_name: 'Rohan Verma',
    email: 'rohan@prime.com',
    email_verified: true,
    phone: '+91 98450 98765',
    phone_verified: true,
    role: 'OWNER',
    avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  // Vertex Telecallers
  {
    id: 'tc-arjun-01',
    user_id: 'user-tc-01',
    organization_id: 'org-vertex-001',
    full_name: 'Arjun Kumar',
    email: 'arjun@vertex.com',
    email_verified: true,
    phone: '+91 98111 22334',
    phone_verified: true,
    role: 'TELECALLER',
    avatar_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 45 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 24,
    calls_today: 18,
    positive_count: 6,
    conversion_rate: 28,
  },
  {
    id: 'tc-rahul-02',
    user_id: 'user-tc-02',
    organization_id: 'org-vertex-001',
    full_name: 'Rahul Sharma',
    email: 'rahul@vertex.com',
    email_verified: true,
    phone: '+91 98222 33445',
    phone_verified: true,
    role: 'TELECALLER',
    avatar_url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 22,
    calls_today: 15,
    positive_count: 5,
    conversion_rate: 26,
  },
  {
    id: 'tc-priya-03',
    user_id: 'user-tc-03',
    organization_id: 'org-vertex-001',
    full_name: 'Priya Reddy',
    email: 'priya@vertex.com',
    email_verified: true,
    phone: '+91 98333 44556',
    phone_verified: true,
    role: 'TELECALLER',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 25,
    calls_today: 22,
    positive_count: 8,
    conversion_rate: 34,
  },
  {
    id: 'tc-sai-04',
    user_id: 'user-tc-04',
    organization_id: 'org-vertex-001',
    full_name: 'Sai Teja',
    email: 'sai@vertex.com',
    email_verified: true,
    phone: '+91 98444 55667',
    phone_verified: true,
    role: 'TELECALLER',
    avatar_url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 20,
    calls_today: 12,
    positive_count: 3,
    conversion_rate: 21,
  },
  {
    id: 'tc-neha-05',
    user_id: 'user-tc-05',
    organization_id: 'org-vertex-001',
    full_name: 'Neha Singh',
    email: 'neha@vertex.com',
    email_verified: true,
    phone: '+91 98555 66778',
    phone_verified: true,
    role: 'TELECALLER',
    avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 19,
    calls_today: 14,
    positive_count: 4,
    conversion_rate: 25,
  },
];

// Helper to generate 110 demo leads for Vertex Consultancy
export function generateDemoLeads(): Lead[] {
  const firstNames = [
    'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
    'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Advaith', 'Aaryan', 'Dhruv', 'Kabir', 'Rudra', 'Ananya',
    'Diya', 'Aadhya', 'Saanvi', 'Myra', 'Gauri', 'Sara', 'Ira', 'Avani', 'Aditi', 'Prisha',
    'Riya', 'Aarohi', 'Kiara', 'Kavya', 'Meera', 'Sneha', 'Tanvi', 'Anushka', 'Ishita', 'Pooja',
    'Rohan', 'Kunal', 'Manish', 'Suresh', 'Karan', 'Deepak', 'Naveen', 'Siddharth', 'Gaurav', 'Tarun'
  ];

  const lastNames = [
    'Sharma', 'Verma', 'Gupta', 'Mehta', 'Patel', 'Reddy', 'Rao', 'Nair', 'Kumar', 'Singh',
    'Chauhan', 'Iyer', 'Deshmukh', 'Joshi', 'Bhat', 'Banerjee', 'Chatterjee', 'Das', 'Sen', 'Pillai',
    'Menon', 'Bose', 'Kapoor', 'Bhardwaj', 'Dubey', 'Tiwari', 'Pandey', 'Saxena', 'Mishra', 'Yadav'
  ];

  const sources = ['Google Ads', 'Website Inquiry', 'Meta Ads', 'LinkedIn', 'Referral', 'Walk-in', 'Webinar'];
  const priorities: ('LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  const statuses: Lead['status'][] = [
    'NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'CONVERTED', 'NOT_INTERESTED', 'INVALID'
  ];

  const telecallerIds = ['tc-arjun-01', 'tc-rahul-02', 'tc-priya-03', 'tc-sai-04', 'tc-neha-05'];

  const leads: Lead[] = [];

  // Lead 1 explicitly matching prompt example LV-10294
  leads.push({
    id: 'lead-lv-10294',
    organization_id: 'org-vertex-001',
    lead_code: 'LV-10294',
    name: 'Rahul Kumar',
    phone: '+91 9876543210',
    email: 'rahul.kumar@example.com',
    source: 'Website',
    status: 'ASSIGNED',
    priority: 'HIGH',
    assigned_to: 'tc-arjun-01',
    notes: 'Interested in Master of Data Science program in Germany. English taught programs only.',
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    last_contacted_at: new Date(Date.now() - 3600000).toISOString(),
    calls_count: 2,
    father_name: 'Suresh Kumar',
    mother_name: 'Sunita Kumar',
    neet_score: 585,
    neet_rank: 14500,
    neet_year: 2025,
    neet_attempts: 1,
    eamcet_score: 112,
    eamcet_rank: 4820,
    eamcet_year: 2025,
    eamcet_attempts: 1,
    ipe_marks: 965,
    ipe_percentage: 96.5,
    ipe_year: 2024,
    ipe_attempts: 1,
    category: 'General',
    gender: 'Male',
    city: 'Hyderabad',
    state: 'Telangana',
    school_or_college: 'Sri Chaitanya Junior College',
    course_interest: 'MBBS / BDS',
  });

  // Lead 2 explicitly matching prompt example LV-10291
  leads.push({
    id: 'lead-lv-10291',
    organization_id: 'org-vertex-001',
    lead_code: 'LV-10291',
    name: 'Pooja Verma',
    phone: '+91 9812345678',
    email: 'pooja.v@example.com',
    source: 'Google Ads',
    status: 'INTERESTED',
    priority: 'URGENT',
    assigned_to: 'tc-arjun-01',
    notes: 'Marked positive. Budget confirmed 25-30 LPA. Ready for intake counselling.',
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
    last_contacted_at: new Date(Date.now() - 7200000).toISOString(),
    calls_count: 3,
    father_name: 'Rajesh Verma',
    mother_name: null, // Explicit null to verify "Not provided" handling
    neet_score: null, // Missing NEET to verify "Not provided" handling
    neet_rank: null,
    neet_year: null,
    neet_attempts: null,
    eamcet_score: 128,
    eamcet_rank: 2150,
    eamcet_year: 2025,
    eamcet_attempts: 1,
    ipe_marks: 978,
    ipe_percentage: 97.8,
    ipe_year: 2024,
    ipe_attempts: 1,
    category: 'OBC',
    gender: 'Female',
    city: 'Vijayawada',
    state: 'Andhra Pradesh',
    school_or_college: 'Narayana Junior College',
    course_interest: 'B.Tech CSE',
  });

  // Generate 108 more realistic leads
  for (let i = 3; i <= 110; i++) {
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[(i * 3) % lastNames.length];
    const name = `${fn} ${ln}`;
    const code = `LV-${10200 + i}`;
    const phone = `+91 ${9800000000 + (i * 73931) % 99999999}`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`;
    const source = sources[i % sources.length];
    const priority = priorities[i % priorities.length];
    
    // Distribute statuses realistically
    let status: Lead['status'] = 'NEW';
    let assignedTo: string | null = null;

    if (i % 6 === 0) {
      status = 'NEW'; // Unassigned
      assignedTo = null;
    } else {
      assignedTo = telecallerIds[i % telecallerIds.length];
      if (i % 5 === 0) status = 'INTERESTED';
      else if (i % 7 === 0) status = 'CONVERTED';
      else if (i % 4 === 0) status = 'FOLLOW_UP';
      else if (i % 8 === 0) status = 'NOT_INTERESTED';
      else if (i % 9 === 0) status = 'CONTACTED';
      else status = 'ASSIGNED';
    }

    leads.push({
      id: `lead-gen-${i}`,
      organization_id: 'org-vertex-001',
      lead_code: code,
      name,
      phone,
      email,
      source,
      status,
      priority,
      assigned_to: assignedTo,
      notes: `Lead generated via ${source}. Candidate interested in university admission consulting.`,
      created_at: new Date(Date.now() - (i % 30) * 86400000 - i * 180000).toISOString(),
      updated_at: new Date(Date.now() - (i % 5) * 3600000).toISOString(),
      last_contacted_at: assignedTo ? new Date(Date.now() - (i % 48) * 3600000).toISOString() : null,
      calls_count: assignedTo ? (i % 4) + 1 : 0,
      father_name: `${firstNames[(i + 7) % firstNames.length]} ${ln}`,
      mother_name: i % 4 === 0 ? null : `${firstNames[(i + 13) % firstNames.length]} ${ln}`,
      neet_score: i % 3 === 0 ? null : 420 + (i * 29) % 280,
      neet_rank: i % 3 === 0 ? null : 5000 + (i * 731) % 40000,
      neet_year: i % 3 === 0 ? null : 2025 - (i % 2),
      neet_attempts: i % 3 === 0 ? null : 1 + (i % 2),
      eamcet_score: i % 2 === 0 ? 85 + (i * 17) % 65 : null,
      eamcet_rank: i % 2 === 0 ? 1200 + (i * 812) % 35000 : null,
      eamcet_year: i % 2 === 0 ? 2025 : null,
      eamcet_attempts: i % 2 === 0 ? 1 : null,
      ipe_marks: 820 + (i * 19) % 170,
      ipe_percentage: Number((82 + (i * 1.5) % 17).toFixed(1)),
      ipe_year: 2024,
      ipe_attempts: 1,
      category: ['General', 'OBC', 'SC', 'ST', 'EWS'][i % 5],
      gender: i % 2 === 0 ? 'Female' : 'Male',
      city: ['Hyderabad', 'Vijayawada', 'Visakhapatnam', 'Warangal', 'Guntur', 'Tirupati'][i % 6],
      state: i % 2 === 0 ? 'Telangana' : 'Andhra Pradesh',
      school_or_college: ['Sri Chaitanya', 'Narayana Jr College', 'PAGE Junior College', 'Fiitjee'][i % 4],
      course_interest: ['MBBS', 'B.Tech CSE', 'B.Tech AI/ML', 'BDS', 'B.Sc Data Science'][i % 5],
    });
  }

  // Also add 5 leads for Prime Careers (Organization B) to test cross-tenant isolation
  for (let j = 1; j <= 5; j++) {
    leads.push({
      id: `lead-prime-${j}`,
      organization_id: 'org-prime-002',
      lead_code: `PC-500${j}`,
      name: `Prime Candidate ${j}`,
      phone: `+91 977770000${j}`,
      email: `candidate${j}@primecareers.org`,
      source: 'LinkedIn Recruiter',
      status: 'NEW',
      priority: 'HIGH',
      assigned_to: null,
      notes: 'Tenant B secret candidate data. Vertex Consultancy must NEVER see this.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      calls_count: 0,
    });
  }

  return leads;
}

// Generate 100+ call history records
export function generateDemoCalls(leads: Lead[]): Call[] {
  const calls: Call[] = [];
  const providers: ('MOCK' | 'TWILIO' | 'EXOTEL')[] = ['MOCK', 'TWILIO', 'EXOTEL'];
  const outcomes: CallOutcome['outcome'][] = [
    'POSITIVE', 'NEGATIVE', 'NO_ANSWER', 'BUSY', 'CALL_BACK', 'FOLLOW_UP', 'CONVERTED'
  ];

  const telecallerNames: Record<string, string> = {
    'tc-arjun-01': 'Arjun Kumar',
    'tc-rahul-02': 'Rahul Sharma',
    'tc-priya-03': 'Priya Reddy',
    'tc-sai-04': 'Sai Teja',
    'tc-neha-05': 'Neha Singh',
  };

  const vertexLeads = leads.filter((l) => l.organization_id === 'org-vertex-001' && l.assigned_to);

  for (let i = 0; i < 105; i++) {
    const lead = vertexLeads[i % vertexLeads.length];
    const duration = 35 + (i * 27) % 360;
    const outcome = outcomes[i % outcomes.length];
    const tcId = lead.assigned_to || 'tc-arjun-01';

    calls.push({
      id: `call-rec-${i + 1}`,
      organization_id: 'org-vertex-001',
      lead_id: lead.id,
      lead_code: lead.lead_code,
      lead_name: lead.name,
      telecaller_id: tcId,
      telecaller_name: telecallerNames[tcId] || 'Telecaller',
      provider: providers[i % providers.length],
      provider_call_id: `MOCK_TEL_${90000 + i}`,
      started_at: new Date(Date.now() - (i % 14) * 86400000 - (i % 12) * 3600000).toISOString(),
      ended_at: new Date(Date.now() - (i % 14) * 86400000 - (i % 12) * 3600000 + duration * 1000).toISOString(),
      duration_seconds: duration,
      status: 'COMPLETED',
      recording_url: `https://mock-telephony.leadvault.dev/recordings/call_00${i + 1}.mp3`,
      recording_consent: true,
      outcome,
      notes: `Call completed with duration ${Math.floor(duration / 60)}m ${duration % 60}s. Outcome marked as ${outcome}.`,
      created_at: new Date(Date.now() - (i % 14) * 86400000).toISOString(),
    });
  }

  return calls;
}

export const DEMO_FOLLOWUPS: FollowUp[] = [
  {
    id: 'fup-001',
    organization_id: 'org-vertex-001',
    lead_id: 'lead-lv-10294',
    lead_code: 'LV-10294',
    lead_name: 'Rahul Kumar',
    lead_phone: '+91 9876543210',
    assigned_to: 'tc-arjun-01',
    scheduled_at: new Date(Date.now() + 4 * 3600000).toISOString(), // Today
    status: 'PENDING',
    priority: 'HIGH',
    notes: 'Confirm IELTS score card and discuss tuition deposit dates',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'fup-002',
    organization_id: 'org-vertex-001',
    lead_id: 'lead-lv-10291',
    lead_code: 'LV-10291',
    lead_name: 'Pooja Verma',
    lead_phone: '+91 9812345678',
    assigned_to: 'tc-arjun-01',
    scheduled_at: new Date(Date.now() + 24 * 3600000).toISOString(), // Tomorrow
    status: 'PENDING',
    priority: 'URGENT',
    notes: 'Father will join call to review German blocked account requirements',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'fup-003',
    organization_id: 'org-vertex-001',
    lead_id: 'lead-gen-5',
    lead_code: 'LV-10205',
    lead_name: 'Arjun Reddy',
    lead_phone: '+91 9800045612',
    assigned_to: 'tc-priya-03',
    scheduled_at: new Date(Date.now() - 3 * 3600000).toISOString(), // Overdue
    status: 'PENDING',
    priority: 'MEDIUM',
    notes: 'Follow up on scholarship essay draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'fup-004',
    organization_id: 'org-vertex-001',
    lead_id: 'lead-gen-12',
    lead_code: 'LV-10212',
    lead_name: 'Kavya Iyer',
    lead_phone: '+91 9800099887',
    assigned_to: 'tc-rahul-02',
    scheduled_at: new Date(Date.now() + 48 * 3600000).toISOString(),
    status: 'PENDING',
    priority: 'LOW',
    notes: 'Spring 2027 intake queries',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-001',
    organization_id: 'org-vertex-001',
    user_id: 'tc-arjun-01',
    type: 'LEAD_ASSIGNED',
    title: 'New Leads Assigned',
    message: '12 new qualified leads from Google Ads assigned to your bucket.',
    read: false,
    link: '/telecaller/leads',
    created_at: new Date(Date.now() - 20 * 60000).toISOString(),
  },
  {
    id: 'notif-002',
    organization_id: 'org-vertex-001',
    user_id: 'tc-arjun-01',
    type: 'FOLLOW_UP_DUE',
    title: 'Follow-up Due Today',
    message: 'Follow-up scheduled with Rahul K. (LV-10294) in 4 hours.',
    read: false,
    link: '/telecaller/follow-ups',
    created_at: new Date(Date.now() - 60 * 60000).toISOString(),
  },
  {
    id: 'notif-003',
    organization_id: 'org-vertex-001',
    user_id: 'prof-owner-001',
    type: 'CALL_OUTCOME',
    title: 'Lead Converted',
    message: 'Priya Reddy marked Lead LV-10291 as POSITIVE / CONVERTED ($18k deal).',
    read: false,
    link: '/owner/leads',
    created_at: new Date(Date.now() - 120 * 60000).toISOString(),
  },
  {
    id: 'notif-004',
    organization_id: 'org-vertex-001',
    user_id: 'prof-owner-001',
    type: 'SECURITY_ALERT',
    title: 'Security Alert: Export Blocked',
    message: 'Telecaller TC-05 attempted to export unmasked lead batch. Action blocked & logged.',
    read: false,
    link: '/owner/security',
    created_at: new Date(Date.now() - 180 * 60000).toISOString(),
  },
];

export const DEMO_SECURITY_EVENTS: SecurityEvent[] = [
  {
    id: 'sec-001',
    organization_id: 'org-vertex-001',
    user_id: 'tc-neha-05',
    user_name: 'Neha Singh',
    event_type: 'EXPORT_ATTEMPT_BLOCKED',
    severity: 'HIGH',
    description: 'Blocked unauthorized bulk CSV export request from restricted telecaller endpoint.',
    metadata: { ip: '103.21.244.12', browser: 'Chrome Mobile / Android', attemptedCount: 45 },
    created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: 'sec-002',
    organization_id: 'org-vertex-001',
    user_id: 'tc-rahul-02',
    user_name: 'Rahul Sharma',
    event_type: 'HIGH_VELOCITY_LEAD_VIEW',
    severity: 'MEDIUM',
    description: 'Unusual lead access velocity detected: 32 leads accessed within 2 minutes.',
    metadata: { leadsViewed: 32, windowSeconds: 120 },
    created_at: new Date(Date.now() - 14 * 3600000).toISOString(),
  },
  {
    id: 'sec-003',
    organization_id: 'org-vertex-001',
    event_type: 'MULTIPLE_FAILED_LOGINS',
    severity: 'HIGH',
    description: '5 consecutive failed authentication attempts detected for owner account from unknown subnet.',
    metadata: { ip: '198.51.100.4', attempts: 5, targetEmail: 'owner@vertex.com' },
    created_at: new Date(Date.now() - 28 * 3600000).toISOString(),
  },
  {
    id: 'sec-004',
    organization_id: 'org-vertex-001',
    user_id: 'tc-arjun-01',
    user_name: 'Arjun Kumar',
    event_type: 'SESSION_IP_CHANGE',
    severity: 'LOW',
    description: 'Telecaller active session IP address changed during active shift.',
    metadata: { oldIp: '122.161.45.10', newIp: '122.161.45.89' },
    created_at: new Date(Date.now() - 40 * 3600000).toISOString(),
  },
];

export const DEMO_ACTIVITY_LOGS: ActivityLog[] = [
  {
    id: 'act-001',
    organization_id: 'org-vertex-001',
    user_id: 'tc-arjun-01',
    user_name: 'Arjun Kumar',
    user_role: 'TELECALLER',
    action: 'CALL_COMPLETED',
    entity_type: 'call',
    entity_id: 'call-rec-1',
    metadata: { leadCode: 'LV-10294', duration: '04:12', outcome: 'POSITIVE' },
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
  },
  {
    id: 'act-002',
    organization_id: 'org-vertex-001',
    user_id: 'tc-arjun-01',
    user_name: 'Arjun Kumar',
    user_role: 'TELECALLER',
    action: 'FOLLOWUP_CREATED',
    entity_type: 'follow_up',
    entity_id: 'fup-001',
    metadata: { leadCode: 'LV-10294', scheduledAt: '4 hours later' },
    created_at: new Date(Date.now() - 23 * 60000).toISOString(),
  },
  {
    id: 'act-003',
    organization_id: 'org-vertex-001',
    user_id: 'prof-owner-001',
    user_name: 'Vikram Malhotra',
    user_role: 'OWNER',
    action: 'LEAD_ASSIGNED',
    entity_type: 'lead',
    metadata: { count: 15, algorithm: 'ROUND_ROBIN', assignedTo: 'Active Telecallers' },
    created_at: new Date(Date.now() - 50 * 60000).toISOString(),
  },
  {
    id: 'act-004',
    organization_id: 'org-vertex-001',
    user_id: 'prof-owner-001',
    user_name: 'Vikram Malhotra',
    user_role: 'OWNER',
    action: 'LEAD_CREATED',
    entity_type: 'lead',
    metadata: { count: 48, source: 'CSV_IMPORT', file: 'leads_march_batch.csv' },
    created_at: new Date(Date.now() - 120 * 60000).toISOString(),
  },
  {
    id: 'act-005',
    organization_id: 'org-vertex-001',
    user_id: 'tc-neha-05',
    user_name: 'Neha Singh',
    user_role: 'TELECALLER',
    action: 'EXPORT_ATTEMPT',
    entity_type: 'security',
    metadata: { blocked: true, policy: 'RLS_NO_TELECALLER_EXPORT' },
    created_at: new Date(Date.now() - 180 * 60000).toISOString(),
  },
];
