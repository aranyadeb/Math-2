import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = ["/login", "/auth", "/setup", "/manifest.webmanifest", "/sw.js", "/icons"];
// The graph lab holds no private data; it is open in development for renderer testing.
const DEV_PUBLIC = process.env.NODE_ENV !== "production" ? ["/lab"] : [];

/** Refresh the Supabase session cookie and gate app pages behind sign-in. */
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = req.nextUrl.pathname;
  if (DEV_PUBLIC.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  if (!url || !key) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
    if (path !== "/setup") return NextResponse.redirect(new URL("/setup", req.url));
    return NextResponse.next();
  }
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
  if (!data.user && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const login = new URL("/login", req.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|.*\\.svg$).*)"],
};
