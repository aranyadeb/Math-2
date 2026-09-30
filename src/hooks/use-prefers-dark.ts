"use client";
import { useEffect, useState } from "react";

/** Effective dark mode: explicit .dark/.light class on <html>, else the OS preference. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const compute = () => setDark(root.classList.contains("dark") || (!root.classList.contains("light") && mq.matches));
    compute();
    mq.addEventListener("change", compute);
    const obs = new MutationObserver(compute);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => { mq.removeEventListener("change", compute); obs.disconnect(); };
  }, []);
  return dark;
}
