import type { RefObject } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { insertField, type EmailField } from "@/lib/email-fields";

type TextElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * "Insert field": puts a personal field ({{client.businessName}}) at the cursor of the given text
 * box, so staff personalize an email by picking a label instead of typing braces. Each person's
 * own details replace the field when the email is sent.
 */
export function InsertFieldMenu({
  fields,
  target,
  value,
  onChange,
  label = "Insert field",
  compact = false,
}: {
  fields: readonly EmailField[];
  /** The text box the field goes into; its cursor position is kept while the menu is open. */
  target: RefObject<TextElement | null>;
  value: string;
  onChange: (value: string) => void;
  /** The accessible name, e.g. "Insert field into subject". */
  label?: string;
  /** Icon-only button, for beside a one-line field. */
  compact?: boolean;
}) {
  function insert(key: string) {
    const element = target.current;
    // The cursor position survives the box losing focus to the menu; without a box, add at the end.
    const edit = insertField(
      {
        value,
        selectionStart: element?.selectionStart ?? value.length,
        selectionEnd: element?.selectionEnd ?? value.length,
      },
      key,
    );
    onChange(edit.value);
    requestAnimationFrame(() => {
      const box = target.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={compact ? "h-9 w-9 shrink-0" : "h-7 gap-1 px-2 text-xs"}
          aria-label={label}
          title={label}
          // Keep the text selection when the button is pressed.
          onMouseDown={(event) => event.preventDefault()}
        >
          <Braces className="h-4 w-4" />
          {!compact && "Insert field"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Focus goes back to the text box (with the cursor after the field), not to this button.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Filled in for each person
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {fields.map((field) => (
          <DropdownMenuItem key={field.key} onSelect={() => insert(field.key)}>
            <span className="flex-1">{field.label}</span>
            <span className="ml-3 text-xs text-muted-foreground">{field.sample}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shown under an email editor when the text uses a field that can't be filled in. */
export function UnknownFieldsNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}
