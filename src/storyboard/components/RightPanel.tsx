/**
 * Right panel — unified editor for Shot, Character, and Scene.
 * Shows the appropriate editor based on what's selected.
 */
import { useState, useEffect } from "react";
import { useStoryboardStore } from "../stores/storyboard.store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { RefreshCw, Save, X, Camera, User, MapPin } from "lucide-react";
import type { ShotType, CameraMovement, EmotionTag, TransitionType, StrategyType } from "../types";

const SHOT_TYPES: { value: ShotType; label: string }[] = [
  { value: "wide", label: "全景" },
  { value: "medium", label: "中景" },
  { value: "close_up", label: "特写" },
  { value: "extreme_close_up", label: "大特写" },
  { value: "over_shoulder", label: "过肩" },
  { value: "pov", label: "主观" },
  { value: "aerial", label: "俯拍" },
];

const CAMERA_MOVEMENTS: { value: CameraMovement; label: string }[] = [
  { value: "static", label: "静止" },
  { value: "pan_left", label: "左摇" },
  { value: "pan_right", label: "右摇" },
  { value: "tilt_up", label: "上摇" },
  { value: "tilt_down", label: "下摇" },
  { value: "dolly_in", label: "推进" },
  { value: "dolly_out", label: "拉远" },
  { value: "tracking", label: "跟踪" },
  { value: "handheld", label: "手持" },
];

const EMOTIONS: { value: EmotionTag; label: string }[] = [
  { value: "neutral", label: "平静" },
  { value: "tense", label: "紧张" },
  { value: "joyful", label: "欢乐" },
  { value: "melancholy", label: "忧郁" },
  { value: "explosive", label: "爆发" },
  { value: "mysterious", label: "神秘" },
  { value: "romantic", label: "浪漫" },
  { value: "horror", label: "恐怖" },
];

const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: "cut", label: "硬切" },
  { value: "fade", label: "淡入淡出" },
  { value: "dissolve", label: "溶解" },
  { value: "wipe", label: "擦除" },
  { value: "match_cut", label: "匹配剪辑" },
];

const STRATEGY_TYPES: { value: StrategyType; label: string; desc: string }[] = [
  { value: "A1", label: "A1 续写", desc: "同场景连续动作，帧链条" },
  { value: "A2", label: "A2 切角", desc: "同场景角度切换，独立生成" },
  { value: "B",  label: "B 长镜", desc: "同场景长镜头，分段续写" },
  { value: "C",  label: "C 独立", desc: "跨场景短镜头，完全独立" },
  { value: "D",  label: "D 跨长", desc: "跨场景长镜头，首段独立" },
];

export function RightPanel() {
  const selectedShotId = useStoryboardStore((s) => s.selectedShotId);
  const selectedCharacterId = useStoryboardStore((s) => s.selectedCharacterId);
  const selectedSceneId = useStoryboardStore((s) => s.selectedSceneId);

  if (selectedShotId) return <ShotEditor />;
  if (selectedCharacterId) return <CharacterEditor />;
  if (selectedSceneId) return <SceneEditor />;

  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground/40 text-xs text-center p-4">
      选择一个镜头、角色或场景查看详情
    </div>
  );
}

/* ── Shot Editor ───────────────────────────────────────── */

