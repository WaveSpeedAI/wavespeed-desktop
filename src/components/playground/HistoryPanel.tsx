import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { GenerationHistoryItem } from "@/types/prediction";
import { cn } from "@/lib/utils";
import { MoreHorizontal, ExternalLink, Copy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HistoryPanelProps {
  history: GenerationHistoryItem[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  direction?: "vertical" | "horizontal";
  onDuplicateToNewTab?: (index: number) => void;
  onApplySettings?: (index: number) => void;
}

export function HistoryPanel({
  history,
  selectedIndex,
  onSelect,
  direction = "vertical",
  onDuplicateToNewTab,
  onApplySettings,
}: HistoryPanelProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to show newest item when history grows
  useEffect(() => {
    if (scrollRef.current) {
      if (direction === "vertical") {
        scrollRef.current.scrollTop = 0;
      } else {
        scrollRef.current.scrollLeft = 0;
      }
    }
  }, [history.length, direction]);

  if (direction === "horizontal") {
    return (
      <div className="border-t bg-muted/30 shrink-0">
        <div
          ref={scrollRef}
          className="flex gap-2 p-2 overflow-x-auto scrollbar-thin"
        >
          {history.map((item, index) => (
            <div key={item.id} className="relative shrink-0 group">
              <button
                onClick={() => onSelect(selectedIndex === index ? null : index)}
                className={cn(
                  "relative w-16 h-16 rounded-md overflow-hidden bg-muted border-2 transition-all",
                  selectedIndex === index
                    ? "border-blue-500 shadow-md"
                    : index === 0 && selectedIndex === null
                      ? "border-blue-500/50"
                      : "border-transparent hover:border-muted-foreground/30",
                )}
              >
                <ThumbnailContent item={item} />
                <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[10px] px-1 rounded-tl">
                  {history.length - index}
                </span>
              </button>
              {onDuplicateToNewTab && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="absolute top-0.5 right-0.5 z-10 h-5 w-5 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="bottom">
                    <DropdownMenuItem
                      onClick={() => onDuplicateToNewTab(index)}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {t("playground.history.openInNewTab", "Open in New Tab")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        onApplySettings
                          ? onApplySettings(index)
                          : onSelect(index)
                      }
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      {t(
                        "playground.history.useSettings",
                        "Use These Settings",
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Vertical layout (desktop)
  return (
    <div className="w-[120px] h-full shrink-0 border-l bg-muted/30 flex flex-col">
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b truncate">
        {t("playground.history.title")}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-2"
      >
        {history.map((item, index) => (
          <div key={item.id} className="relative group">
            <button
              onClick={() => onSelect(selectedIndex === index ? null : index)}
              className={cn(
                "relative w-full aspect-square rounded-md overflow-hidden bg-muted border-2 transition-all",
                selectedIndex === index
                  ? "border-blue-500 shadow-md"
                  : index === 0 && selectedIndex === null
                    ? "border-blue-500/50"
                    : "border-transparent hover:border-muted-foreground/30",
              )}
            >
              <ThumbnailContent item={item} />
              <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[10px] px-1 rounded-tl">
                {history.length - index}
              </span>
            </button>
            {onDuplicateToNewTab && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="absolute top-0.5 right-0.5 z-10 h-5 w-5 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem onClick={() => onDuplicateToNewTab(index)}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t("playground.history.openInNewTab", "Open in New Tab")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSelect(index)}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t("playground.history.useSettings", "Use These Settings")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThumbnailContent({ item }: { item: GenerationHistoryItem }) {
  if (item.thumbnailUrl && item.thumbnailType === "image") {
    return (
      <img
        src={item.thumbnailUrl}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
      />
    );
  }

  if (item.thumbnailUrl && item.thumbnailType === "video") {
    return (
      <video
        src={item.thumbnailUrl}
        className="w-full h-full object-cover"
        muted
        preload="metadata"
      />
    );
  }

  // Fallback: show a generic icon
  return (
    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
    </div>
  );
}
