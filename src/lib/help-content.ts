/**
 * The in-app staff guide (Help). Written with the exact labels staff see, so it reads like the
 * screens. Update the topic alongside any change to the screen it describes.
 */

export type HelpBlock =
  | { type: "text"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "tip"; text: string };

export interface HelpLink {
  label: string;
  /** An app page staff can open from the topic. */
  to: HelpRoute;
}

export interface HelpTopic {
  /** Anchor on the Help page: /help#<id>. */
  id: string;
  area: HelpArea;
  title: string;
  summary: string;
  /** Extra words staff might search for. */
  keywords: string[];
  blocks: HelpBlock[];
  links?: HelpLink[];
}

export const HELP_AREAS = [
  "Getting started",
  "Clients",
  "Intake & approval",
  "Programs",
  "Funding awards",
  "Billing & payments",
  "Monitoring & closing",
  "Forms",
  "Reports",
  "Settings",
  "What clients see",
] as const;
export type HelpArea = (typeof HELP_AREAS)[number];

/** Pages a help topic can link to (all exist in src/routes). */
export const HELP_ROUTES = [
  "/",
  "/clients",
  "/programs",
  "/payments",
  "/forms",
  "/intake",
  "/review",
  "/pipeline",
  "/monitoring",
  "/archive",
  "/reports",
  "/settings",
] as const;
export type HelpRoute = (typeof HELP_ROUTES)[number];

