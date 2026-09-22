# ClientFlow Hub

## Standalone API Scaffold

The standalone NestJS service is in `clientflow-api/` and is tracked by this repository. It owns
ClientFlow requests, authentication, and n8n-based workflow delivery in production.

```powershell
Set-Location clientflow-api
npm install
npm run prisma:generate
npm test
npm run build
```

See `clientflow-api/docs/RENDER_DEPLOYMENT.md` before creating or deploying the Render service.

Build a modern SaaS-style web application called ClientFlow for managing client intake, program routing, form assignments, funding/service terms, monitoring, contracts, final reports, and archives.

The application is for a company that offers multiple programs to businesses, clients, sponsors, and community partners. The company currently receives information through disconnected Wix and Google Forms, but this new system should centralize the intake and workflow process.

Main Goal

Create a clean, professional, easy-to-use internal admin portal where staff can:

Add or receive a new client intake.

Review the client’s needs.

Decide which program they belong in.

Send the correct follow-up form by email.

Have the form prefilled with information already collected.

Track the client through approval, active program, monitoring, completion, final report, and archive.

Generate terms or agreements based on selected program information.

Keep all notes, documents, communication history, and workflow status in one client profile.

Design Style

Use a professional dashboard style.

Visual direction:

Clean business software

Modern CRM feel

Simple navigation

White/light background

Dark text

Accent color: deep blue or teal

Rounded cards

Clear status badges

Minimal clutter

Mobile-responsive but optimized for desktop admin use

The system should feel like a mix of a CRM, intake manager, and project workflow tracker.

Core Navigation

Create a sidebar with these main sections:

Dashboard

Clients

New Intake

Programs

Forms

Monitoring

Contracts

Reports

Archive

Settings

Dashboard Page

Create a dashboard with summary cards:

New Intakes

Needs Review

Forms Sent

Active Clients

Monitoring Due

Contracts Pending

Completed This Month

Archived Clients

Also include:

Recent activity feed

Upcoming follow-ups

Clients needing attention

Quick action buttons:

Add Client

Create Intake

Send Form

Create Contract

Generate Report

Client List Page

Create a searchable client table with filters.

Columns:

Client / Business Name

Contact Person

Program

Status

Assigned Staff

Last Activity

Next Follow-Up

Intake Source

Actions

Filters:

Program

Status

Assigned Staff

Date Created

Active / Archived

Actions:

View Profile

Send Form

Add Note

Archive

Client Profile Page

Create a detailed client profile with tabs.

Header should show:

Business / Client Name

Contact Person

Email

Phone

Program

Status Badge

Assigned Staff

Next Follow-Up Date

Quick actions

Quick actions:

Send Program Form

Create Terms

Generate Contract

Add Note

Schedule Follow-Up

Move to Archive

Tabs:

Overview

Intake

Program Forms

Terms

Monitoring

Documents

Communications

Contracts

Final Report

Activity Log

Overview Tab

Show:

Client summary

Business description

What they need

Current program

Current status

Internal decision

Assigned staff

Important dates

Open tasks

Latest notes

Intake Tab

Show the initial intake information.

Fields:

Client name

Business name

Email

Phone

Website

Social media links

Business description

Type of assistance requested

Program of interest

Budget or funding need

Preferred contact method

How they heard about the company

Additional comments

Uploaded files

Program Forms Tab

This tab manages follow-up forms sent after staff decides which program the client belongs in.

Show:

Assigned forms

Form status

Date sent

Date opened

Date submitted

Due date

Resend button

Preview button

Cancel button

Form statuses:

Draft

Ready to Send

Sent

Opened

In Progress

Submitted

Needs Correction

Approved

Rejected

Expired

Cancelled

When staff clicks “Send Program Form,” open a modal where they choose one of these program forms:

Brand Awareness Subscription

30-Day Premier Workshop Subscription

Event Planning

Commercial Property

Grant Application

Interest Intake

Sponsorship Intake

The form should be sent by email through a secure link. Known information from the client profile should be prefilled.

Programs Page

Create a page to manage program types.

Program cards:

Brand Awareness Subscription

30-Day Premier Workshop Subscription

Event Planning

Commercial Property

Grant

Interest

Sponsorship

Each program should have:

Program name

Description

Active / inactive toggle

Default workflow

Default form template

Default contract template

Default monitoring frequency

Required documents

Status pipeline

Forms Page

Create a form builder / form template manager.

For MVP, this can be a structured template editor rather than a full drag-and-drop builder.

Each form template should include:

Form name

Program

Description

Questions

Required fields

Optional fields

File upload fields

Consent checkbox

Internal notes

Email message template

