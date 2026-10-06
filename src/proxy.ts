import { NextResponse, type NextRequest } from "next/server";

/** Forwards the requested path so server code can send signed-out users back here after login. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest).*)"],
};
