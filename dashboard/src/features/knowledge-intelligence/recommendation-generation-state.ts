import type { AssistantRecommendationGenerationJob } from "../../types/api";

export type RecommendationGenerationPhase =
  | "IDLE"
  | "ENQUEUEING"
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "EXISTING_RESULT"
  | "FAILED";

export interface RecommendationGenerationState {
  phase: RecommendationGenerationPhase;
  job: AssistantRecommendationGenerationJob | null;
  message: string | null;
  error: string | null;
  reused: boolean;
  operation: "Recommendation" | "Configuration";
}

export const initialRecommendationGenerationState: RecommendationGenerationState = {
  phase: "IDLE",
  job: null,
  message: null,
  error: null,
  reused: false,
  operation: "Recommendation",
};

const knownStatuses = new Set(["PENDING", "PROCESSING", "READY", "FAILED", "CANCELLED"]);

export function normalizeRecommendationGenerationJob(value: unknown): AssistantRecommendationGenerationJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const status = typeof candidate.status === "string" ? candidate.status.toUpperCase() : "";
  if (!id || !knownStatuses.has(status)) return null;
  return {
    id,
    status: status as AssistantRecommendationGenerationJob["status"],
    attempts: typeof candidate.attempts === "number" && Number.isFinite(candidate.attempts)
      ? candidate.attempts
      : 0,
    last_error_code: typeof candidate.last_error_code === "string" ? candidate.last_error_code : null,
    metadata: candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
      ? candidate.metadata as Record<string, unknown>
      : undefined,
  };
}

type Action =
  | { type: "START"; operation?: "Recommendation" | "Configuration" }
  | { type: "ACCEPTED"; job: AssistantRecommendationGenerationJob; reused: boolean; operation?: "Recommendation" | "Configuration" }
  | { type: "JOB_STATUS"; job: AssistantRecommendationGenerationJob }
  | { type: "ENQUEUE_FAILED" }
  | { type: "POLL_ERROR" }
  | { type: "INVALID_RESPONSE" }
  | { type: "RESET" };

function stateForJob(job: AssistantRecommendationGenerationJob, reused: boolean, operation: RecommendationGenerationState["operation"]): RecommendationGenerationState {
  if (job.status === "READY") {
    return {
      phase: reused ? "EXISTING_RESULT" : "SUCCEEDED",
      job,
      message: reused
        ? `${operation} already generated and refreshed.`
        : `${operation} generated successfully.`,
      error: null,
      reused,
      operation,
    };
  }
  if (job.status === "FAILED" || job.status === "CANCELLED") {
    return {
      phase: "FAILED",
      job,
      message: null,
      error: `${operation} generation failed. You can retry.`,
      reused,
      operation,
    };
  }
  return {
    phase: job.status === "PROCESSING" ? "PROCESSING" : "PENDING",
    job,
    message: null,
    error: null,
    reused,
    operation,
  };
}

export function recommendationGenerationReducer(
  state: RecommendationGenerationState,
  action: Action,
): RecommendationGenerationState {
  switch (action.type) {
    case "START":
      return { ...initialRecommendationGenerationState, phase: "ENQUEUEING", operation: action.operation ?? "Recommendation" };
    case "ACCEPTED":
      return stateForJob(action.job, action.reused, action.operation ?? state.operation);
    case "JOB_STATUS":
      return stateForJob(action.job, state.reused, state.operation);
    case "POLL_ERROR":
      return {
        ...state,
        phase: "FAILED",
        message: null,
        error: `${state.operation} generation status could not be retrieved. You can retry.`,
      };
    case "ENQUEUE_FAILED":
      return {
        ...initialRecommendationGenerationState,
        phase: "FAILED",
        operation: state.operation,
        error: `${state.operation} generation could not be started. You can retry.`,
      };
    case "INVALID_RESPONSE":
      return {
        ...initialRecommendationGenerationState,
        phase: "FAILED",
        operation: state.operation,
        error: `${state.operation} generation returned an unusable job response. Refresh and retry.`,
      };
    case "RESET":
      return initialRecommendationGenerationState;
    default:
      return state;
  }
}
