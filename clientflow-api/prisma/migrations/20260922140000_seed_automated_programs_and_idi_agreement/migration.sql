-- Seed CfProgram rows for all 9 automated intake program options (idempotent per org).
-- These are required for ContractsService.prepareProgramSelection/resolveClientProgram to
-- find an active CfProgram by name; without them the automated flow cannot resolve any program.
WITH organizations AS (
  SELECT "id" AS "organizationId" FROM "Organization"
  UNION
  SELECT "organizationId" FROM "CfProgram"
  UNION
  SELECT "organizationId" FROM "CfContract"
), programs("name", "description", "contractTemplateName", "monitoringFrequency") AS (
  VALUES
    ('Brand Awareness Subscription', 'Ongoing brand awareness services subscription.', 'Brand Awareness Service Agreement', 'Monthly'),
    ('30-Day Premier Workshop Subscription', '30-day premier workshop subscription program.', 'Premier Workshop Service Agreement', 'Monthly'),
    ('Event Planning', 'Event planning services.', 'Event Planning Agreement', 'Monthly'),
    ('Commercial Property', 'Commercial property services.', 'Commercial Property Service Agreement', 'Monthly'),
    ('Grant', 'Grant-related services.', 'Grant Agreement', 'Monthly'),
    ('Sponsorship', 'Sponsorship services.', 'Sponsorship Agreement', 'Monthly'),
    ('Interest', 'General interest inquiries routed for staff review.', 'General Services Agreement', 'Monthly'),
    ('Other / Unsure', 'Unclassified inquiries routed for staff review.', 'General Services Agreement', 'Monthly'),
    ('Inspire Detroit Initiative', 'Monthly IDI membership: funding access, workshops, EAM Expo participation and business support.', 'IDI Membership Agreement', 'Monthly')
)
INSERT INTO "CfProgram" (
  "id", "organizationId", "name", "description", "isActive", "financialTrackingEnabled",
  "defaultFormTemplateId", "defaultMonitoringFrequency", "defaultContractTemplateId",
  "defaultWorkflow", "requiredDocuments", "statusPipeline", "createdAt", "updatedAt"
)
SELECT
  'cfprog_' || md5(organizations."organizationId" || ':' || programs."name"),
  organizations."organizationId",
  programs."name",
  programs."description",
  true,
  false,
  'general-intake',
  programs."monitoringFrequency",
  programs."contractTemplateName",
  '[]', '[]', '[]',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM organizations
CROSS JOIN programs
WHERE NOT EXISTS (
  SELECT 1 FROM "CfProgram" existing
  WHERE existing."organizationId" = organizations."organizationId"
  AND existing."name" = programs."name"
);

-- Add the real, approved IDI Membership Agreement contract template (not a placeholder).
WITH organizations AS (
  SELECT "id" AS "organizationId" FROM "Organization"
  UNION
  SELECT "organizationId" FROM "CfProgram"
  UNION
  SELECT "organizationId" FROM "CfContract"
)
INSERT INTO "CfContractTemplate" ("id", "organizationId", "name", "content", "isActive", "createdAt", "updatedAt")
SELECT
  'cftpl_' || md5(organizations."organizationId" || ':IDI Membership Agreement'),
  organizations."organizationId",
  'IDI Membership Agreement',
$idiagreement$INSPIRED DETROIT INITIATIVE MEMBERSHIP AGREEMENT
"Inspire to Be Great"

This agreement is between EA Management LLC ("EAM") and the member listed on the signature page. It becomes active after both parties sign and the first membership payment is completed.

1. PURPOSE OF IDI
The Inspired Detroit Initiative ("IDI") helps Detroit founders and small-business owners gain access to capital, funding opportunities, customer acquisition, brand exposure and visibility, and business education and community support.
The goal is to give every member multiple ways to bring money into their business during a 12-month period. These opportunities may come through EAM/IDI funding, outside grants, EAM Expo sales, new customers and business connections.
The program begins October 1, 2026.

2. MEMBERSHIP, PAYMENT AND CANCELLATION
IDI is a month-to-month membership. The Founding Member Rate is $25 per month and automatically renews through the EAM Wix Plans & Pricing system.
The first payment covers the first program month beginning October 1, 2026. The next payment is due November 1, 2026, and payments will continue monthly.
The first 50 paid members will keep the $25 Founding Member Rate while their membership remains active and in good standing.
A member may cancel through their Wix membership account or by sending EAM a written request. Cancellation takes effect at the end of the current paid month. There are no partial-month refunds.
There is no grace period for a failed payment. Membership benefits stop immediately, and the member is placed out of good standing. If the membership is canceled or ends, the $25 Founding Member Rate is lost.

