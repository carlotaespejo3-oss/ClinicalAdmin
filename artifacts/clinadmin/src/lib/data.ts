import { Email, SentEmail, ManualTask, HomePlanItem, WeekDataItem, WeekHistoryItem } from './types';

export type { Email, SentEmail, ManualTask, HomePlanItem, WeekDataItem, WeekHistoryItem } from './types';

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
    kind: 'clinical',
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
    kind: 'clinical',
    deadline: 2,
    estMin: 15
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
    kind: 'triage',
    deadline: 3,
    estMin: 3,
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
    kind: 'meeting',
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
    risk: 'low',
    cat: CAT.REVIEW,
    kind: 'script',
    deadline: 14,
    estMin: 15
  },
  {
    id: 6,
    from: 'Mrs. Davies — SENCO',
    subject: 'Lucas Thompson EHCP review 24th May',
    preview: "We are preparing for Lucas Thompson's EHCP review on the 24th May...",
    body: "We are preparing for Lucas Thompson's EHCP review on the 24th May and would appreciate your clinical contribution to his social and emotional needs section. Please complete the attached SENCO contribution template and return by 22nd May.",
    date: '3 days ago',
    risk: 'low',
    cat: CAT.REVIEW,
    kind: 'complex',
    deadline: 9,
    estMin: 20,
    linkedTaskId: 'm5'
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
    kind: 'admin',
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
    kind: 'triage',
    deadline: 10,
    estMin: 3
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
    kind: 'none',
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
  },
  {
    id: 'm5',
    title: 'Complete EHCP clinical section — Lucas Thompson',
    cat: CAT.REVIEW,
    deadline: 9,
    risk: 'low',
    type: 'Form',
    estMin: 30,
    linkedEmailId: 6,
    autoCompleteOnReply: true,
  }
];

