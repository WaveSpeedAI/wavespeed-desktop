/**
 * NodeBodyContent — the inner body rendering of a CustomNode.
 *
 * Extracted from CustomNode to keep each file under 1000 lines.
 * Renders: ML hint, media upload, text input, AI task form,
 * schema params, input ports, segment picker, defParams,
 * inline preview, and results panel.
 */
import { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useWorkflowStore } from "../../../stores/workflow.store";
import {
  SegmentPointPicker,
  type SegmentPoint,
} from "../../SegmentPointPicker";
import { MousePointer2, ChevronRight, ChevronDown } from "lucide-react";
import { getSingleImageFromValues } from "@/lib/schemaToForm";
import { convertDesktopModel } from "../../../lib/model-converter";
import type {
  ParamDefinition,
  PortDefinition,
  ModelParamSchema,
  WaveSpeedModel,
} from "@/workflow/types/node-defs";
import type { NodeStatus } from "@/workflow/types/execution";
import { ResultsPanel } from "../../panels/ResultsPanel";
import { FormField } from "@/components/playground/FormField";
import { ModelSelector } from "@/components/playground/ModelSelector";
import type { FormFieldConfig } from "@/lib/schemaToForm";
import type { Model } from "@/types/model";

import {
  type CustomNodeData,
  ML_FREE_TOOLS,
  paramDefToFormFieldConfig,
  portToFormFieldConfig,
} from "./CustomNodeTypes";
import { HandleAnchor } from "./CustomNodeHandleAnchor";
import {
  Row,
  LinkedBadge,
  ConnectedInputControl,
  Tip,
  Inline3DViewer,
} from "./CustomNodePrimitives";
import {
  ParamRow,
  MediaRow,
  LoraRow,
  JsonRow,
  DefParamControl,
  InputPortControl,
} from "./CustomNodeParamControls";
import { MediaUploadBody, TextInputBody } from "./CustomNodeInputBodies";

export interface CustomNodeBodyProps {
  id: string;
  data: CustomNodeData;
  status: NodeStatus;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    targetHandle?: string | null;
  }>;
  connectedSet: Set<string>;
  inputDefs: PortDefinition[];
  paramDefs: ParamDefinition[];
  isAITask: boolean;
  isPreviewNode: boolean;
  currentModelId: string;
  currentModel: Model | undefined;
  storeModels: Model[];
  getModelById: (id: string) => Model | undefined;
  usePlaygroundForm: boolean;
  visibleFormFields: FormFieldConfig[];
  hiddenFormFields: FormFieldConfig[];
  enabledHiddenFields: Set<string>;
  setEnabledHiddenFields: Dispatch<SetStateAction<Set<string>>>;
  orderedVisibleParams: ModelParamSchema[];
  optionalParams: ModelParamSchema[];
  showOptional: boolean;
  setShowOptional: Dispatch<SetStateAction<boolean>>;
  formValues: Record<string, unknown>;
  resultGroups: unknown[];
  setParam: (key: string, value: unknown) => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => void;
  openPreview: (src: string) => void;
  handleInlineSelectModel: (model: WaveSpeedModel) => void;
  handleWorkflowUploadFile: (file: File) => Promise<string>;
  localizeInputLabel: (key: string, fallback: string) => string;
  localizeParamLabel: (key: string, fallback: string) => string;
  localizeParamDescription: (
    key: string,
    fallback?: string,
  ) => string | undefined;
  segmentPointPickerOpen: boolean;
  setSegmentPointPickerOpen: Dispatch<SetStateAction<boolean>>;
  ensureWorkflowId: () => Promise<string | null | undefined>;
  inlineInputPreviewUrl: string;
  inlinePreviewIsImage: boolean;
  inlinePreviewIsVideo: boolean;
  inlinePreviewIsAudio: boolean;
  inlinePreviewIs3D: boolean;
  resultsExpanded: boolean;
  setResultsExpanded: Dispatch<SetStateAction<boolean>>;
}

