export interface ModelSchema {
  type: string;
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

export interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  items?: {
    type: string;
    minItems?: number;
    maxItems?: number;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
    enum?: string[];
    "x-enum"?: string[];
    "x-order-properties"?: string[];
  };
  minItems?: number;
  maxItems?: number;
  recommend?: Array<{
    path: string;
    scale: number;
    cover?: string;
  }>;
  // Extended UI hints
  step?: number;
  "x-ui-component"?:
    | "slider"
    | "uploader"
    | "uploaders"
    | "loras"
    | "select"
    | "array";
  "x-accept"?: string;
  "x-placeholder"?: string;
  "x-hidden"?: boolean;
  nullable?: boolean;
  "x-enum"?: string[];
}

export interface Model {
  model_id: string;
  name: string;
  description?: string;
  type?: string;
  base_price?: number;
  sort_order?: number;
  api_schema?: {
    openapi?: string;
    info?: Record<string, unknown>;
    paths?: Record<string, unknown>;
    components?: {
      schemas?: {
        Request?: ModelSchema;
        Response?: Record<string, unknown>;
      };
    };
  };
}

export interface ModelsResponse {
  code: number;
  message: string;
  data: Model[];
}
