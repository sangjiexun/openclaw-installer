import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface TerminalOutputProps {
  lines: string[];
  className?: string;
}

export function TerminalOutput({ lines, className }: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      className={cn(
        "bg-black/40 rounded-md border p-3 font-mono text-xs overflow-y-auto max-h-48",
        className
      )}
    >
      {lines.length === 0 ? (
        <span className="text-muted-foreground">等待执行...</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="text-green-400/80 whitespace-pre-wrap break-all">
            {line}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
