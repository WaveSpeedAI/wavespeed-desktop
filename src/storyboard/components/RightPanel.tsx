/**
 * Right panel — unified editor for Shot, Character, and Scene (v3.0).
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
import type { ShotScale, CameraMotionType, TransitionType } from "../types/shot";

const SHOT_SCALES: { value: ShotScale; label: string }[] = [
  { value: "ECU", label: "大特写" },
  { value: "CU", label: "特写" },
  { value: "MCU", label: "中特写" },
  { value: "MS", label: "中景" },
  { value: "MLS", label: "中全景" },
  { value: "LS", label: "全景" },
  { value: "ELS", label: "远景" },
];

const CAMERA_MOTIONS: { value: CameraMotionType; label: string }[] = [
  { value: "static", label: "静止" },
  { value: "pan", label: "摇镜" },
  { value: "tilt", label: "俯仰" },
  { value: "dolly_in", label: "推进" },
  { value: "dolly_out", label: "拉远" },
  { value: "tracking", label: "跟踪" },
  { value: "crane", label: "升降" },
  { value: "handheld", label: "手持" },
];

const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: "cut", label: "硬切" },
  { value: "dissolve", label: "溶解" },
  { value: "crossfade", label: "交叉淡化" },
  { value: "fade", label: "淡入淡出" },
  { value: "wipe", label: "擦除" },
  { value: "match_cut", label: "匹配剪辑" },
];

const PATH_INFO: Record<string, { label: string; desc: string }> = {
  P1: { label: "P1 首帧→视频", desc: "默认路径，首帧生成后 i2v" },
  P2: { label: "P2 首尾帧→视频", desc: "明确起止状态，≤6s" },
  P3: { label: "P3 合成首帧→视频", desc: "3+ 角色强制合成" },
  P4: { label: "P4 静态+Ken Burns", desc: "氛围镜头，零风险" },
  P5: { label: "P5 分段→拼接", desc: ">7s 内部节奏变化" },
};

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
  const updateShot = useStoryboardStore((s) => s.updateShot);
  const regenerateFirstFrame = useStoryboardStore((s) => s.regenerateFirstFrame);
  const selectShot = useStoryboardStore((s) => s.selectShot);

  const shot = shots.find((s) => s.shot_id === selectedShotId);

  const [visualPoetry, setVisualPoetry] = useState("");
  const [tensionMoment, setTensionMoment] = useState("");
  const [scale, setScale] = useState<ShotScale>("MS");
  const [cameraType, setCameraType] = useState<CameraMotionType>("static");
  const [cameraIntensity, setCameraIntensity] = useState(1);
  const [duration, setDuration] = useState(6);
  const [transitionIn, setTransitionIn] = useState<TransitionType>("cut");
  const [transitionOut, setTransitionOut] = useState<TransitionType>("cut");
  const [firstFramePrompt, setFirstFramePrompt] = useState("");
  const [i2vPrompt, setI2vPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");

  useEffect(() => {
    if (shot) {
      setVisualPoetry(shot.visual_poetry);
      setTensionMoment(shot.tension_moment);
      setScale(shot.composition.scale);
      setCameraType(shot.camera_motion.type);
      setCameraIntensity(shot.camera_motion.intensity);
      setDuration(shot.duration_seconds);
      setTransitionIn(shot.transition_in);
      setTransitionOut(shot.transition_out);
      setFirstFramePrompt(shot.first_frame_prompt);
      setI2vPrompt(shot.i2v_prompt);
      setNegPrompt(shot.negative_prompt);
    }
  }, [shot]);

  if (!shot) return null;

  const handleSave = () => {
    updateShot(shot.shot_id, {
      visual_poetry: visualPoetry,
      tension_moment: tensionMoment,
      composition: { ...shot.composition, scale },
      camera_motion: { type: cameraType, intensity: cameraIntensity },
      duration_seconds: duration,
      transition_in: transitionIn,
      transition_out: transitionOut,
      first_frame_prompt: firstFramePrompt,
      i2v_prompt: i2vPrompt,
      negative_prompt: negPrompt,
    });
  };

  const shotChars = characters.filter((c) =>
    shot.subjects.some((s) => s.character_id === c.character_id),
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold">镜头 #{shot.sequence_number}</h3>
          {shot.scene_type && (
            <span className="text-[9px] font-mono text-muted-foreground bg-muted px-1 rounded">
              {shot.scene_type}
            </span>
          )}
        </div>
        <button onClick={() => selectShot(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* First frame / video preview */}
      {(shot.generated_assets.first_frame || shot.generated_assets.video_url) && (
        <div className="border-b">
          {shot.generated_assets.video_url ? (
            <video
              src={shot.generated_assets.video_url}
              controls
              className="w-full aspect-video bg-black"
              preload="metadata"
            />
          ) : shot.generated_assets.first_frame ? (
            <img
              src={shot.generated_assets.first_frame}
              alt={`Shot #${shot.sequence_number}`}
              className="w-full aspect-video object-cover"
            />
          ) : null}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px]">🎨 视觉诗意 (≤30 tokens)</Label>
            <Textarea value={visualPoetry} onChange={(e) => setVisualPoetry(e.target.value)} className="text-xs min-h-[40px] resize-none" placeholder="cinematic description..." />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">⚡ 张力时刻 (≤15 tokens)</Label>
            <Textarea value={tensionMoment} onChange={(e) => setTensionMoment(e.target.value)} className="text-xs min-h-[40px] resize-none" placeholder="frozen instant before peak..." />
          </div>

          {/* Characters in shot */}
          {shotChars.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[10px]">👥 角色</Label>
              <p className="text-[9px] text-muted-foreground">{shotChars.map((c) => c.name).join(", ")}</p>
            </div>
          )}

          {/* Duration */}
          <div className="space-y-1">
            <Label className="text-[10px]">⏱ 时长: {duration}s</Label>
            <Slider value={[duration]} onValueChange={([v]) => setDuration(v)} min={4} max={12} step={0.5} className="py-1" />
          </div>

          {/* Composition */}
          <div className="space-y-1">
            <Label className="text-[10px]">🎬 景别</Label>
            <Select value={scale} onValueChange={(v) => setScale(v as ShotScale)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SHOT_SCALES.map((st) => (<SelectItem key={st.value} value={st.value} className="text-xs">{st.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          {/* Camera motion */}
          <div className="space-y-1">
            <Label className="text-[10px]">📷 运镜</Label>
            <Select value={cameraType} onValueChange={(v) => setCameraType(v as CameraMotionType)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAMERA_MOTIONS.map((cm) => (<SelectItem key={cm.value} value={cm.value} className="text-xs">{cm.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">运镜强度: {cameraIntensity}</Label>
            <Slider value={[cameraIntensity]} onValueChange={([v]) => setCameraIntensity(v)} min={1} max={5} step={1} className="py-1" />
          </div>

          {/* Transitions */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">🔗 入场转场</Label>
              <Select value={transitionIn} onValueChange={(v) => setTransitionIn(v as TransitionType)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRANSITIONS.map((tr) => (<SelectItem key={tr.value} value={tr.value} className="text-xs">{tr.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">🔗 出场转场</Label>
              <Select value={transitionOut} onValueChange={(v) => setTransitionOut(v as TransitionType)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRANSITIONS.map((tr) => (<SelectItem key={tr.value} value={tr.value} className="text-xs">{tr.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Prompts */}
          <div className="space-y-1">
            <Label className="text-[10px]">🖼 首帧 Prompt</Label>
            <Textarea value={firstFramePrompt} onChange={(e) => setFirstFramePrompt(e.target.value)} className="text-[10px] min-h-[60px] resize-none font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">🎬 i2v Prompt</Label>
            <Textarea value={i2vPrompt} onChange={(e) => setI2vPrompt(e.target.value)} className="text-[10px] min-h-[60px] resize-none font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">🚫 负面提示词</Label>
            <Textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} className="text-[10px] min-h-[40px] resize-none font-mono" />
          </div>

          {/* Execution plan info */}
          {shot.execution_plan && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-[10px]">🧭 执行计划</Label>
              <div className="text-[9px] space-y-1 bg-muted/30 rounded-lg p-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">路径</span>
                  <span className="font-mono font-medium">
                    {shot.execution_plan.path} — {PATH_INFO[shot.execution_plan.path]?.label}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">需要尾帧</span>
                  <span>{shot.execution_plan.need_end_frame ? "✅" : "❌"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">需要合成</span>
                  <span>{shot.execution_plan.need_composite ? "✅" : "❌"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">分段数</span>
                  <span>{shot.execution_plan.segment_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">安全时长</span>
                  <span>{shot.execution_plan.safe_max_duration}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">降级路径</span>
                  <span className="font-mono">{shot.execution_plan.fallback_path}</span>
                </div>
              </div>
            </div>
          )}

          {/* QC warnings */}
          {shot.qc_warnings.length > 0 && (
            <div className="space-y-1 pt-2 border-t">
              <Label className="text-[10px]">⚠ 质量警告</Label>
              <div className="text-[9px] text-amber-600 dark:text-amber-400 space-y-0.5">
                {shot.qc_warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="p-3 border-t flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={handleSave}>
          <Save className="h-3 w-3 mr-1" /> 保存
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={() => regenerateFirstFrame(shot.shot_id)}>
          <RefreshCw className="h-3 w-3 mr-1" /> 重新生成首帧
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
  const [faceDesc, setFaceDesc] = useState("");
  const [coreOutfit, setCoreOutfit] = useState("");
  const [sigFeatures, setSigFeatures] = useState("");

  useEffect(() => {
    if (char) {
      setName(char.name);
      setFaceDesc(char.immutable_traits.face_description);
      setCoreOutfit(char.immutable_traits.core_outfit);
      setSigFeatures(char.immutable_traits.signature_features);
    }
  }, [char]);

  if (!char) return null;

  const handleSave = () => {
    updateCharacter(char.character_id, {
      name,
      immutable_traits: {
        face_description: faceDesc,
        core_outfit: coreOutfit,
        signature_features: sigFeatures,
      },
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold">角色: {char.name}</h3>
          <span className="text-[9px] text-muted-foreground">{char.role}</span>
        </div>
        <button onClick={() => selectCharacter(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Avatar */}
      <div className="border-b p-3 flex justify-center">
        <div className="w-20 h-20 rounded-xl bg-muted/50 flex items-center justify-center overflow-hidden">
          {char.turnaround_image ? (
            <img src={char.turnaround_image} alt={char.name} className="w-full h-full object-cover" />
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
            <Label className="text-[10px]">👁 面部描述 (≤30 tokens)</Label>
            <Textarea value={faceDesc} onChange={(e) => setFaceDesc(e.target.value)} className="text-xs min-h-[60px] resize-none" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">👔 核心服装 (≤20 tokens)</Label>
            <Textarea value={coreOutfit} onChange={(e) => setCoreOutfit(e.target.value)} className="text-xs min-h-[40px] resize-none" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">✨ 标志特征</Label>
            <Input value={sigFeatures} onChange={(e) => setSigFeatures(e.target.value)} className="text-xs h-7" />
          </div>

          {/* Mutable states */}
          {char.mutable_states.length > 0 && (
            <div className="space-y-1 pt-2 border-t">
              <Label className="text-[10px]">🔄 可变状态</Label>
              <div className="text-[9px] space-y-1">
                {char.mutable_states.map((ms) => (
                  <div key={ms.state_id} className="bg-muted/30 rounded p-1.5">
                    <span className="font-medium">{ms.name}</span>: {ms.description}
                  </div>
                ))}
              </div>
            </div>
          )}
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
  const [envDesc, setEnvDesc] = useState("");
  const [geometryHint, setGeometryHint] = useState("");
  const [weather, setWeather] = useState("");
  const [lightMood, setLightMood] = useState("");

  useEffect(() => {
    if (scene) {
      setName(scene.name);
      setEnvDesc(scene.environment_description);
      setGeometryHint(scene.geometry_hint);
      setWeather(scene.weather_state);
      setLightMood(scene.key_light_mood);
    }
  }, [scene]);

  if (!scene) return null;

  const handleSave = () => {
    updateScene(scene.scene_id, {
      name,
      environment_description: envDesc,
      geometry_hint: geometryHint,
      weather_state: weather,
      key_light_mood: lightMood as any,
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
          {scene.master_frame ? (
            <img src={scene.master_frame} alt={scene.name} className="w-full h-full object-cover" />
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
            <Label className="text-[10px]">🏞 环境描述 (≤40 tokens)</Label>
            <Textarea value={envDesc} onChange={(e) => setEnvDesc(e.target.value)} className="text-xs min-h-[80px] resize-none" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">📐 空间结构</Label>
            <Input value={geometryHint} onChange={(e) => setGeometryHint(e.target.value)} className="text-xs h-7" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">💡 光照氛围</Label>
              <Select value={lightMood} onValueChange={setLightMood}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warm" className="text-xs">暖调</SelectItem>
                  <SelectItem value="cold" className="text-xs">冷调</SelectItem>
                  <SelectItem value="dramatic" className="text-xs">戏剧</SelectItem>
                  <SelectItem value="soft" className="text-xs">柔和</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">🌤 天气</Label>
              <Input value={weather} onChange={(e) => setWeather(e.target.value)} className="text-xs h-7" />
            </div>
          </div>

          {/* Landmark objects */}
          {scene.landmark_objects.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[10px]">🏛 地标物体</Label>
              <div className="flex flex-wrap gap-1">
                {scene.landmark_objects.map((obj, i) => (
                  <span key={i} className="text-[9px] bg-muted px-1.5 py-0.5 rounded">{obj}</span>
                ))}
              </div>
            </div>
          )}

          {/* Dominant colors */}
          {scene.dominant_colors.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[10px]">🎨 主色调</Label>
              <p className="text-[9px] text-muted-foreground">{scene.dominant_colors.join(", ")}</p>
            </div>
          )}
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
