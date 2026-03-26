export const normalizePathname = (pathname: string) => pathname || "/";
export const meetingCodeFromPathname = (pathname: string) =>
  pathname === "/" ? null : pathname.slice(1).toLowerCase();

