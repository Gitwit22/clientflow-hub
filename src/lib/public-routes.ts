export function isPublicRoute(pathname: string): boolean {
  return pathname === "/login"
    || pathname.startsWith("/accept-invite")
    || pathname.startsWith("/s/")
    || pathname.startsWith("/agreements/");
}
