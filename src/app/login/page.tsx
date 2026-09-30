"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { Button, Card, Input, Label, Notice } from "@/components/ui/primitives";

function LoginInner() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getBrowserSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getBrowserSupabase().auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError(error.message);
    else {
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold">Textbook Graphs</h1>
        <p className="mb-5 text-sm text-muted">Sign in with a magic link or a one-time code.</p>
        {!sent ? (
          <form onSubmit={send} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>Send sign-in email</Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <Notice tone="ok">Check {email}. Click the link, or enter the code from the email.</Notice>
            <div>
              <Label htmlFor="code">Code</Label>
              <Input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" className="w-full" disabled={busy || code.trim().length < 6}>Verify code</Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setSent(false)}>Use a different email</Button>
          </form>
        )}
        {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
