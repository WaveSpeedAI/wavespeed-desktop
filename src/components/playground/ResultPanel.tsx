import { OutputDisplay } from "./OutputDisplay";
import { BatchOutputGrid } from "./BatchOutputGrid";
import type { PredictionResult } from "@/types/prediction";
import type { BatchResult, BatchQueueItem } from "@/types/batch";

interface ResultPanelProps {
  prediction: PredictionResult | null;
  outputs: (string | Record<string, unknown>)[];
  error: string | null;
  isLoading: boolean;
  modelId?: string;
  // Batch
  batchResults: BatchResult[];
  batchIsRunning?: boolean;
  batchTotalCount?: number;
  batchQueue?: BatchQueueItem[];
  onClearBatch: () => void;
  // Batch preview
  batchPreviewInputs: Record<string, unknown>[];
  // History
  historyIndex: number | null;
}

export function ResultPanel({
  prediction,
  outputs,
  error,
  isLoading,
  modelId,
  batchResults,
  batchIsRunning,
  batchTotalCount,
  batchQueue,
  onClearBatch,
  batchPreviewInputs,
  historyIndex,
}: ResultPanelProps) {
  return (
    <div className="flex-1 min-w-0 overflow-auto p-5 md:p-6">
      {/* Batch Results */}
      {(batchIsRunning || batchResults.length > 0) && historyIndex === null ? (
        <BatchOutputGrid
          results={batchResults}
          modelId={modelId}
          onClear={onClearBatch}
          isRunning={batchIsRunning}
          totalCount={batchTotalCount}
          queue={batchQueue}
        />
      ) : /* Batch Preview */
      batchPreviewInputs.length > 0 && historyIndex === null ? (
        <BatchOutputGrid
          results={[]}
          modelId={modelId}
          onClear={() => {}}
          isRunning={false}
          totalCount={batchPreviewInputs.length}
          queue={batchPreviewInputs.map((input, index) => ({
            id: `preview-${index}`,
            index,
            input,
            status: "pending" as const,
          }))}
        />
      ) : (
        <OutputDisplay
          prediction={prediction}
          outputs={outputs}
          error={error}
          isLoading={isLoading}
          modelId={modelId}
        />
      )}
    </div>
  );
}
