// Type declaration for onnxruntime-web
// Needed because package.json "exports" prevents automatic type resolution
declare module "onnxruntime-web" {
  export namespace env {
    namespace wasm {
      let wasmPaths: string;
    }
  }

  export type TypedTensorDataType =
    | Float32Array
    | Int32Array
    | BigInt64Array
    | Uint8Array;

  export class Tensor {
    constructor(
      type: "float32" | "int32" | "int64" | "uint8",
      data: TypedTensorDataType | number[] | bigint[],
      dims: readonly number[],
    );
    readonly data: TypedTensorDataType;
    readonly dims: readonly number[];
    readonly type: string;
    readonly size: number;
  }

  export interface SessionOptions {
    executionProviders?: string[];
    graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
    enableCpuMemArena?: boolean;
    executionMode?: "sequential" | "parallel";
  }

  export interface RunOptions {
    logSeverityLevel?: number;
  }

  export interface OnnxValueMapType {
    [name: string]: Tensor;
  }

  export class InferenceSession {
    static create(
      modelPath: string | ArrayBuffer | Uint8Array,
      options?: SessionOptions,
    ): Promise<InferenceSession>;
    run(
      feeds: OnnxValueMapType,
      options?: RunOptions,
    ): Promise<OnnxValueMapType>;
    release(): Promise<void>;
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
  }
}
