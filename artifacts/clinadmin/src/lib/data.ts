import { Email, SentEmail, ManualTask, HomePlanItem, WeekDataItem, WeekHistoryItem } from './types';

export const CAT = {
  URGENT: 'Urgent clinical',
  UNSAFE: 'Unsafe to answer by email',
  PROF: 'Professional — high priority',
  REVIEW: 'Needs clinician review',
  MEETING: 'Meeting / event deadline',
  ADMIN: 'Admin only',
  NONE: 'No action required',
  LEGAL: 'Medico-legal',
  LOW: 'Low priority',
  DONE: 'Completed'
} as const;

export const emails: Email[] = [
  {
    id: 1,
    from: 'Sarah Chen (parent)',
    subject: "Mia hasn't eaten/self-harm ideation",
    preview: "I'm very worried about Mia, she hasn't eaten properly for 2 days and...",
    body: "I'm very worried about Mia, she hasn't eaten properly for 2 days and is talking about self-harm again. Please can you advise what we should do?",
    date: 'Today, 08:45',
    risk: 'high',
    cat: CAT.UNSAFE,
    deadline: 1,
    estMin: 15
  },
  {
    id: 2,
    from: 'Dr. Martinez (GP)',
    subject: 'James Okafor urgent clinical',
    preview: "Urgent clinical update regarding James Okafor following his recent...",
    body: "Urgent clinical update regarding James Okafor following his recent crisis assessment. He requires an immediate medication review.",
    date: 'Today, 09:12',
    risk: 'high',
    cat: CAT.URGENT,
    deadline: 2,
    estMin: 20
  },
  {
    id: 3,
    from: 'Dr. K. Osei — Clinical Psychology',
    subject: 'Priya Sharma formulation meeting Thu 2pm',
    preview: "Hi Dr Patterson, are you able to join the formulation meeting for Priya...",
    body: "Hi Dr Patterson, are you able to join the formulation meeting for Priya Sharma this Thursday at 2pm? Your input would be invaluable.",
    date: 'Yesterday',
    risk: 'medium',
    cat: CAT.PROF,
    deadline: 3,
    estMin: 10,
    isProfessional: true
  },
  {
    id: 4,
    from: 'CHYMS Training Team',
    subject: 'CHYMS Annual Conference — registration closes Friday',
    preview: "Final reminder that registration for the annual CHYMS conference closes this Friday...",
    body: "Final reminder that registration for the annual CHYMS conference closes this Friday. Please ensure you have registered if you wish to attend. Early registration secures your CPD certificate.",
    date: 'Yesterday',
    risk: 'medium',
    cat: CAT.MEETING,
    deadline: 3,
    estMin: 5,
    isMeeting: true
  },
  {
    id: 5,
    from: 'Patricia Okafor (parent)',
    subject: 'Ritalin 54mg early script',
    preview: "James is running low on his Ritalin 54mg and we are going away...",
    body: "James is running low on his Ritalin 54mg and we are going away on Friday. Could we please have an early script for his next month's supply?",
    date: '2 days ago',
    risk: 'medium',
    cat: CAT.REVIEW,
    deadline: 3,
    estMin: 12
  },
  {
    id: 6,
    from: 'Mrs. Davies — SENCO',
    subject: 'Lucas Thompson EHCP review 24th May',
    preview: "We are preparing for Lucas Thompson's EHCP review on the 24th May...",
    body: "We are preparing for Lucas Thompson's EHCP review on the 24th May and would appreciate your clinical contribution to his social and emotional needs section.",
    date: '3 days ago',
    risk: 'low',
    cat: CAT.REVIEW,
    deadline: 9,
    estMin: 30
  },
  {
    id: 7,
    from: 'NHS Training Admin',
    subject: 'MCA mandatory training renewal',
    preview: "Our records show your Mental Capacity Act mandatory training...",
    body: "Our records show your Mental Capacity Act mandatory training is due for renewal in 35 days. Please book a slot via the ESR portal.",
    date: '1 week ago',
    risk: 'none',
    cat: CAT.ADMIN,
    deadline: 35,
    estMin: 5
  },
  {
    id: 8,
    from: 'Linda Foster (parent)',
    subject: 'appointment letter query',
    preview: "We received an appointment letter for Tuesday but the time doesn't...",
    body: "We received an appointment letter for Tuesday but the time doesn't work for us as Linda has a school trip. Can we move it to the afternoon?",
    date: '1 week ago',
    risk: 'none',
    cat: CAT.ADMIN,
    deadline: 10,
    estMin: 5
  },
  {
    id: 9,
    from: 'MDT Coordinator',
    subject: 'MDT rescheduled Thu 10am',
    preview: "Please note the MDT meeting on Thursday has been rescheduled...",
    body: "Please note the MDT meeting on Thursday has been rescheduled to 10am. Calendar invites have been updated.",
    date: '2 weeks ago',
    risk: 'none',
    cat: CAT.NONE,
    deadline: null,
    estMin: 2
  }
];

