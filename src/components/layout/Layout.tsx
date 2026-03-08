import {
  useState,
  useEffect,
  useRef,
  useCallback,
  startTransition,
  lazy,
  Suspense,
} from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./Sidebar";
import { AppLogo } from "./AppLogo";
import { PageResetContext } from "./PageResetContext";
import { PersistentPage } from "./PersistentPage";
import { Toaster } from "@/components/ui/toaster";
import { UpdateBanner } from "./UpdateBanner";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/useToast";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  Zap,
  ExternalLink,
  Globe,
  FileText,
} from "lucide-react";
// Lazy-load all persistent pages — only loaded when first visited
const LazyVideoEnhancerPage = lazy(() =>
  import("@/pages/VideoEnhancerPage").then((m) => ({
    default: m.VideoEnhancerPage,
  })),
);
const LazyImageEnhancerPage = lazy(() =>
  import("@/pages/ImageEnhancerPage").then((m) => ({
    default: m.ImageEnhancerPage,
  })),
);
const LazyBackgroundRemoverPage = lazy(() =>
  import("@/pages/BackgroundRemoverPage").then((m) => ({
    default: m.BackgroundRemoverPage,
  })),
);
const LazyImageEraserPage = lazy(() =>
  import("@/pages/ImageEraserPage").then((m) => ({
    default: m.ImageEraserPage,
  })),
);
const LazySegmentAnythingPage = lazy(() =>
  import("@/pages/SegmentAnythingPage").then((m) => ({
    default: m.SegmentAnythingPage,
  })),
);
const LazyZImagePage = lazy(() =>
  import("@/pages/ZImagePage").then((m) => ({ default: m.ZImagePage })),
);
const LazyVideoConverterPage = lazy(() =>
  import("@/pages/VideoConverterPage").then((m) => ({
    default: m.VideoConverterPage,
  })),
);
const LazyAudioConverterPage = lazy(() =>
  import("@/pages/AudioConverterPage").then((m) => ({
    default: m.AudioConverterPage,
  })),
);
const LazyImageConverterPage = lazy(() =>
  import("@/pages/ImageConverterPage").then((m) => ({
    default: m.ImageConverterPage,
  })),
);
const LazyMediaTrimmerPage = lazy(() =>
  import("@/pages/MediaTrimmerPage").then((m) => ({
    default: m.MediaTrimmerPage,
  })),
);
const LazyMediaMergerPage = lazy(() =>
  import("@/pages/MediaMergerPage").then((m) => ({
    default: m.MediaMergerPage,
  })),
);
const LazyFaceEnhancerPage = lazy(() =>
  import("@/pages/FaceEnhancerPage").then((m) => ({
    default: m.FaceEnhancerPage,
  })),
);
const LazyFaceSwapperPage = lazy(() =>
  import("@/pages/FaceSwapperPage").then((m) => ({
    default: m.FaceSwapperPage,
  })),
);
const LazyHistoryPage = lazy(() =>
  import("@/pages/HistoryPage").then((m) => ({ default: m.HistoryPage })),
);
const LazyAssetsPage = lazy(() =>
  import("@/pages/AssetsPage").then((m) => ({ default: m.AssetsPage })),
);
const LazyWorkflowPage = lazy(() =>
  import("@/workflow/WorkflowPage").then((m) => ({ default: m.WorkflowPage })),
);
const LazyPlaygroundPage = lazy(() =>
  import("@/pages/PlaygroundPage").then((m) => ({
    default: m.PlaygroundPage,
  })),
);
const LazyStoryboardPage = lazy(() =>
  import("@/storyboard/StoryboardPage").then((m) => ({
    default: m.StoryboardPage,
  })),
);
import { useFreeToolListener } from "@/workflow/hooks/useFreeToolListener";

const isElectron = navigator.userAgent.toLowerCase().includes("electron");

