export default function SetupPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Configuration needed</h1>
      <p className="text-sm text-muted">
        Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and set
        <code> NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and <code>GEMINI_API_KEY</code>,
        run the migrations in <code>supabase/migrations</code>, then restart the server. See README.md.
      </p>
    </div>
  );
}
