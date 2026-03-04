/**
 * Left panel — Character cards, Scene cards, Global style settings.
 */
import { useStoryboardStore } from "../stores/storyboard.store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { User, MapPin, Palette, Volume2, Pencil } from "lucide-react";

export function LeftPanel() {
  const characters = useStoryboardStore((s) => s.characters);
  const scenes = useStoryboardStore((s) => s.scenes);
  const project = useStoryboardStore((s) => s.project);
  const selectedCharacterId = useStoryboardStore((s) => s.selectedCharacterId);
  const selectedSceneId = useStoryboardStore((s) => s.selectedSceneId);
  const selectCharacter = useStoryboardStore((s) => s.selectCharacter);
  const selectScene = useStoryboardStore((s) => s.selectScene);

  if (!project) return null;

  return (
    <div className="w-56 border-r bg-background/50 flex flex-col shrink-0">
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Characters */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2 flex items-center gap-1">
              <User className="h-3 w-3" /> 角色 ({characters.length})
            </h3>
            <div className="space-y-2">
              {characters.map((char) => {
                const initial = char.name.charAt(0).toUpperCase();
                const hue = char.name.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % 360;

                return (
                  <div
                    key={char.character_id}
                    onClick={() => selectCharacter(char.character_id)}
                    className={cn(
                      "rounded-lg border p-2 cursor-pointer transition-all hover:shadow-sm group",
                      selectedCharacterId === char.character_id
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border/50 hover:border-border",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {/* Avatar with colored initial fallback */}
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                        style={!char.anchor_images.front ? { backgroundColor: `hsl(${hue}, 50%, 85%)` } : undefined}
                      >
                        {char.anchor_images.front ? (
                          <img src={char.anchor_images.front} alt={char.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-sm font-bold" style={{ color: `hsl(${hue}, 60%, 35%)` }}>{initial}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium truncate">{char.name}</p>
                          <button
                            onClick={(e) => { e.stopPropagation(); selectCharacter(char.character_id); }}
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
                            title="编辑角色"
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground/60" />
                          </button>
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
                          {char.visual_description.slice(0, 60)}...
                        </p>
                        {char.voice_id && (
                          <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5 mt-0.5">
                            <Volume2 className="h-2.5 w-2.5" /> {char.voice_id}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Scenes */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2 flex items-center gap-1">
              <MapPin className="h-3 w-3" /> 场景 ({scenes.length})
            </h3>
            <div className="space-y-2">
              {scenes.map((scene) => {
                const hue = scene.name.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % 360;

                return (
                  <div
                    key={scene.scene_id}
                    onClick={() => selectScene(scene.scene_id)}
                    className={cn(
                      "rounded-lg border p-2 cursor-pointer transition-all hover:shadow-sm group",
                      selectedSceneId === scene.scene_id
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border/50 hover:border-border",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                        style={!scene.anchor_image ? { backgroundColor: `hsl(${hue}, 45%, 88%)` } : undefined}
                      >
                        {scene.anchor_image ? (
                          <img src={scene.anchor_image} alt={scene.name} className="w-full h-full object-cover" />
                        ) : (
                          <MapPin className="h-4 w-4" style={{ color: `hsl(${hue}, 50%, 40%)` }} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium truncate">{scene.name}</p>
                          <button
                            onClick={(e) => { e.stopPropagation(); selectScene(scene.scene_id); }}
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
                            title="编辑场景"
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground/60" />
                          </button>
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
                          {scene.description.slice(0, 60)}...
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Global Style */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2 flex items-center gap-1">
              <Palette className="h-3 w-3" /> 全局风格
            </h3>
            <div className="rounded-lg border border-border/50 p-2 space-y-1 text-[10px] text-muted-foreground">
              <p>视觉: {project.style_profile.visual_style || "自动"}</p>
              <p>色调: {project.style_profile.color_tone || "自动"}</p>
              <p>配乐: {project.audio_profile.bgm_style || "自动"}</p>
              <p>比例: {project.style_profile.aspect_ratio}</p>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}


