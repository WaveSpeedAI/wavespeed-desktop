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
  // Only show batch grid when there are actual results
  const showBatchGrid =
    batchResults.length > 0 && historyIndex === null;

  return (
    <div className="flex-1 min-w-0 overflow-auto p-5 md:p-6">
      {showBatchGrid ? (
        <BatchOutputGrid
          results={batchResults}
          modelId={modelId}
          onClear={onClearBatch}
          isRunning={batchIsRunning}
          totalCount={batchTotalCount}
          queue={batchQueue}
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
