import { useState, useMemo, useCallback, useRef, memo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useModelsStore } from "@/stores/modelsStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { fuzzySearch } from "@/lib/fuzzySearch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PlayCircle,
  ExternalLink,
  Star,
  Info,
  Search,
  X,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SortKey = "popularity" | "name" | "price";

/** Color mapping for model type tags */
function getTypeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("video"))
    return "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400";
  if (t.includes("image"))
    return "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400";
  if (t.includes("audio"))
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400";
  if (t.includes("portrait"))
    return "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400";
  if (t.includes("text"))
    return "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400";
}

interface ExplorePanelProps {
  onSelectModel: (modelId: string) => void;
  externalSearch?: string;
}

/** Memoized model card to avoid re-rendering all cards on filter change */
const ModelCard = memo(function ModelCard({
  model,
  isFav,
  onSelect,
  onToggleFav,
  onNewTab,
}: {
  model: {
    model_id: string;
    name: string;
    type?: string;
    base_price?: number;
    description?: string;
  };
  isFav: boolean;
  onSelect: (id: string) => void;
  onToggleFav: (e: React.MouseEvent, id: string) => void;
  onNewTab: (e: React.MouseEvent, id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={() => onSelect(model.model_id)}
      className="cursor-pointer rounded-lg border border-border bg-card shadow-sm hover:bg-accent/50 hover:border-primary/30 hover:shadow-md transition-all group overflow-hidden dark:bg-white/[0.06] dark:border-white/[0.08] dark:hover:bg-white/[0.10]"
    >
      <div className={cn("h-[2px]", getTypeColor(model.type || ""))} />
      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors flex-1 min-w-0">
            {model.name}
          </p>
          {model.type && (
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap",
                getTypeColor(model.type),
              )}
            >
              {model.type}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          {model.base_price !== undefined && (
            <span className="text-xs font-semibold text-primary">
              ${model.base_price.toFixed(4)}
            </span>
          )}
          <div className="flex gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="h-3 w-3" />
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="w-64" side="top" align="end">
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-sm">{model.name}</h4>
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {model.model_id}
                  </p>
                  {model.description && (
                    <p className="text-xs text-muted-foreground">
                      {model.description}
                    </p>
                  )}
                  {model.type && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {t("models.type")}:
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {model.type}
                      </Badge>
                    </div>
                  )}
                  {model.base_price !== undefined && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {t("models.basePrice")}:
                      </span>
                      <span className="font-medium text-primary">
                        ${model.base_price.toFixed(4)}
                      </span>
                    </div>
                  )}
                </div>
              </HoverCardContent>
            </HoverCard>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={(e) => onToggleFav(e, model.model_id)}
            >
              <Star
                className={cn(
                  "h-3 w-3",
                  isFav && "fill-yellow-400 text-yellow-400",
                )}
              />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(model.model_id);
              }}
            >
              <PlayCircle className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={(e) => onNewTab(e, model.model_id)}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});

