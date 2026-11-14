# ClientFlow: staff guide to programs, agreements, funding and emails

Short instructions for running a program from setup to closing a client out.

## 1. Set up and activate a program

1. **Programs → New program.** Enter the name, description and intake form. Leave it **Inactive**.
2. Open the program. The **Setup checklist** at the top of Overview shows what this program needs:
   - **Intake form** (always).
   - **Enrollment agreement**, only when the program's journey has a Contract stage or contracts
     are sent automatically after intake.
   - **Welcome email**, only when it's sent automatically after signing.
   - Optional items: monthly deliverables, billing, an award agreement.
3. When every required item is ticked, click **Activate program**. ClientFlow won't activate a
   program that is missing required setup, and tells you what to finish.

A program that doesn't use contracts (no Contract stage) can be activated without an agreement.

## 2. Agreements (contracts)

Program page → Overview → **Agreements**.

- **Enrollment agreement:** what a client signs to join. One per program, marked "Enrollment
  agreement". The first one you add becomes it automatically.
- **Award agreement:** generated for an individual funding award, e.g. the IDI Member Fund
  agreement. Add it with **Add agreement template** and choose "Award agreement".
- **Versions:** saving creates a new version, which is used for agreements prepared from now on.
  Agreements already sent or signed keep the exact text they were sent with.
- **Merge fields** fill in client and award details: `{{client.businessName}}`,
  `{{client.contactName}}`, `{{program.name}}`, `{{today}}`, and in award agreements
  `{{award.amount}}`, `{{award.date}}`, `{{award.title}}`, `{{award.source}}`. Click **Merge fields you
  can use** for the full list, and **Preview with sample details** to check the wording.
- Replace any "Template draft only" starter wording with your reviewed legal text. The page warns
  you while it's still there.

**Sending an enrollment agreement:** on the client, click **Send contract**, then **Review
agreement**. You'll see the exact text the client will sign. If details are missing (for
example the business name), sending is blocked until you fill them in.

## 3. Funding awards

Client → choose the program at the top → **Funding** tab.

1. **Add award:** title, source, amount awarded and award date.
2. **Approve** the award, or tick "Already approved" when adding it.
3. If the program has an award agreement: **Prepare agreement**, review the text (amount, business
   name and date filled in), then **Send agreement**. Signing it records the signature only. It
   doesn't change the client's onboarding or program status.
4. **Record payment** each time money goes out. **Awarded**, **received** and **still owed** are
   shown separately, so $5,000 awarded with $2,500 paid shows both figures.
5. **Supporting documents:** add files on the award card.

Rules ClientFlow enforces:
- A payment can never take "received" above the amount awarded.
- A payment recorded by mistake is **voided** with a reason. It stays in the ledger, crossed out.
- After an agreement is sent or signed, changing the award's title, source, amount or date
  requires **replacing the agreement**. An unsigned one is cancelled; a signed one is kept as history.
- An award can be **cancelled** only while nothing has been paid on it.
- **Payments → Award follow-up** lists every award with money still owed, including clients whose
  program participation is archived.

What the client asked for (intake) and the proposed terms are shown alongside, but are not the
same as an award.

## 4. Program emails with images

Program page → **Emails** → **Send email blast**.

- Use **Image** in the toolbar to add a PNG, JPEG or GIF (up to 5 MB). It appears on its own line.
- **Preview email** shows the email as members will see it.
- **Send test to me** emails one copy, marked [Test], to you only. Members get nothing.
- Then send to everyone or to chosen members.

## 5. Closing a client out (final report)

Client → choose the program → **Final Report** tab.

1. **Save draft** as often as you like. It changes nothing else about the client.
2. **Finalize report & archive…** shows what is still open:
   - agreements not signed
   - deliverables not finished
   - awards with money still owed
3. Resolve them, or write **why the participation is closing with them open**. That reason is
   required, and it is kept in the report.
4. Finalizing saves a fixed copy of the report and archives **only that program participation**.
   The client's other programs stay active, and the report can be printed at any time.
   - Agreements still waiting for a signature are cancelled.
   - Unpaid awards stay in Award follow-up and can still be paid.

## 6. Deleting a client

A client who has **any recorded payment**, either a billing payment or an award payment, can't be
permanently deleted. Archive them instead: archiving keeps their payment history. Clients with no
payments, or only voided ones, can still be permanently deleted from the client menu.
