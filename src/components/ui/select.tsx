import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

function Select({ value, onChange, options, placeholder, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !selected && "text-muted-foreground"
        )}
      >
        <span className="truncate">{selected?.label || placeholder || "请选择..."}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="max-h-60 overflow-y-auto p-1">
            {options.map((option) =>
              option.disabled ? (
                <div
                  key={option.value}
                  className="px-2 py-1.5 text-xs font-medium text-muted-foreground select-none"
                >
                  {option.label}
                </div>
              ) : (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                    "hover:bg-accent hover:text-accent-foreground cursor-pointer",
                    option.value === value && "bg-accent/50"
                  )}
                >
                  <span className="flex-1 text-left truncate">{option.label}</span>
                  {option.value === value && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground ml-2" />
                  )}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { Select };
export type { SelectOption, SelectProps };
