import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateEnrollment } from "@/lib/api";
import { dateInputValue, joinedDateFromInput } from "@/lib/enrollment-dates";
import { isTerminalEnrollmentStatus } from "@/lib/enrollment-status";
import type { ProgramEnrollment } from "@/types";

/** Shows when the client joined the program and lets staff correct it. */
export function JoinedDateEditor({ enrollment }: { enrollment: ProgramEnrollment }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span>
          {enrollment.startDate
            ? new Date(enrollment.startDate).toLocaleDateString()
            : isTerminalEnrollmentStatus(enrollment.status)
              ? "Not recorded"
              : "Set when the contract is signed"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => {
            setValue(dateInputValue(enrollment.startDate));
            setEditing(true);
          }}
        >
          Edit
        </Button>
      </span>
    );
  }

  async function save() {
    setSaving(true);
    try {
      await updateEnrollment(enrollment.id, { startDate: joinedDateFromInput(value) });
      toast.success("Joined date saved.");
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the joined date.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        aria-label="Joined date"
        className="h-8 w-auto"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={saving}
      />
      <Button type="button" size="sm" className="h-8" onClick={() => void save()} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8"
        onClick={() => setEditing(false)}
        disabled={saving}
      >
        Cancel
      </Button>
    </span>
  );
}