export const sentEmails: SentEmail[] = [
  {
    to: 'Linda Foster (parent)',
    toLabel: 'Parent',
    toName: 'Linda Foster',
    subject: 'appointment clarification',
    body: "Dear Mrs. Foster, thank you for your email. I have asked the admin team to reschedule the appointment for Tuesday afternoon as requested."
  },
  {
    to: 'Dr. K. Osei (colleague)',
    toLabel: 'Colleague',
    toName: 'Dr. K. Osei',
    subject: 'joint formulation Thu 2pm',
    body: "Hi Kwame, yes I'll be there for the 2pm formulation for Priya Sharma. Looking forward to it."
  },
  {
    to: 'Dr. Martinez (GP)',
    toLabel: 'GP',
    toName: 'Dr. Martinez',
    subject: 'James Okafor clinical update',
    body: "Dear Dr. Martinez, regarding James Okafor, I have reviewed the crisis report and will be seeing him for a medication review this week."
  },
  {
    to: 'Mrs. Davies (school/SENCO)',
    toLabel: 'School',
    toName: 'Mrs. Davies',
    subject: 'EHCP contribution',
    body: "Dear Mrs. Davies, please find attached my clinical contribution for Lucas Thompson's EHCP review."
  },
  {
    to: 'NHS Resolution (formal/legal)',
    toLabel: 'Legal',
    toName: 'NHS Resolution',
    subject: 'SAR',
    body: "To whom it may concern, please find the requested documentation regarding the SAR for case ref: 22849."
  },
  {
    to: 'MDT Team (admin)',
    toLabel: 'Admin',
    toName: 'MDT Team',
    subject: 'scheduling',
    body: "Hi team, confirming I can attend the rescheduled MDT on Thursday at 10am."
  }
];

export const manualTasks: ManualTask[] = [
  {
    id: 'm1',
    title: 'ADHD assessment report Zara Ali',
    cat: CAT.REVIEW,
    deadline: 12,
    risk: 'low',
    type: 'Report',
    estMin: 60
  },
  {
    id: 'm2',
    title: 'Phone callback Dr. Osei re case formulation',
    cat: CAT.PROF,
    deadline: 2,
    risk: 'medium',
    type: 'Phone call',
    estMin: 10
  },
  {
    id: 'm3',
    title: 'Sign off discharge letter Thomas Wright',
    cat: CAT.ADMIN,
    deadline: 7,
    risk: 'none',
    type: 'Letter',
    estMin: 10
  },
  {
    id: 'm4',
    title: 'Governance meeting agenda response',
    cat: CAT.MEETING,
    deadline: 5,
    risk: 'none',
    type: 'Meeting',
    estMin: 8
  }
];

