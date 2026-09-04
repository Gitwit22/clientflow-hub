import { Clock3, LogOut } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface IdleSessionWarningProps {
  open: boolean;
  secondsRemaining: number;
  isLoggingOut: boolean;
  onContinue: () => void;
  onLogout: () => void;
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function IdleSessionWarning({
  open,
  secondsRemaining,
  isLoggingOut,
  onContinue,
  onLogout,
}: IdleSessionWarningProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-md bg-amber-100 text-amber-700 sm:mx-0">
            <Clock3 className="size-5" />
          </div>
          <AlertDialogTitle>Your session is about to expire</AlertDialogTitle>
          <AlertDialogDescription>
            You have been inactive. Continue your session to keep working, or you will be signed out
            automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-center"
          role="timer"
          aria-live="polite"
          aria-label={`${secondsRemaining} seconds remaining`}
        >
          <p className="font-mono text-2xl font-semibold text-amber-900">
            {formatCountdown(secondsRemaining)}
          </p>
          <p className="mt-1 text-xs text-amber-800">until automatic sign out</p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onLogout} disabled={isLoggingOut}>
            <LogOut className="size-4" />
            {isLoggingOut ? "Signing out..." : "Sign out now"}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onContinue} disabled={isLoggingOut}>
            Continue session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