export function CustomNodeBody(props: CustomNodeBodyProps) {
  const {
    id,
    data,
    status,
    edges,
    connectedSet,
    inputDefs,
    paramDefs,
    isAITask,
    isPreviewNode,
    currentModelId,
    currentModel,
    storeModels,
    getModelById,
    usePlaygroundForm,
    visibleFormFields,
    hiddenFormFields,
    enabledHiddenFields,
    setEnabledHiddenFields,
    orderedVisibleParams,
    optionalParams,
    showOptional,
    setShowOptional,
    formValues,
    resultGroups,
    setParam,
    updateNodeParams,
    openPreview,
    handleInlineSelectModel,
    handleWorkflowUploadFile,
    localizeInputLabel,
    localizeParamLabel,
    localizeParamDescription,
    segmentPointPickerOpen,
    setSegmentPointPickerOpen,
    ensureWorkflowId,
    inlineInputPreviewUrl,
    inlinePreviewIsImage,
    inlinePreviewIsVideo,
    inlinePreviewIsAudio,
    inlinePreviewIs3D,
    resultsExpanded,
    setResultsExpanded,
  } = props;
  const { t } = useTranslation();

  return (
    <div className="px-1 py-2 space-y-px">
      {/* Free-tool ML model download hint */}
      {status === "idle" &&
        resultGroups.length === 0 &&
        ML_FREE_TOOLS.has(data.nodeType) && (
          <div className="mx-3 mb-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <svg
              className="flex-shrink-0 text-amber-400"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="text-[10px] text-amber-400/90 leading-tight">
              {t(
                "workflow.freeToolModelHint",
                "First run will auto-download the AI model, please wait",
              )}
            </span>
          </div>
        )}

      {/* Media Upload node — special UI */}
      {data.nodeType === "input/media-upload" && (
        <>
          {inputDefs.map((inp) => {
            const hid = `input-${inp.key}`;
            const conn = connectedSet.has(hid);
            return (
              <Row key={inp.key}>
                <div className="flex items-center justify-between gap-2 w-full">
                  <span
                    className={`text-xs whitespace-nowrap flex-shrink-0 ${conn ? "text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}
                  >
                    <HandleAnchor
                      id={hid}
                      type="target"
                      connected={conn}
                      media
                    />
                    {localizeInputLabel(inp.key, inp.label)}
                  </span>
                  {conn && (
                    <ConnectedInputControl
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onPreview={openPreview}
                    />
                  )}
                </div>
              </Row>
            );
          })}
          {!connectedSet.has("input-media") && (
            <MediaUploadBody
              params={data.params}
              onBatchChange={(updates) => {
                updateNodeParams(id, { ...data.params, ...updates });
              }}
              onPreview={openPreview}
            />
          )}
        </>
      )}

      {/* Text Input node — special UI */}
      {data.nodeType === "input/text-input" && (
        <TextInputBody
          params={data.params}
          onParamChange={(updates) => {
            updateNodeParams(id, { ...data.params, ...updates });
          }}
        />
      )}

      {isAITask && (
        <div className="nodrag px-3 mb-1" onClick={(e) => e.stopPropagation()}>
          <ModelSelector
            models={storeModels}
            value={currentModelId || undefined}
            onChange={(modelId) => {
              const storeModel = getModelById(modelId);
              if (!storeModel) return;
              handleInlineSelectModel(convertDesktopModel(storeModel));
            }}
          />
        </div>
      )}

      {/* AI Task: reuse Playground form (FormField) when model is loaded */}
      {usePlaygroundForm && (
        <>
          {visibleFormFields.map((field) => {
            const hid = `param-${field.name}`;
            const conn = connectedSet.has(hid);
            const isMediaField =
              field.type === "file" ||
              field.type === "file-array" ||
              /image|video|audio|mask/i.test(field.name);
            return (
              <Row key={field.name}>
                {conn ? (
                  <div className="flex flex-col gap-1 w-full">
                    <div className="flex items-center">
                      <span className="text-sm font-medium leading-none">
                        <HandleAnchor
                          id={hid}
                          type="target"
                          connected={conn}
                          media={isMediaField}
                        />
                        {field.label || field.name}
                        {field.required && (
                          <span className="ml-0.5 text-destructive">*</span>
                        )}
                      </span>
                    </div>
                    {isMediaField ? (
                      <ConnectedInputControl
                        nodeId={id}
                        handleId={hid}
                        edges={edges}
                        nodes={useWorkflowStore.getState().nodes}
                        onPreview={openPreview}
                      />
                    ) : (
                      <LinkedBadge
                        nodeId={id}
                        handleId={hid}
                        edges={edges}
                        nodes={useWorkflowStore.getState().nodes}
                        onDisconnect={() => {
                          const edge = edges.find(
                            (e) => e.target === id && e.targetHandle === hid,
                          );
                          if (edge)
                            useWorkflowStore.getState().removeEdge(edge.id);
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div
                    className="w-full min-w-0 nodrag"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FormField
                      field={field}
                      value={formValues[field.name]}
                      onChange={(v) => setParam(field.name, v)}
                      modelType={currentModel?.type}
                      imageValue={
                        field.name === "prompt"
                          ? getSingleImageFromValues(formValues)
                          : undefined
                      }
                      formValues={formValues}
                      handleAnchor={
                        <HandleAnchor
                          id={hid}
                          type="target"
                          connected={conn}
                          media={isMediaField}
                        />
                      }
                    />
                  </div>
                )}
              </Row>
            );
          })}
          {hiddenFormFields.length > 0 && (
            <div className="space-y-2 px-3 py-1">
              {hiddenFormFields.map((field) => {
                const isEnabled = enabledHiddenFields.has(field.name);
                return (
                  <div key={field.name} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEnabledHiddenFields((prev) => {
                          const next = new Set(prev);
                          if (next.has(field.name)) {
                            next.delete(field.name);
                            setParam(field.name, undefined);
                          } else next.add(field.name);
                          return next;
                        });
                      }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium border border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))] transition-colors"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full border-2 ${isEnabled ? "bg-primary border-primary" : "border-muted-foreground"}`}
                      />
                      {field.label}
                    </button>
                    {isEnabled && (
                      <div className="pl-2 border-l-2 border-primary/50 ml-1">
                        <FormField
                          field={field}
                          value={formValues[field.name]}
                          onChange={(v) => setParam(field.name, v)}
                          modelType={currentModel?.type}
                          formValues={formValues}
                          hideLabel
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Fallback: schema-based ParamRow/MediaRow when not using Playground form */}
      {!usePlaygroundForm &&
        orderedVisibleParams.map((p) => {
          const hid = `param-${p.name}`;
          if (p.mediaType && p.fieldType !== "loras") {
            return (
              <MediaRow
                key={p.name}
                nodeId={id}
                schema={p}
                value={data.params[p.name]}
                connected={connectedSet.has(hid)}
                connectedSet={connectedSet}
                edges={edges}
                nodes={useWorkflowStore.getState().nodes}
                onChange={(v) => setParam(p.name, v)}
                onPreview={openPreview}
              />
            );
          }
          if (p.fieldType === "loras") {
            return (
              <LoraRow
                key={p.name}
                schema={p}
                value={data.params[p.name]}
                onChange={(v) => setParam(p.name, v)}
              />
            );
          }
          if (p.fieldType === "json") {
            return (
              <JsonRow
                key={p.name}
                nodeId={id}
                schema={p}
                value={data.params[p.name]}
                connected={connectedSet.has(hid)}
                edges={edges}
                nodes={useWorkflowStore.getState().nodes}
                onChange={(v) => setParam(p.name, v)}
              />
            );
          }
          return (
            <ParamRow
              key={p.name}
              nodeId={id}
              schema={p}
              value={data.params[p.name]}
              connected={connectedSet.has(hid)}
              edges={edges}
              nodes={useWorkflowStore.getState().nodes}
              onDisconnect={() => {
                const edge = edges.find(
                  (e) => e.target === id && e.targetHandle === hid,
                );
                if (edge) useWorkflowStore.getState().removeEdge(edge.id);
              }}
              onChange={(v) => setParam(p.name, v)}
              optimizerSettings={
                (data.params.__optimizerSettings as Record<string, unknown>) ??
                {}
              }
              onOptimizerSettingsChange={(v) =>
                setParam("__optimizerSettings", v)
              }
            />
          );
        })}

      {!usePlaygroundForm && optionalParams.length > 0 && (
        <>
          <div className="px-3 py-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowOptional(!showOptional);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <span className="text-[8px]">{showOptional ? "▼" : "▶"}</span>
              {showOptional
                ? t("workflow.hide", "Hide")
                : t("workflow.show", "Show")}{" "}
              {optionalParams.length} {t("workflow.optional", "optional")}
            </button>
          </div>
          {showOptional &&
            optionalParams.map((p) => {
              const hid = `param-${p.name}`;
              return (
                <ParamRow
                  key={p.name}
                  nodeId={id}
                  schema={p}
                  value={data.params[p.name]}
                  connected={connectedSet.has(hid)}
                  edges={edges}
                  nodes={useWorkflowStore.getState().nodes}
                  onDisconnect={() => {
                    const edge = edges.find(
                      (e) => e.target === id && e.targetHandle === hid,
                    );
                    if (edge) useWorkflowStore.getState().removeEdge(edge.id);
                  }}
                  onChange={(v) => setParam(p.name, v)}
                  optimizerSettings={
                    (data.params.__optimizerSettings as Record<
                      string,
                      unknown
                    >) ?? {}
                  }
                  onOptimizerSettingsChange={(v) =>
                    setParam("__optimizerSettings", v)
                  }
                />
              );
            })}
        </>
      )}

      {inputDefs.map((inp) => {
        if (data.nodeType === "input/media-upload") return null;
        const hid = `input-${inp.key}`;
        const conn = connectedSet.has(hid);
        const portFieldConfig = portToFormFieldConfig(inp, data.nodeType);
        const useFormFieldForPort = portFieldConfig != null && !conn;
        if (!isPreviewNode) {
          return (
            <Row key={inp.key}>
              <div className="flex items-center justify-between gap-2 w-full">
                <span
                  className={`text-xs whitespace-nowrap flex-shrink-0 ${conn ? "text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}
                >
                  <HandleAnchor id={hid} type="target" connected={conn} media />
                  {localizeInputLabel(inp.key, inp.label)}
                  {inp.required && <span className="text-red-400"> *</span>}
                </span>
                {conn ? (
                  <ConnectedInputControl
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onPreview={openPreview}
                  />
                ) : useFormFieldForPort ? (
                  <div
                    className="flex-1 min-w-0 nodrag"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FormField
                      field={portFieldConfig}
                      value={formValues[inp.key]}
                      onChange={(v) => setParam(inp.key, v)}
                      formValues={formValues}
                      hideLabel
                      onUploadFile={
                        portFieldConfig.type === "file"
                          ? handleWorkflowUploadFile
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <InputPortControl
                      nodeId={id}
                      port={inp}
                      value={data.params[inp.key]}
                      onChange={(v) => setParam(inp.key, v)}
                      onPreview={openPreview}
                      referenceImageUrl={
                        data.nodeType === "free-tool/image-eraser" &&
                        inp.key === "mask_image"
                          ? String(data.params.input ?? "")
                          : undefined
                      }
                      showDrawMaskButton={
                        data.nodeType === "free-tool/image-eraser" &&
                        inp.key === "mask_image"
                      }
                    />
                  </div>
                )}
              </div>
            </Row>
          );
        }

        return (
          <Row key={inp.key}>
            <div className="w-full min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs ${conn ? "text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}
                >
                  <HandleAnchor id={hid} type="target" connected={conn} media />
                  {localizeInputLabel(inp.key, inp.label)}
                  {inp.required && <span className="text-red-400"> *</span>}
                </span>
              </div>
              {conn ? (
                <ConnectedInputControl
                  nodeId={id}
                  handleId={hid}
                  edges={edges}
                  nodes={useWorkflowStore.getState().nodes}
                  onPreview={openPreview}
                  showPreview={false}
                />
              ) : useFormFieldForPort ? (
                <div
                  className="w-full min-w-0 nodrag"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FormField
                    field={portFieldConfig}
                    value={formValues[inp.key]}
                    onChange={(v) => setParam(inp.key, v)}
                    formValues={formValues}
                    hideLabel
                    onUploadFile={
                      portFieldConfig.type === "file"
                        ? handleWorkflowUploadFile
                        : undefined
                    }
                  />
                </div>
              ) : (
                <InputPortControl
                  nodeId={id}
                  port={inp}
                  value={data.params[inp.key]}
                  onChange={(v) => setParam(inp.key, v)}
                  onPreview={openPreview}
                  referenceImageUrl={
                    data.nodeType === "free-tool/image-eraser" &&
                    inp.key === "mask_image"
                      ? String(data.params.input ?? "")
                      : undefined
                  }
                  showDrawMaskButton={
                    data.nodeType === "free-tool/image-eraser" &&
                    inp.key === "mask_image"
                  }
                  showPreview={false}
                />
              )}
            </div>
          </Row>
        );
      })}

      {/* Segment Anything: Pick points by clicking */}
      {data.nodeType === "free-tool/segment-anything" && (
        <div className="px-3 py-1">
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
              {t("workflow.pointsLabel")}
            </span>
            <button
              type="button"
              title={
                String(data.params.input ?? "").trim()
                  ? t("workflow.pickPoints")
                  : t("workflow.pickPointsNeedInput")
              }
              disabled={!String(data.params.input ?? "").trim()}
              onClick={(e) => {
                e.stopPropagation();
                if (String(data.params.input ?? "").trim())
                  setSegmentPointPickerOpen(true);
              }}
              className={`nodrag flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md border border-[hsl(var(--border))] text-xs transition-colors ${
                String(data.params.input ?? "").trim()
                  ? "cursor-pointer bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
                  : "cursor-not-allowed opacity-50"
              }`}
            >
              <MousePointer2 className="h-4 w-4" />
              {t("workflow.pickPoints")}
              {(() => {
                try {
                  const pts = data.params.__segmentPoints as string | undefined;
                  if (!pts) return null;
                  const arr = JSON.parse(pts) as SegmentPoint[];
                  return Array.isArray(arr) && arr.length > 0 ? (
                    <span className="text-[10px] opacity-75">
                      ({arr.length})
                    </span>
                  ) : null;
                } catch {
                  return null;
                }
              })()}
            </button>
          </div>
          {segmentPointPickerOpen && String(data.params.input ?? "").trim() && (
            <SegmentPointPicker
              referenceImageUrl={String(data.params.input)}
              onComplete={async (points: SegmentPoint[], maskBlob?: Blob) => {
                const newParams: Record<string, unknown> = {
                  ...data.params,
                  __segmentPoints: JSON.stringify(points),
                };
                if (maskBlob) {
                  try {
                    const wfId = await ensureWorkflowId();
                    if (wfId) {
                      const { storageIpc } =
                        await import("../../../ipc/ipc-client");
                      const arrBuf = await maskBlob.arrayBuffer();
                      const localPath = await storageIpc.saveUploadedFile(
                        wfId,
                        id,
                        "segment-mask.png",
                        arrBuf,
                      );
                      newParams.__previewMask = `local-asset://${encodeURIComponent(localPath)}`;
                    }
                  } catch (e) {
                    console.error("Failed to save segment mask:", e);
                  }
                }
                updateNodeParams(id, newParams);
                setSegmentPointPickerOpen(false);
              }}
              onClose={() => setSegmentPointPickerOpen(false)}
            />
          )}
        </div>
      )}

      {/* defParams */}
      {data.nodeType !== "input/media-upload" &&
        data.nodeType !== "input/text-input" &&
        paramDefs.map((p) => {
          const hid = `param-${p.key}`;
          const canConnect =
            p.connectable !== false && p.dataType !== undefined;
          const conn = canConnect ? connectedSet.has(hid) : false;
          const fieldConfig = paramDefToFormFieldConfig(p, data.nodeType);

          if (fieldConfig) {
            if (!canConnect) {
              return (
                <div
                  key={p.key}
                  className="px-3 py-1 nodrag"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FormField
                    field={fieldConfig}
                    value={formValues[p.key]}
                    onChange={(v) => setParam(p.key, v)}
                    formValues={formValues}
                  />
                </div>
              );
            }
            return (
              <Row key={p.key}>
                {conn ? (
                  <div className="flex flex-col gap-1 w-full">
                    <div className="flex items-center">
                      <span className="text-sm font-medium leading-none">
                        <HandleAnchor id={hid} type="target" connected={conn} />
                        {localizeParamLabel(p.key, p.label)}
                      </span>
                    </div>
                    <LinkedBadge
                      nodeId={id}
                      handleId={hid}
                      edges={edges}
                      nodes={useWorkflowStore.getState().nodes}
                      onDisconnect={() => {
                        const edge = edges.find(
                          (e) => e.target === id && e.targetHandle === hid,
                        );
                        if (edge)
                          useWorkflowStore.getState().removeEdge(edge.id);
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="w-full min-w-0 nodrag"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FormField
                      field={fieldConfig}
                      value={formValues[p.key]}
                      onChange={(v) => setParam(p.key, v)}
                      formValues={formValues}
                      handleAnchor={
                        <HandleAnchor id={hid} type="target" connected={conn} />
                      }
                    />
                  </div>
                )}
              </Row>
            );
          }

          if (!canConnect) {
            return (
              <div key={p.key} className="px-3 py-1">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                    {localizeParamLabel(p.key, p.label)}
                    {localizeParamDescription(p.key, p.description) && (
                      <Tip
                        text={String(
                          localizeParamDescription(p.key, p.description),
                        )}
                      />
                    )}
                  </span>
                  <DefParamControl
                    nodeId={id}
                    param={p}
                    value={data.params[p.key]}
                    onChange={(v) => setParam(p.key, v)}
                  />
                </div>
              </div>
            );
          }

          return (
            <Row key={p.key}>
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs text-[hsl(var(--muted-foreground))] flex-shrink-0">
                  <HandleAnchor id={hid} type="target" connected={conn} />
                  {localizeParamLabel(p.key, p.label)}
                  {localizeParamDescription(p.key, p.description) && (
                    <Tip
                      text={String(
                        localizeParamDescription(p.key, p.description),
                      )}
                    />
                  )}
                </span>
                {conn ? (
                  <LinkedBadge
                    nodeId={id}
                    handleId={hid}
                    edges={edges}
                    nodes={useWorkflowStore.getState().nodes}
                    onDisconnect={() => {
                      const edge = edges.find(
                        (e) => e.target === id && e.targetHandle === hid,
                      );
                      if (edge) useWorkflowStore.getState().removeEdge(edge.id);
                    }}
                  />
                ) : (
                  <DefParamControl
                    nodeId={id}
                    param={p}
                    value={data.params[p.key]}
                    onChange={(v) => setParam(p.key, v)}
                  />
                )}
              </div>
            </Row>
          );
        })}

      {/* Unified input preview area */}
      {isPreviewNode && inlineInputPreviewUrl && (
        <div className="px-3 pb-2">
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            {inlinePreviewIsImage && (
              <img
                src={inlineInputPreviewUrl}
                alt=""
                onClick={(e) => {
                  e.stopPropagation();
                  openPreview(inlineInputPreviewUrl);
                }}
                className="w-full max-h-[4096px] rounded-lg border border-[hsl(var(--border))] object-contain cursor-pointer hover:ring-2 hover:ring-blue-500/40 transition-shadow bg-black/5"
              />
            )}
            {inlinePreviewIsVideo && (
              <video
                src={inlineInputPreviewUrl}
                controls
                className="w-full max-h-[4096px] rounded-lg border border-[hsl(var(--border))] object-contain"
              />
            )}
            {inlinePreviewIsAudio && (
              <audio
                src={inlineInputPreviewUrl}
                controls
                className="w-full max-h-10 rounded-lg border border-[hsl(var(--border))]"
              />
            )}
            {inlinePreviewIs3D && (
              <Inline3DViewer
                src={inlineInputPreviewUrl}
                onClick={() => openPreview(inlineInputPreviewUrl)}
              />
            )}
          </div>
        </div>
      )}

      {/* Results — at bottom of card, collapsed by default */}
      {data.nodeType !== "annotation" && (
        <div className="nodrag nowheel min-h-0 flex flex-col flex-1 mt-2 border-t border-border/50 pt-2 select-text">
          <button
            type="button"
            onClick={() => setResultsExpanded((prev) => !prev)}
            className="flex items-center gap-1.5 w-full text-left py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {resultsExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{t("workflow.results", "Results")}</span>
            {resultGroups.length > 0 && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary tabular-nums">
                {resultGroups.length}
              </span>
            )}
          </button>
          {resultsExpanded && (
            <div className="min-h-0 flex flex-col flex-1">
              <ResultsPanel embeddedInNode nodeId={id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