function ShotEditor() {
  const selectedShotId = useStoryboardStore((s) => s.selectedShotId);
  const shots = useStoryboardStore((s) => s.shots);
  const characters = useStoryboardStore((s) => s.characters);
  const project = useStoryboardStore((s) => s.project);
  const updateShot = useStoryboardStore((s) => s.updateShot);
  const regenerateShot = useStoryboardStore((s) => s.regenerateShot);
  const selectShot = useStoryboardStore((s) => s.selectShot);

  const shot = shots.find((s) => s.shot_id === selectedShotId);
  const isPro = project?.mode === "pro";

  const [desc, setDesc] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [narration, setNarration] = useState("");
  const [shotType, setShotType] = useState<ShotType>("medium");
  const [cameraMove, setCameraMove] = useState<CameraMovement>("static");
  const [duration, setDuration] = useState(6);
  const [emotion, setEmotion] = useState<EmotionTag>("neutral");
  const [transition, setTransition] = useState<TransitionType>("cut");
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");

  useEffect(() => {
    if (shot) {
      setDesc(shot.action_description);
      setDialogue(shot.dialogue || "");
      setNarration(shot.narration || "");
      setShotType(shot.shot_type);
      setCameraMove(shot.camera_movement);
      setDuration(shot.duration);
      setEmotion(shot.emotion_tag);
      setTransition(shot.transition_to_next);
      setPrompt(shot.generation_prompt);
      setNegPrompt(shot.negative_prompt);
    }
  }, [shot]);

  if (!shot) return null;

  const handleSave = () => {
    updateShot(shot.shot_id, {
      action_description: desc,
      dialogue: dialogue || null,
      narration: narration || null,
      shot_type: shotType,
      camera_movement: cameraMove,
      duration,
      emotion_tag: emotion,
      transition_to_next: transition,
      generation_prompt: prompt,
      negative_prompt: negPrompt,
    });
  };

  const shotChars = characters.filter((c) => shot.character_ids.includes(c.character_id));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold">镜头 #{shot.sequence_number}</h3>
        </div>
        <button onClick={() => selectShot(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Video preview with duration comparison */}
      {shot.generated_assets.video_path && (
        <div className="border-b">
          <video
            src={shot.generated_assets.video_path}
            controls
            className="w-full aspect-video bg-black"
            preload="metadata"
            onLoadedMetadata={(e) => {
              const vid = e.target as HTMLVideoElement;
              const actualDur = vid.duration;
              // Show duration mismatch warning inline
              const container = vid.parentElement;
              if (container) {
                const existing = container.querySelector("[data-dur-info]");
                if (existing) existing.remove();
                if (actualDur > 0 && Math.abs(actualDur - shot.duration) > 0.5) {
                  const badge = document.createElement("div");
                  badge.setAttribute("data-dur-info", "true");
                  badge.className = "px-2 py-1 text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-t";
                  badge.textContent = `⚠ 实际 ${actualDur.toFixed(1)}s vs 目标 ${shot.duration}s — 偏差 ${Math.abs(actualDur - shot.duration).toFixed(1)}s`;
                  container.appendChild(badge);
                }
              }
            }}
          />
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px]">📝 动作描述</Label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} className="text-xs min-h-[60px] resize-none" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">💬 对白</Label>
            {shotChars.length > 0 && (
              <p className="text-[9px] text-muted-foreground">角色: {shotChars.map((c) => c.name).join(", ")}</p>
            )}
            <Textarea value={dialogue} onChange={(e) => setDialogue(e.target.value)} placeholder="无对白" className="text-xs min-h-[40px] resize-none" />
          </div>

          {/* Duration — always visible (critical for generation) */}
          <div className="space-y-1">
            <Label className="text-[10px]">⏱ 时长: {duration}s <span className="text-muted-foreground/60">(4-12s)</span></Label>
            <Slider value={[duration]} onValueChange={([v]) => setDuration(v)} min={4} max={12} step={1} className="py-1" />
            <p className="text-[9px] text-muted-foreground/60">Seedance 模型支持 4-12 秒，此参数直接传入 API</p>
          </div>

          {isPro && (
            <>
              <div className="space-y-1">
                <Label className="text-[10px]">🎙 旁白</Label>
                <Textarea value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="无旁白" className="text-xs min-h-[40px] resize-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">🎬 景别</Label>
                <Select value={shotType} onValueChange={(v) => setShotType(v as ShotType)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SHOT_TYPES.map((st) => (<SelectItem key={st.value} value={st.value} className="text-xs">{st.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">📷 运镜</Label>
                <Select value={cameraMove} onValueChange={(v) => setCameraMove(v as CameraMovement)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMERA_MOVEMENTS.map((cm) => (<SelectItem key={cm.value} value={cm.value} className="text-xs">{cm.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">🎭 情绪</Label>
                <Select value={emotion} onValueChange={(v) => setEmotion(v as EmotionTag)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMOTIONS.map((em) => (<SelectItem key={em.value} value={em.value} className="text-xs">{em.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">🔗 转场</Label>
                <Select value={transition} onValueChange={(v) => setTransition(v as TransitionType)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRANSITIONS.map((tr) => (<SelectItem key={tr.value} value={tr.value} className="text-xs">{tr.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">🤖 生成Prompt</Label>
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="text-[10px] min-h-[80px] resize-none font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">🚫 负面提示词</Label>
                <Textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} className="text-[10px] min-h-[40px] resize-none font-mono" />
              </div>

              {/* Strategy info & override */}
              {shot.strategy && (
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-[10px]">🧭 生成策略</Label>
                  <div className="text-[9px] space-y-1 bg-muted/30 rounded-lg p-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">类型</span>
                      <span className="font-mono font-medium">{shot.strategy.strategy_type} — {STRATEGY_TYPES.find((s) => s.value === shot.strategy!.strategy_type)?.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">帧链条</span>
                      <span>{shot.strategy.use_frame_chain ? "✅ 启用" : "❌ 关闭"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">分段数</span>
                      <span>{shot.strategy.segments}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">可并行</span>
                      <span>{shot.strategy.parallel_eligible ? "✅" : "❌"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">场景锚定</span>
                      <span>{shot.strategy.is_scene_anchor_shot ? "⚓ 是" : "否"}</span>
                    </div>
                  </div>

                  <Label className="text-[10px]">覆盖策略类型</Label>
                  <Select
                    value={shot.user_strategy_override?.strategy_type ?? shot.strategy.strategy_type}
                    onValueChange={(v) => {
                      const override = {
                        ...shot.user_strategy_override,
                        strategy_type: v as StrategyType,
                        use_frame_chain: v === "A1" || v === "B" || v === "D",
                        parallel_eligible: v === "C" || v === "A2",
                      };
                      updateShot(shot.shot_id, { user_strategy_override: override });
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STRATEGY_TYPES.map((st) => (
                        <SelectItem key={st.value} value={st.value} className="text-xs">
                          {st.label} — {st.desc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
      <div className="p-3 border-t flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={handleSave}>
          <Save className="h-3 w-3 mr-1" /> 保存
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={() => regenerateShot(shot.shot_id)}>
          <RefreshCw className="h-3 w-3 mr-1" /> 重新生成
        </Button>
      </div>
    </div>
  );
}

/* ── Character Editor ──────────────────────────────────── */

function CharacterEditor() {
  const selectedCharacterId = useStoryboardStore((s) => s.selectedCharacterId);
  const characters = useStoryboardStore((s) => s.characters);
  const updateCharacter = useStoryboardStore((s) => s.updateCharacter);
  const selectCharacter = useStoryboardStore((s) => s.selectCharacter);

  const char = characters.find((c) => c.character_id === selectedCharacterId);

  const [name, setName] = useState("");
  const [visualDesc, setVisualDesc] = useState("");
  const [personality, setPersonality] = useState("");
  const [role, setRole] = useState("");

  useEffect(() => {
    if (char) {
      setName(char.name);
      setVisualDesc(char.visual_description);
      setPersonality(char.personality);
      setRole(char.role_in_story);
    }
  }, [char]);

  if (!char) return null;

  const handleSave = () => {
    updateCharacter(char.character_id, {
      name,
      visual_description: visualDesc,
      personality,
      role_in_story: role,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold">角色: {char.name}</h3>
        </div>
        <button onClick={() => selectCharacter(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Avatar */}
      <div className="border-b p-3 flex justify-center">
        <div className="w-20 h-20 rounded-xl bg-muted/50 flex items-center justify-center overflow-hidden">
          {char.anchor_images.front ? (
            <img src={char.anchor_images.front} alt={char.name} className="w-full h-full object-cover" />
          ) : (
            <User className="h-8 w-8 text-muted-foreground/30" />
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px]">👤 名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-xs h-7" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">🎨 外观描述</Label>
            <Textarea value={visualDesc} onChange={(e) => setVisualDesc(e.target.value)} className="text-xs min-h-[80px] resize-none" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">💭 性格</Label>
            <Textarea value={personality} onChange={(e) => setPersonality(e.target.value)} className="text-xs min-h-[40px] resize-none" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">🎭 角色定位</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} className="text-xs h-7" />
          </div>
        </div>
      </ScrollArea>
      <div className="p-3 border-t">
        <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={handleSave}>
          <Save className="h-3 w-3 mr-1" /> 保存角色
        </Button>
      </div>
    </div>
  );
}

/* ── Scene Editor ──────────────────────────────────────── */

function SceneEditor() {
  const selectedSceneId = useStoryboardStore((s) => s.selectedSceneId);
  const scenes = useStoryboardStore((s) => s.scenes);
  const updateScene = useStoryboardStore((s) => s.updateScene);
  const selectScene = useStoryboardStore((s) => s.selectScene);

  const scene = scenes.find((s) => s.scene_id === selectedSceneId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [lighting, setLighting] = useState("");
  const [weather, setWeather] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("");
  const [mood, setMood] = useState("");

  useEffect(() => {
    if (scene) {
      setName(scene.name);
      setDescription(scene.description);
      setLighting(scene.lighting);
      setWeather(scene.weather);
      setTimeOfDay(scene.time_of_day);
      setMood(scene.mood);
    }
  }, [scene]);

  if (!scene) return null;

  const handleSave = () => {
    updateScene(scene.scene_id, {
      name,
      description,
      lighting,
      weather,
      time_of_day: timeOfDay,
      mood,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold">场景: {scene.name}</h3>
        </div>
        <button onClick={() => selectScene(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scene image */}
      <div className="border-b p-3 flex justify-center">
        <div className="w-full aspect-video rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden">
          {scene.anchor_image ? (
            <img src={scene.anchor_image} alt={scene.name} className="w-full h-full object-cover" />
          ) : (
            <MapPin className="h-8 w-8 text-muted-foreground/30" />
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px]">📍 场景名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-xs h-7" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">🏞 环境描述</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="text-xs min-h-[80px] resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">💡 光照</Label>
              <Input value={lighting} onChange={(e) => setLighting(e.target.value)} className="text-xs h-7" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">🌤 天气</Label>
              <Input value={weather} onChange={(e) => setWeather(e.target.value)} className="text-xs h-7" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">🕐 时间</Label>
              <Input value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} className="text-xs h-7" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">🎭 氛围</Label>
              <Input value={mood} onChange={(e) => setMood(e.target.value)} className="text-xs h-7" />
            </div>
          </div>
        </div>
      </ScrollArea>
      <div className="p-3 border-t">
        <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={handleSave}>
          <Save className="h-3 w-3 mr-1" /> 保存场景
        </Button>
      </div>
    </div>
  );
}
