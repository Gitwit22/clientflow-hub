import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UnsavedChangesMarker } from "@/components/CollapsibleSection";
import { HelpLink } from "@/components/help/HelpLink";
import { validationErrorProps } from "@/lib/section-markers";
import { PAGE_HELP_TOPICS } from "@/lib/help-content";
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
import {
  AgreementImportError,
  extractAgreementText,
  IMPORT_ACCEPT,
  remainingBlanks,
  suggestMergeFields,
} from "@/lib/agreement-import";
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
  embedded = false,
}: {
  program: Program;
  workflow: ProgramWorkflow | undefined;
  onChanged: () => void;
  /** Inside a section titled "Agreements" (which carries the #agreements link target). */
  embedded?: boolean;
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
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  /** A document waiting for staff to confirm it may replace the text already in the editor. */
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  /** The imported document's name while its suggested merge fields are offered. */
  const [importedFrom, setImportedFrom] = useState<string | null>(null);

  // The editor starts from the active version of the selected template, and resets only when the
  // selected template or its active version changes (not on every keystroke-driven re-render).
  function restoreEditor() {
    setTitle(activeVersion?.title ?? "");
    setContent(activeVersion?.content ?? "");
    setFile(null);
    setShowSample(false);
    setPendingImport(null);
    setImportedFrom(null);
  }
  useEffect(() => {
    restoreEditor();
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
  // Suggestions are worked out from the current text, so an applied one simply stops matching.
  const suggestions = useMemo(
    () => (importedFrom ? suggestMergeFields(content, editingPurpose) : []),
    [importedFrom, content, editingPurpose],
  );
  const blanksLeft = importedFrom ? remainingBlanks(content) : 0;
  const unsaved = adding
    ? Boolean(content.trim() || newName.trim() || file)
    : title !== (activeVersion?.title ?? "") ||
      content !== (activeVersion?.content ?? "") ||
      Boolean(file);

  function chooseImport(selected: File | undefined) {
    if (importInput.current) importInput.current.value = "";
    if (!selected) return;
    if (content.trim()) setPendingImport(selected);
    else void importDocument(selected);
  }

  async function importDocument(document: File) {
    setPendingImport(null);
    setImporting(true);
    try {
      const imported = await extractAgreementText(document);
      setContent(imported.text);
      setShowSample(false);
      // The original is kept with the version for staff; clients sign the text.
      setFile(document);
      if (adding && !newName.trim()) setNewName(imported.name);
      setImportedFrom(document.name);
      toast.success("Document imported. Check the text and the suggested fields before saving.");
    } catch (error) {
      toast.error(
        error instanceof AgreementImportError ? error.message : "Unable to read this document.",
      );
    } finally {
      setImporting(false);
    }
  }

  const applySuggestion = (apply: (text: string) => string) => setContent((text) => apply(text));
  const applyAllSuggestions = () =>
    setContent((text) => suggestions.reduce((current, item) => item.apply(current), text));

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
        setImportedFrom(null);
      },
      "Agreement version saved. New agreements use it; ones already sent keep their text.",
      "Unable to save this agreement version.",
    );

  const addTemplate = () =>
    act(
      async () => {
        const fileId = await storedFileId();
        const existingIds = new Set(templates.map((template) => template.id));
        const next = await createProgramWorkflowContractTemplate(program.id, {
          name: newName.trim(),
          purpose: newPurpose,
          title: title.trim() || newName.trim(),
          content: content.trim(),
          storedFileId: fileId,
          isActive: true,
        });
        // Show the new template, so its wording isn't left in another template's editor.
        const added = next?.contract?.templates?.find((template) => !existingIds.has(template.id));
        if (added) setSelectedId(added.id);
        else restoreEditor();
        setAdding(false);
        setNewName("");
        setFile(null);
        setImportedFrom(null);
      },
      "Agreement template added.",
      "Unable to add this agreement template.",
    );

  return (
    <div
      id={embedded ? undefined : "agreements"}
      className={
        embedded ? "space-y-3" : "scroll-mt-4 space-y-3 rounded-lg border border-border p-3"
      }
    >
      {unsaved && <UnsavedChangesMarker />}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {!embedded && (
            <p className="font-mono text-[10px] uppercase text-muted-foreground">Agreements</p>
          )}
          <p className="text-xs text-muted-foreground">
            New agreements use each template&apos;s active version. Agreements already sent or
            signed keep the text they were sent with.
          </p>
          <HelpLink topic={PAGE_HELP_TOPICS.agreements} className="mt-1" />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => {
            if (adding) {
              setAdding(false);
              restoreEditor();
            } else {
              setAdding(true);
              setTitle("");
              setContent("");
              setFile(null);
              setShowSample(false);
            }
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
              placeholder="Grant Award Agreement"
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={importing || saving}
              onClick={() => importInput.current?.click()}
            >
              {importing ? "Reading document…" : "Import from PDF or Word"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Brings in the document&apos;s text to review. Nothing is saved until you save.
            </span>
            <input
              ref={importInput}
              type="file"
              accept={IMPORT_ACCEPT}
              aria-label="Import agreement from a PDF or Word document"
              className="hidden"
              onChange={(event) => chooseImport(event.target.files?.[0])}
            />
          </div>
          {pendingImport && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded border border-border bg-muted/40 p-2 text-xs"
            >
              <span>Replace the text in the editor with &ldquo;{pendingImport.name}&rdquo;?</span>
              <Button size="sm" type="button" onClick={() => void importDocument(pendingImport)}>
                Replace text
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setPendingImport(null)}
              >
                Keep my text
              </Button>
            </div>
          )}
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
            <p role="alert" className="text-xs text-destructive" {...validationErrorProps}>
              Not available in {PURPOSE_LABEL[editingPurpose].toLowerCase()}s:{" "}
              {problems.map((key) => `{{${key}}}`).join(", ")}
            </p>
          )}
          {importedFrom && (
            <div
              aria-label="Suggested merge fields"
              className="space-y-2 rounded border border-border p-3 text-xs"
            >
              <p className="font-medium">
                Imported from &ldquo;{importedFrom}&rdquo;. Fill in what changes for each client:
              </p>
              {suggestions.length > 0 ? (
                <ul className="space-y-1.5">
                  {suggestions.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{item.label}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => applySuggestion(item.apply)}
                      >
                        Apply
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No more suggestions.</p>
              )}
              {suggestions.length > 1 && (
                <Button size="sm" type="button" onClick={applyAllSuggestions}>
                  Apply all
                </Button>
              )}
              {blanksLeft > 0 && (
                <p className="text-destructive">
                  {blanksLeft === 1 ? "1 blank (____) is" : `${blanksLeft} blanks (____) are`} left
                  in the text. Replace each with a merge field or the wording you want.
                </p>
              )}
              <p className="text-muted-foreground">
                Other wording that differs per award, such as the award&apos;s name, can use{" "}
                <code>{"{{award.title}}"}</code> and <code>{"{{award.source}}"}</code>.
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="agreement-original-document" className="text-xs">
              Original document (optional)
            </Label>
            {file ? (
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span>{file.name}</span>
                <Button
                  size="sm"
                  variant="link"
                  type="button"
                  className="h-auto p-0"
                  onClick={() => setFile(null)}
                >
                  Remove
                </Button>
              </p>
            ) : (
              <Input
                id="agreement-original-document"
                type="file"
                accept={DOCUMENT_UPLOAD_ACCEPT}
                aria-label="Agreement document"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Kept for staff. Clients read and sign the text above, filled in for each client.
            </p>
          </div>
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
