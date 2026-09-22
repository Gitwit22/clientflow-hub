-- Adds an optional per-program welcome message override so cohort-specific details
-- (e.g. IDI kickoff date/location) can be updated without a code deploy.
-- Leaving this NULL preserves the existing hardcoded PROGRAM_WELCOME_MESSAGES behavior.
ALTER TABLE "CfProgram" ADD COLUMN "welcomeMessage" TEXT;