export const HELP_TOPICS: HelpTopic[] = [
  // Getting started
  {
    id: "how-clientflow-works",
    area: "Getting started",
    title: "How ClientFlow works",
    summary: "The path every client takes, from first contact to closing out.",
    keywords: ["overview", "journey", "workflow", "start", "basics"],
    blocks: [
      {
        type: "text",
        text: "Each client moves through the same journey. ClientFlow sends most emails for you and tells you what to do next.",
      },
      {
        type: "steps",
        items: [
          "Add the client and send the General Intake (or fill it in with them).",
          "The client submits the intake and picks a program.",
          "If the program needs approval, the client waits in Pending Review until staff approve.",
          "The client signs the program's enrollment agreement. A welcome email can go out automatically.",
          "The client is active: deliverables, billing, funding awards and monitoring happen on their profile.",
          "When the program ends, file the Final Report. That archives only that program participation.",
        ],
      },
      {
        type: "tip",
        text: "A client can be in several programs. The bar at the top of the client's page (\"Working in:\") chooses which program you're looking at.",
      },
    ],
    links: [{ label: "Go to Clients", to: "/clients" }],
  },
  {
    id: "finding-your-way",
    area: "Getting started",
    title: "Finding your way around",
    summary: "What each part of the menu is for.",
    keywords: ["menu", "sidebar", "navigation", "notifications", "bell"],
    blocks: [
      {
        type: "list",
        items: [
          "Dashboard, Clients, Programs, Payments, Forms: the main screens.",
          "Workflow (Intake, Review, Pipeline, Monitoring, Archive): day-to-day queues.",
          "Insights (Reports, Settings): numbers and setup.",
          "The bell at the top shows notifications, such as a signed agreement or a failed email.",
        ],
      },
      {
        type: "tip",
        text: 'Most pages have a "How this works" link at the top that opens the matching help topic.',
      },
    ],
  },
  {
    id: "dashboard",
    area: "Getting started",
    title: "The Dashboard",
    summary: "What needs attention today, across every client.",
    keywords: ["home", "needs attention", "follow-ups", "activity"],
    blocks: [
      {
        type: "list",
        items: [
          "Onboarding, Active, Archived and Needs Attention give the headline counts.",
          "Needs Attention lists clients missing a program, contracts waiting on staff, and emails that failed to send. Click a name to open the client.",
          "Recent activity and Upcoming follow-ups show what happened and what's next.",
        ],
      },
      {
        type: "tip",
        text: 'Use "Add client" here to start a new client without leaving the Dashboard.',
      },
    ],
    links: [{ label: "Go to Dashboard", to: "/" }],
  },

  // Clients
  {
    id: "add-a-client",
    area: "Clients",
    title: "Add a new client",
    summary: "Create a profile and get the General Intake to them.",
    keywords: ["new client", "create", "intake", "secure link", "profile"],
    blocks: [
      { type: "text", text: 'Quick way: click "Add client" on the Dashboard or Clients page.' },
      {
        type: "steps",
        items: [
          "Enter the contact name and email (business name and phone are optional).",
          'Leave "Send the General Intake email immediately" ticked to email the intake now, or untick it to send later.',
          'Click "Add client".',
          'If a client already uses that email, ClientFlow says so first. For an archived client choose "Restore that profile" to bring them back with their history; for an active one, "Open existing". "Create new anyway" adds a separate client.',
        ],
      },
      {
        type: "text",
        text: 'Guided way: open Intake ("New Intake") to search for an existing profile first, so you don\'t create a duplicate.',
      },
      {
        type: "steps",
        items: [
          'Search by email, phone or business name. Select the profile, or click "Create new profile".',
          'Choose "Complete Master Intake Now" to fill in the form with the client, or "Send Secure Link" to email it with a due date and a personal message.',
          'Finish with "View profile" or "Start another intake".',
        ],
      },
      {
        type: "tip",
        text: "Text-message delivery is not available yet. Intake links go by email.",
      },
    ],
    links: [
      { label: "Go to Intake", to: "/intake" },
      { label: "Go to Clients", to: "/clients" },
    ],
  },
  {
    id: "find-clients",
    area: "Clients",
    title: "Find and filter clients",
    summary: "Search the client list and see each client's next step.",
    keywords: ["search", "filter", "list", "next action", "send form"],
    blocks: [
      {
        type: "list",
        items: [
          "Tabs: All, Onboarding, Active, Archived.",
          'Filter by program, assigned staff or relationship (Prospect, Applicant, Client, Sponsor), or type in "Search clients…".',
          "Next action shows what each client needs: Assign program, Send contract, Awaiting signature, a check-in, or Follow up.",
          "Row buttons: View, Send form, Archive. Admins also see Delete.",
        ],
      },
    ],
    links: [{ label: "Go to Clients", to: "/clients" }],
  },
  {
    id: "client-profile",
    area: "Clients",
    title: "The client profile",
    summary: "Everything about one client, tab by tab.",
    keywords: [
      "profile",
      "tabs",
      "overview",
      "documents",
      "communications",
      "activity",
      "edit client",
    ],
    blocks: [
      {
        type: "text",
        text: 'Choose the program in the "Working in:" bar first. The tabs then show that program.',
      },
      {
        type: "list",
        items: [
          "Overview: the next step for this program, status and follow-up date, open tasks and recent activity.",
          "Program: the agreement, monthly deliverables, and funding & service terms.",
          "Billing: payment setup, payments and the ledger.",
          "Funding: awards, award agreements and award payments.",
          "Forms: the Master Intake answers and program forms.",
          'Documents: signed agreements, staff uploads and client uploads ("Upload document").',
          "Communications: log a note, email, call or meeting.",
          "Monitoring: follow-up items such as payment checks or progress reports.",
          "Final Report: close out this program participation.",
          "Activity: a full history of what happened.",
        ],
      },
      {
        type: "tip",
        text: '"Edit client" (top right) changes contact details, status, assigned staff and the next follow-up date.',
      },
    ],
    links: [{ label: "Go to Clients", to: "/clients" }],
  },
  {
    id: "send-intake-contract-welcome",
    area: "Clients",
    title: "Send the intake, agreement or welcome email",
    summary: "The Send menu on a client's page.",
    keywords: ["send", "resend", "contract", "agreement", "welcome", "intake", "signing link"],
    blocks: [
      {
        type: "list",
        items: [
          "Send / resend intake: emails the General Intake form.",
          'Send contract: the selected program\'s enrollment agreement. Click "Review agreement" to see the exact text the client will sign, then "Send contract". If details are missing, sending is blocked until you add them.',
          "Send / resend welcome email: available once the agreement is signed.",
        ],
      },
      {
        type: "tip",
        text: "The agreement and welcome items need the client to be in a program first.",
      },
      { type: "text", text: "Resending a signing link makes the old link stop working." },
    ],
  },
  {
    id: "archive-and-delete",
    area: "Clients",
    title: "Archive, restore or delete a client",
    summary: "Take a client out of the active list, or bring them back.",
    keywords: ["archive", "restore", "delete", "remove", "payments"],
    blocks: [
      {
        type: "list",
        items: [
          '"Move to archive" on the client\'s page asks for a reason and final status. Archived clients are listed on the Archive page.',
          '"Restore client" on their page, Restore on the Archive page, or Restore on the Clients page\'s Archived tab brings them back with the programs that were archived with them.',
          "Adding a new client with an archived client's email offers \"Restore that profile\", so you don't end up with two records.",
          "Admins can permanently delete a client from the Clients or Archive list by typing the business name.",
        ],
      },
      {
        type: "tip",
        text: 'A client with any recorded payment can\'t be deleted, only archived, so the payment history is kept. Test clients are the exception (see "Try things out with a test client").',
      },
    ],
    links: [{ label: "Go to Archive", to: "/archive" }],
  },
  {
    id: "test-clients",
    area: "Clients",
    title: "Try things out with a test client",
    summary: "Walk through awards, contracts, payments and emails without touching your numbers.",
    keywords: [
      "test",
      "practice",
      "demo",
      "sandbox",
      "try",
      "training",
      "delete test client",
      "fake client",
    ],
    blocks: [
      {
        type: "steps",
        items: [
          'Click "Add client", enter a name and your own email address, and tick "This is a test client". Click "Add test client".',
          "Use the test client like any other: enroll them in a program, give an award, send the agreement, record payments (including past payments), send forms.",
          'When you\'re done, open the test client and click "Delete test client". Type the name to confirm.',
        ],
      },
      {
        type: "list",
        items: [
          'Test clients show a "Test" badge in the client list, on their page and in program member lists.',
          "They and everything recorded for them are left out of the Dashboard, Reports, the Payments page, award follow-up and program member counts.",
          'Program email blasts never go to test clients. Use "Send test to me" to try a blast.',
          "Deleting a test client erases everything entered under it, including awards, payments, contracts, documents and email history.",
        ],
      },
      {
        type: "tip",
        text: "Emails to a test client really send, so use an address you own. Emails already sent can't be recalled. A client can only be marked as a test when it's created, never later, so a real client's payments can never be deleted this way. Deleting needs an admin.",
      },
    ],
    links: [{ label: "Go to Clients", to: "/clients" }],
  },

  // Intake & approval
  {
    id: "pending-review",
    area: "Intake & approval",
    title: "Approve clients (Pending Review)",
    summary: "Clients whose chosen program needs staff approval before the agreement goes out.",
    keywords: ["review", "approve", "decline", "pending"],
    blocks: [
      {
        type: "steps",
        items: [
          "Open Review. Each row shows the client and the program they chose.",
          'Wrong program? Pick the right one under "Correct program" and click "Apply".',
          'Click "Approve & send", check the agreement, then "Sign & send". You sign for the organization and the client gets the signing link.',
          'Or click "Decline".',
        ],
      },
    ],
    links: [{ label: "Go to Review", to: "/review" }],
  },
  {
    id: "pipeline",
    area: "Intake & approval",
    title: "Track progress (Pipeline)",
    summary: "Where each new client is in intake, approval and signing.",
    keywords: ["pipeline", "status", "intake sent", "contract sent", "onboarding"],
    blocks: [
      {
        type: "text",
        text: "Filter by status (Intake Sent, Program Selected, Pending Staff Review, Contract Sent, Contract Opened, Onboarding…). Open a client to assign a program, send the contract or download the signed agreement.",
      },
    ],
    links: [{ label: "Go to Pipeline", to: "/pipeline" }],
  },

  // Programs
  {
    id: "create-a-program",
    area: "Programs",
    title: "Create a program",
    summary: "Start a new program from scratch or from another program's setup.",
    keywords: ["new program", "copy setup", "activate", "inactive"],
    blocks: [
      {
        type: "steps",
        items: [
          'Programs → "New program". Enter the name and description.',
          'Under "Start from", choose "A blank program" or copy another program\'s setup, ticking the parts to bring over (journey, intake questions, agreements, welcome email, deliverables, billing, automatic emails). Clients are never copied.',
          'The new program starts inactive. Open it and finish the Setup checklist, then click "Activate program".',
        ],
      },
      {
        type: "tip",
        text: 'An existing inactive program can be finished with "Copy setup from another program" on its page. Only parts it doesn\'t already have are added.',
      },
    ],
    links: [{ label: "Go to Programs", to: "/programs" }],
  },
  {
    id: "program-setup-checklist",
    area: "Programs",
    title: "The program page and setup checklist",
    summary: "What's on a program's Overview, and how to activate it.",
    keywords: ["overview", "checklist", "activate", "sections", "journey", "required documents"],
    blocks: [
      {
        type: "text",
        text: "Program setup and At a glance are always shown. The other sections open and close; when closed they show a one-line summary. Several can be open at once, and unsaved edits are kept when you close one.",
      },
      {
        type: "list",
        items: [
          'Setup checklist: opens when something still needs doing. Each unfinished item has a "Go to …" link to where it\'s set up.',
          "Client journey: the stages clients move through. Review, Contract and Monitoring can be skipped.",
          "Required documents: what clients must provide.",
          "Billing: the default fee and frequency.",
          "Program workflow: Agreements, Welcome email, Automations and Email signature.",
        ],
      },
      {
        type: "tip",
        text: "A program can't be activated until its required setup is done. Editing an active program is never blocked.",
      },
    ],
    links: [{ label: "Go to Programs", to: "/programs" }],
  },
  {
    id: "program-agreements",
    area: "Programs",
    title: "Agreements: enrollment and award",
    summary: "Write, import and version the agreements clients sign.",
    keywords: [
      "agreement",
      "contract",
      "template",
      "import",
      "pdf",
      "word",
      "merge fields",
      "award agreement",
      "enrollment agreement",
      "version",
      "bold",
      "italic",
      "underline",
      "heading",
      "format",
    ],
    blocks: [
      { type: "text", text: "Program → Overview → Program workflow → Agreements." },
      {
        type: "list",
        items: [
          "Enrollment agreement: what clients sign to join the program. One per program.",
          "Award agreement: sent for an individual funding award, such as a LIVE Grant Giveaway award.",
        ],
      },
      {
        type: "steps",
        items: [
          'Click "Add agreement template", enter a name and choose "Used for".',
          'Click "Import from PDF or Word" to bring in a contract you already have, or type the text.',
          'Under "Suggested merge fields", click "Apply all" to replace blanks such as "Business Name: ____", the award amount and the award date with fields ClientFlow fills in.',
          'Click "Preview with sample details", read it, then "Add template".',
        ],
      },
      {
        type: "text",
        text: "Merge fields you can use include {{client.businessName}}, {{client.contactName}}, {{program.name}}, {{today}}, and in award agreements {{award.amount}}, {{award.date}}, {{award.title}} and {{award.source}}.",
      },
      {
        type: "list",
        items: [
          "Formatting: select text and use the toolbar above the agreement text: Bold, Italic, Underline, the text size menu (Heading, Subheading, Normal text, Small print), Bulleted list, Numbered list and Center.",
          'The toolbar writes simple marks you can also type: **bold**, _italic_, ++underline++; a line starting "# " (heading), "## " (subheading), "-# " (small print), "- " or "1. " (list); a line wrapped in -> and <- is centered.',
          "The preview, the client's signing page and the signed PDF all show the formatting. A note under the text points out formatting that was started but not finished.",
          "Lines in ALL CAPS still show as headings, so agreements written before formatting look as they did.",
        ],
      },
      {
        type: "tip",
        text: "Saving a change creates a new version. Agreements already sent or signed keep the exact text they were sent with.",
      },
    ],
    links: [{ label: "Go to Programs", to: "/programs" }],
  },
  {
    id: "welcome-email",
    area: "Programs",
    title: "The welcome email",
    summary: "The email clients get after signing the enrollment agreement.",
    keywords: ["welcome", "email", "guide", "attachment"],
    blocks: [
      {
        type: "text",
        text: 'Program → Overview → Program workflow → Welcome email. Write the subject and message, attach a welcome guide if you like, then "Save welcome version".',
      },
      { type: "tip", text: "Whether it goes out automatically is set under Automations." },
    ],
  },
  {
    id: "automatic-emails",
    area: "Programs",
    title: "Automatic emails",
    summary: "Emails ClientFlow sends for you when something happens.",
    keywords: ["automation", "automatic", "custom email", "trigger", "test"],
    blocks: [
      {
        type: "list",
        items: [
          "The main switch turns all automation for the program on or off.",
          '"Agreement signing link after intake" and "Welcome email after signing" can each be switched on or off.',
          "A signed copy of the agreement always goes to the client.",
          'Custom emails: "Add email", choose when it\'s sent (for example when an intake is submitted), write it with merge fields, and "Send test to me" before saving.',
        ],
      },
      {
        type: "tip",
        text: "Each custom email is sent once per client for each event. Scheduled reminders aren't available yet.",
      },
    ],
  },
  {
    id: "email-signature",
    area: "Programs",
    title: "Email signature and layout",
    summary: "The sign-off and header layout on every email.",
    keywords: [
      "signature",
      "sign-off",
      "layout",
      "logo",
      "left",
      "centered",
      "header",
      "edge",
      "margin",
    ],
    blocks: [
      {
        type: "list",
        items: [
          'Settings → "Email signature & layout": the organization\'s default.',
          "Program → Overview → Program workflow → Email signature: a program's own, which replaces the default for that program's emails. Leave it empty to use the organization's.",
          'Layout: "Centered" (standard), "Left, with a margin" (logo and text indented from the left), or "Left, logo at the edge" (the logo starts at the very left edge and the text keeps its margin).',
          "Email apps add a little space of their own around every email, so the logo can't sit closer to the edge than that.",
          'Signature by role (same Settings section): an Admin signature (for example "Thank you, EAM Administration") and a Staff signature ("Thank you, EAM Staff"). Emails a person sends (blasts, forms, agreements, welcome emails, staff invites) end with their role\'s signature; automatic emails keep the program\'s or organization\'s. Leave a role empty to use those.',
        ],
      },
      { type: "tip", text: 'Use "Send test to me" on a program email to see the result.' },
    ],
    links: [{ label: "Go to Settings", to: "/settings" }],
  },
  {
    id: "program-members",
    area: "Programs",
    title: "Program members",
    summary: "Add members, mark them completed or withdraw them.",
    keywords: ["members", "add members", "withdraw", "complete", "enroll"],
    blocks: [
      {
        type: "list",
        items: [
          '"Add members" (top of the program page) enrolls existing clients. The program must be active.',
          "Members tab: search current members and past memberships. Use the row buttons to mark a member completed or withdraw them; withdrawing asks for a reason.",
        ],
      },
    ],
    links: [{ label: "Go to Programs", to: "/programs" }],
  },
  {
    id: "program-questions",
    area: "Programs",
    title: "Program questions",
    summary: "Questions clients answer for this program, after the General Intake.",
    keywords: ["questions", "intake", "form", "program section"],
    blocks: [
      {
        type: "text",
        text: 'Program → Program questions → "Add program questions". The first set you add becomes the program\'s intake questions. Clients answer them on the intake form after the general questions.',
      },
    ],
  },
  {
    id: "deliverables",
    area: "Programs",
    title: "Monthly deliverables",
    summary: "What the program provides each month, tracked per client.",
    keywords: ["deliverables", "monthly", "merge into", "member fund", "checklist"],
    blocks: [
      {
        type: "list",
        items: [
          'Program → Deliverables → "Add deliverable". Set program-wide dates under "Program dates".',
          "On a client's Program tab, update each month's items and \"Finalize month\".",
          'Two deliverables that are the same thing: click "Merge into…" on the one to retire. The preview shows what changes; notes move across and the retired one is turned off.',
        ],
      },
    ],
  },
  {
    id: "email-blasts",
    area: "Programs",
    title: "Email all program members",
    summary: "Send one email to everyone in a program, in several programs, or in all of them.",
    keywords: [
      "blast",
      "newsletter",
      "email members",
      "images",
      "bulk",
      "all members",
      "everyone",
      "multiple programs",
      "announcement",
    ],
    blocks: [
      { type: "text", text: "One program:" },
      {
        type: "steps",
        items: [
          'Program → Emails → "Send email blast" (or "Send email blast" on the program\'s card on the Programs page).',
          'Write the message. Use the list buttons for bullets or numbers (Enter continues the list) and "Image" to add a picture.',
          '"Preview email", then "Send test to me".',
          "Send to everyone or to chosen members.",
        ],
      },
      { type: "text", text: "Several programs, or everyone:" },
      {
        type: "steps",
        items: [
          'Programs page → "Email members".',
          'Tick the programs you want, or "All programs". The count shows how many people will get it.',
          'Write the message, "Preview email", "Send test to me", then "Send to N people".',
        ],
      },
      {
        type: "list",
        items: [
          "Each person gets one copy, even if they're in several of the chosen programs.",
          "The send is recorded under each program, so every program's Emails tab shows its part and can retry failures.",
          "Archived clients and test clients are never emailed.",
        ],
      },
    ],
    links: [{ label: "Go to Programs", to: "/programs" }],
  },

  // Funding
  {
    id: "funding-awards",
    area: "Funding awards",
    title: "Award a grant and send the funding agreement",
    summary: "Record an award, send its agreement, track signing.",
    keywords: ["award", "grant", "funding", "live grant giveaway", "agreement", "approve"],
    blocks: [
      {
        type: "text",
        text: 'Once per program, add an award agreement (see "Agreements: enrollment and award").',
      },
      {
        type: "steps",
        items: [
          "Open the client, choose the program, then the Funding tab.",
          '"Add award": title, source, amount and award date. Tick "Already approved", or click "Approve" later.',
          'On the award card, click "Review & send agreement". The client\'s name, amount and date are filled in. If the program has several award agreements, choose one.',
          'Click "Send agreement". The card moves through Wording → Review & send → Sent → Signed.',
        ],
      },
      {
        type: "tip",
        text: "If sending is blocked, the card says why: the award isn't approved, the program is inactive, the client or participation is archived, or there's no award wording.",
      },
    ],
  },
  {
    id: "client-signing",
    area: "Funding awards",
    title: "Signing, the signed copy and where it's saved",
    summary: "What happens when a client signs an agreement.",
    keywords: ["sign", "signature", "signed copy", "pdf", "documents", "executed"],
    blocks: [
      {
        type: "list",
        items: [
          'The client opens the link, reads the agreement, types their name and email, ticks the box and clicks "Sign agreement".',
          "EA Management's signature is added when staff send the agreement.",
          "After signing, the client gets an email with a link to the signed PDF, and the PDF is saved in the client's Documents tab.",
          "Award agreements show \"View signed agreement\" on the award card. Signing an award agreement doesn't change the client's program status.",
        ],
      },
      {
        type: "tip",
        text: "Clients can't type into blanks on the agreement. ClientFlow fills every field before sending.",
      },
    ],
  },
  {
    id: "award-payments",
    area: "Funding awards",
    title: "Award payments and changes",
    summary: "Record money paid out, and change an award after sending.",
    keywords: ["award payment", "void", "edit award", "cancel award", "follow-up", "owed"],
    blocks: [
      {
        type: "list",
        items: [
          '"Record payment" each time money goes out. Awarded, received and still owed are shown separately.',
          "A payment recorded by mistake is voided with a reason. It stays in the history, crossed out.",
          "Changing the amount, date, title or source after sending asks you to replace the agreement. An unsigned one is cancelled; a signed one is kept as history.",
          "An award can be cancelled only while nothing has been paid.",
          'Payments → "Award follow-up" lists every award with money still owed.',
        ],
      },
    ],
    links: [{ label: "Go to Payments", to: "/payments" }],
  },

  // Billing
  {
    id: "billing-setup",
    area: "Billing & payments",
    title: "Set up and record client payments",
    summary: "Payment agreements, payments, past payments and the ledger.",
    keywords: [
      "billing",
      "payment",
      "past payment",
      "record payment",
      "applies to period",
      "ledger",
      "void",
      "bring current",
      "behind",
      "overdue",
      "current",
      "agreement",
    ],
    blocks: [
      {
        type: "text",
        text: "Client → choose the program → Billing tab. Only admins can record payments.",
      },
      {
        type: "list",
        items: [
          '"Set Up Payments": amount, frequency and start date.',
          '"Record payment" for any money the client paid (see below).',
          '"View Ledger" lists every payment; void one with a reason if it was entered by mistake.',
          'The status line shows "Current" when nothing is owed so far, or "Behind" with how many periods are overdue, how much, and which months.',
          'When a client is behind on months they actually paid before ClientFlow, click "Already paid? Mark earlier periods as paid" and tick those periods. They then show as paid.',
        ],
      },
      { type: "text", text: "To record a payment:" },
      {
        type: "steps",
        items: [
          "Open the client and pick the program in the bar at the top.",
          'Open the Billing tab and click "Record payment".',
          'For a payment on the schedule, pick the period it covers under "Applies to period". That period then shows as paid and Outstanding goes down.',
          'For money received before ClientFlow (or outside the schedule), tick "This is a past payment". It counts toward "Collected" but isn\'t applied to a period. Without a payment agreement, every payment is saved this way.',
          "Enter the amount, the date it was paid (today or earlier) and how it was paid, then save.",
        ],
      },
      {
        type: "list",
        items: [
          '"Applies to period" lists the periods still unpaid, up to the next due date. If those are all paid (the client paid ahead), it offers the next unpaid one.',
          'Past payments show in the ledger as "Past payment".',
        ],
      },
      {
        type: "tip",
        text: 'Setting up payments for a client who was already paying? Set "Existing payment status" when you save the agreement, and ClientFlow asks which earlier periods were paid, so they don\'t show as overdue.',
      },
    ],
    links: [{ label: "Go to Payments", to: "/payments" }],
  },
  {
    id: "payments-page",
    area: "Billing & payments",
    title: "The Payments page",
    summary: "Money received, expected and outstanding across every client.",
    keywords: ["payments", "revenue", "outstanding", "expected", "forecast"],
    blocks: [
      {
        type: "list",
        items: [
          "Choose Month, Quarter or Year.",
          "Received, Expected, Outstanding and Active recurring revenue.",
          '"Needs Billing Setup" lists clients without payments set up; "Set Up Payments" opens their Billing tab.',
          '"Award follow-up" lists funding awards with money still owed.',
        ],
      },
    ],
    links: [{ label: "Go to Payments", to: "/payments" }],
  },

  // Monitoring & closing
  {
    id: "monitoring",
    area: "Monitoring & closing",
    title: "Monitoring follow-ups",
    summary: "Regular checks on active clients, and the board that tracks them.",
    keywords: ["monitoring", "compliance", "follow-up", "check-in", "overdue"],
    blocks: [
      {
        type: "list",
        items: [
          'Add an item on the client\'s Monitoring tab ("Add monitoring item"): type, due date and notes.',
          "The Monitoring page groups every item: Overdue, Due today, Due this week, Upcoming, Not scheduled, Done.",
          'Click "Record compliant" or "Not compliant" when the check is done.',
        ],
      },
    ],
    links: [{ label: "Go to Monitoring", to: "/monitoring" }],
  },
  {
    id: "final-report",
    area: "Monitoring & closing",
    title: "Close a program participation (Final Report)",
    summary: "File the final report and archive one program for a client.",
    keywords: ["final report", "close", "finalize", "archive participation", "outcome"],
    blocks: [
      {
        type: "steps",
        items: [
          "Client → choose the program → Final Report tab.",
          'Fill in results, issues, comments, outcome and next steps. "Save draft" as often as you like.',
          "Finalize. ClientFlow lists anything still open: unsigned agreements, unfinished deliverables, awards with money owed. Resolve them or write why the participation is closing with them open.",
          "Finalizing saves a fixed copy of the report and archives only that program participation. The client's other programs stay active.",
        ],
      },
      {
        type: "tip",
        text: "Downloading the final report as a PDF isn't available yet. Open it from the Final Report tab instead.",
      },
    ],
    links: [{ label: "Go to Archive", to: "/archive" }],
  },

  // Forms
  {
    id: "forms",
    area: "Forms",
    title: "Forms and the Master Intake",
    summary: "The intake questions every client answers, and program sections.",
    keywords: ["forms", "master intake", "template", "questions", "submissions"],
    blocks: [
      {
        type: "list",
        items: [
          "Master Intake: the general questions every client answers.",
          "Program Sections: each program's own questions.",
          'Submission History: every submitted intake; "Review answers" or "View profile".',
          '"New template" or "Edit template" to change questions; "Send Master Intake" to send it to a client.',
        ],
      },
    ],
    links: [{ label: "Go to Forms", to: "/forms" }],
  },

  // Reports
  {
    id: "reports",
    area: "Reports",
    title: "Reports",
    summary: "Portfolio numbers: revenue, members, intakes, contracts.",
    keywords: ["reports", "revenue", "portfolio", "statistics", "contracts"],
    blocks: [
      {
        type: "list",
        items: [
          "Revenue for this month, quarter or year, and received by program.",
          "Current members by program and new intakes by month.",
          "Contract status, and a portfolio summary (onboarding, active, completed, declined, monitoring due, funding committed).",
        ],
      },
    ],
    links: [{ label: "Go to Reports", to: "/reports" }],
  },

  // Settings
  {
    id: "settings-users",
    area: "Settings",
    title: "Team members and roles",
    summary: "Invite staff, set roles and turn accounts on or off.",
    keywords: ["users", "invite", "staff", "admin", "role", "password", "team"],
    blocks: [
      {
        type: "list",
        items: [
          "Each Settings section opens and closes: click its title. Closed, it shows a one-line summary.",
          'Settings → "Users & roles" → "Invite": name, email and role (Admin or Staff). They get an email to set a password.',
          "Change a member's role, or switch their account off.",
          "Admins can email a new invite link or a password reset link.",
          "Admins alone can permanently delete clients.",
        ],
      },
    ],
    links: [{ label: "Go to Settings", to: "/settings" }],
  },
  {
    id: "settings-organization",
    area: "Settings",
    title: "Your organization's details",
    summary: "Company profile, email logo and your own account.",
    keywords: ["company", "profile", "logo", "reply-to", "security", "change password"],
    blocks: [
      {
        type: "list",
        items: [
          "Company profile: name, reply-to email and default monitoring frequency.",
          "Email header logo: shown at the top of emails, the signing page and signed PDFs. Use PNG or JPEG so it also shows on PDFs.",
          "Personal profile and Security: your name and password.",
        ],
      },
      {
        type: "tip",
        text: "Some template switches in Settings say editing is coming soon. They don't change emails yet.",
      },
    ],
    links: [{ label: "Go to Settings", to: "/settings" }],
  },

  // What clients see
  {
    id: "what-clients-see",
    area: "What clients see",
    title: "What clients see",
    summary: "The emails and pages your clients use.",
    keywords: ["client view", "intake form", "signing page", "emails", "secure link"],
    blocks: [
      {
        type: "list",
        items: [
          "Intake email: a secure link to their own intake form. They answer the general questions, choose at least one program (the form highlights the program list and won't submit until one is ticked), answer each chosen program's questions and submit.",
          'Agreement email: a link to read and sign. The agreement shows in large, easy-to-read text. They must scroll to the end before they can tick "I agree" and sign ("Jump to the end" is there too). Signing takes their typed name, email and agreement; anything missing or mistyped is explained next to the field, and a link that has expired says to ask for a new one.',
          "Signed copy: an email with a link to the signed PDF.",
          "Welcome email and any program emails, with your logo and signature.",
        ],
      },
      { type: "tip", text: "Links are personal to each client. Ask clients not to forward them." },
    ],
  },
];

