import { ChevronLeft } from "lucide-react";
import type { ReactNode } from 'react';
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

// Standardized "back" affordance: a rounded shadcn outline button, applied to the TanStack <Link>
// (an anchor) at each call site so every page's back navigation looks and behaves identically.
// Carries its own bottom spacing so the page title always clears the chip. `max-w-full` keeps a long
// child name from pushing the page wider than the phone column; the label truncates (the full name
// always shows in the page heading below).
export const backLinkClass = cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-full px-3 no-underline mb-[14px] max-w-full');

export function BackLabel({ children }: { children: ReactNode }) {
  return <><ChevronLeft aria-hidden="true" size={18} className="shrink-0" /><span className="min-w-0 truncate">{children}</span></>;
}
