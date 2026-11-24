import { ChevronLeft } from "lucide-react";
import type { ReactNode } from 'react';
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

// Standardized "back" affordance: a rounded shadcn outline button, applied to the TanStack <Link>
// (an anchor) at each call site so every page's back navigation looks and behaves identically.
// Carries its own bottom spacing so the page title always clears the chip.
export const backLinkClass = cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-full px-3 no-underline mb-[14px]');

export function BackLabel({ children }: { children: ReactNode }) {
  return <><ChevronLeft aria-hidden="true" size={18} />{children}</>;
}
