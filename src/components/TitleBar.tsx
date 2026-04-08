import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";

export function TitleBar() {
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    window.electronAPI.getAppVersion?.().then((v) => v && setAppVersion(v)).catch(() => {});
  }, []);

  return (
    <div className="titlebar-drag flex items-center justify-between h-8 bg-background border-b px-3 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground tracking-wide">
          🐾 OpenClaw 安装向导
        </span>
        {appVersion && (
          <span className="text-[10px] text-muted-foreground/50 font-mono select-none">
            v{appVersion}
          </span>
        )}
      </div>
      <div className="titlebar-no-drag flex items-center">
        <button
          onClick={() => window.electronAPI.minimize()}
          title="最小化"
          className="h-8 w-10 flex items-center justify-center hover:bg-muted transition-colors"
        >
          <Minus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={() => window.electronAPI.maximize()}
          title="最大化"
          className="h-8 w-10 flex items-center justify-center hover:bg-muted transition-colors"
        >
          <Square className="h-3 w-3 text-muted-foreground" />
        </button>
        <button
          onClick={() => window.electronAPI.close()}
          title="关闭"
          className="h-8 w-10 flex items-center justify-center hover:bg-destructive/80 hover:text-white transition-colors"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
