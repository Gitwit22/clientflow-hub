export function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/accept-invite") ||
    pathname.startsWith("/reset-password") ||
    // Early intake emails linked to /apply/<token>; those links must still open without sign-in.
    pathname.startsWith("/apply/") ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/agreements/")
  );
}
