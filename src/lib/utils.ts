import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function nid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function roundToStep(qty: number, step: number) {
  if (!Number.isFinite(qty) || !Number.isFinite(step) || step <= 0) return 0;
  const decimals = (String(step).split(".")[1] ?? "").replace(/0+$/, "").length;
  const n = Math.floor(qty / step + 1e-12) * step;
  return Number(n.toFixed(decimals));
}
