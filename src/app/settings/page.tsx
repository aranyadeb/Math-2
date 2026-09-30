"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/layout/app-state";
import { Button, Card, Label, Notice, Select, Spinner } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";

interface UsageRow { task: string; model: string; input_tokens: number | null; output_tokens: number | null; estimated_cost_usd: number | null; latency_ms: number | null; fallback: boolean; success: boolean; created_at: string }

export default function SettingsPage() {
  const { user, prefs, updatePrefs } = useApp();
  const router = useRouter();
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [config, setConfig] = useState<{ fast: string; reasoning: string; transcribe: string; geminiConfigured: boolean } | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    getBrowserSupabase().from("ai_usage").select("task,model,input_tokens,output_tokens,estimated_cost_usd,latency_ms,fallback,success,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(2000)
      .then(({ data }) => setUsage((data ?? []) as UsageRow[]));
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  const summary = useMemo(() => {
    const byModel = new Map<string, { calls: number; inTok: number; outTok: number; cost: number; latency: number; fallbacks: number; failures: number }>();
    for (const u of usage ?? []) {
      const s = byModel.get(u.model) ?? { calls: 0, inTok: 0, outTok: 0, cost: 0, latency: 0, fallbacks: 0, failures: 0 };
      s.calls++; s.inTok += u.input_tokens ?? 0; s.outTok += u.output_tokens ?? 0; s.cost += Number(u.estimated_cost_usd ?? 0); s.latency += u.latency_ms ?? 0;
      if (u.fallback) s.fallbacks++;
      if (!u.success) s.failures++;
      byModel.set(u.model, s);
    }
    return [...byModel.entries()];
  }, [usage]);

  const signOut = async () => {
    await getBrowserSupabase().auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="theme">Appearance</Label>
          <Select id="theme" className="w-full" value={prefs.ui_preferences.theme ?? "system"} onChange={(e) => updatePrefs({ ui_preferences: { ...prefs.ui_preferences, theme: e.target.value as "system" } })}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="quality">Default import quality</Label>
          <Select id="quality" className="w-full" value={prefs.ui_preferences.defaultQuality ?? "balanced"} onChange={(e) => updatePrefs({ ui_preferences: { ...prefs.ui_preferences, defaultQuality: e.target.value as "balanced" } })}>
            <option value="economy">Economy</option><option value="balanced">Balanced</option><option value="high">High clarity</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!prefs.graph_preferences.deepAnalysisDefault} onChange={(e) => updatePrefs({ graph_preferences: { ...prefs.graph_preferences, deepAnalysisDefault: e.target.checked } })} />
          Use Deep Analysis (reasoning model) by default — slower and costlier
        </label>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="font-semibold">AI models</h2>
        {config ? (
          <>
            {!config.geminiConfigured ? <Notice tone="error">GEMINI_API_KEY is not set on the server. Voice, page detection and graph generation are unavailable until it is configured.</Notice> : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Fast</dt><dd className="font-mono">{config.fast}</dd>
              <dt className="text-muted">Reasoning</dt><dd className="font-mono">{config.reasoning}</dd>
              <dt className="text-muted">Transcription</dt><dd className="font-mono">{config.transcribe}</dd>
            </dl>
          </>
        ) : <Spinner />}
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="font-semibold">Usage (last 30 days)</h2>
        {usage === null ? <Spinner /> : summary.length === 0 ? <p className="text-sm text-muted">No AI calls yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Model</th><th className="pr-3">Calls</th><th className="pr-3">Input tok</th><th className="pr-3">Output tok</th><th className="pr-3">Est. cost</th><th className="pr-3">Avg latency</th><th>Fallback / failed</th></tr></thead>
              <tbody>
                {summary.map(([m, s]) => (
                  <tr key={m} className="border-t border-border">
                    <td className="py-1 pr-3 font-mono">{m}</td><td className="pr-3">{s.calls}</td><td className="pr-3">{s.inTok.toLocaleString()}</td><td className="pr-3">{s.outTok.toLocaleString()}</td>
                    <td className="pr-3">${s.cost.toFixed(4)}</td><td className="pr-3">{Math.round(s.latency / s.calls)} ms</td><td>{s.fallbacks} / {s.failures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">Costs are estimates from the per-token prices configured on the server.</p>
          </div>
        )}
      </Card>

      <Card className="flex items-center justify-between p-4">
        <span className="text-sm text-muted">Signed in as {user?.email}</span>
        <Button onClick={signOut}>Sign out</Button>
      </Card>
    </div>
  );
}