export const homePlan: HomePlanItem[] = [
  {
    id: 1,
    title: 'Review Poppy K. high-risk email',
    why: 'Complex patient, unanswered since Thursday.',
    time: '15 min',
    done: false,
    emailId: 1,
    draftTo: 'Sarah Chen (parent)',
    draftSubject: 'Re: Mia — urgent safeguarding response',
    draftReply: `Dear Mrs. Chen,

Thank you for getting in touch. I take what you have shared about Mia very seriously.

Given what you have described, I would strongly advise you to contact our Crisis Team today on 0800 123 4567. If you are concerned for Mia's immediate safety, please call 999 or take her to your nearest A&E.

I am flagging this to our safeguarding lead today and will be in direct contact with you before end of day.

Please do not hesitate to call the CAMHS duty line in the meantime.

Kind regards,
Dr. A. Patterson
CAMHS Consultant, St. Jude's Hospital`
  },
  {
    id: 2,
    title: 'Send/edit 3 urgent clinical drafts',
    why: 'Due today/tomorrow.',
    time: '25 min',
    done: false,
    emailId: 2,
    draftTo: 'Dr. Martinez (GP)',
    draftSubject: 'Re: James Okafor — urgent clinical update',
    draftReply: `Dear Dr. Martinez,

Thank you for this urgent update regarding James Okafor.

I have reviewed the crisis assessment report and agree that an immediate medication review is warranted. I have prioritised James for a review appointment this week and will be in contact with his family directly.

In the interim, if there are further concerns about his safety, please do not hesitate to contact our duty clinician on the CAMHS urgent line.

Kind regards,
Dr. A. Patterson
CAMHS Consultant, St. Jude's Hospital`
  },
  {
    id: 3,
    title: 'Reply to Dr. Osei — Priya Sharma formulation',
    why: 'Clinical colleague — professional response required by Thu.',
    time: '10 min',
    done: false,
    badge: 'professional',
    emailId: 3,
    draftTo: 'Dr. K. Osei — Clinical Psychology',
    draftSubject: 'Re: Priya Sharma formulation meeting Thu 2pm',
    draftReply: `Hi Kwame,

Thanks for the invite — yes, I'll be there for the 2pm formulation for Priya Sharma.

I have reviewed her most recent assessment and will bring my updated clinical summary. Looking forward to the discussion.

Best,
Anna`
  },
  {
    id: 4,
    title: 'Register for CHYMS Annual Conference',
    why: 'Registration closes Friday — CPD opportunity, 3 days left.',
    time: '5 min',
    done: false,
    badge: 'meeting',
    emailId: 4,
    draftTo: 'CHYMS Training Team',
    draftSubject: 'Re: CHYMS Annual Conference — registration',
    draftReply: `Dear CHYMS Training Team,

Please confirm my registration for the CHYMS Annual Conference.

Name: Dr. A. Patterson
Role: CAMHS Consultant
Trust: St. Jude's Hospital

Kind regards,
Dr. A. Patterson`
  },
  {
    id: 5,
    title: 'Review medication side effect response',
    why: 'Parent waiting for advice.',
    time: '10 min',
    done: false,
    emailId: 5,
    draftTo: 'Patricia Okafor (parent)',
    draftSubject: 'Re: Ritalin 54mg early script',
    draftReply: `Dear Mrs. Okafor,

Thank you for getting in touch regarding James's Ritalin prescription.

I have reviewed his notes and am happy to authorise an early repeat prescription given your forthcoming trip. I will arrange this with our prescribing team today and ask them to send the prescription directly to your preferred pharmacy.

Please do let me know if you need anything further.

Kind regards,
Dr. A. Patterson
CAMHS Consultant, St. Jude's Hospital`
  },
  {
    id: 6,
    title: 'Review 2 non-urgent emails approaching 14 days',
    why: 'Will breach if left until next week.',
    time: '20 min',
    done: false
  }
];

export const weekData: WeekDataItem[] = [
  { day: 'Tue', planned: 90, recommended: 90 },
  { day: 'Wed', planned: 90, recommended: 150, addExtra: 60 },
  { day: 'Thu', planned: 60, recommended: 70 }
];

export const weekHistory: WeekHistoryItem[] = [
  { week: 'W-6', high: 20, medium: 30, low: 40, admin: 50 },
  { week: 'W-5', high: 15, medium: 35, low: 45, admin: 55 },
  { week: 'W-4', high: 25, medium: 25, low: 50, admin: 40 },
  { week: 'W-3', high: 30, medium: 40, low: 30, admin: 45 },
  { week: 'W-2', high: 10, medium: 45, low: 55, admin: 60 },
  { week: 'W-1', high: 22, medium: 38, low: 42, admin: 48 },
  { week: 'Current', high: 35, medium: 25, low: 30, admin: 50 }
];

export const histEmails: Email[] = Array.from({ length: 10 }, (_, i) => ({
  id: 101 + i,
  from: `Past Sender ${i + 1}`,
  subject: `Unresolved past item ${i + 1}`,
  preview: "This is a past unresolved item that needs review...",
  body: "This is a past unresolved item that needs review from several weeks ago.",
  date: `${21 + i * 7} days ago`,
  risk: i % 3 === 0 ? 'medium' : 'none',
  cat: CAT.REVIEW,
  deadline: null,
  estMin: 10
}));

export const scanSteps = [
  "Checking main inbox...",
  "Scanning clinical subfolders...",
  "Identifying high-risk keywords...",
  "Calculating response deadlines...",
  "Building catch-up recommendations..."
];
