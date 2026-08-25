import { StatusBadge } from "@/components/StatusBadge";
import type {
  ProgramDetailAnswer,
  ProgramDetailAnswerGroup,
  ProgramDetailForm,
} from "@/types";

function displayAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayAnswer).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return "";
}

function AnswerList({ answers }: { answers: ProgramDetailAnswer[] }) {
  if (answers.length === 0) {
    return <p className="text-sm text-muted-foreground">No answers recorded.</p>;
  }
  return (
    <dl className="grid gap-x-8 sm:grid-cols-2">
      {answers.map((answer) => (
        <div key={answer.fieldId} className="border-b border-border py-2 last:border-0">
          <dt className="font-mono text-[10px] uppercase text-muted-foreground">{answer.label}</dt>
          <dd className={answer.type === "signature"
            ? "font-signature mt-0.5 wrap-break-word text-2xl"
            : "mt-0.5 wrap-break-word text-sm"}
          >
            {displayAnswer(answer.value) || <span className="text-muted-foreground">Not answered</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AnswerGroups({ groups, empty }: { groups: ProgramDetailAnswerGroup[]; empty: string }) {
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.id}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h5 className="text-sm font-medium">{group.title}</h5>
            {group.submittedAt && (
              <span className="text-xs text-muted-foreground">
                Submitted {new Date(group.submittedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <AnswerList answers={group.answers} />
        </section>
      ))}
    </div>
  );
}

function FollowUpForms({ forms }: { forms: ProgramDetailForm[] }) {
  if (forms.length === 0) {
    return <p className="text-sm text-muted-foreground">No follow-up forms assigned.</p>;
  }
  return (
    <div className="space-y-5">
      {forms.map((form) => (
        <section key={form.id}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h5 className="text-sm font-medium">{form.templateName}</h5>
              <p className="text-xs text-muted-foreground">
                {form.submittedAt
                  ? `Submitted ${new Date(form.submittedAt).toLocaleDateString()}`
                  : form.dueAt || form.dueDate
                    ? `Due ${new Date(form.dueAt ?? form.dueDate!).toLocaleDateString()}`
                    : "No due date"}
              </p>
            </div>
            <StatusBadge status={form.status} />
          </div>
          <AnswerList answers={form.answers} />
        </section>
      ))}
    </div>
  );
}

export function ParticipantRepliesPanel({
  coreIntake,
  programIntake,
  forms,
}: {
  coreIntake: ProgramDetailAnswerGroup[];
  programIntake: ProgramDetailAnswerGroup[];
  forms: ProgramDetailForm[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section>
        <h4 className="mb-3 font-display text-sm font-semibold">Core intake replies</h4>
        <AnswerGroups groups={coreIntake} empty="No core intake replies recorded." />
      </section>
      <section>
        <h4 className="mb-3 font-display text-sm font-semibold">Program replies</h4>
        <AnswerGroups groups={programIntake} empty="No program-specific replies recorded." />
      </section>
      <section>
        <h4 className="mb-3 font-display text-sm font-semibold">Follow-up forms</h4>
        <FollowUpForms forms={forms} />
      </section>
    </div>
  );
}