// Hoisted constants — avoid re-creation on every render
const PERSISTENT_PATHS = [
  "/history",
  "/assets",
  "/free-tools/video-enhancer",
  "/free-tools/image-enhancer",
  "/free-tools/face-enhancer",
  "/free-tools/face-swapper",
  "/free-tools/background-remover",
  "/free-tools/image-eraser",
  "/free-tools/segment-anything",
  "/free-tools/video-converter",
  "/free-tools/audio-converter",
  "/free-tools/image-converter",
  "/free-tools/media-trimmer",
  "/free-tools/media-merger",
  "/z-image",
  "/workflow",
  "/storyboard",
  "/playground",
] as const;
const PERSISTENT_PATHS_SET = new Set<string>(PERSISTENT_PATHS);
const NOOP = () => {};

/** Check if a pathname matches a persistent path (exact or prefix for /playground) */
function isPersistentPath(pathname: string): boolean {
  if (PERSISTENT_PATHS_SET.has(pathname)) return true;
  // /playground and /playground/* are persistent
  if (pathname === "/playground" || pathname.startsWith("/playground/"))
    return true;
  return false;
}

/** Get the persistent path key for a pathname (normalizes /playground/* → /playground) */
function getPersistentKey(pathname: string): string {
  if (pathname === "/playground" || pathname.startsWith("/playground/"))
    return "/playground";
  return pathname;
}

// Helper to generate next key
let keyCounter = 0;
const nextKey = () => ++keyCounter;

