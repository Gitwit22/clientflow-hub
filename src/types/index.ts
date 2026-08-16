export type ClientStatus =
  | "New Intake"
  | "Needs Review"
  | "More Information Needed"
  | "Qualified"
  | "Declined"
  | "Waitlisted"
  | "Approved"
  | "Terms Proposed"
  | "Contract Pending"
  | "Active"
  | "Monitoring"
  | "Completed"
  | "Final Report Needed"
  | "Pre-Archive"
  | "Archived"
  | "Closed Early"
  | "Defaulted";

export const CLIENT_STATUSES: ClientStatus[] = [
  "New Intake",
  "Needs Review",
  "More Information Needed",
  "Qualified",
  "Declined",
  "Waitlisted",
  "Approved",
  "Terms Proposed",
  "Contract Pending",
  "Active",
  "Monitoring",
  "Completed",
  "Final Report Needed",
  "Pre-Archive",
  "Archived",
  "Closed Early",
  "Defaulted",
];

export type FormStatus =
  | "Draft"
  | "Ready to Send"
  | "Sent"
  | "Opened"
  | "In Progress"
  | "Submitted"
  | "Needs Correction"
  | "Approved"
  | "Rejected"
  | "Expired"
  | "Cancelled";

export type ContractStatus =
  | "Draft"
  | "Internal Review"
  | "Sent"
  | "Signed"
  | "Declined"
  | "Expired"
  | "Completed"
  | "Archived";

export type ContractType =
  | "Service Agreement"
  | "Grant Agreement"
  | "Loan Agreement"
  | "Forgivable Loan Agreement"
  | "Investment Terms"
  | "Sponsorship Agreement"
  | "Event Planning Agreement"
  | "Workshop Agreement"
  | "Membership Agreement"
  | "Partnership Agreement";

export type SupportType =
  | "Service"
  | "Grant"
  | "Loan"
  | "Forgivable Loan"
  | "Investment"
  | "Sponsorship"
  | "Mixed Support"
  | "Other";

export type MonitoringFrequency = "Weekly" | "Biweekly" | "Monthly" | "Quarterly" | "Custom";

export type MonitoringType =
  | "Payment check"
  | "Milestone check"
  | "Progress report"
  | "Document request"
  | "Follow-up meeting"
  | "Grant compliance"
  | "Sponsorship benefit fulfillment"
  | "Contract review";

export type MonitoringStatus = "Scheduled" | "Due" | "Overdue" | "Completed";

export type UserRole = "Admin" | "Manager" | "Staff" | "Viewer";

export type BackendRole = "org_admin" | "reviewer" | "super_admin";

export interface OrgMember {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: BackendRole;
  isActive: boolean;
  createdAt: string;
  invitePending?: boolean;
}

export interface OrgSettings {
  id: string;
  name: string;
  settings: {
    replyToEmail?: string;
    defaultMonitoringFrequency?: string;
    [key: string]: unknown;
  };
}

export interface Client {
  id: string;
  organizationId?: string;
  businessName: string;
  primaryContactName: string;
  email: string;
  phone: string;
  website?: string;
  socialLinks?: string[];
  programId: string | null;
  status: ClientStatus;
  profileType?: ProfileType;
  relationshipType?: RelationshipType;
  lifecycleStatus?: LifecycleStatus;
  assignedStaff: string;
  assignedUserId?: string | null;
  intakeSource: string;
  source?: ProfileSource;
  createdAt: string;
  updatedAt: string;
  nextFollowUpDate?: string;
  convertedAt?: string | null;
  isDemo?: boolean;
  isArchived: boolean;
  archiveReason?: string;
  finalStatus?: string;
  archivedAt?: string;
  intake: IntakeDetails;
  snapchat?: SnapchatRecord;
}

export interface IntakeDetails {
  businessDescription: string;
  assistanceRequested: string;
  programOfInterest: string;
  budgetNeed: string;
  preferredContact: string;
  heardAboutUs: string;
  additionalComments: string;
  uploadedFiles: string[];
}

export interface SnapchatRecord {
  username: string;
  lastContactDate?: string;
  summary?: string;
  followUpNeeded: boolean;
  staffMember?: string;
}

export interface Program {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  defaultFormTemplateId: string;
  defaultMonitoringFrequency: MonitoringFrequency;
  defaultContractTemplateId: ContractType;
  defaultWorkflow: string[];
  requiredDocuments: string[];
  statusPipeline: ClientStatus[];
}

