import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { downloadDocument, uploadDocument } from "@/lib/api";
import {
  cfApproveAward,
  cfCancelAward,
  cfCreateAward,
  cfListAwards,
  cfRecordAwardPayment,
  cfUpdateAward,
  cfVoidAwardPayment,
} from "@/lib/apiClient";
import { isDefinitiveFailure, newIdempotencyKey, DOCUMENT_UPLOAD_ACCEPT } from "@/lib/client-send";
import { localToday } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Award, AwardPaymentMethod, Client, ProgramEnrollment, Terms } from "@/types";

const STATUS_LABEL: Record<Award["status"], string> = {
  pending: "Pending approval",
  approved: "Approved",
  agreement_sent: "Agreement sent",
  agreement_signed: "Agreement signed",
  cancelled: "Cancelled",
};

const PAYMENT_STATE_LABEL: Record<Award["paymentState"], string> = {
  unpaid: "Not paid yet",
  partially_paid: "Partially paid",
  paid: "Paid in full",
};

const METHODS: Array<{ value: AwardPaymentMethod; label: string }> = [
  { value: "check", label: "Check" },
  { value: "ach", label: "Bank transfer (ACH)" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

const day = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : "—";
/** The calendar day of a stored date, for a date input. */
const inputDay = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");

/**
 * Funding awards for one program participation: what was awarded, what has been paid and what is
 * still owed, kept apart from the client's requested funding (intake) and proposed terms.
 */
export function FundingTab({
  client,
  enrollment,
  programName,
  terms,
}: {
  client: Client;
  enrollment: ProgramEnrollment | null;
  programName: string;
  terms: readonly Terms[];
}) {
  const [awards, setAwards] = useState<Award[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Award | "new" | null>(null);
  const [paying, setPaying] = useState<Award | null>(null);
  const [cancelling, setCancelling] = useState<Award | null>(null);

  const enrollmentId = enrollment?.id;
  const load = useCallback(async () => {
    if (!enrollmentId) return;
    setLoading(true);
    try {
      setAwards(await cfListAwards(client.id, enrollmentId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load awards.");
    } finally {
      setLoading(false);
    }
  }, [client.id, enrollmentId]);

  useEffect(() => {
    setAwards([]);
    void load();
  }, [load]);

  if (!enrollment) {
    return (
      <p className="text-sm text-muted-foreground">
        Choose a program above to see its funding awards.
      </p>
    );
  }

  const replace = (updated: Award) =>
    setAwards((current) => current.map((award) => (award.id === updated.id ? updated : award)));
  const counted = awards.filter((award) => award.status !== "cancelled");
  const totals = counted.reduce(
    (sum, award) => ({
      awarded: sum.awarded + award.amountAwarded,
      received: sum.received + award.received,
      outstanding: sum.outstanding + award.outstanding,
    }),
    { awarded: 0, received: 0, outstanding: 0 },
  );
  const requested = client.intake?.budgetNeed;
  const proposed = terms.filter(
    (term) => term.enrollmentId === enrollment.id || !term.enrollmentId,
  );

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="font-display text-base">Funding awards · {programName}</CardTitle>
          <Button size="sm" onClick={() => setEditing("new")} disabled={enrollment.isArchived}>
            Add award
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-3 gap-3" aria-label="Award totals">
            <Figure label="Awarded" value={totals.awarded} />
            <Figure label="Received" value={totals.received} />
            <Figure label="Still owed" value={totals.outstanding} />
          </dl>
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <span className="font-medium text-foreground">Requested at intake:</span>{" "}
              {requested ? String(requested) : "Not stated"}
            </p>
            <p>
              <span className="font-medium text-foreground">Proposed in terms:</span>{" "}
              {proposed.length
                ? proposed.map((term) => formatMoney(term.fundingAmount)).join(", ")
                : "None"}
            </p>
          </div>
          {enrollment.isArchived && (
            <p className="text-xs text-muted-foreground">
              This participation is archived. No new awards can be added, but payments on awards
              already given can still be recorded.
            </p>
          )}
        </CardContent>
      </Card>

      {loading && !awards.length ? (
        <p className="text-sm text-muted-foreground">Loading awards…</p>
      ) : awards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No awards recorded for this program yet.</p>
      ) : (
        awards.map((award) => (
          <AwardCard
            key={award.id}
            award={award}
            clientId={client.id}
            onChanged={replace}
            onEdit={() => setEditing(award)}
            onPay={() => setPaying(award)}
            onCancel={() => setCancelling(award)}
            onReload={() => void load()}
          />
        ))
      )}

      <AwardDialog
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        award={editing === "new" ? null : editing}
        open={editing !== null}
        clientId={client.id}
        enrollmentId={enrollment.id}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          setAwards((current) =>
            current.some((award) => award.id === saved.id)
              ? current.map((award) => (award.id === saved.id ? saved : award))
              : [saved, ...current],
          );
        }}
      />
      <RecordAwardPaymentDialog
        key={paying?.id ?? "closed"}
        award={paying}
        onOpenChange={(open) => !open && setPaying(null)}
        onSaved={(saved) => {
          setPaying(null);
          replace(saved);
        }}
      />
      <CancelAwardDialog
        key={cancelling?.id ?? "closed-cancel"}
        award={cancelling}
        onOpenChange={(open) => !open && setCancelling(null)}
        onSaved={(saved) => {
          setCancelling(null);
          replace(saved);
        }}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <dt className="font-mono text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className="font-display text-lg">{formatMoney(value)}</dd>
    </div>
  );
}

function AwardCard({
  award,
  clientId,
  onChanged,
  onEdit,
  onPay,
  onCancel,
  onReload,
}: {
  award: Award;
  clientId: string;
  onChanged: (award: Award) => void;
  onEdit: () => void;
  onPay: () => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const cancelled = award.status === "cancelled";
  const canPay = !cancelled && award.status !== "pending" && award.outstanding > 0;

  async function approve() {
    setBusy(true);
    try {
      onChanged(await cfApproveAward(award.id));
      toast.success("Award approved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to approve the award.");
    } finally {
      setBusy(false);
    }
  }

  async function voidPayment(paymentId: string) {
    setBusy(true);
    try {
      onChanged(await cfVoidAwardPayment(paymentId, voidReason.trim()));
      setVoidingId(null);
      setVoidReason("");
      toast.success("Payment voided. It stays in the ledger, marked as void.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to void the payment.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      await uploadDocument(clientId, file, award.enrollmentId, award.id);
      toast.success("Document added to the award.");
      onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload the document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-card" aria-label={`Award ${award.title}`}>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-base">{award.title}</CardTitle>
          <div className="flex flex-wrap gap-1">
            <Badge variant={cancelled ? "outline" : "default"}>{STATUS_LABEL[award.status]}</Badge>
            {!cancelled && (
              <Badge variant="outline">{PAYMENT_STATE_LABEL[award.paymentState]}</Badge>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {award.source} · awarded {day(award.awardDate)}
          {award.expectedPaymentDate ? ` · payment expected ${day(award.expectedPaymentDate)}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-3 gap-3">
          <Figure label="Awarded" value={award.amountAwarded} />
          <Figure label="Received" value={award.received} />
          <Figure label="Still owed" value={award.outstanding} />
        </dl>
        {award.notes && <p className="whitespace-pre-wrap text-muted-foreground">{award.notes}</p>}
        {cancelled && (
          <p className="text-muted-foreground">
            Cancelled {day(award.cancelledAt)} by {award.cancelledByDisplayName}:{" "}
            {award.cancelReason}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {award.status === "pending" && (
            <Button size="sm" disabled={busy} onClick={() => void approve()}>
              Approve
            </Button>
          )}
          {canPay && (
            <Button size="sm" disabled={busy} onClick={onPay}>
              Record payment
            </Button>
          )}
          {!cancelled && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
              Edit
            </Button>
          )}
          {!cancelled && award.received === 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
              Cancel award
            </Button>
          )}
        </div>

        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Payments</p>
          {award.payments.length === 0 ? (
            <p className="text-muted-foreground">No payments recorded.</p>
          ) : (
            <ul className="space-y-1" aria-label="Award payments">
              {award.payments.map((payment) => (
                <li key={payment.id} className="rounded border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={payment.voidedAt ? "line-through text-muted-foreground" : ""}>
                      {formatMoney(payment.amount)} · {day(payment.paymentDate)} ·{" "}
                      {METHODS.find((method) => method.value === payment.paymentMethod)?.label}
                      {payment.note ? ` · ${payment.note}` : ""}
                    </span>
                    {!payment.voidedAt && voidingId !== payment.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setVoidingId(payment.id);
                          setVoidReason("");
                        }}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                  {payment.voidedAt && (
                    <p className="text-xs text-muted-foreground">
                      Voided by {payment.voidedByDisplayName}: {payment.voidReason}
                    </p>
                  )}
                  {voidingId === payment.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Reason for voiding"
                        value={voidReason}
                        onChange={(event) => setVoidReason(event.target.value)}
                        placeholder="Why is this payment being voided?"
                        className="max-w-sm"
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy || !voidReason.trim()}
                        onClick={() => void voidPayment(payment.id)}
                      >
                        Void payment
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setVoidingId(null)}>
                        Keep
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Supporting documents
          </p>
          {award.documents.length > 0 && (
            <ul className="space-y-1">
              {award.documents.map((document) => (
                <li key={document.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{document.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void downloadDocument(document.id, { view: true }).catch((error: unknown) =>
                        toast.error(error instanceof Error ? error.message : "Unable to open."),
                      )
                    }
                  >
                    View
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Input
            type="file"
            aria-label={`Add a document to ${award.title}`}
            accept={DOCUMENT_UPLOAD_ACCEPT}
            disabled={busy}
            onChange={(event) => {
              void upload(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AwardDialog({
  award,
  open,
  clientId,
  enrollmentId,
  onOpenChange,
  onSaved,
}: {
  award: Award | null;
  open: boolean;
  clientId: string;
  enrollmentId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (award: Award) => void;
}) {
  const [title, setTitle] = useState(award?.title ?? "");
  const [source, setSource] = useState(award?.source ?? "");
  const [amount, setAmount] = useState(award ? String(award.amountAwarded) : "");
  const [awardDate, setAwardDate] = useState(inputDay(award?.awardDate) || localToday());
  const [expected, setExpected] = useState(inputDay(award?.expectedPaymentDate));
  const [notes, setNotes] = useState(award?.notes ?? "");
  const [approve, setApprove] = useState(false);
  const [replaceAgreement, setReplaceAgreement] = useState(false);
  const [saving, setSaving] = useState(false);
  const attemptKey = useRef<string | null>(null);
  const hasAgreement = award?.status === "agreement_sent" || award?.status === "agreement_signed";

  async function save() {
    const amountAwarded = Number(amount);
    if (!title.trim() || !source.trim() || !(amountAwarded > 0) || !awardDate) {
      toast.error("Enter a title, source, amount and award date.");
      return;
    }
    setSaving(true);
    try {
      let saved: Award;
      if (award) {
        saved = await cfUpdateAward(award.id, {
          title: title.trim(),
          source: source.trim(),
          amountAwarded,
          awardDate,
          expectedPaymentDate: expected || null,
          notes,
          ...(replaceAgreement ? { replaceAgreement: true } : {}),
        });
      } else {
        attemptKey.current ??= newIdempotencyKey();
        saved = await cfCreateAward(
          clientId,
          enrollmentId,
          {
            title: title.trim(),
            source: source.trim(),
            amountAwarded,
            awardDate,
            ...(expected ? { expectedPaymentDate: expected } : {}),
            ...(notes.trim() ? { notes } : {}),
            approve,
          },
          attemptKey.current,
        );
        attemptKey.current = null;
      }
      toast.success(award ? "Award updated." : "Award recorded.");
      onSaved(saved);
    } catch (error) {
      if (isDefinitiveFailure(error)) attemptKey.current = null;
      toast.error(error instanceof Error ? error.message : "Unable to save the award.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{award ? "Edit award" : "Add award"}</DialogTitle>
          <DialogDescription>
            The amount awarded. Payments are recorded separately as they are made.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="award-title">Title</Label>
            <Input
              id="award-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Member Business Achievement Award"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="award-source">Source</Label>
            <Input
              id="award-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="IDI Member Fund"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="award-amount">Amount awarded ($)</Label>
            <Input
              id="award-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="award-date">Award date</Label>
            <Input
              id="award-date"
              type="date"
              value={awardDate}
              onChange={(event) => setAwardDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="award-expected">Payment expected (optional)</Label>
            <Input
              id="award-expected"
              type="date"
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="award-notes">Notes</Label>
            <Textarea
              id="award-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {!award && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={approve} onCheckedChange={(value) => setApprove(value === true)} />
              Already approved
            </label>
          )}
          {hasAgreement && (
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={replaceAgreement}
                onCheckedChange={(value) => setReplaceAgreement(value === true)}
                aria-label="Replace the award agreement"
              />
              <span>
                Replace the award agreement. Needed to change the title, source, amount or date:
                {award?.status === "agreement_signed"
                  ? " the signed agreement is kept as history and a new one must be prepared."
                  : " the unsigned agreement is cancelled and a new one must be prepared."}
              </span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : award ? "Save changes" : "Add award"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordAwardPaymentDialog({
  award,
  onOpenChange,
  onSaved,
}: {
  award: Award | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (award: Award) => void;
}) {
  const [amount, setAmount] = useState(award ? String(award.outstanding) : "");
  const [paymentDate, setPaymentDate] = useState(localToday());
  const [method, setMethod] = useState<AwardPaymentMethod>("check");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // One key per payment being entered: kept across a retry after a dropped connection.
  const attemptKey = useRef<string | null>(null);

  async function save() {
    if (!award) return;
    const value = Number(amount);
    if (!(value > 0)) {
      toast.error("Enter the amount paid.");
      return;
    }
    if (value > award.outstanding) {
      toast.error(`That is more than the ${formatMoney(award.outstanding)} still owed.`);
      return;
    }
    setSaving(true);
    try {
      attemptKey.current ??= newIdempotencyKey();
      const saved = await cfRecordAwardPayment(
        award.id,
        { amount: value, paymentDate, paymentMethod: method, ...(note.trim() ? { note } : {}) },
        attemptKey.current,
      );
      attemptKey.current = null;
      toast.success("Payment recorded.");
      onSaved(saved);
    } catch (error) {
      if (isDefinitiveFailure(error)) attemptKey.current = null;
      toast.error(error instanceof Error ? error.message : "Unable to record the payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={award !== null} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Record award payment</DialogTitle>
          <DialogDescription>
            {award ? `${award.title}: ${formatMoney(award.outstanding)} still owed.` : ""} Mistakes
            are voided, never edited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="award-payment-amount">Amount paid ($)</Label>
            <Input
              id="award-payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="award-payment-date">Payment date</Label>
            <Input
              id="award-payment-date"
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Method</Label>
            <Select
              value={method}
              onValueChange={(value) => setMethod(value as AwardPaymentMethod)}
            >
              <SelectTrigger aria-label="Payment method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="award-payment-note">Note (optional)</Label>
            <Input
              id="award-payment-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Check #1042"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelAwardDialog({
  award,
  onOpenChange,
  onSaved,
}: {
  award: Award | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (award: Award) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (!award) return;
    setSaving(true);
    try {
      onSaved(await cfCancelAward(award.id, reason.trim()));
      toast.success("Award cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to cancel the award.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={award !== null} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Cancel this award?</DialogTitle>
          <DialogDescription>
            {award?.title}. An agreement waiting for a signature is cancelled too; a signed one is
            kept as history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="award-cancel-reason">Reason</Label>
          <Textarea
            id="award-cancel-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Keep award
          </Button>
          <Button
            variant="destructive"
            disabled={saving || !reason.trim()}
            onClick={() => void confirm()}
          >
            {saving ? "Cancelling…" : "Cancel award"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