export function Layout() {
  const { t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem("sidebarCollapsed");
    return stored !== null ? stored === "true" : false;
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebarCollapsed", String(next));
      return next;
    });
  }, []);
  const navigate = useNavigate();
  const location = useLocation();
  const hasShownUpdateToast = useRef(false);

  // Register free-tool IPC listener globally (must be always mounted for workflow execution)
  useFreeToolListener();

  // Track which persistent pages have been visited (to delay initial mount).
  // Using a ref + counter avoids creating a new Set on every navigation which
  // would cause every PersistentPage wrapper to re-render.
  const visitedPagesRef = useRef<Set<string>>(new Set());
  const [visitedVersion, setVisitedVersion] = useState(0);
  // Stable lookup: returns true if page was visited. The `visitedVersion`
  // dependency ensures the component re-renders when a NEW page is first visited.
  const hasVisited = useCallback(
    (path: string) => visitedPagesRef.current.has(path),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visitedVersion],
  );
  // Track the last visited free-tools sub-page for navigation
  const [lastFreeToolsPage, setLastFreeToolsPage] = useState<string | null>(
    null,
  );
  // Track keys for each page to force remount when reset
  const [pageKeys, setPageKeys] = useState<Record<string, number>>({});

  // Reset a persistent page by changing its key (forces remount)
  const resetPage = useCallback((path: string) => {
    setPageKeys((prev) => ({
      ...prev,
      [path]: nextKey(),
    }));
  }, []);

  const {
    isValidated,
    isValidating,
    loadApiKey,
    hasAttemptedLoad,
    isLoading: isLoadingApiKey,
  } = useApiKeyStore();
  const [inputKey, setInputKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  // Load API key on app startup
  useEffect(() => {
    loadApiKey();
  }, [loadApiKey]);

  // Reset login form when API key is cleared
  useEffect(() => {
    if (!isValidated) {
      setInputKey("");
      setError("");
    }
  }, [isValidated]);

  // Track visits to persistent pages and last visited free-tools page
  useEffect(() => {
    if (isPersistentPath(location.pathname)) {
      const key = getPersistentKey(location.pathname);
      // Track for lazy mounting — only bump version when truly new
      if (!visitedPagesRef.current.has(key)) {
        visitedPagesRef.current.add(key);
        startTransition(() => {
          setVisitedVersion((v) => v + 1);
        });
      }
      // Track last visited for sidebar navigation (only for free-tools sub-pages)
      if (location.pathname.startsWith("/free-tools/")) {
        setLastFreeToolsPage(location.pathname);
      }
    } else if (location.pathname === "/free-tools") {
      setLastFreeToolsPage(null);
    }
  }, [location.pathname]);

  // mainRef kept for potential future use
  const mainRef = useRef<HTMLElement>(null);

  // Pages that don't require API key
  const publicPaths = [
    "/",
    "/settings",
    "/templates",
    "/assets",
    "/free-tools",
    "/z-image",
  ];
  const isPublicPage = publicPaths.some((path) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname === path || location.pathname.startsWith(path + "/"),
  );

  // Listen for update availability on startup
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;

    const unsubscribe = window.electronAPI.onUpdateStatus((status) => {
      if (status.status === "available" && !hasShownUpdateToast.current) {
        hasShownUpdateToast.current = true;
        const version = (status as { version?: string }).version;
        toast({
          title: "Update Available",
          description: version
            ? `Version ${version} is ready to download`
            : "A new version is available",
          action: (
            <ToastAction altText="View" onClick={() => navigate("/settings")}>
              View
            </ToastAction>
          ),
        });
      }
    });

    return unsubscribe;
  }, [navigate]);

  const handleSaveApiKey = async () => {
    if (!inputKey.trim()) return;

    setIsSaving(true);
    setError("");
    try {
      // Validate the key first by trying to fetch models
      apiClient.setApiKey(inputKey.trim());
      await apiClient.listModels();

      // If we get here, the key is valid - save it directly
      if (window.electronAPI) {
        await window.electronAPI.setApiKey(inputKey.trim());
      } else {
        localStorage.setItem("wavespeed_api_key", inputKey.trim());
      }

      // Reload the API key state (force to bypass hasAttemptedLoad check)
      await loadApiKey(true);

      toast({
        title: t("settings.apiKey.saved"),
        description: t("settings.apiKey.savedDesc"),
      });
    } catch {
      // Validation failed - clear the temporary key from client
      apiClient.setApiKey("");
      setError(t("settings.apiKey.invalidDesc"));
    } finally {
      setIsSaving(false);
    }
  };

  // Check if current page requires login (must have a validated API key)
  // Only show login form after we've attempted to load the API key and finished loading/validating
  const requiresLogin =
    !isValidated &&
    !isPublicPage &&
    hasAttemptedLoad &&
    !isLoadingApiKey &&
    !isValidating;

  // Login form content for protected pages
  const loginContent = (
    <div className="flex h-full items-center justify-center relative overflow-hidden">
      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <div className="gradient-bg rounded-xl p-3">
              <Zap className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold gradient-text mb-2">WaveSpeed</h1>
          <p className="text-muted-foreground">
            {t("apiKeyRequired.defaultDesc")}
          </p>
        </div>

        {/* API Key form */}
        <div className="bg-card border rounded-lg p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">{t("settings.apiKey.title")}</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">{t("settings.apiKey.label")}</Label>
            <div className="relative">
              <Input
                id="apiKey"
                type={showKey ? "text" : "password"}
                value={inputKey}
                onChange={(e) => {
                  setInputKey(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                placeholder={t("settings.apiKey.placeholder")}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <Button
            className="w-full gradient-bg hover:opacity-90"
            onClick={handleSaveApiKey}
            disabled={isSaving || !inputKey.trim()}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("settings.apiKey.validating")}
              </>
            ) : (
              t("settings.apiKey.save")
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            {t("settings.apiKey.getKey")}{" "}
            <a
              href="https://wavespeed.ai/accesskey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              wavespeed.ai/accesskey
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        {/* Settings link */}
        <p className="text-center mt-4 text-sm text-muted-foreground">
          {t("apiKeyRequired.orGoTo")}{" "}
          <Button
            variant="link"
            className="p-0 h-auto"
            onClick={() => navigate("/settings")}
          >
            {t("nav.settings")}
          </Button>
        </p>
      </div>
    </div>
  );

  return (
    <PageResetContext.Provider value={{ resetPage }}>
      <TooltipProvider>
        <div className="flex flex-col h-screen overflow-hidden relative">
          {/* Fixed titlebar — draggable region for macOS & Windows (Electron only) */}
          {isElectron && (
            <div className="h-8 min-h-[32px] flex items-center justify-center bg-background electron-drag select-none shrink-0 relative z-50 electron-safe-right">
              {!/mac/i.test(navigator.platform) && (
                <div className="absolute left-0 top-0 bottom-0 w-12 flex items-center justify-center electron-no-drag">
                  <AppLogo className="h-5 w-5 shrink-0" />
                </div>
              )}
              {/* Global WebPage & Docs buttons */}
              <div
                className={
                  /mac/i.test(navigator.platform)
                    ? "absolute right-3 top-0 bottom-0 flex items-center gap-1 electron-no-drag"
                    : "absolute right-[140px] top-0 bottom-0 flex items-center electron-no-drag"
                }
              >
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <a
                      href="https://wavespeed.ai/dashboard"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        /mac/i.test(navigator.platform)
                          ? "flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          : "flex items-center justify-center h-8 w-[46px] text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                      }
                    >
                      <Globe className="h-4 w-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("playground.webPage", "WebPage")}
                  </TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <a
                      href="https://wavespeed.ai/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        /mac/i.test(navigator.platform)
                          ? "flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          : "flex items-center justify-center h-8 w-[46px] text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                      }
                    >
                      <FileText className="h-4 w-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("playground.docs", "Docs")}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
          <div className="flex flex-1 overflow-hidden">
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggle={toggleSidebar}
              lastFreeToolsPage={lastFreeToolsPage}
              isMobileOpen={false}
              onMobileClose={NOOP}
            />
            <main
              ref={mainRef}
              className="relative flex-1 overflow-hidden md:pl-0"
              style={{ background: "hsl(var(--content-area))" }}
            >
              {requiresLogin ? (
                loginContent
              ) : (
                <>
                  {/* Regular routes via Outlet */}
                  <div
                    className={
                      isPersistentPath(location.pathname)
                        ? "hidden"
                        : "h-full overflow-auto"
                    }
                  >
                    <Outlet />
                  </div>
                  {/* Persistent pages — mounted on first visit, hidden via CSS when inactive */}
                  <PersistentPage
                    visited={hasVisited("/playground")}
                    active={
                      location.pathname === "/playground" ||
                      location.pathname.startsWith("/playground/")
                    }
                    pageKey={pageKeys["/playground"] || 0}
                  >
                    <LazyPlaygroundPage key={pageKeys["/playground"] || 0} />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/history")}
                    active={location.pathname === "/history"}
                    pageKey={pageKeys["/history"] || 0}
                  >
                    <LazyHistoryPage key={pageKeys["/history"] || 0} />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/assets")}
                    active={location.pathname === "/assets"}
                    pageKey={pageKeys["/assets"] || 0}
                  >
                    <LazyAssetsPage key={pageKeys["/assets"] || 0} />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/video-enhancer")}
                    active={location.pathname === "/free-tools/video-enhancer"}
                    pageKey={pageKeys["/free-tools/video-enhancer"] || 0}
                  >
                    <LazyVideoEnhancerPage
                      key={pageKeys["/free-tools/video-enhancer"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/image-enhancer")}
                    active={location.pathname === "/free-tools/image-enhancer"}
                    pageKey={pageKeys["/free-tools/image-enhancer"] || 0}
                  >
                    <LazyImageEnhancerPage
                      key={pageKeys["/free-tools/image-enhancer"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/face-enhancer")}
                    active={location.pathname === "/free-tools/face-enhancer"}
                    pageKey={pageKeys["/free-tools/face-enhancer"] || 0}
                  >
                    <LazyFaceEnhancerPage
                      key={pageKeys["/free-tools/face-enhancer"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/face-swapper")}
                    active={location.pathname === "/free-tools/face-swapper"}
                    pageKey={pageKeys["/free-tools/face-swapper"] || 0}
                  >
                    <LazyFaceSwapperPage
                      key={pageKeys["/free-tools/face-swapper"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/background-remover")}
                    active={
                      location.pathname === "/free-tools/background-remover"
                    }
                    pageKey={pageKeys["/free-tools/background-remover"] || 0}
                  >
                    <LazyBackgroundRemoverPage
                      key={pageKeys["/free-tools/background-remover"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/image-eraser")}
                    active={location.pathname === "/free-tools/image-eraser"}
                    pageKey={pageKeys["/free-tools/image-eraser"] || 0}
                  >
                    <LazyImageEraserPage
                      key={pageKeys["/free-tools/image-eraser"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/segment-anything")}
                    active={
                      location.pathname === "/free-tools/segment-anything"
                    }
                    pageKey={pageKeys["/free-tools/segment-anything"] || 0}
                  >
                    <LazySegmentAnythingPage
                      key={pageKeys["/free-tools/segment-anything"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/z-image")}
                    active={location.pathname === "/z-image"}
                    pageKey={pageKeys["/z-image"] || 0}
                  >
                    <LazyZImagePage key={pageKeys["/z-image"] || 0} />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/video-converter")}
                    active={location.pathname === "/free-tools/video-converter"}
                    pageKey={pageKeys["/free-tools/video-converter"] || 0}
                  >
                    <LazyVideoConverterPage
                      key={pageKeys["/free-tools/video-converter"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/audio-converter")}
                    active={location.pathname === "/free-tools/audio-converter"}
                    pageKey={pageKeys["/free-tools/audio-converter"] || 0}
                  >
                    <LazyAudioConverterPage
                      key={pageKeys["/free-tools/audio-converter"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/image-converter")}
                    active={location.pathname === "/free-tools/image-converter"}
                    pageKey={pageKeys["/free-tools/image-converter"] || 0}
                  >
                    <LazyImageConverterPage
                      key={pageKeys["/free-tools/image-converter"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/media-trimmer")}
                    active={location.pathname === "/free-tools/media-trimmer"}
                    pageKey={pageKeys["/free-tools/media-trimmer"] || 0}
                  >
                    <LazyMediaTrimmerPage
                      key={pageKeys["/free-tools/media-trimmer"] || 0}
                    />
                  </PersistentPage>
                  <PersistentPage
                    visited={hasVisited("/free-tools/media-merger")}
                    active={location.pathname === "/free-tools/media-merger"}
                    pageKey={pageKeys["/free-tools/media-merger"] || 0}
                  >
                    <LazyMediaMergerPage
                      key={pageKeys["/free-tools/media-merger"] || 0}
                    />
                  </PersistentPage>
                  {/* Persistent Workflow page — overflow hidden (canvas) */}
                  {hasVisited("/workflow") && (
                    <div
                      className={
                        location.pathname === "/workflow"
                          ? "h-full overflow-hidden"
                          : "hidden"
                      }
                      style={
                        location.pathname === "/workflow"
                          ? undefined
                          : { contentVisibility: "hidden" }
                      }
                    >
                      <Suspense
                        fallback={
                          location.pathname === "/workflow" ? (
                            <div className="flex h-full items-center justify-center">
                              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                            </div>
                          ) : null
                        }
                      >
                        <LazyWorkflowPage key={pageKeys["/workflow"] || 0} />
                      </Suspense>
                    </div>
                  )}
                  {/* Persistent Storyboard page */}
                  {hasVisited("/storyboard") && (
                    <div
                      className={
                        location.pathname === "/storyboard"
                          ? "h-full overflow-hidden"
                          : "hidden"
                      }
                      style={
                        location.pathname === "/storyboard"
                          ? undefined
                          : { contentVisibility: "hidden" }
                      }
                    >
                      <Suspense
                        fallback={
                          location.pathname === "/storyboard" ? (
                            <div className="flex h-full items-center justify-center">
                              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                            </div>
                          ) : null
                        }
                      >
                        <LazyStoryboardPage key={pageKeys["/storyboard"] || 0} />
                      </Suspense>
                    </div>
                  )}
                </>
              )}
            </main>
            <Toaster />
            <UpdateBanner />
          </div>
        </div>
      </TooltipProvider>
    </PageResetContext.Provider>
  );
}
