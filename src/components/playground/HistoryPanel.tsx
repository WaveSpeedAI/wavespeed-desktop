import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { GenerationHistoryItem } from "@/types/prediction";
import { cn } from "@/lib/utils";

interface HistoryPanelProps {
  history: GenerationHistoryItem[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  direction?: "vertical" | "horizontal";
}

export function HistoryPanel({
  history,
  selectedIndex,
  onSelect,
  direction = "vertical",
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
            <button
              key={item.id}
              onClick={() => onSelect(selectedIndex === index ? null : index)}
              className={cn(
                "relative shrink-0 w-16 h-16 rounded-md overflow-hidden bg-muted border-2 transition-all",
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
          <button
            key={item.id}
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
