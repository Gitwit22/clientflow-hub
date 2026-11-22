import { AlignCenter, Bold, Italic, List, ListOrdered, Underline } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  currentLineSize,
  setLineSize,
  toggleCenter,
  type AgreementSize,
} from "@/lib/agreement-editing";
import { formattingProblems } from "@/lib/agreement-format";
import { continueListOnEnter, toggleList, wrapSelection, type TextEdit } from "@/lib/email-format";

const SIZE_LABELS: Record<AgreementSize, string> = {
  heading: "Heading",
  subheading: "Subheading",
  normal: "Normal text",
  small: "Small print",
};

/**
 * The agreement text with a formatting toolbar: bold, italic, underline, text size, lists and
 * centering. The toolbar writes the light markup of agreement-format.ts into the text, which the
 * preview, the client's signing page and the signed PDF all show formatted.
 */
export function AgreementEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState<AgreementSize>("normal");
  const problems = formattingProblems(value);

  function current(): TextEdit {
    const element = textarea.current;
    return {
      value,
      selectionStart: element?.selectionStart ?? value.length,
      selectionEnd: element?.selectionEnd ?? value.length,
    };
  }

  function apply(edit: TextEdit | null) {
    if (!edit) return;
    onChange(edit.value);
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  const tools = [
    { label: "Bold", icon: Bold, run: () => apply(wrapSelection(current(), "**", "bold text")) },
    {
      label: "Italic",
      icon: Italic,
      run: () => apply(wrapSelection(current(), "_", "italic text")),
    },
    {
      label: "Underline",
      icon: Underline,
      run: () => apply(wrapSelection(current(), "++", "underlined text")),
    },
    { label: "Bulleted list", icon: List, run: () => apply(toggleList(current(), "bullet")) },
    {
      label: "Numbered list",
      icon: ListOrdered,
      run: () => apply(toggleList(current(), "numbered")),
    },
    { label: "Center", icon: AlignCenter, run: () => apply(toggleCenter(current())) },
  ];

  return (
    <div className="space-y-1.5">
      <div className="rounded-md border border-input">
        <div
          role="toolbar"
          aria-label="Agreement formatting"
          className="flex flex-wrap items-center gap-1 border-b border-input px-1 py-1"
        >
          <Select
            value={size}
            disabled={disabled}
            onValueChange={(next) => {
              setSize(next as AgreementSize);
              apply(setLineSize(current(), next as AgreementSize));
            }}
          >
            <SelectTrigger aria-label="Text size" className="h-7 w-[9.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SIZE_LABELS) as AgreementSize[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SIZE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tools.map((tool) => (
            <Button
              key={tool.label}
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={tool.label}
              title={tool.label}
              disabled={disabled}
              // Keep the text selection when the button is pressed.
              onMouseDown={(event) => event.preventDefault()}
              onClick={tool.run}
            >
              <tool.icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
        <Textarea
          ref={textarea}
          value={value}
          disabled={disabled}
          rows={14}
          aria-label="Agreement text"
          className="rounded-none border-0 shadow-none focus-visible:ring-0"
          placeholder="Agreement text. Use merge fields such as {{client.businessName}}."
          onChange={(event) => onChange(event.target.value)}
          // The size menu follows the line the caret is on.
          onSelect={() => setSize(currentLineSize(current()))}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            const next = continueListOnEnter(current());
            if (!next) return;
            event.preventDefault();
            apply(next);
          }}
        />
      </div>
      {problems.length > 0 && (
        <ul role="status" className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Select text and use the buttons, or type **bold**, _italic_, ++underline++. Start a line
        with &quot;# &quot; for a heading, &quot;## &quot; for a subheading, &quot;-# &quot; for
        small print, &quot;- &quot; or &quot;1. &quot; for a list; wrap a line in -&gt; and &lt;- to
        center it. The preview shows it as the client will see it.
      </p>
    </div>
  );
}