Due date settings

Create sample form templates for:

Interest Intake Form

Fields:

Name

Business / Organization Name

Email

Phone

Website

Social media links

Program or service of interest

Brief business description

Type of assistance needed

Estimated budget

Desired start date

Preferred contact method

How did you hear about us?

Additional comments

Sponsorship Intake Form

Fields:

Sponsor / Company Name

Primary Contact

Email

Phone

Website

Sponsorship opportunity or event

Sponsorship level of interest

Available budget

Cash or in-kind contribution

Desired visibility or benefits

Logo upload

Marketing restrictions

Payment or invoicing needs

Contract signer

Deadline

Additional requirements

Brand Awareness Subscription Form

Fields:

Business name

Contact person

Email

Phone

Website

Social media platforms

Current brand presence

Target audience

Marketing goals

Content needs

Current challenges

Desired outcomes

Budget

Upload brand assets

30-Day Premier Workshop Form

Fields:

Business name

Contact person

Email

Phone

Workshop goals

Current business stage

Main challenges

Preferred start date

Availability

Team members attending

Expected outcome

Notes

Event Planning Form

Fields:

Event name

Event type

Event date

Event location

Expected attendance

Budget

Services needed

Vendors needed

Sponsorship needs

Marketing needs

Timeline

Special requirements

Commercial Property Form

Fields:

Business name

Contact person

Email

Phone

Business type

Property need

Desired location

Budget range

Lease or purchase preference

Square footage needed

Timeline

Special requirements

Current property status

Grant Application Form

Fields:

Applicant name

Business name

Email

Phone

Business description

Grant amount requested

Purpose of funds

Eligibility information

Community impact

Business stage

Revenue stage

Required documents

Agreement checkbox

Signature field placeholder

Monitoring Page

Create a monitoring board showing clients with active follow-up obligations.

Columns or filters:

Due Today

Due This Week

Overdue

Upcoming

Completed

Each monitoring item should include:

Client name

Program

Monitoring type

Due date

Assigned staff

Status

Notes

Mark Complete button

Reschedule button

Monitoring frequency options:

Weekly

Biweekly

Monthly

Quarterly

Custom

Monitoring types:

Payment check

Milestone check

Progress report

Document request

Follow-up meeting

Grant compliance

Sponsorship benefit fulfillment

Contract review

Terms Page / Terms Modal

Create a terms creation flow that can be launched from the client profile.

Terms should include:

Program type

Support type

Funding amount

Resource description

Grant amount

Loan amount

Investment amount

Forgivable amount

Repayment required: yes/no

Repayment schedule

Interest or long-term interest

Milestones

Reporting requirements

Start date

End date

Monitoring frequency

Special conditions

Internal approval status

Support type options:

Service

Grant

Loan

Forgivable Loan

Investment

Sponsorship

Mixed Support

Other

Contracts Page

Create a contract manager page.

Show:

Client

Program

Contract type

Status

Created date

Sent date

Signed date

Actions

Contract statuses:

Draft

Internal Review

Sent

Signed

Declined

Expired

Completed

Archived

Contract types:

Service Agreement

Grant Agreement

Loan Agreement

Forgivable Loan Agreement

Investment Terms

Sponsorship Agreement

Event Planning Agreement

Workshop Agreement

Include a “Generate Contract” button that uses client intake information, selected program, and terms data to create a draft contract preview.

For MVP, generate a preview page with placeholder agreement language and merge fields. Do not treat it as final legal language.

Reports Page

Create reports for:

Active clients by program

New intakes by month

Approved vs declined clients

Monitoring due

Completed clients

Archived clients

Funding or resource commitments

Contract status report

Final Report Flow

At the end of a client’s program, staff should complete a final report.

Fields:

Client name

Program

Start date

End date

Original need

Support provided

Funding or resources provided

Milestones completed

Results achieved

Issues encountered

Staff comments

Client outcome

Recommended next steps

Archive decision

After final report completion, allow staff to mark the client as:

Contract Complete

Program Complete

Paid in Full

Grant Requirements Complete

Sponsorship Fulfilled

Closed Early

Defaulted

Pre-Archive

Archived

Archive Page

Create an archive table for inactive, declined, completed, or closed clients.

Columns:

Client name

Program

Final status

Archive reason

Date archived

Final report available

Actions

Actions:

View archived profile

Restore to active

Download final report

Settings Page

Settings should include:

User management placeholder

Role management placeholder

Program settings

Status settings

Form settings

Email template settings

Contract template settings

Monitoring settings

Company profile settings

User roles:

Admin

Manager

Staff

Viewer

Permissions should be planned but do not need full backend enforcement in the first Lovable version.