3. WHAT MEMBERS RECEIVE
Access to EAM/IDI and vetted outside funding opportunities; one 2.5-hour live interactive business workshop each month; EAM Expo vendor participation at no additional vendor fee, based on available space; one Business Accountability Circle each month; brand exposure and visibility through EAM platforms and events; customer acquisition and revenue growth opportunities; and business resources and ongoing community support.
Members must provide EAM with the correct information, logos, pictures and content needed to receive promotional support.

4. EAM EXPO PARTICIPATION
EAM Expo vendor participation is included with membership, but space is based on availability, registration, business fit and good standing.
Vendors must follow all EAM and venue rules and are responsible for their products, equipment, inventory, permits, licenses and sales taxes.
Insurance may be required based on the vendor's products, services, equipment, event risk, applicable law, venue rules or EAM's insurance requirements. When requested, proof of insurance must be provided before setup.
EAM Expo participation creates opportunities for sales and customer acquisition but does not guarantee revenue.

5. FOUNDER AND TEAM MEMBER ACCESS
One membership covers the founder and one authorized team member. The founder must provide the team member's name, title and phone number on the signature page. The founder is responsible for making sure the team member follows this agreement.
The same team member must remain connected to the membership. If that person leaves the business or can no longer participate, EAM may approve one replacement as an exception. Membership access may not be shared with anyone else.

6. MEMBER CONDUCT AND CONFIDENTIALITY
Members and their authorized team members must treat EAM staff, members, partners, vendors and guests with respect.
Harassment, threats, discrimination, fraud, false information, unsafe behavior, illegal activity, disruption or misuse of EAM, IDI or another member's information is not allowed.
Private information shared during workshops, funding sessions, Business Accountability Circles or member meetings may not be recorded, copied, posted or shared without permission. Each member keeps ownership of their business name, logo, ideas, products and materials.
EAM may immediately remove a member for any violation. A warning is not required, and a member removed for a violation will not receive a refund.

7. PHOTO AND VIDEO PERMISSION
Members give EAM permission to use photos, videos, business names and logos from public IDI events and EAM Expos for EAM social media, the website, marketing, event recaps and program reports.
A member may opt out by notifying EAM in writing before the event.

8. PROGRAM CHANGES OR PROGRAM END
EAM may change program benefits, schedules, locations, rules or agreement terms at any time with notice. The $25 Founding Member Rate will remain protected while the membership is active and in good standing.
If EAM ends IDI, EAM will notify members, complete the requirements for the current paid month and stop future payments. No refund will be issued after the paid month is completed.

9. RESULTS AND COMPLETE AGREEMENT
IDI is designed to give members multiple ways to gain access to money, customers and business opportunities. EAM does not guarantee that every member will receive a grant, funding, sales, customers, increased revenue or business growth.
The member remains responsible for their own business decisions, applications, products and services. IDI membership is not an investment, loan or promise of funding.

This document contains the full agreement between EAM and the member. It follows Michigan law. Electronic signatures completed through this platform are treated the same as handwritten signatures.

MEMBER AGREEMENT
By signing below, the member confirms that they:
- Read and understand this agreement
- Agree to the recurring $25 monthly payment
- Understand the cancellation, failed-payment and refund rules
- Understand that funding and business results are not guaranteed
- Accept responsibility for their authorized team member
- Agree to follow IDI and EAM Expo rules
- Agree to the photo and video permission unless they opt out in writing$idiagreement$,
  true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM organizations
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- Refresh the program-selection field's options on any already-created General Intake templates
-- so existing organizations' live public intake forms include the new program immediately.
UPDATE "CfFormTemplate"
SET "fields" = (
  SELECT jsonb_agg(
    CASE WHEN elem->>'id' = 'selectedProgram'
      THEN jsonb_set(elem, '{options}', '[
        "Brand Awareness Subscription",
        "30-Day Premier Workshop Subscription",
        "Event Planning",
        "Commercial Property",
        "Grant",
        "Interest",
        "Sponsorship",
        "Other / Unsure",
        "Inspire Detroit Initiative"
      ]'::jsonb)
      ELSE elem
    END
  )
  FROM jsonb_array_elements("fields") AS elem
)
WHERE "scope" = 'master_core'
  AND "fields" @> '[{"id":"selectedProgram"}]'::jsonb;