export function ExplorePanel({
  onSelectModel,
  externalSearch,
}: ExplorePanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { models, toggleFavorite, isFavorite } = useModelsStore();
  const { createTab } = usePlaygroundStore();
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("popularity");
  const [sortAsc, setSortAsc] = useState(false);

  // Local search state with debounce
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearchDebounced(value), 250);
  }, []);
  const handleSearchClear = useCallback(() => {
    setSearchInput("");
    setSearchDebounced("");
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  const search = externalSearch ?? searchDebounced;

  const allTypes = useMemo(() => {
    const typeSet = new Set<string>();
    models.forEach((m) => {
      if (m.type) typeSet.add(m.type);
    });
    return Array.from(typeSet).sort();
  }, [models]);

  const filteredModels = useMemo(() => {
    let result = models;

    // Favorites filter
    if (showFavoritesOnly) {
      result = result.filter((m) => isFavorite(m.model_id));
    }

    // Type filter
    if (typeFilter) result = result.filter((m) => m.type === typeFilter);

    // Search
    if (search.trim()) {
      return fuzzySearch(result, search, (m) => [
        m.name,
        m.model_id,
        m.description || "",
      ]).map((r) => r.item);
    }

    // Sort
    const sorted = [...result].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "price") return (a.base_price ?? 0) - (b.base_price ?? 0);
      // popularity: use sort_order (lower = more popular)
      return (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
    });

    return sortAsc ? sorted : sorted.reverse();
  }, [
    models,
    search,
    typeFilter,
    showFavoritesOnly,
    isFavorite,
    sortKey,
    sortAsc,
  ]);

  const handleToggleFavorite = useCallback(
    (e: React.MouseEvent, modelId: string) => {
      e.stopPropagation();
      toggleFavorite(modelId);
    },
    [toggleFavorite],
  );

  const handleOpenInNewTab = useCallback(
    (e: React.MouseEvent, modelId: string) => {
      e.stopPropagation();
      const model = models.find((m) => m.model_id === modelId);
      createTab(model);
      navigate(`/playground/${encodeURIComponent(modelId)}`);
    },
    [models, createTab, navigate],
  );

  const sortLabels: Record<SortKey, string> = {
    popularity: "Popularity",
    name: "Name",
    price: "Price",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar with controls */}
      {externalSearch == null && (
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t(
                  "playground.explore.searchPlaceholder",
                  "Search models...",
                )}
                className="w-full h-[34px] pl-9 pr-8 rounded-lg border border-border bg-muted/40 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
              />
              {searchInput && (
                <button
                  onClick={handleSearchClear}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Favorites toggle */}
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-[34px] w-[34px] p-0 shrink-0 border border-border",
                showFavoritesOnly &&
                  "bg-yellow-500/10 border-yellow-500/30 text-yellow-500",
              )}
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  showFavoritesOnly && "fill-yellow-400 text-yellow-400",
                )}
              />
            </Button>

            {/* Sort dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-[34px] px-2.5 shrink-0 border border-border text-xs font-medium gap-1"
                >
                  {sortLabels[sortKey]}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[120px]">
                {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => setSortKey(key)}
                    className={cn(
                      "text-xs",
                      sortKey === key && "font-semibold text-primary",
                    )}
                  >
                    {sortLabels[key]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sort direction */}
            <Button
              variant="ghost"
              size="sm"
              className="h-[34px] w-[34px] p-0 shrink-0 border border-border"
              onClick={() => setSortAsc(!sortAsc)}
            >
              {sortAsc ? (
                <ArrowDownNarrowWide className="h-4 w-4" />
              ) : (
                <ArrowUpNarrowWide className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-4 pb-6 pt-3">
          {/* All Models heading */}
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {showFavoritesOnly
              ? t("playground.explore.favorites", "Favorites")
              : search
                ? t("playground.explore.searchResults", "{{count}} results", {
                    count: filteredModels.length,
                  })
                : t("playground.explore.allModels", "All Models")}
          </h3>

          {/* Category tags — wrap to show all */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            <button
              onClick={() => setTypeFilter(null)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors whitespace-nowrap",
                !typeFilter
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t("playground.explore.all", "All")}
            </button>
            {allTypes.map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors whitespace-nowrap",
                  typeFilter === type
                    ? "ring-1 ring-current " + getTypeColor(type)
                    : getTypeColor(type) + " hover:opacity-80",
                )}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Models grid — 2 columns */}
          <div className="grid grid-cols-2 gap-2">
            {filteredModels.map((model) => (
              <ModelCard
                key={model.model_id}
                model={model}
                isFav={isFavorite(model.model_id)}
                onSelect={onSelectModel}
                onToggleFav={handleToggleFavorite}
                onNewTab={handleOpenInNewTab}
              />
            ))}
          </div>
          {filteredModels.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {showFavoritesOnly
                ? t(
                    "playground.explore.noFavorites",
                    "No favorites yet — star a model to save it here",
                  )
                : t("models.noResults", "No models found")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
