import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Boxes,
  FlaskConical,
  FileText,
  History,
  FolderHeart,
  Wand2,
  Zap,
  GitBranch,
  ArrowRight,
  Sparkles,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Check if running in Capacitor native environment
const isCapacitorNative = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
  shapeGradient: string;
  href: string;
  badge?: string;
}

function FeatureCard({
  icon,
  title,
  description,
  gradient,
  shapeGradient,
  href,
  badge,
}: FeatureCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isNewFeature = href === "/workflow";

  return (
    <div
      className={cn(
        "relative group cursor-pointer overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-lg",
        isNewFeature
          ? "border-blue-500/30 ring-2 ring-blue-500/10 hover:ring-blue-500/20"
          : "border-border/50 hover:border-border",
      )}
      onClick={() => navigate(href)}
    >
      {/* Enhanced glow for new feature */}
      {isNewFeature && (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-pink-500/5 animate-pulse" />
          <div className="absolute top-2 right-2 z-20">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white shadow-lg animate-pulse">
              ✨ NEW
            </span>
          </div>
        </>
      )}

      {/* Gradient background */}
      <div
        className={cn(
          "absolute inset-0 opacity-20 transition-opacity duration-300 group-hover:opacity-30",
          gradient,
        )}
      />

      {/* Floating geometric shape */}
      <div
        className={cn(
          "absolute -top-4 -right-4 w-24 h-24 rounded-2xl rotate-12 opacity-30 transition-all duration-500 group-hover:rotate-45 group-hover:opacity-50",
          shapeGradient,
        )}
      />
      <div
        className={cn(
          "absolute -bottom-6 -left-6 w-20 h-20 rounded-full opacity-20 transition-all duration-500 group-hover:scale-125 group-hover:opacity-40",
          shapeGradient,
        )}
      />

      {/* Content */}
      <div className="relative z-10 p-3">
        <div className="flex items-start justify-between mb-2">
          <div
            className={cn("p-2 rounded-lg bg-gradient-to-br", shapeGradient)}
          >
            {icon}
          </div>
          {badge && !isNewFeature && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary">
              {badge}
            </span>
          )}
        </div>
        <h3 className="text-base font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground mb-2">{description}</p>
        <div className="flex items-center text-sm font-medium text-primary opacity-0 translate-x-[-8px] transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0">
          {t("welcome.explore")} <ArrowRight className="ml-1 h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = isCapacitorNative();

  const features: FeatureCardProps[] = [
    {
      icon: <Star className="h-6 w-6 text-amber-600 dark:text-amber-400" />,
      title: t("welcome.featuredModels.title"),
      description: t("welcome.featuredModels.description"),
      gradient:
        "bg-gradient-to-br from-amber-500/40 via-orange-500/20 to-transparent",
      shapeGradient: "from-amber-500/40 to-orange-500/30",
      href: "/featured-models",
      badge: t("welcome.featuredModels.badge"),
    },
    {
      icon: <Boxes className="h-6 w-6 text-blue-600 dark:text-blue-400" />,
      title: t("welcome.features.models.title"),
      description: t("welcome.features.models.description"),
      gradient:
        "bg-gradient-to-br from-blue-500/40 via-cyan-500/20 to-transparent",
      shapeGradient: "from-blue-500/40 to-cyan-500/30",
      href: "/models",
      badge: "500+",
    },
    {
      icon: (
        <FlaskConical className="h-6 w-6 text-purple-600 dark:text-purple-400" />
      ),
      title: t("welcome.features.playground.title"),
      description: t("welcome.features.playground.description"),
      gradient:
        "bg-gradient-to-br from-purple-500/40 via-violet-500/20 to-transparent",
      shapeGradient: "from-purple-500/40 to-violet-500/30",
      href: "/playground",
    },
    {
      icon: <FileText className="h-6 w-6 text-pink-600 dark:text-pink-400" />,
      title: t("welcome.features.templates.title"),
      description: t("welcome.features.templates.description"),
      gradient:
        "bg-gradient-to-br from-pink-500/40 via-rose-500/20 to-transparent",
      shapeGradient: "from-pink-500/40 to-rose-500/30",
      href: "/templates",
    },
    {
      icon: (
        <History className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
      ),
      title: t("welcome.features.history.title"),
      description: t("welcome.features.history.description"),
      gradient:
        "bg-gradient-to-br from-emerald-500/40 via-green-500/20 to-transparent",
      shapeGradient: "from-emerald-500/40 to-green-500/30",
      href: "/history",
    },
    // Assets: hidden on mobile (mobile downloads directly to device)
    ...(!isMobile
      ? [
          {
            icon: (
              <FolderHeart className="h-6 w-6 text-teal-600 dark:text-teal-400" />
            ),
            title: t("welcome.features.assets.title"),
            description: t("welcome.features.assets.description"),
            gradient:
              "bg-gradient-to-br from-teal-500/40 via-cyan-500/20 to-transparent",
            shapeGradient: "from-teal-500/40 to-cyan-500/30",
            href: "/assets",
          },
        ]
      : []),
    // Workflow: desktop only
    ...(!isMobile
      ? [
          {
            icon: (
              <GitBranch className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            ),
            title: t("welcome.features.workflow.title"),
            description: t("welcome.features.workflow.description"),
            gradient:
              "bg-gradient-to-br from-blue-500/40 via-indigo-500/20 to-transparent",
            shapeGradient: "from-blue-500/40 to-indigo-500/30",
            href: "/workflow",
            badge: t("welcome.features.workflow.badge"),
          },
        ]
      : []),

    {
      icon: <Wand2 className="h-6 w-6 text-orange-600 dark:text-orange-400" />,
      title: t("welcome.features.freeTools.title"),
      description: t("welcome.features.freeTools.description"),
      gradient:
        "bg-gradient-to-br from-orange-500/40 via-amber-500/20 to-transparent",
      shapeGradient: "from-orange-500/40 to-amber-500/30",
      href: "/free-tools",
      badge: t("welcome.features.freeTools.badge"),
    },
    // Z-Image: hidden on mobile (no local SD model support)
    ...(!isMobile
      ? [
          {
            icon: (
              <Zap className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
            ),
            title: t("welcome.features.zImage.title"),
            description: t("welcome.features.zImage.description"),
            gradient:
              "bg-gradient-to-br from-yellow-500/40 via-amber-500/20 to-transparent",
            shapeGradient: "from-yellow-500/40 to-amber-500/30",
            href: "/z-image",
            badge: t("welcome.features.zImage.badge"),
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
        <div className="text-center mb-5">
          {/* Logo and Title */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
              <Sparkles className="relative h-9 w-9 text-primary" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">
              {isMobile
                ? "WaveSpeed Mobile"
                : navigator.userAgent.toLowerCase().includes("electron")
                  ? "WaveSpeed Desktop"
                  : "WaveSpeedAI Studio"}
            </h1>
          </div>
          <p className="text-base text-muted-foreground max-w-lg mx-auto">
            {t("welcome.tagline")}
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="w-full max-w-5xl mx-auto mb-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {features.map((feature) => (
              <FeatureCard key={feature.href} {...feature} />
            ))}
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Button
            size="default"
            onClick={() => navigate("/models")}
            className="gap-2"
          >
            {t("welcome.getStarted")}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            size="default"
            variant="outline"
            onClick={() => navigate("/free-tools")}
            className="gap-2"
          >
            <Wand2 className="h-4 w-4" />
            {t("welcome.tryFreeTools")}
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-3 text-sm text-muted-foreground">
        <a
          href="https://wavespeed.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          wavespeed.ai
        </a>
      </div>
    </div>
  );
}