export const homePlan: HomePlanItem[] = [
  {
    id: 1,
    title: 'Review Mia C. high-risk email — suicidal ideation flag',
    why: 'Suicidal-risk wording from parent — needs compassionate dual draft, not a standard reply.',
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
    why: 'Clinical colleague — quick yes/no by Thu.',
    time: '3 min',
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
    time: '15 min',
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

export const histEmails: Email[] = [
  {
    id: 101,
    from: 'Sarah Chen (parent)',
    subject: "Mia — still not eating, worsening self-harm",
    preview: "Dr. Patterson, Mia has not eaten for 4 days and has been cutting herself...",
    body: "Dr. Patterson, Mia has not eaten for 4 days and has been cutting herself daily. We are very frightened. Please can someone call us urgently.",
    date: '14 days ago',
    risk: 'high',
    cat: CAT.UNSAFE,
    kind: 'clinical',
    deadline: 0,
    estMin: 15,
  },
  {
    id: 102,
    from: 'Dr. Martinez (GP)',
    subject: "James Okafor — medication query urgent",
    preview: "James has developed a tic and his parents are concerned about the Ritalin dose...",
    body: "James has developed a tic and his parents are concerned. Can you advise on dose adjustment or whether we should pause the Ritalin?",
    date: '12 days ago',
    risk: 'high',
    cat: CAT.URGENT,
    kind: 'clinical',
    deadline: 2,
    estMin: 15,
  },
  {
    id: 103,
    from: 'LAC Team — Social Services',
    subject: "Looked After Child review — Tyler Mason 23rd May",
    preview: "Tyler Mason's LAC review is on 23rd May and we require your clinical report...",
    body: "Tyler Mason's LAC review is on 23rd May and we require your clinical report by the 21st. Please can you confirm receipt and expected turnaround.",
    date: '10 days ago',
    risk: 'high',
    cat: CAT.LEGAL,
    kind: 'complex',
    deadline: 3,
    estMin: 20,
  },
  {
    id: 104,
    from: 'Mrs. Davies — SENCO',
    subject: "Lucas Thompson EHCP — your section overdue",
    preview: "We submitted the EHCP to the local authority but your section is outstanding...",
    body: "We submitted the EHCP to the local authority but your section is still outstanding. The LA deadline has now passed. Can you submit as soon as possible?",
    date: '9 days ago',
    risk: 'medium',
    cat: CAT.REVIEW,
    kind: 'complex',
    deadline: 1,
    estMin: 20,
  },
  {
    id: 105,
    from: 'Dr. K. Osei — Clinical Psychology',
    subject: "Formulation notes for Priya Sharma — follow-up",
    preview: "Just checking you received the formulation notes from last Thursday...",
    body: "Just checking you received the formulation notes from last Thursday. We were expecting your written input for the shared care plan by end of this week.",
    date: '8 days ago',
    risk: 'medium',
    cat: CAT.PROF,
    kind: 'professional',
    deadline: 2,
    estMin: 15,
  },
  {
    id: 106,
    from: 'MDT Coordinator',
    subject: "MDT summary notes — your cases",
    preview: "Please find the MDT notes attached. Action: brief written summary from you...",
    body: "Please find the MDT notes attached for your three cases discussed on 5th May. Action required: brief written summary and any updated care plan notes from you.",
    date: '7 days ago',
    risk: 'medium',
    cat: CAT.REVIEW,
    kind: 'complex',
    deadline: 3,
    estMin: 20,
  },
  {
    id: 107,
    from: 'Patricia Okafor (parent)',
    subject: "James — pharmacy says no script available",
    preview: "We went to collect James's Ritalin and the pharmacy said there is no prescription...",
    body: "We went to collect James's Ritalin and the pharmacy said there is no prescription on the system. He has only 3 days left. Can you sort urgently?",
    date: '6 days ago',
    risk: 'medium',
    cat: CAT.REVIEW,
    kind: 'script',
    deadline: 1,
    estMin: 10,
  },
  {
    id: 108,
    from: 'NHS Resolution',
    subject: "Subject Access Request — case ref 22849",
    preview: "We have received a Subject Access Request for records relating to case ref 22849...",
    body: "We have received a Subject Access Request for records relating to case ref 22849. Please provide all relevant correspondence within 28 days of the original request date (6th May).",
    date: '6 days ago',
    risk: 'medium',
    cat: CAT.LEGAL,
    kind: 'complex',
    deadline: 22,
    estMin: 20,
  },
  {
    id: 109,
    from: 'CHYMS Training Team',
    subject: "CHYMS CPD Day — your speaker slot 18th June",
    preview: "A reminder that you are confirmed as a speaker at the CHYMS CPD Day...",
    body: "A reminder that you are confirmed as a speaker at the CHYMS CPD Day on 18th June. Please submit your slides and bio by 4th June.",
    date: '5 days ago',
    risk: 'low',
    cat: CAT.MEETING,
    kind: 'meeting',
    deadline: 23,
    estMin: 5,
  },
  {
    id: 110,
    from: 'Linda Foster (parent)',
    subject: "Re: appointment — can we rebook?",
    preview: "We missed our appointment last Tuesday as we didn't get the reminder...",
    body: "We missed our appointment last Tuesday as we didn't get the reminder. Can we please rebook? The next available slot shows as July — is that right?",
    date: '4 days ago',
    risk: 'low',
    cat: CAT.ADMIN,
    kind: 'triage',
    deadline: 10,
    estMin: 3,
  },
  {
    id: 111,
    from: 'NHS Training Admin',
    subject: "Safeguarding Level 3 renewal due",
    preview: "Our records show your Safeguarding Level 3 renewal is due this month...",
    body: "Our records show your Safeguarding Level 3 renewal is due this month. Please book via the ESR portal. Slots are filling up — earliest available is 20th May.",
    date: '3 days ago',
    risk: 'low',
    cat: CAT.ADMIN,
    kind: 'admin',
    deadline: 8,
    estMin: 5,
  },
  {
    id: 112,
    from: 'Governance Team',
    subject: "Serious Incident learning — response required",
    preview: "Following the recent SI panel, your written learning reflections are required...",
    body: "Following the recent SI panel, your written learning reflections are required as part of the trust-wide response. Please complete the attached template by 30th May.",
    date: '2 days ago',
    risk: 'medium',
    cat: CAT.ADMIN,
    kind: 'complex',
    deadline: 18,
    estMin: 20,
  },
];

export const scanSteps = [
  "Checking main inbox...",
  "Scanning clinical subfolders...",
  "Identifying high-risk keywords...",
  "Checking medico-legal correspondence...",
  "Calculating response deadlines...",
  "Cross-referencing patient risk flags...",
  "Building catch-up recommendations..."
];