export interface FormField {
  id: string;
  label: string;
  type:
    "text" | "email" | "phone" | "url" | "textarea" | "number" | "date" | "select" | "file" | "checkbox";
  required: boolean;
  options?: string[];
  prefillKey?: keyof Client | "businessDescription" | "programOfInterest";
}

export interface FormTemplate {
  id: string;
  programId: string;
  name: string;
  description: string;
  fields: FormField[];
  emailTemplate: string;
  internalNotes?: string;
  dueInDays: number;
  isActive: boolean;
}

export type ProfileType = "individual" | "business" | "organization";

export type RelationshipType = "prospect" | "applicant" | "client" | "sponsor";

export type LifecycleStatus =
  | "new"
  | "contacted"
  | "intake_pending"
  | "under_review"
  | "qualified"
  | "active"
  | "not_a_fit"
  | "declined"
  | "inactive"
  | "archived";

export type ProfileSource =
  "admin_created" | "public_form" | "secure_invitation" | "referral" | "imported";

export type CompletionMethod = "admin_assisted" | "secure_link" | "public_submission";

export type DeliveryMethod = "none" | "email" | "sms" | "email_and_sms";

export type FormAssignmentStatus =
  | "draft"
  | "sent"
  | "delivered"
  | "opened"
  | "in_progress"
  | "submitted"
  | "under_review"
  | "approved"
  | "cancelled"
  | "expired";

export interface FormAssignment {
  id: string;
  organizationId?: string;
  clientId: string;
  profileId?: string;
  formId: string;
  assignedUserId?: string | null;
  completionMethod?: CompletionMethod;
  deliveryMethod?: DeliveryMethod;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  status: FormAssignmentStatus;
  dueAt?: string | null;
  sentAt?: string;
  openedAt?: string;
  startedAt?: string | null;
  submittedAt?: string;
  cancelledAt?: string | null;
  dueDate?: string;
  secureLink?: string;
  responses?: Record<string, string>;
  editHistory?: FormEdit[];
  createdByUserId?: string;
  isDemo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FormEdit {
  id: string;
  editedAt: string;
  editedBy: string;
  changes: Array<{
    fieldId: string;
    fieldLabel: string;
    oldValue: string;
    newValue: string;
  }>;
}

export interface Terms {
  id: string;
  clientId: string;
  programId: string;
  supportType: SupportType;
  fundingAmount: number;
  resourceDescription: string;
  grantAmount: number;
  loanAmount: number;
  investmentAmount: number;
  forgivableAmount: number;
  repaymentRequired: boolean;
  repaymentSchedule: string;
  interestDescription: string;
  milestones: string;
  reportingRequirements: string;
  startDate: string;
  endDate: string;
  monitoringFrequency: MonitoringFrequency;
  specialConditions: string;
  approvalStatus: "Pending" | "Approved" | "Rejected";
}

export interface MonitoringItem {
  id: string;
  clientId: string;
  programId: string;
  type: MonitoringType;
  dueDate: string;
  status: MonitoringStatus;
  assignedStaff: string;
  notes: string;
  completedAt?: string;
}

export interface Contract {
  id: string;
  clientId: string;
  programId: string;
  termsId?: string;
  contractType: ContractType;
  status: ContractStatus;
  createdAt: string;
  sentAt?: string;
  signedAt?: string;
  content: string;
}

export interface ClientDocument {
  id: string;
  clientId: string;
  name: string;
  type: string;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface Communication {
  id: string;
  clientId: string;
  type: "Email" | "Call" | "Meeting" | "Snapchat" | "Note";
  direction: "Inbound" | "Outbound" | "Internal";
  subject: string;
  notes: string;
  date: string;
  staffMember: string;
}

export interface FinalReport {
  id: string;
  clientId: string;
  programId: string;
  startDate: string;
  endDate: string;
  originalNeed: string;
  supportProvided: string;
  fundingProvided: string;
  milestonesCompleted: string;
  resultsAchieved: string;
  issuesEncountered: string;
  staffComments: string;
  clientOutcome: string;
  recommendedNextSteps: string;
  archiveDecision: string;
}

export interface ActivityLog {
  id: string;
  clientId: string;
  action: string;
  description: string;
  user: string;
  timestamp: string;
}

export type FinalReportDraft = Omit<FinalReport, "id" | "clientId">;

export const ARCHIVE_DECISIONS = [
  "Contract Complete",
  "Program Complete",
  "Paid in Full",
  "Grant Requirements Complete",
  "Sponsorship Fulfilled",
  "Closed Early",
  "Defaulted",
  "Pre-Archive",
  "Archived",
];

export const STAFF = ["Alicia Monroe", "Derrick Hale", "Priya Raman", "Marcus Webb"];
