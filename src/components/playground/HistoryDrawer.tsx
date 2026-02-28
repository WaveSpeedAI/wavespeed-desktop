import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GenerationHistoryItem } from "@/types/prediction";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";

interface HistoryDrawerProps {
  history: GenerationHistoryItem[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}

function ThumbnailContent({ item }: { item: GenerationHistoryItem }) {
  if (item.thumbnailUrl) {
    if (item.thumbnailType === "video") {
      return (
        <video
          src={item.thumbnailUrl}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
      );
    }
    return (
      <img
        src={item.thumbnailUrl}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[10px]">
      No preview
    </div>
  );
}

export function HistoryDrawer({
  history,
  selectedIndex,
  onSelect,
}: HistoryDrawerProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const prevLenRef = useRef(history.length);

  // Auto-expand when new items arrive
  useEffect(() => {
    if (history.length > prevLenRef.current) {
      setIsExpanded(true);
    }
    prevLenRef.current = history.length;
  }, [history.length]);

  // Hide entirely when no history
  if (history.length === 0) return null;

  return (
    <div className="border-t bg-card/80 backdrop-blur shrink-0">
      {/* Toggle handle — centered pill button */}
      <div className="flex justify-center -mt-3 mb-0 relative z-10">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-center w-10 h-5 rounded-t-lg bg-card border border-b-0 border-border hover:bg-accent/50 transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between px-4 pb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("playground.recentGenerations", "Recent Generations")}
        </span>
        <span className="text-[10px] text-muted-foreground/70">
          {history.length} {history.length === 1 ? "item" : "items"}
        </span>
      </div>

      {/* Thumbnails strip — animated expand/collapse */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-in-out",
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-thin">
            {history.map((item, index) => (
              <button
                key={item.id}
                onClick={() => onSelect(selectedIndex === index ? null : index)}
                className={cn(
                  "relative shrink-0 w-[72px] h-[72px] rounded-lg overflow-hidden bg-muted border-2 transition-all hover:scale-105",
                  selectedIndex === index
                    ? "border-primary shadow-md shadow-primary/20"
                    : index === 0 && selectedIndex === null
                      ? "border-primary/40"
                      : "border-transparent hover:border-muted-foreground/30",
                )}
              >
                <ThumbnailContent item={item} />
                <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-1 rounded-tl font-medium">
                  {history.length - index}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
