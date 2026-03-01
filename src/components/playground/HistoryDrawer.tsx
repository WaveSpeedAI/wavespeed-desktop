import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { GenerationHistoryItem } from "@/types/prediction";
import { cn } from "@/lib/utils";
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

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
  const [isExpanded, setIsExpanded] = useState(true);
  const userCollapsedRef = useRef(false);
  const prevLenRef = useRef(history.length);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-expand when new items arrive, unless user manually collapsed
  useEffect(() => {
    if (history.length > prevLenRef.current && !userCollapsedRef.current) {
      setIsExpanded(true);
    }
    prevLenRef.current = history.length;
  }, [history.length]);

  const handleToggle = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    userCollapsedRef.current = !next;
  };

  // Navigate history: prev / next with wrap-around
  const navigate = useCallback(
    (direction: "prev" | "next") => {
      if (history.length === 0) return;
      if (selectedIndex === null) {
        onSelect(0);
        return;
      }
      if (direction === "prev") {
        onSelect(selectedIndex === 0 ? history.length - 1 : selectedIndex - 1);
      } else {
        onSelect(selectedIndex === history.length - 1 ? 0 : selectedIndex + 1);
      }
    },
    [history.length, selectedIndex, onSelect],
  );

  // Keyboard: Left/Right arrows to navigate, Esc to deselect
  useEffect(() => {
    if (history.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate("next");
      } else if (e.key === "Escape" && selectedIndex !== null) {
        e.preventDefault();
        onSelect(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [history.length, selectedIndex, navigate, onSelect]);

  // Scroll selected thumbnail into view
  useEffect(() => {
    if (selectedIndex === null || !scrollRef.current) return;
    const child = scrollRef.current.children[selectedIndex] as HTMLElement;
    if (child) {
      child.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  // Hide entirely when no history
  if (history.length === 0) return null;

  return (
    <div className="border-t bg-card/80 backdrop-blur shrink-0">
      {/* Toggle handle — centered pill button */}
      <div className="flex justify-center -mt-3 mb-0 relative z-10">
        <button
          onClick={handleToggle}
          className="flex items-center justify-center w-10 h-5 rounded-t-lg bg-card border border-b-0 border-border hover:bg-accent/50 transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Header row with nav buttons */}
      <div className="flex items-center justify-between px-4 pb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("playground.recentGenerations", "Recent Generations")}
        </span>
        <div className="flex items-center gap-1.5">
          {history.length > 1 && (
            <>
              <button
                onClick={() => navigate("prev")}
                className="flex items-center justify-center w-5 h-5 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground/70 tabular-nums min-w-[3ch] text-center">
                {selectedIndex !== null ? selectedIndex + 1 : "-"}/
                {history.length}
              </span>
              <button
                onClick={() => navigate("next")}
                className="flex items-center justify-center w-5 h-5 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {history.length <= 1 && (
            <span className="text-[10px] text-muted-foreground/70">
              {history.length} {history.length === 1 ? "item" : "items"}
            </span>
          )}
        </div>
      </div>

      {/* Thumbnails strip — animated expand/collapse */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-in-out",
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-y-hidden">
          <div
            ref={scrollRef}
            className="flex gap-2 px-4 pb-1 mb-2 overflow-x-auto"
          >
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
                  {index + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