/** The help topic each page's "How this works" link opens. */
export const PAGE_HELP_TOPICS = {
  dashboard: "dashboard",
  clients: "find-clients",
  clientProfile: "client-profile",
  programs: "create-a-program",
  program: "program-setup-checklist",
  payments: "payments-page",
  forms: "forms",
  intake: "add-a-client",
  review: "pending-review",
  pipeline: "pipeline",
  monitoring: "monitoring",
  archive: "archive-and-delete",
  reports: "reports",
  settings: "settings-users",
  funding: "funding-awards",
  billing: "billing-setup",
  agreements: "program-agreements",
} as const;

/** Plain text of a topic, for search. */
export function topicText(topic: HelpTopic): string {
  const blocks = topic.blocks.map((block) =>
    block.type === "steps" || block.type === "list" ? block.items.join(" ") : block.text,
  );
  return [topic.title, topic.summary, topic.keywords.join(" "), ...blocks].join(" ").toLowerCase();
}

/**
 * Topics matching every word of the query (case-insensitive), best match first: a word in the
 * title counts most, then the keywords, the summary, and the rest of the text. Ties keep guide order.
 */
export function searchHelp(query: string, topics: HelpTopic[] = HELP_TOPICS): HelpTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return topics;
  const scored: { topic: HelpTopic; score: number; order: number }[] = [];
  topics.forEach((topic, order) => {
    const text = topicText(topic);
    if (!words.every((word) => text.includes(word))) return;
    const title = topic.title.toLowerCase();
    const keywords = topic.keywords.join(" ").toLowerCase();
    const summary = topic.summary.toLowerCase();
    const score = words.reduce(
      (total, word) =>
        total +
        (title.includes(word) ? 8 : 0) +
        (keywords.includes(word) ? 4 : 0) +
        (summary.includes(word) ? 2 : 0) +
        1,
      0,
    );
    scored.push({ topic, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.topic);
}
