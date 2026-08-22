import { useEffect, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createEnrollment, reactivateEnrollment } from "@/lib/api";
import { useAppState } from "@/lib/store";
import type { Program } from "@/types";

const CLOSED_STATUSES = new Set(["completed", "declined", "withdrawn"]);

export function ManageProgramMembersDialog({
  program,
  open,
  onOpenChange,
}: {
  program: Program;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { clients, enrollments } = useAppState();
  const [query, setQuery] = useState("");
  const [savingClientId, setSavingClientId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const candidates = clients
    .filter((client) => !client.isArchived)
    .map((client) => ({
      client,
      enrollment: enrollments.find(
        (item) => item.clientId === client.id && item.programId === program.id,
      ),
    }))
    .filter(({ client, enrollment }) => {
      if (enrollment && !CLOSED_STATUSES.has(enrollment.status)) return false;
      if (!normalizedQuery) return true;
      return [client.businessName, client.primaryContactName, client.email].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      );
    });

  async function addMember(clientId: string) {
    const existing = enrollments.find(
      (item) => item.clientId === clientId && item.programId === program.id,
    );
    setSavingClientId(clientId);
    try {
      if (existing) {
        await reactivateEnrollment(existing.id);
        toast.success("Program membership reactivated.");
      } else {
        await createEnrollment({ clientId, programId: program.id, status: "interested" });
        toast.success("Client added to program.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update membership.");
    } finally {
      setSavingClientId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Add program members</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients by name or email"
            className="pl-9"
          />
        </div>
        <div className="max-h-[55vh] divide-y divide-border overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No eligible clients match this search.
            </p>
          ) : (
            candidates.map(({ client, enrollment }) => (
              <div key={client.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{client.businessName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {client.primaryContactName} · {client.email}
                  </p>
                  {enrollment && (
                    <p className="mt-1 text-xs capitalize text-muted-foreground">
                      Previous status: {enrollment.status.replace(/_/g, " ")}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingClientId !== null}
                  onClick={() => void addMember(client.id)}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  {savingClientId === client.id
                    ? "Saving..."
                    : enrollment
                      ? "Reactivate"
                      : "Add"}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}