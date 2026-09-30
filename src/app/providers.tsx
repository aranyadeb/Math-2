"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppStateProvider } from "@/components/layout/app-state";
import { Header } from "@/components/layout/header";

export function Providers({ children }: { children: ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  if (path.startsWith("/setup")) return <>{children}</>;
  return (
    <AppStateProvider>
      <Header />
      <main>{children}</main>
    </AppStateProvider>
  );
}
