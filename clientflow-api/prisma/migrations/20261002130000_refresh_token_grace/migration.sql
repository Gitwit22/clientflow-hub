-- The refresh token replaced by the last rotation. It stays usable for a minute so two tabs
-- refreshing at the same moment both stay signed in, instead of one being logged out.
ALTER TABLE "AuthSession" ADD COLUMN "previousRefreshTokenHash" TEXT;
