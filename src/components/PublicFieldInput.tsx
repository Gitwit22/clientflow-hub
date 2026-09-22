import {
  isSocialMediaField,
  RepeatableSocialLinksInput,
  SocialMediaInput,
} from "@/components/SocialMediaInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PublicFormField, PublicFormResponseValue } from "@/lib/apiClient";

export function isBlank(value: PublicFormResponseValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function isPublicFieldRequired(field: PublicFormField): boolean {
  return field.required && field.type !== "file";
}

export function isRequiredResponseComplete(
  field: PublicFormField,
  value: PublicFormResponseValue | undefined,
): boolean {
  if (!isPublicFieldRequired(field)) return true;
  if (field.type === "checkbox") return value === true || value === "true";
  return !isBlank(value);
}

const legacyFieldLabels: Record<string, string> = {
  name: "Name",
  primaryContactName: "Name",
  contactName: "Name",
  business: "Business / Organization Name",
  businessName: "Business / Organization Name",
  email: "Email",
  phone: "Phone",
  website: "Website",
  facebookUrl: "Facebook URL",
  instagramUrl: "Instagram URL",
  linkedinUrl: "LinkedIn URL",
  tiktokUrl: "TikTok URL",
  youtubeUrl: "YouTube URL",
  businessType: "Business type",
  program: "Program or service of interest",
  programOfInterest: "Program or service of interest",
  selectedProgram: "Program of interest",
  description: "Brief business description",
  businessDescription: "Brief business description",
  assistance: "Type of assistance needed",
  assistanceRequested: "Type of assistance needed",
  budget: "Estimated budget",
  budgetNeed: "Estimated budget",
  start: "Desired start date",
  contact: "Preferred contact method",
  preferredContact: "Preferred contact method",
  heard: "How did you hear about us?",
  heardAboutUs: "How did you hear about us?",
  comments: "Additional comments",
  additionalComments: "Additional comments",
};

export function publicFieldLabel(field: PublicFormField): string {
  const label = field.label.trim();
  if (label) return label;
  return (
    legacyFieldLabels[field.id] ??
    (field.id
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .trim() ||
      "Form field")
  );
}

/** Renders the right input control for a public intake/contract field, matching the original intake's style. */
export function PublicFieldInput({
  field,
  inputId,
  value,
  onChange,
  disabled,
}: {
  field: PublicFormField;
  inputId: string;
  value: PublicFormResponseValue;
  onChange: (v: PublicFormResponseValue) => void;
  disabled?: boolean;
}) {
  if (field.type === "social_links") {
    return (
      <RepeatableSocialLinksInput
        inputId={inputId}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  const stringValue = typeof value === "string" ? value : "";
  if (isSocialMediaField(field.id)) {
    return (
      <SocialMediaInput
        fieldId={field.id}
        inputId={inputId}
        value={stringValue}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <Textarea
        id={inputId}
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={disabled}
        placeholder="Enter your answer…"
      />
    );
  }
  if (field.type === "select" && field.options?.length) {
    return (
      <Select value={stringValue} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={inputId}>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={inputId}
          checked={value === true || value === "true"}
          onCheckedChange={(checked) => onChange(String(Boolean(checked)))}
          disabled={disabled}
        />
        <label htmlFor={inputId} className="cursor-pointer text-sm">
          {publicFieldLabel(field)}
          {isPublicFieldRequired(field) && <span className="ml-1 text-destructive">*</span>}
        </label>
      </div>
    );
  }
  if (field.type === "file") {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        File upload — coming soon
      </div>
    );
  }
  if (field.type === "signature") {
    return (
      <div className="space-y-3">
        <Input
          id={inputId}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          maxLength={200}
          autoComplete="name"
          placeholder="Type your full legal name"
        />
        <div className="flex min-h-20 items-center border-b border-foreground/50 px-3 py-2">
          <span className="font-signature text-3xl text-foreground">
            {stringValue || "Your signature"}
          </span>
        </div>
      </div>
    );
  }
  return (
    <Input
      id={inputId}
      type={
        field.type === "phone"
          ? "tel"
          : field.type === "email"
            ? "email"
            : field.type === "url"
              ? "url"
              : field.type === "number"
                ? "number"
                : field.type === "date"
                  ? "date"
                  : "text"
      }
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Enter your answer…"
    />
  );
}
