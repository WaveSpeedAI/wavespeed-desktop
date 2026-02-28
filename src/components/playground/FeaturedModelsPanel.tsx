import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Model } from "@/types/model";

const FEATURED_MODEL_FAMILIES = [
  {
    name: "Seedream 4.5",
    provider: "bytedance",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1764761216479761378_Yy864da9.png",
    primaryVariant: "bytedance/seedream-v4.5",
    tags: ["Photorealistic", "High Detail"],
    isNew: true,
  },
  {
    name: "Seedance 1.5 Pro",
    provider: "bytedance",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766494048998434655_qEMLsAI0.png",
    primaryVariant: "bytedance/seedance-v1.5-pro/image-to-video",
    tags: ["Sci-Fi", "Neon", "Future"],
  },
  {
    name: "Wan Spicy",
    provider: "wavespeed-ai",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766298334453523753_f975da96.png",
    primaryVariant: "wavespeed-ai/wan-2.2-spicy/image-to-video",
    tags: ["Artistic", "Soft", "Paint"],
  },
  {
    name: "InfiniteTalk",
    provider: "wavespeed-ai",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766575571686877852_Sckigeck.png",
    primaryVariant: "wavespeed-ai/infinitetalk",
    tags: ["Movie", "Bk"],
  },
  {
    name: "Kling 2.6 Motion Control",
    provider: "kwaivgi",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1766519115490596160_Smusqomu.png",
    primaryVariant: "kwaivgi/kling-v2.6-pro/motion-control",
    tags: ["Motion", "Control"],
  },
  {
    name: "Nano Banana Pro",
    provider: "google",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1763649945119973876_WvMIEAxu.jpg",
    primaryVariant: "google/nano-banana-pro/text-to-image",
    tags: ["Text-to-Image"],
  },
  {
    name: "Wan Animate",
    provider: "wavespeed-ai",
    poster:
      "https://d1q70pf5vjeyhc.wavespeed.ai/media/images/1758433474532574441_SkTQLIEA.jpeg",
    primaryVariant: "wavespeed-ai/wan-2.2/animate",
    tags: ["Animation"],
  },
];

interface FeaturedModelsPanelProps {
  onSelectFeatured: (primaryVariant: string) => void;
  models: Model[];
}

export function FeaturedModelsPanel({
  onSelectFeatured,
  models,
}: FeaturedModelsPanelProps) {
  const getPrice = (modelId: string) => {
    const model = models.find((m) => m.model_id === modelId);
    return model?.base_price;
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {FEATURED_MODEL_FAMILIES.map((family, index) => {
            const price = getPrice(family.primaryVariant);
            const isHero = index === 0;
            return (
              <div
                key={family.name}
                className={cn(
                  "cursor-pointer group relative rounded-xl overflow-hidden bg-muted",
                  isHero ? "col-span-full aspect-[21/9]" : "aspect-[16/9]",
                )}
                onClick={() => onSelectFeatured(family.primaryVariant)}
              >
                <img
                  src={family.poster}
                  alt={family.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
                {family.isNew && (
                  <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground text-[10px] px-2 py-0.5 font-bold">
                    NEW
                  </Badge>
                )}
                <div className="absolute bottom-3 left-4 right-4">
                  <h4
                    className={cn(
                      "font-bold text-white leading-tight",
                      isHero ? "text-lg" : "text-sm",
                    )}
                  >
                    {family.name}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[11px] text-white/60">
                      {family.tags.join(" · ")}
                    </p>
                    {price !== undefined && (
                      <span className="text-[11px] text-white/80 font-semibold">
                        ${price.toFixed(4)} / run
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
