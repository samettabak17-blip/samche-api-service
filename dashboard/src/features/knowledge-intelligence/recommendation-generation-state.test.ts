import { describe, expect, it } from "vitest";
import {
  initialRecommendationGenerationState,
  normalizeRecommendationGenerationJob,
  recommendationGenerationReducer,
} from "./recommendation-generation-state";

describe("assistant recommendation generation UI state", () => {
  it("moves from enqueueing through pending, processing and ready", () => {
    const enqueueing = recommendationGenerationReducer(
      initialRecommendationGenerationState,
      { type: "START" },
    );
    expect(enqueueing.phase).toBe("ENQUEUEING");

    const pending = recommendationGenerationReducer(enqueueing, {
      type: "ACCEPTED",
      job: { id: "job-1", status: "PENDING", attempts: 0 },
      reused: false,
    });
    expect(pending.phase).toBe("PENDING");

    const processing = recommendationGenerationReducer(pending, {
      type: "JOB_STATUS",
      job: { id: "job-1", status: "PROCESSING", attempts: 1 },
    });
    expect(processing.phase).toBe("PROCESSING");

    const ready = recommendationGenerationReducer(processing, {
      type: "JOB_STATUS",
      job: { id: "job-1", status: "READY", attempts: 1 },
    });
    expect(ready.phase).toBe("SUCCEEDED");
  });

  it("marks a reused ready job as an existing result instead of inert", () => {
    const state = recommendationGenerationReducer(
      initialRecommendationGenerationState,
      {
        type: "ACCEPTED",
        job: { id: "job-1", status: "READY", attempts: 1 },
        reused: true,
      },
    );
    expect(state.phase).toBe("EXISTING_RESULT");
    expect(state.message).toMatch(/already generated/i);
  });

  it("returns to a retryable failed state for terminal and malformed job responses", () => {
    const failed = recommendationGenerationReducer(
      initialRecommendationGenerationState,
      { type: "JOB_STATUS", job: { id: "job-1", status: "FAILED", attempts: 3 } },
    );
    expect(failed.phase).toBe("FAILED");

    expect(normalizeRecommendationGenerationJob({})).toBeNull();
    const malformed = recommendationGenerationReducer(
      initialRecommendationGenerationState,
      { type: "INVALID_RESPONSE" },
    );
    expect(malformed.phase).toBe("FAILED");
  });

  it("preserves the Configuration operation in enqueue and payload errors", () => {
    const starting = recommendationGenerationReducer(
      initialRecommendationGenerationState,
      { type: "START", operation: "Configuration" },
    );
    const enqueueFailure = recommendationGenerationReducer(starting, { type: "ENQUEUE_FAILED" });
    expect(enqueueFailure.error).toBe("Configuration generation could not be started. You can retry.");

    const malformed = recommendationGenerationReducer(starting, { type: "INVALID_RESPONSE" });
    expect(malformed.error).toBe("Configuration generation returned an unusable job response. Refresh and retry.");
  });

  it("handles a fast ready Configuration result and a terminal failure without retaining loading", () => {
    const starting = recommendationGenerationReducer(
      initialRecommendationGenerationState,
      { type: "START", operation: "Configuration" },
    );
    const ready = recommendationGenerationReducer(starting, {
      type: "ACCEPTED",
      job: { id: "configuration-job", status: "READY", attempts: 1 },
      reused: false,
      operation: "Configuration",
    });
    expect(ready.phase).toBe("SUCCEEDED");
    expect(ready.message).toBe("Configuration generated successfully.");

    const failed = recommendationGenerationReducer(starting, {
      type: "JOB_STATUS",
      job: { id: "configuration-job", status: "FAILED", attempts: 3, last_error_code: "KNOWLEDGE_GENERATION_TIMEOUT" },
    });
    expect(failed.phase).toBe("FAILED");
    expect(failed.error).toBe("Configuration generation failed. You can retry.");
  });
});
