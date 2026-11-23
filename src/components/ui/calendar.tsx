import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, CalendarDaysIcon } from "lucide-react"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/* Household dates are plain `YYYY-MM-DD` Jakarta dates with no time component.
   All grid math runs in UTC so a parent's local timezone never shifts the day,
   and range checks compare the zero-padded strings directly. */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

const monthLabel = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})
const dayLabel = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})
const triggerLabel = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function parse(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function toISO(date: Date) {
  return date.toISOString().slice(0, 10)
}
function addDays(iso: string, delta: number) {
  const date = parse(iso)
  date.setUTCDate(date.getUTCDate() + delta)
  return toISO(date)
}
function clamp(iso: string, min?: string, max?: string) {
  if (min && iso < min) return min
  if (max && iso > max) return max
  return iso
}

export type CalendarProps = {
  value?: string
  onSelect: (date: string) => void
  min?: string
  max?: string
  today?: string
  autoFocus?: boolean
  className?: string
}

export function Calendar({
  value,
  onSelect,
  min,
  max,
  today,
  autoFocus = true,
  className,
}: CalendarProps) {
  const seed = clamp(value || today || toISO(new Date()), min, max)
  const [focus, setFocus] = React.useState(seed)
  const [view, setView] = React.useState(() => focus.slice(0, 7)) // "YYYY-MM"
  const gridRef = React.useRef<HTMLDivElement>(null)
  const pendingFocus = React.useRef(autoFocus)

  const [vy, vm] = view.split("-").map(Number)
  const firstOfMonth = new Date(Date.UTC(vy, vm - 1, 1))
  const leadBlanks = (firstOfMonth.getUTCDay() + 6) % 7 // Monday-first offset
  const daysInMonth = new Date(Date.UTC(vy, vm, 0)).getUTCDate()
  const lastOfPrev = toISO(new Date(Date.UTC(vy, vm - 1, 0)))
  const firstOfNext = toISO(new Date(Date.UTC(vy, vm, 1)))
  const prevDisabled = Boolean(min && lastOfPrev < min)
  const nextDisabled = Boolean(max && firstOfNext > max)

  function goMonth(delta: number) {
    const next = new Date(Date.UTC(vy, vm - 1 + delta, 1))
    setView(toISO(next).slice(0, 7))
  }

  // Keep the roving-focus target in view and move keyboard focus onto it.
  React.useEffect(() => {
    if (focus.slice(0, 7) !== view) setView(focus.slice(0, 7))
  }, [focus, view])
  React.useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)
      ?.focus()
  })

  function move(next: string) {
    const target = clamp(next, min, max)
    pendingFocus.current = true
    setFocus(target)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const keys: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (event.key in keys) {
      event.preventDefault()
      move(addDays(focus, keys[event.key]))
    } else if (event.key === "Home") {
      event.preventDefault()
      move(addDays(focus, -((parse(focus).getUTCDay() + 6) % 7)))
    } else if (event.key === "End") {
      event.preventDefault()
      move(addDays(focus, 6 - ((parse(focus).getUTCDay() + 6) % 7)))
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault()
      const d = parse(focus)
      d.setUTCMonth(d.getUTCMonth() + (event.key === "PageUp" ? -1 : 1))
      move(toISO(d))
    }
  }

  const cells: (string | null)[] = []
  for (let i = 0; i < leadBlanks; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1)
    cells.push(toISO(new Date(Date.UTC(vy, vm - 1, d))))

  return (
    <div className={cn("w-[17rem] select-none", className)} data-slot="calendar">
      <div className="flex items-center justify-between pb-3">
        <NavButton
          label="Previous month"
          disabled={prevDisabled}
          onClick={() => goMonth(-1)}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </NavButton>
        <div
          aria-live="polite"
          className="font-heading text-sm font-semibold tracking-tight"
        >
          {monthLabel.format(firstOfMonth)}
        </div>
        <NavButton
          label="Next month"
          disabled={nextDisabled}
          onClick={() => goMonth(1)}
        >
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </NavButton>
      </div>

      <div
        className="grid grid-cols-7 pb-1.5 text-center text-[0.68rem] font-medium tracking-wide text-muted-foreground"
        aria-hidden="true"
      >
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-0.5"
      >
        {cells.map((iso, index) => {
          if (!iso) return <span key={`blank-${index}`} aria-hidden="true" />
          const disabled = Boolean((min && iso < min) || (max && iso > max))
          const selected = iso === value
          const isToday = iso === today
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              data-date={iso}
              aria-label={dayLabel.format(parse(iso))}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              disabled={disabled}
              tabIndex={iso === focus ? 0 : -1}
              onClick={() => onSelect(iso)}
              className={cn(
                // Reset: this app ships without Tailwind preflight, so buttons
                // keep the UA grey fill and outset border unless cleared here.
                "flex h-9 cursor-pointer appearance-none items-center justify-center rounded-[10px] border border-transparent bg-transparent font-heading text-sm tabular-nums outline-none transition-colors disabled:cursor-default",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                !selected &&
                  !disabled &&
                  "text-foreground hover:bg-accent hover:text-accent-foreground",
                selected && "bg-primary font-semibold text-primary-foreground",
                isToday &&
                  !selected &&
                  "font-semibold text-primary ring-1 ring-ring/45 ring-inset",
                disabled && "text-muted-foreground/35"
              )}
            >
              {Number(iso.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-sm" }),
        "cursor-pointer appearance-none bg-transparent text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40"
      )}
    >
      {children}
    </button>
  )
}

export type DatePickerProps = {
  value?: string
  onSelect: (date: string) => void
  min?: string
  max?: string
  today?: string
  disabled?: boolean
  placeholder?: string
  "aria-labelledby"?: string
  valueId?: string
  className?: string
}

/** Field-width trigger that opens a Calendar in a Popover — the shadcn date
    picker pattern, dressed in the Family Notebook palette. */
export function DatePicker({
  value,
  onSelect,
  min,
  max,
  today,
  disabled,
  placeholder = "Pick a date",
  valueId,
  className,
  ...props
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const display = value ? triggerLabel.format(parse(value)) : placeholder
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-labelledby={props["aria-labelledby"]}
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          "h-11 w-full justify-between px-3.5 font-normal text-foreground data-[placeholder]:text-muted-foreground",
          className
        )}
        data-placeholder={value ? undefined : ""}
      >
        <span id={valueId} className={cn(!value && "text-muted-foreground")}>
          {display}
        </span>
        <CalendarDaysIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto p-3.5"
      >
        <Calendar
          value={value}
          today={today}
          min={min}
          max={max}
          onSelect={(date) => {
            onSelect(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
