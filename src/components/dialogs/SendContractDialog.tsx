import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSendAttempt } from "@/hooks/use-send-attempt";
import {
  downloadExecutedContract,
  getProgramWorkflow,
  refreshClientCommunications,
  refreshClientContracts,
} from "@/lib/api";
import {
  acfGenerateContract,
  acfPreviewContract,
  acfSendContract,
  acfSendContractCopy,
  ApiError,
  type AgreementPreview,
} from "@/lib/apiClient";
import {
  contractSendState,
  currentContract,
  describeDelivery,
  recipientProblem,
} from "@/lib/client-send";
import type { Client, Contract, Program, ProgramEnrollment } from "@/types";

const dateLabel = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "");

/**
 * One place to send a contract, resend its signing link, or email the signed copy. The three are
 * separate operations on the server: a signed contract can only be sent as a copy, never back
 * through the signing-link flow.
 */
export function SendContractDialog({
  client,
  enrollment,
  program,
  contracts,
  staffSigner,
  open,
  onOpenChange,
}: {
  client: Client;
  enrollment: ProgramEnrollment;
  program: Program | undefined;
  /** This client's contracts (any enrollment; the newest one for the enrollment is used). */
  contracts: readonly Contract[];
  staffSigner: { name: string; id?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const attempt = useSendAttempt();
  const problem = recipientProblem(client);
  const state = contractSendState(currentContract(contracts, enrollment.id));
  const needsTemplate = state.kind === "none" || state.kind === "closed";
  // A new agreement or an unsent draft is reviewed, exactly as the client will read it, before sending.
  const needsReview = needsTemplate || state.kind === "draft";
  const [templateReady, setTemplateReady] = useState<boolean | null>(null);
  const [review, setReview] = useState<AgreementPreview | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);

  useEffect(() => {
    if (!open) setReview(null);
  }, [open]);

  async function loadReview() {
    setLoadingReview(true);
    try {
      setReview(await acfPreviewContract(client.id, { enrollmentId: enrollment.id }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the agreement.");
    } finally {
      setLoadingReview(false);
    }
  }

  // Only a brand-new contract needs the program's active template; check it up front.
  useEffect(() => {
    if (!open || !needsTemplate || !program) return;
    let cancelled = false;
    setTemplateReady(null);
    getProgramWorkflow(program.id)
      .then((workflow) => {
        if (!cancelled) setTemplateReady(!!workflow.contract.activeVersion);
      })
      .catch(() => {
        if (!cancelled) setTemplateReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, needsTemplate, program?.id]);

  async function refresh() {
    await Promise.allSettled([
      refreshClientContracts(client.id),
      refreshClientCommunications(client.id),
    ]);
  }

  async function run(action: "send" | "copy") {
    try {
      const result = await attempt.run(async (idempotencyKey) => {
        if (action === "copy" && state.kind === "signed") {
          return acfSendContractCopy(client.id, state.contract.id, { idempotencyKey });
        }
        // Reuse the contract already drafted/sent; only draft a new one when there isn't one.
        const existing =
          "contract" in state && state.kind !== "closed" ? state.contract : undefined;
        const contractId =
          existing?.id ??
          (
            await acfGenerateContract(client.id, {
              staffSignerName: staffSigner.name,
              ...(staffSigner.id ? { staffSignerId: staffSigner.id } : {}),
              enrollmentId: enrollment.id,
              // Pin the new agreement to exactly the text staff reviewed.
              ...(review && !review.existingContractId
                ? { reviewedVersionId: review.versionId, reviewedContentHash: review.contentHash }
                : {}),
            })
          ).contract.id;
        return acfSendContract(client.id, contractId, {
          enrollmentId: enrollment.id,
          idempotencyKey,
        });
      });
      if (!result) return;
      void refresh();
      const outcome = describeDelivery(result.emailDelivery);
      if (outcome.ok) {
        toast.success(
          action === "copy"
            ? `Signed copy sent to ${client.email}.`
            : state.kind === "sent" || state.kind === "opened"
              ? `Contract resent to ${client.email}.`
              : `Contract sent to ${client.email}.`,
        );
        onOpenChange(false);
      } else {
        toast.error(outcome.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send this contract.");
      // The agreement changed after it was reviewed: show the current text instead.
      if (error instanceof ApiError && error.status === 409 && review) void loadReview();
    }
  }

  const programName = program?.name ?? "this program";
  const busy = attempt.sending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={review ? "sm:max-w-2xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle className="font-display">Contract</DialogTitle>
          <DialogDescription>
            {programName} · {client.email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {review && needsReview ? (
            <AgreementReviewPanel review={review} />
          ) : state.kind === "signed" ? (
            <>
              <p>
                <span className="font-medium">Signed {dateLabel(state.contract.signedAt)}.</span>{" "}
                {state.contract.contractType}
              </p>
              <p className="text-muted-foreground">
                Sending a copy emails a download link for the signed agreement. The signing link is
                not reissued.
              </p>
              {!state.contract.executedStoredFileId && (
                <p className="text-muted-foreground">The signed copy is not available yet.</p>
              )}
            </>
          ) : state.kind === "sent" || state.kind === "opened" ? (
            <>
              <p>
                <span className="font-medium">
                  {state.kind === "opened" ? "Opened" : "Sent"} {dateLabel(state.contract.sentAt)}.
                </span>{" "}
                Waiting for a signature.
              </p>
              <p className="text-muted-foreground">
                Resending emails a new signing link. The previous link stops working.
              </p>
            </>
          ) : state.kind === "draft" ? (
            <p>
              A draft contract is ready: {state.contract.contractType}. Sending emails the signing
              link.
            </p>
          ) : templateReady === false ? (
            <div className="space-y-2">
              <p role="alert" className="text-destructive">
                No active contract is configured for this program.
              </p>
              {program && (
                <Button asChild variant="outline" size="sm">
                  <Link to="/programs/$programId" params={{ programId: program.id }}>
                    Go to Program Contract Settings
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              {state.kind === "closed"
                ? "The previous contract is closed. Sending drafts a new one"
                : "No contract has been drafted yet. Sending drafts one"}{" "}
              from the program&apos;s active template and emails the signing link.
            </p>
          )}
        </div>

        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Close
          </Button>
          {state.kind === "signed" ? (
            <>
              {state.contract.executedStoredFileId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void downloadExecutedContract(client.id, state.contract.id).catch(
                      (error: unknown) =>
                        toast.error(
                          error instanceof Error ? error.message : "Contract download failed.",
                        ),
                    );
                  }}
                >
                  View executed contract
                </Button>
              )}
              <Button
                type="button"
                onClick={() => run("copy")}
                disabled={busy || !state.contract.executedStoredFileId || !!problem}
              >
                {busy ? "Sending…" : "Send copy"}
              </Button>
            </>
          ) : needsReview && !review ? (
            <Button
              type="button"
              onClick={() => void loadReview()}
              disabled={loadingReview || (needsTemplate && templateReady === false) || !!problem}
            >
              {loadingReview ? "Preparing…" : "Review agreement"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => run("send")}
              disabled={
                busy ||
                (needsTemplate && templateReady === false) ||
                !!problem ||
                (review?.missing.length ?? 0) > 0
              }
            >
              {busy
                ? "Sending…"
                : state.kind === "sent" || state.kind === "opened"
                  ? "Resend signing link"
                  : "Send contract"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The agreement exactly as the client will read it, with any details still missing. */
function AgreementReviewPanel({ review }: { review: AgreementPreview }) {
  return (
    <div className="space-y-3">
      <p className="font-medium">{review.title}</p>
      <pre
        aria-label="Agreement text"
        className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-sans text-sm"
      >
        {review.content}
      </pre>
      {review.missing.length > 0 ? (
        <div role="alert" className="space-y-1 text-destructive">
          <p className="font-medium">Fill in these details before sending:</p>
          <ul className="list-disc pl-5">
            {review.missing.map((field) => (
              <li key={field.key}>{field.label}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">
          This is the text the client will sign. Sending emails them the signing link.
        </p>
      )}
    </div>
  );
}
