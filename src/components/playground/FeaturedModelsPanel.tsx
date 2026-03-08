import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { Model } from "@/types/model";

const FEATURED_MODEL_FAMILIES = [
  {
    name: "Nano Banana Pro",
    provider: "google",
    description: "Fast, high-quality text-to-image by Google",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1763649945119973876_WvMIEAxu.jpg",
    primaryVariant: "google/nano-banana-pro/text-to-image",
    tags: ["Text-to-Image"],
    ratio: "poster" as const,
  },
  {
    name: "InfiniteTalk",
    provider: "wavespeed-ai",
    description: "Natural talking-head video from a single portrait photo",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766575571686877852_Sckigeck.png",
    primaryVariant: "wavespeed-ai/infinitetalk",
    tags: ["Talking Head"],
    ratio: "poster" as const,
  },
  {
    name: "Wan Spicy",
    provider: "wavespeed-ai",
    description: "Artistic video generation with painterly, soft-toned visuals",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766298334453523753_f975da96.png",
    primaryVariant: "wavespeed-ai/wan-2.2-spicy/image-to-video",
    tags: ["Artistic", "Soft", "Paint"],
    ratio: "poster" as const,
  },
  {
    name: "Seedream 4.5",
    provider: "bytedance",
    description:
      "Ultra-realistic image generation with stunning detail and accuracy",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1764761216479761378_Yy864da9.png",
    primaryVariant: "bytedance/seedream-v4.5",
    tags: ["Photorealistic", "High Detail"],
    isNew: true,
    ratio: "square" as const,
  },
  {
    name: "Seedance 1.5 Pro",
    provider: "bytedance",
    description: "Cinematic video creation with breathtaking sci-fi aesthetics",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766494048998434655_qEMLsAI0.png",
    primaryVariant: "bytedance/seedance-v1.5-pro/image-to-video",
    tags: ["Sci-Fi", "Neon", "Future"],
    ratio: "square" as const,
  },
  {
    name: "Kling 2.6 Motion Control",
    provider: "kwaivgi",
    description: "Precise camera & motion-guided video generation",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766519115490596160_Smusqomu.png",
    primaryVariant: "kwaivgi/kling-v2.6-pro/motion-control",
    tags: ["Motion", "Control"],
    ratio: "square" as const,
  },
  {
    name: "Wan Animate",
    provider: "wavespeed-ai",
    description: "Bring characters to life with smooth animation",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1758433474532574441_SkTQLIEA.jpeg",
    primaryVariant: "wavespeed-ai/wan-2.2/animate",
    tags: ["Animation"],
    ratio: "square" as const,
  },
];

const TAG_COLORS = [
  "text-sky-200/90 bg-sky-400/15",
  "text-violet-200/90 bg-violet-400/15",
  "text-emerald-200/90 bg-emerald-400/15",
  "text-rose-200/90 bg-rose-400/15",
  "text-amber-200/90 bg-amber-400/15",
];

interface FeaturedModelsPanelProps {
  onSelectFeatured: (primaryVariant: string) => void;
  models: Model[];
  /** Mobile layout: 2-col grids instead of 3/4 */
  mobile?: boolean;
}

function PosterCard({
  family,
  price,
  onClick,
  className,
}: {
  family: (typeof FEATURED_MODEL_FAMILIES)[number];
  price: number | undefined;
  onClick: () => void;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-muted cursor-pointer group ${className ?? ""}`}
      onClick={onClick}
    >
      {!loaded && <div className="absolute inset-0 animate-pulse bg-muted" />}
      <img
        src={family.poster}
        alt={family.name}
        className={`w-full h-full object-cover group-hover:scale-105 transition-all duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
      />
      <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      {family.isNew && (
        <Badge className="absolute top-2 left-2 bg-primary text-primary-foreground text-[9px] px-1.5 py-0 font-bold leading-4">
          NEW
        </Badge>
      )}
      <div className="absolute bottom-2 left-2.5 right-2.5">
        <p className="text-[9px] text-white/60 uppercase tracking-wider leading-none">
          {family.provider}
        </p>
        <h4 className="text-[13px] font-bold text-white leading-tight line-clamp-1 mt-1 drop-shadow-sm">
          {family.name}
        </h4>
        {family.description && (
          <p className="text-[10px] text-white/70 leading-snug line-clamp-1 mt-0.5">
            {family.description}
          </p>
        )}
        <div className="flex items-center flex-wrap gap-1 mt-1.5">
          {family.tags.map((tag, i) => (
            <span
              key={tag}
              className={`text-[8px] rounded-full px-1.5 py-[2px] leading-none ${TAG_COLORS[i % TAG_COLORS.length]}`}
            >
              {tag}
            </span>
          ))}
          {price !== undefined && (
            <span className="text-[8px] rounded-full px-1.5 py-[2px] leading-none text-white/90 bg-white/20 ml-auto">
              ${price.toFixed(3)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function FeaturedModelsPanel({
  onSelectFeatured,
  models,
  mobile,
}: FeaturedModelsPanelProps) {
  const getPrice = (modelId: string) => {
    const model = models.find((m) => m.model_id === modelId);
    return model?.base_price;
  };

  const posters = FEATURED_MODEL_FAMILIES.filter((f) => f.ratio === "poster");
  const squares = FEATURED_MODEL_FAMILIES.filter((f) => f.ratio === "square");

  const card = (
    family: (typeof FEATURED_MODEL_FAMILIES)[number],
    cls?: string,
  ) => (
    <PosterCard
      key={family.primaryVariant}
      family={family}
      price={getPrice(family.primaryVariant)}
      onClick={() => onSelectFeatured(family.primaryVariant)}
      className={cls}
    />
  );

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="pb-1 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
          <h3 className="text-2xl font-bold tracking-tight text-foreground">
            Featured Models
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Hand-picked models for image generation, video creation, and
            animation. From photorealistic portraits to cinematic motion —
            explore what's trending and start creating in seconds.
          </p>
        </div>

        {/* Top row: poster cards (3:4) — 2 cols on mobile, 3 on desktop */}
        <div
          className={
            mobile
              ? "grid grid-cols-2 gap-2"
              : "grid grid-cols-3 gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both"
          }
          style={mobile ? undefined : { animationDelay: "80ms" }}
        >
          {posters.map((f) => card(f, "aspect-[3/4]"))}
        </div>

        {/* Bottom row: square cards (1:1) — 2 cols on mobile, 4 on desktop */}
        <div
          className={
            mobile
              ? "grid grid-cols-2 gap-2"
              : "grid grid-cols-4 gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both"
          }
          style={mobile ? undefined : { animationDelay: "160ms" }}
        >
          {squares.map((f) => card(f, "aspect-square"))}
        </div>
      </div>
    </ScrollArea>
  );
}
