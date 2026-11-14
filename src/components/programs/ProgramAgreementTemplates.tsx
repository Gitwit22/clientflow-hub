import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { VersionHistory } from "@/components/programs/VersionHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createProgramWorkflowContractTemplate,
  createProgramWorkflowContractVersion,
  updateProgramWorkflow,
  updateProgramWorkflowContractTemplate,
  uploadStoredFile,
} from "@/lib/api";
import {
  fieldsFor,
  hasDraftLanguage,
  invalidFields,
  renderWithSamples,
} from "@/lib/agreement-fields";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/client-send";
import type {
  AgreementPurpose,
  Program,
  ProgramWorkflow,
  ProgramWorkflowContractTemplate,
  ProgramWorkflowContractVersion,
} from "@/types";

const PURPOSE_LABEL: Record<AgreementPurpose, string> = {
  enrollment: "Enrollment agreement",
  award: "Award agreement",
};

const purposeOf = (template: ProgramWorkflowContractTemplate): AgreementPurpose =>
  template.purpose === "award" ? "award" : "enrollment";

/**
 * A program's agreement templates. One enrollment agreement is what clients sign to join; award
 * agreements are generated from individual funding awards. Each template keeps its versions; new
 * agreements use its active version, and agreements already sent keep the text they were sent with.
 */
