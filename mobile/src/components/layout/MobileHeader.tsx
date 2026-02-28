import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/stores/themeStore";
import { AppLogo } from "@/components/layout/AppLogo";
import { cn } from "@/lib/utils";

// Map paths to page titles (translation key or plain text prefixed with '!')
const pageTitles: Record<string, string> = {
  "/models": "nav.models",
  "/playground": "nav.playground",
  "/templates": "nav.templates",
  "/history": "nav.history",
  "/assets": "nav.assets",
  "/settings": "nav.settings",
  "/free-tools": "nav.freeTools",
  "/free-tools/video": "freeTools.videoEnhancer.title",
  "/free-tools/image": "freeTools.imageEnhancer.title",
  "/free-tools/background-remover": "freeTools.backgroundRemover.title",
  "/free-tools/image-eraser": "freeTools.imageEraser.title",
  "/free-tools/segment-anything": "freeTools.segmentAnything.title",
  "/free-tools/video-converter": "freeTools.videoConverter.title",
};

// Pages that should show a back button in the header
// Note: Free tools sub-pages are NOT included because those pages have their own back buttons
const pagesWithBackButton: string[] = [];

export function MobileHeader() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme, resolvedTheme } = useThemeStore();

  // Toggle between light and dark
  const toggleTheme = () => {
    // If current theme is auto, check what resolved to, then toggle
    const currentTheme = theme === "auto" ? resolvedTheme : theme;
    setTheme(currentTheme === "dark" ? "light" : "dark");
  };

  const isDark = theme === "auto" ? resolvedTheme === "dark" : theme === "dark";

  // Get current page title
  const getPageTitle = () => {
    // Check for exact match first
    if (pageTitles[location.pathname]) {
      const title = pageTitles[location.pathname];
      // If prefixed with '!', return plain text (without the prefix)
      if (title.startsWith("!")) {
        return title.slice(1);
      }
      return t(title);
    }

    // Check for playground with model ID
    if (location.pathname.startsWith("/playground/")) {
      return t("nav.playground");
    }

    // Default to app name (home page)
    return null;
  };

  const showBackButton = pagesWithBackButton.some(
    (path) =>
      location.pathname === path || location.pathname.startsWith(path + "/"),
  );

  const handleBack = () => {
    // For free tools sub-pages, go back to free tools hub
    if (location.pathname.startsWith("/free-tools/")) {
      navigate("/free-tools");
    } else {
      navigate(-1);
    }
  };

  return (
    <header className="mobile-header">
      <div className="flex items-center justify-between h-12 px-4">
        {/* Left side - Back button, Home button, or Logo */}
        <div className="flex items-center gap-2 min-w-[40px]">
          {showBackButton ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 -ml-2"
              onClick={handleBack}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : location.pathname === "/" ? (
            <AppLogo className="h-7 w-7 shrink-0" />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 -ml-2"
              onClick={() => navigate("/")}
            >
              <Home className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Center - Title */}
        <h1
          className={cn(
            "font-semibold text-base truncate",
            showBackButton ? "flex-1 text-center" : "flex-1",
          )}
        >
          {getPageTitle() ?? (
            <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#1a2654] to-[#1a6b7c] dark:from-[#38bdf8] dark:to-[#34d399]">
              WaveSpeed
            </span>
          )}
        </h1>

        {/* Right side - Theme toggle */}
        <div className="flex items-center gap-1.5 justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleTheme}
          >
            {isDark ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