Client Statuses

Use these client statuses throughout the app:

New Intake

Needs Review

More Information Needed

Qualified

Declined

Waitlisted

Approved

Terms Proposed

Contract Pending

Active

Monitoring

Completed

Final Report Needed

Pre-Archive

Archived

Closed Early

Defaulted

Data Model

Create frontend mock data and TypeScript types for:

Client:

id

businessName

contactName

email

phone

website

socialLinks

programId

status

assignedStaff

intakeSource

createdAt

updatedAt

nextFollowUpDate

isArchived

Program:

id

name

description

isActive

defaultFormTemplateId

defaultMonitoringFrequency

defaultContractTemplateId

FormTemplate:

id

programId

name

description

fields

emailTemplate

isActive

FormAssignment:

id

clientId

formTemplateId

status

sentAt

openedAt

submittedAt

dueDate

secureLink

responses

Terms:

id

clientId

programId

supportType

fundingAmount

grantAmount

loanAmount

investmentAmount

forgivableAmount

repaymentRequired

repaymentSchedule

interestDescription

milestones

reportingRequirements

startDate

endDate

monitoringFrequency

specialConditions

approvalStatus

MonitoringItem:

id

clientId

programId

type

dueDate

status

assignedStaff

notes

completedAt

Contract:

id

clientId

programId

termsId

contractType

status

createdAt

sentAt

signedAt

content

Document:

id

clientId

name

type

url

uploadedAt

uploadedBy

Communication:

id

clientId

type

direction

subject

notes

date

staffMember

FinalReport:

id

clientId

programId

startDate

endDate

originalNeed

supportProvided

fundingProvided

milestonesCompleted

resultsAchieved

issuesEncountered

staffComments

clientOutcome

recommendedNextSteps

archiveDecision

ActivityLog:

id

clientId

action

description

user

timestamp

Snapchat Feature

Do not build automatic Snapchat message scraping.

Instead, create a Snapchat communication section in the client profile.

Fields:

Snapchat username

Last Snapchat contact date

Communication summary

Follow-up needed

Staff member

Add a button:

Open Snapchat Web

When clicked, it should open Snapchat Web in a new browser tab. Staff can manually record the result of the conversation.

Email Form Sending

Create UI for sending forms by email.

When staff clicks Send Form:

Show recipient email

Show selected form

Show editable subject line

Show editable email body

Show secure form link placeholder

Show due date

Allow send preview

Email body example:

Hello {{contactName}},

Based on your initial intake, we would like you to complete the next step for the {{programName}} program.

Some of your information has already been added to the form. Please review it, complete any missing sections, and submit it by {{dueDate}}.

Secure Form Link:
{{secureFormLink}}

Thank you,
EA Management Team

Backend Preparation

Even if the first version is frontend-only, structure the app so it can connect to a backend API later.

Create an API service layer with placeholder functions:

getClients()

getClientById(id)

createClient(data)

updateClient(id, data)

archiveClient(id)

restoreClient(id)

getPrograms()

createProgram(data)

updateProgram(id, data)

getFormTemplates()

assignFormToClient(clientId, formTemplateId)

sendFormEmail(formAssignmentId)

submitFormResponse(formAssignmentId, responses)

createTerms(clientId, data)

updateTerms(termsId, data)

generateContract(clientId, termsId)

createMonitoringItem(data)

completeMonitoringItem(id)

createFinalReport(clientId, data)

archiveAfterFinalReport(clientId)

uploadDocument(clientId, file)

addCommunication(clientId, data)

getActivityLog(clientId)

Use mock data for now, but keep the architecture ready for Supabase, Firebase, Appwrite, or a custom Node/Express backend.

MVP Pages to Generate First

Prioritize these pages:

Dashboard

Client List

Client Profile

New Intake

Forms

Programs

Monitoring

Contracts

Reports

Archive

Settings

Important UX Rules

Every client should have one master profile.

A client can apply to multiple programs without creating duplicate profiles.

Staff should always know the client’s current status.

Staff should be able to send the next form without copying and pasting data manually.

Forms should reuse information already collected.

Declined and completed clients should be archived, not deleted.

Contracts should be generated from structured intake and terms data.

Monitoring should be easy to see by due date.

Final reports should be required before long-term archive when applicable.

Deliverable

Generate the full frontend MVP with navigation, mock data, realistic screens, modals, forms, tables, status badges, and reusable components.

Use TypeScript, React, Tailwind, shadcn/ui components if available, and clean modular structure.

Prioritize a polished working prototype over backend completeness.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/302bb396-5a14-4b6d-b46f-f7d1dc859363).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