export function ProgramAgreementTemplates({
  program,
  workflow,
  onChanged,
}: {
  program: Program;
  workflow: ProgramWorkflow | undefined;
  onChanged: () => void;
}) {
  const templates = workflow?.contract.templates ?? [];
  const enrollmentTemplateId = workflow?.config.activeContractTemplateId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    templates.find((template) => template.id === selectedId) ??
    templates.find((template) => template.id === enrollmentTemplateId) ??
    templates[0] ??
    null;
  const isEnrollmentAgreement = !!selected && selected.id === enrollmentTemplateId;
  const versions = (workflow?.contract.versions ?? []).filter(
    (version) => version.templateId === selected?.id,
  );
  const activeVersionId = selected
    ? isEnrollmentAgreement
      ? (workflow?.config.activeContractVersionId ?? selected.activeVersionId ?? null)
      : (selected.activeVersionId ?? null)
    : null;
  const activeVersion = versions.find((version) => version.id === activeVersionId) ?? null;

  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState<AgreementPurpose>("award");

  // The editor starts from the active version of the selected template, and resets only when the
  // selected template or its active version changes (not on every keystroke-driven re-render).
  useEffect(() => {
    setTitle(activeVersion?.title ?? "");
    setContent(activeVersion?.content ?? "");
    setFile(null);
    setShowSample(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, activeVersion?.id]);

  const editingPurpose: AgreementPurpose = adding
    ? newPurpose
    : selected
      ? purposeOf(selected)
      : "enrollment";
  const problems = useMemo(
    () => invalidFields(`${title}\n${content}`, editingPurpose),
    [title, content, editingPurpose],
  );

  async function act(work: () => Promise<unknown>, success: string, failure: string) {
    setSaving(true);
    try {
      await work();
      toast.success(success);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure);
    } finally {
      setSaving(false);
    }
  }

  const activate = (version: ProgramWorkflowContractVersion) =>
    act(
      () =>
        isEnrollmentAgreement
          ? updateProgramWorkflow(program.id, {
              activeContractTemplateId: version.templateId,
              activeContractVersionId: version.id,
            })
          : updateProgramWorkflowContractTemplate(program.id, version.templateId, {
              activeVersionId: version.id,
            }),
      `Version ${version.version} is now active.`,
      "Unable to activate this version.",
    );

  const makeEnrollmentAgreement = (template: ProgramWorkflowContractTemplate) => {
    const versionId =
      template.activeVersionId ??
      (workflow?.contract.versions ?? []).find((version) => version.templateId === template.id)?.id;
    if (!versionId) {
      toast.error("Save a version of this agreement first.");
      return;
    }
    void act(
      () =>
        updateProgramWorkflow(program.id, {
          activeContractTemplateId: template.id,
          activeContractVersionId: versionId,
        }),
      `${template.name} is now the enrollment agreement.`,
      "Unable to change the enrollment agreement.",
    );
  };

  async function storedFileId(): Promise<string | undefined> {
    if (!file) return undefined;
    return (await uploadStoredFile(file, "program-workflow/contracts")).id;
  }

  const saveVersion = () =>
    act(
      async () => {
        const fileId = await storedFileId();
        if (selected) {
          await createProgramWorkflowContractVersion(program.id, selected.id, {
            title: title.trim() || undefined,
            content: content.trim(),
            storedFileId: fileId,
            makeActive: true,
          });
        } else {
          await createProgramWorkflowContractTemplate(program.id, {
            name: `${program.name} Agreement`,
            purpose: "enrollment",
            title: title.trim() || `${program.name} Agreement`,
            content: content.trim(),
            storedFileId: fileId,
            isActive: true,
          });
        }
        setFile(null);
      },
      "Agreement version saved. New agreements use it; ones already sent keep their text.",
      "Unable to save this agreement version.",
    );

  const addTemplate = () =>
    act(
      async () => {
        const fileId = await storedFileId();
        await createProgramWorkflowContractTemplate(program.id, {
          name: newName.trim(),
          purpose: newPurpose,
          title: title.trim() || newName.trim(),
          content: content.trim(),
          storedFileId: fileId,
          isActive: true,
        });
        setAdding(false);
        setNewName("");
        setFile(null);
      },
      "Agreement template added.",
      "Unable to add this agreement template.",
    );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Agreements</p>
          <p className="text-xs text-muted-foreground">
            New agreements use each template&apos;s active version. Agreements already sent or
            signed keep the text they were sent with.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => {
            setAdding((value) => !value);
            setTitle("");
            setContent("");
          }}
        >
          {adding ? "Cancel" : "Add agreement template"}
        </Button>
      </div>

      {!adding && templates.length > 0 && (
        <ul className="space-y-1" aria-label="Agreement templates">
          {templates.map((template) => {
            const isEnrollment = template.id === enrollmentTemplateId;
            return (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(template.id)}
                  className={`flex w-full flex-wrap items-center gap-2 rounded border px-3 py-2 text-left text-sm ${
                    template.id === selected?.id ? "border-primary" : "border-border"
                  }`}
                >
                  <span className="font-medium">{template.name}</span>
                  {isEnrollment ? (
                    <Badge>Enrollment agreement</Badge>
                  ) : (
                    <Badge variant="outline">{PURPOSE_LABEL[purposeOf(template)]}</Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!adding && selected && purposeOf(selected) === "enrollment" && !isEnrollmentAgreement && (
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => makeEnrollmentAgreement(selected)}
        >
          Use as enrollment agreement
        </Button>
      )}

      {!adding && selected && (
        <VersionHistory
          versions={versions}
          activeId={activeVersionId}
          renderVersion={(version) => (
            <div
              key={version.id}
              className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {version.title || `Version ${version.version}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  v{version.version}
                  {version.storedFileId ? " · file attached" : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant={activeVersionId === version.id ? "default" : "outline"}
                disabled={saving || activeVersionId === version.id}
                onClick={() => void activate(version)}
              >
                {activeVersionId === version.id ? "Active" : "Activate"}
              </Button>
            </div>
          )}
        />
      )}

      {hasDraftLanguage(activeVersion?.content) && !adding && (
        <p
          role="alert"
          className="rounded border border-destructive/40 p-2 text-xs text-destructive"
        >
          This agreement still contains starter wording (&ldquo;Template draft only&rdquo;). Replace
          it with your reviewed legal text before sending it to clients.
        </p>
      )}

      {adding && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="agreement-template-name">Template name</Label>
            <Input
              id="agreement-template-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Member Fund Award Agreement"
            />
          </div>
          <div className="space-y-1">
            <Label>Used for</Label>
            <Select
              value={newPurpose}
              onValueChange={(value) => setNewPurpose(value as AgreementPurpose)}
            >
              <SelectTrigger aria-label="Used for">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="award">Award agreement (per funding award)</SelectItem>
                <SelectItem value="enrollment">
                  Enrollment agreement (joining the program)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {(adding || selected || templates.length === 0) && (
        <div className="space-y-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Agreement title"
            aria-label="Agreement title"
          />
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={10}
            placeholder="Agreement text. Use merge fields such as {{client.businessName}}."
            aria-label="Agreement text"
          />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Merge fields you can use</summary>
            <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
              {fieldsFor(editingPurpose).map((field) => (
                <li key={field.key}>
                  <code>{`{{${field.key}}}`}</code> {field.label}
                </li>
              ))}
            </ul>
          </details>
          {problems.length > 0 && (
            <p role="alert" className="text-xs text-destructive">
              Not available in {PURPOSE_LABEL[editingPurpose].toLowerCase()}s:{" "}
              {problems.map((key) => `{{${key}}}`).join(", ")}
            </p>
          )}
          <Input
            type="file"
            accept={DOCUMENT_UPLOAD_ACCEPT}
            aria-label="Agreement document"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={!content.trim()}
              onClick={() => setShowSample((value) => !value)}
            >
              {showSample ? "Hide preview" : "Preview with sample details"}
            </Button>
            {adding ? (
              <Button
                size="sm"
                disabled={saving || !newName.trim() || !content.trim() || problems.length > 0}
                onClick={() => void addTemplate()}
              >
                Add template
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={saving || !content.trim() || problems.length > 0}
                onClick={() => void saveVersion()}
              >
                Save as new version
              </Button>
            )}
          </div>
          {showSample && (
            <pre
              aria-label="Sample agreement"
              className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/40 p-3 font-sans text-sm"
            >
              {`${title.trim() ? `${title.trim()}\n\n` : ""}${renderWithSamples(content)}`}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
