import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tenantApi } from "../dashboard/dashboard-api";
import { useTenant } from "../tenants/tenant-context";
import { KnowledgeIntelligencePage } from "./knowledge-intelligence-page";
import { ApiError } from "../../lib/api-client";

vi.mock("../dashboard/dashboard-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../dashboard/dashboard-api")>();
  return {
    ...actual,
    tenantApi: {
      ...actual.tenantApi,
      getKnowledgeOverview: vi.fn(),
      listAssistants: vi.fn(),
      listChannels: vi.fn(),
      listKnowledgeSources: vi.fn(),
      getKnowledgeSource: vi.fn(),
      uploadKnowledgeSource: vi.fn(),
      createManualKnowledgeSource: vi.fn(),
      assignKnowledgeSource: vi.fn(),
      unassignKnowledgeSource: vi.fn(),
      reindexKnowledgeSource: vi.fn(),
      generateImageKnowledgeCandidates: vi.fn(),
      archiveKnowledgeSource: vi.fn(),
      listKnowledgeCandidates: vi.fn(),
      getKnowledgeCandidateEvidence: vi.fn(),
      approveKnowledgeCandidate: vi.fn(),
      rejectKnowledgeCandidate: vi.fn(),
      listKnowledgeGaps: vi.fn(),
      getKnowledgeGapSignals: vi.fn(),
      createCandidateFromKnowledgeGap: vi.fn(),
      updateKnowledgeGapStatus: vi.fn(),
      listBusinessIdentities: vi.fn(),
      createBusinessIdentity: vi.fn(),
      listBusinessProfiles: vi.fn(),
      analyzeBusinessProfileScope: vi.fn(),
      generateBusinessProfile: vi.fn(),
      listKnowledgeRecommendations: vi.fn(),
      generateKnowledgeRecommendation: vi.fn(),
      listAssistantConfigurations: vi.fn(),
      updateBusinessProfile: vi.fn(),
      reviewBusinessProfile: vi.fn(),
      activateBusinessProfile: vi.fn(),
      rollbackBusinessProfile: vi.fn(),
      reviewRecommendation: vi.fn(),
      generateAssistantConfiguration: vi.fn(),
      updateAssistantConfiguration: vi.fn(),
      reviewAssistantConfiguration: vi.fn(),
      activateAssistantConfiguration: vi.fn(),
      rollbackAssistantConfiguration: vi.fn(),
      previewKnowledgeRetrieval: vi.fn(),
    },
  };
});
vi.mock("../tenants/tenant-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../tenants/tenant-context")>();
  return { ...actual, useTenant: vi.fn() };
});

const mockedApi = vi.mocked(tenantApi);
const mockedTenant = vi.mocked(useTenant);

function renderPage(
  canManage = true,
  initialEntry = "/app/tenant-a/knowledge",
) {
  mockedTenant.mockReturnValue({
    tenants: [],
    selectedTenant: undefined,
    tenantRole: canManage ? "ADMIN" : "AGENT",
    canManage,
    isLoading: false,
    error: null,
    selectTenant: vi.fn(),
    adoptTenant: vi.fn(),
    createTenant: vi.fn(),
    isOwner: false,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/app/:tenantId/*"
            element={<KnowledgeIntelligencePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedApi.getKnowledgeOverview.mockResolvedValue({
    sources: { ready: 3, processing: 1, failed: 2 },
    reviewQueue: {
      candidates: 4,
      profiles: 1,
      recommendations: 2,
      configurations: 3,
    },
    gaps: { open: 5 },
    runtime: { activeProfile: true, activeConfigurations: 2, assistants: 4 },
  });
  mockedApi.listAssistants.mockResolvedValue([]);
  mockedApi.listChannels.mockResolvedValue([]);
  mockedApi.listKnowledgeSources.mockResolvedValue([]);
  mockedApi.assignKnowledgeSource.mockResolvedValue(undefined);
  mockedApi.generateImageKnowledgeCandidates.mockResolvedValue({
    candidates: [],
    reused: false,
  });
  mockedApi.listKnowledgeCandidates.mockResolvedValue([]);
  mockedApi.listKnowledgeGaps.mockResolvedValue([]);
  mockedApi.listBusinessIdentities.mockResolvedValue([]);
  mockedApi.listBusinessProfiles.mockResolvedValue([]);
  mockedApi.listKnowledgeRecommendations.mockResolvedValue([]);
  mockedApi.listAssistantConfigurations.mockResolvedValue([]);
});

it("requires a Business Identity and explicit READY source scope before generation", async () => {
  mockedApi.listBusinessIdentities.mockResolvedValue([
    {
      id: "identity-meridian",
      display_name: "Meridian Arc Technologies LLC",
      normalized_identity: "meridian arc technologies",
      status: "ACTIVE",
    },
  ]);
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "source-meridian",
      title: "Meridian DOCX",
      source_type: "DOCUMENT",
      processing_status: "READY",
      indexing_status: "READY",
      enabled: true,
    },
    {
      id: "source-nova",
      title: "Nova TXT",
      source_type: "DOCUMENT",
      processing_status: "READY",
      indexing_status: "READY",
      enabled: true,
    },
  ]);
  mockedApi.generateBusinessProfile.mockResolvedValue({
    profile: {
      id: "profile-a",
      profile_data: {},
      status: "NEEDS_REVIEW",
      active_version_id: null,
    },
    reused: false,
    run_id: "run-a",
  });
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await screen.findByRole("option", { name: "Meridian Arc Technologies LLC" });
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Business Identity" }),
    { target: { value: "identity-meridian" } },
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Meridian DOCX" }),
  );
  expect(screen.getByRole("checkbox", { name: "Nova TXT" })).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Analyze selected sources" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  await waitFor(() =>
    expect(mockedApi.generateBusinessProfile).toHaveBeenCalledWith(
      "tenant-a",
      "identity-meridian",
      ["source-meridian"],
    ),
  );
});

it("surfaces a new review-only generation and opens the exact returned version even when refetch fails", async () => {
  prepareIdentityScope();
  mockedApi.listBusinessProfiles
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("refetch failed"));
  mockedApi.generateBusinessProfile.mockResolvedValue({
    profile: {
      id: "12345678-1234-4234-8234-123456789012",
      profile_data: { company_identity: "Meridian Arc Technologies LLC" },
      status: "NEEDS_REVIEW",
      active_version_id: null,
    },
    reused: false,
    run_id: "run-new",
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await selectMeridianScope();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  expect(await screen.findByText("Business Profile generated")).toBeVisible();
  expect(screen.getAllByText("NEEDS_REVIEW").length).toBeGreaterThan(0);
  expect(screen.getAllByText("NOT ACTIVE").length).toBeGreaterThan(0);
  expect(screen.getByText("Version 12345678")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Review generated profile" }),
  );
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute(
      "data-profile-version-id",
      "12345678-1234-4234-8234-123456789012",
    ),
  );
});

it("surfaces an exact reused generation result and clears it when scope changes", async () => {
  prepareIdentityScope();
  mockedApi.generateBusinessProfile.mockResolvedValue({
    profile: {
      id: "87654321-1234-4234-8234-123456789012",
      profile_data: {},
      status: "NEEDS_REVIEW",
      active_version_id: null,
    },
    reused: true,
    run_id: "run-existing",
  });
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await selectMeridianScope();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  expect(
    await screen.findByText("Existing exact generation result reused"),
  ).toBeVisible();
  expect(screen.getByText("Version 87654321")).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox", { name: "Nova TXT" }));
  expect(
    screen.queryByText("Existing exact generation result reused"),
  ).not.toBeInTheDocument();
});

it("keeps a safe generation failure beside the generate panel", async () => {
  prepareIdentityScope();
  mockedApi.generateBusinessProfile.mockRejectedValue(
    new ApiError(503, "Business Profile generation failed", {
      code: "KNOWLEDGE_PROFILE_GENERATION_FAILED",
    }),
  );
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await selectMeridianScope();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  const panel = screen.getByRole("region", {
    name: "Business Profile source scope",
  });
  expect(
    await within(panel).findByText("Business Profile generation failed"),
  ).toBeVisible();
});

it("shows a clear generating state and a duplicate-safe retry after timeout", async () => {
  mockedApi.listBusinessIdentities.mockResolvedValue([
    {
      id: "identity-meridian",
      display_name: "Meridian Arc Technologies LLC",
      normalized_identity: "meridian arc technologies",
      status: "ACTIVE",
    },
  ]);
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "source-meridian",
      title: "Meridian DOCX",
      source_type: "DOCUMENT",
      processing_status: "READY",
      indexing_status: "READY",
      enabled: true,
    },
  ]);
  let rejectGeneration!: (error: unknown) => void;
  mockedApi.generateBusinessProfile.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectGeneration = reject;
      }),
  );
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await screen.findByRole("option", { name: "Meridian Arc Technologies LLC" });
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Business Identity" }),
    { target: { value: "identity-meridian" } },
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Meridian DOCX" }),
  );
  const generate = screen.getByRole("button", {
    name: "Generate scoped Business Profile",
  });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  await waitFor(() =>
    expect(mockedApi.generateBusinessProfile).toHaveBeenCalledTimes(1),
  );
  expect(
    await screen.findByRole("button", { name: "Generating Business Profile…" }),
  ).toBeDisabled();
  rejectGeneration(
    new ApiError(503, "Knowledge generation timed out", {
      code: "KNOWLEDGE_GENERATION_TIMEOUT",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "No Business Profile was created",
  );
  expect(
    await screen.findByRole("button", {
      name: "Retry scoped Business Profile",
    }),
  ).toBeEnabled();
  expect(screen.queryByText(/GEMINI|provider|model/i)).not.toBeInTheDocument();
});

const conflictError = (
  identities = [
    {
      detected_identity: "Meridian Arc Technologies LLC",
      normalized_identity: "meridian arc technologies",
      source_ids: ["source-meridian"],
    },
    {
      detected_identity: "Nova Crest Business Services LLC",
      normalized_identity: "nova crest business services",
      source_ids: ["source-nova"],
    },
  ],
) =>
  new ApiError(409, "Identity resolution required", {
    code: "IDENTITY_RESOLUTION_REQUIRED",
    details: {
      identities,
      evidence: identities.map((identity, index) => ({
        source_id: identity.source_ids[0],
        source_title: index ? "Nova TXT" : "Meridian DOCX",
        detected_identity: identity.detected_identity,
        confidence: index ? 0.98 : 0.99,
        safe_evidence: `Legal name: ${identity.detected_identity}`,
      })),
    },
  });

function prepareIdentityScope() {
  mockedApi.listBusinessIdentities.mockResolvedValue([
    {
      id: "identity-meridian",
      display_name: "Meridian Arc Technologies LLC",
      normalized_identity: "meridian arc technologies",
      status: "ACTIVE",
    },
    {
      id: "identity-nova",
      display_name: "Nova Crest Business Services LLC",
      normalized_identity: "nova crest business services",
      status: "ACTIVE",
    },
  ]);
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "source-meridian",
      title: "Meridian DOCX",
      source_type: "DOCUMENT",
      processing_status: "READY",
      indexing_status: "READY",
      enabled: true,
    },
    {
      id: "source-nova",
      title: "Nova TXT",
      source_type: "DOCUMENT",
      processing_status: "READY",
      indexing_status: "READY",
      enabled: true,
    },
  ]);
}

async function selectMeridianScope() {
  await screen.findByRole("option", { name: "Meridian Arc Technologies LLC" });
  fireEvent.change(
    screen.getByRole("combobox", { name: "Business Identity" }),
    { target: { value: "identity-meridian" } },
  );
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Meridian DOCX" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate scoped Business Profile" }),
    ).toBeEnabled(),
  );
}

it.each([
  [
    "Business Identity",
    () =>
      fireEvent.change(
        screen.getByRole("combobox", { name: "Business Identity" }),
        { target: { value: "identity-nova" } },
      ),
  ],
  [
    "source selection",
    () => fireEvent.click(screen.getByRole("checkbox", { name: "Nova TXT" })),
  ],
])(
  "clears a stale generation conflict when %s changes",
  async (_label, changeScope) => {
    prepareIdentityScope();
    mockedApi.generateBusinessProfile.mockRejectedValue(conflictError());
    renderPage(true, "/app/tenant-a/knowledge-base/profile");
    await selectMeridianScope();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate scoped Business Profile" }),
    );
    expect(
      await screen.findByText(
        /^Selected sources describe multiple businesses\./,
      ),
    ).toBeVisible();
    changeScope();
    expect(
      screen.queryByText(/^Selected sources describe multiple businesses\./),
    ).not.toBeInTheDocument();
  },
);

it("clears an old generation conflict after successful identity analysis", async () => {
  prepareIdentityScope();
  mockedApi.generateBusinessProfile.mockRejectedValue(conflictError());
  mockedApi.analyzeBusinessProfileScope.mockResolvedValue({
    status: "RESOLVED",
    business_identity: {
      id: "identity-meridian",
      display_name: "Meridian Arc Technologies LLC",
      normalized_identity: "meridian arc technologies",
      status: "ACTIVE",
    },
    source_ids: ["source-meridian"],
    identities: [
      {
        detected_identity: "Meridian Arc Technologies LLC",
        normalized_identity: "meridian arc technologies",
        source_ids: ["source-meridian"],
      },
    ],
    evidence: [],
  });
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await selectMeridianScope();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  expect(
    await screen.findByText(/^Selected sources describe multiple businesses\./),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Analyze selected sources" }),
  );
  expect(await screen.findByText("Identity resolved")).toBeVisible();
  expect(
    screen.queryByText(/^Selected sources describe multiple businesses\./),
  ).not.toBeInTheDocument();
});

it("does not render a late stale attempt result for a new scope", async () => {
  prepareIdentityScope();
  let rejectGeneration!: (error: unknown) => void;
  mockedApi.generateBusinessProfile.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectGeneration = reject;
      }),
  );
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await selectMeridianScope();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  await waitFor(() =>
    expect(mockedApi.generateBusinessProfile).toHaveBeenCalledTimes(1),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Business Identity" }),
    { target: { value: "identity-nova" } },
  );
  rejectGeneration(conflictError());
  await waitFor(() =>
    expect(
      screen.queryByText(/^Selected sources describe multiple businesses\./),
    ).not.toBeInTheDocument(),
  );
});

it("renders every identity, confidence and safe evidence for a current conflict", async () => {
  prepareIdentityScope();
  mockedApi.generateBusinessProfile.mockRejectedValue(conflictError());
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await selectMeridianScope();
  fireEvent.click(screen.getByRole("checkbox", { name: "Nova TXT" }));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Nova TXT" })).toBeChecked(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  expect(
    await screen.findByText(/^Selected sources describe multiple businesses\./),
  ).toBeVisible();
  expect(screen.getAllByText("Meridian Arc Technologies LLC")).toHaveLength(2);
  expect(screen.getAllByText("Nova Crest Business Services LLC")).toHaveLength(
    2,
  );
  expect(
    screen.getByText("Legal name: Meridian Arc Technologies LLC"),
  ).toBeVisible();
  expect(
    screen.getByText("Legal name: Nova Crest Business Services LLC"),
  ).toBeVisible();
  expect(screen.getByText(/99%/)).toBeVisible();
  expect(screen.getByText(/98%/)).toBeVisible();
});

it("does not label unknown or low-confidence evidence as multiple businesses", async () => {
  prepareIdentityScope();
  mockedApi.generateBusinessProfile.mockRejectedValue(
    new ApiError(409, "Identity resolution required", {
      code: "IDENTITY_RESOLUTION_REQUIRED",
      details: {
        identities: [],
        evidence: [
          {
            source_id: "source-meridian",
            source_title: "Meridian DOCX",
            detected_identity: "UNKNOWN",
            confidence: 0.2,
            safe_evidence: "No reliable legal name",
          },
        ],
      },
    }),
  );
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  await selectMeridianScope();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate scoped Business Profile" }),
  );
  expect(
    await screen.findByText(
      "Business identity could not be confidently resolved",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(/^Selected sources describe multiple businesses\./),
  ).not.toBeInTheDocument();
});

it("accepts JPG, JPEG and PNG source uploads with the image size boundary", async () => {
  renderPage(true, "/app/tenant-a/knowledge-base/sources");
  expect(
    await screen.findByRole("button", { name: "Upload source" }),
  ).toBeVisible();
  expect(screen.getByText("PDF, DOCX, TXT, JPG, JPEG or PNG")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Upload source" }));
  const input = screen.getByLabelText("Source file");
  expect(input).toHaveAttribute("accept", expect.stringContaining(".jpg"));
  expect(input).toHaveAttribute("accept", expect.stringContaining(".jpeg"));
  expect(input).toHaveAttribute("accept", expect.stringContaining(".png"));
  expect(screen.getByText(/25 MiB/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Add manual knowledge" }),
  ).toBeVisible();
});

it("keeps unsupported and oversized images out of the upload request", async () => {
  renderPage(true, "/app/tenant-a/knowledge-base/sources");
  fireEvent.click(await screen.findByRole("button", { name: "Upload source" }));
  const input = screen.getByLabelText("Source file");

  fireEvent.change(input, {
    target: { files: [new File(["not an image"], "unsupported.gif", { type: "image/gif" })] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("This file type is not supported");
  expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();

  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array(25 * 1024 * 1024 + 1)], "too-large.png", {
          type: "image/png",
        }),
      ],
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("25 MiB or smaller");
  expect(mockedApi.uploadKnowledgeSource).not.toHaveBeenCalled();
});

it("shows source detail lifecycle actions and real assignment state", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-a", tenant_id: "tenant-a", name: "Sales Assistant" },
  ]);
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "source-a",
      title: "Policy",
      source_type: "PDF",
      processing_status: "READY",
      indexing_status: "READY",
      enabled: true,
    },
  ]);
  mockedApi.getKnowledgeSource.mockResolvedValue({
    id: "source-a",
    title: "Policy",
    source_type: "PDF",
    processing_status: "READY",
    indexing_status: "READY",
    enabled: true,
    assistant_ids: ["assistant-a"],
  });
  renderPage(true, "/app/tenant-a/knowledge-base/sources");
  (await screen.findByRole("button", { name: "View Policy" })).click();
  expect(
    await screen.findByRole("button", { name: "Unassign Sales Assistant" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Re-index" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
});

it("shows a READY image extraction summary and an explicit candidate action", async () => {
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "image-source-a",
      title: "Support screenshot",
      source_type: "IMAGE",
      mime_type: "image/png",
      processing_status: "READY",
      indexing_status: "DISABLED",
      enabled: true,
    },
  ]);
  mockedApi.getKnowledgeSource.mockResolvedValue({
    id: "image-source-a",
    title: "Support screenshot",
    source_type: "IMAGE",
    mime_type: "image/png",
    processing_status: "READY",
    indexing_status: "DISABLED",
    enabled: true,
    extraction_hash: "a".repeat(64),
    extraction_method: "GEMINI_VISION",
    image_segment_count: 3,
    image_role_summary: { BUSINESS: 1, CUSTOMER: 1, UNKNOWN: 1 },
    assistant_ids: [],
  });

  renderPage(true, "/app/tenant-a/knowledge-base/sources");
  fireEvent.click(await screen.findByRole("button", { name: "View Support screenshot" }));

  expect(await screen.findByText("Image extraction completed")).toBeVisible();
  expect(screen.getByText("3 segments · BUSINESS 1 · CUSTOMER 1 · UNKNOWN 1")).toBeVisible();
  expect(screen.getByRole("button", { name: "Generate candidates" })).toBeEnabled();
});

it("shows a safe failed image processing state without offering candidate generation", async () => {
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "image-source-failed",
      title: "Unreadable screenshot",
      source_type: "IMAGE",
      mime_type: "image/jpeg",
      processing_status: "FAILED",
      indexing_status: "DISABLED",
      processing_error_code: "IMAGE_EXTRACTION_FAILED",
      enabled: true,
    },
  ]);
  mockedApi.getKnowledgeSource.mockResolvedValue({
    id: "image-source-failed",
    title: "Unreadable screenshot",
    source_type: "IMAGE",
    mime_type: "image/jpeg",
    processing_status: "FAILED",
    indexing_status: "DISABLED",
    processing_error_code: "IMAGE_EXTRACTION_FAILED",
    enabled: true,
    assistant_ids: [],
  });

  renderPage(true, "/app/tenant-a/knowledge-base/sources");
  fireEvent.click(await screen.findByRole("button", { name: "View Unreadable screenshot" }));

  expect(await screen.findByText("Image processing failed safely")).toBeVisible();
  expect(screen.queryByText("Image extraction completed")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Generate candidates" })).not.toBeInTheDocument();
});

it("generates image candidates only after the explicit source action", async () => {
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "image-source-a",
      title: "Support screenshot",
      source_type: "IMAGE",
      mime_type: "image/png",
      processing_status: "READY",
      indexing_status: "DISABLED",
      enabled: true,
    },
  ]);
  mockedApi.getKnowledgeSource.mockResolvedValue({
    id: "image-source-a",
    title: "Support screenshot",
    source_type: "IMAGE",
    mime_type: "image/png",
    processing_status: "READY",
    indexing_status: "DISABLED",
    enabled: true,
    extraction_hash: "a".repeat(64),
    assistant_ids: [],
  });
  mockedApi.listKnowledgeCandidates.mockResolvedValue([
    {
      id: "image-candidate-a",
      candidate_type: "POLICY",
      proposed_title: "Payment timing",
      proposed_content: "The remaining balance is due before the event.",
      status: "NEEDS_REVIEW",
      pii_redaction_status: "REDACTED",
    },
  ]);

  renderPage(true, "/app/tenant-a/knowledge-base/sources");
  fireEvent.click(await screen.findByRole("button", { name: "View Support screenshot" }));
  expect(mockedApi.generateImageKnowledgeCandidates).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Generate candidates" }));

  await waitFor(() =>
    expect(mockedApi.generateImageKnowledgeCandidates).toHaveBeenCalledWith(
      "tenant-a",
      "image-source-a",
      { assistantId: null, extractionHash: "a".repeat(64) },
    ),
  );
  expect(await screen.findByText("Payment timing")).toBeVisible();
});

it("renders redacted image BUSINESS evidence and CUSTOMER context without treating it as truth", async () => {
  mockedApi.listKnowledgeCandidates.mockResolvedValue([
    {
      id: "image-candidate-a",
      candidate_type: "POLICY",
      proposed_title: "Payment timing",
      proposed_content: "The remaining balance is due before the event.",
      status: "NEEDS_REVIEW",
      pii_redaction_status: "REDACTED",
    },
  ]);
  mockedApi.getKnowledgeCandidateEvidence.mockResolvedValue([
    {
      evidence_type: "IMAGE",
      channel_type: "IMAGE",
      sender_type: "CUSTOMER",
      evidence_kind: "SUPPORTING_CONTEXT",
      source_title: "Support screenshot",
      role_confidence: 0.91,
      normalized_text: "Can we pay on the event day? Contact [REDACTED_EMAIL].",
      segment_order: 0,
      occurred_at: "2026-09-01T00:00:00Z",
    },
    {
      evidence_type: "IMAGE",
      channel_type: "IMAGE",
      sender_type: "BUSINESS",
      evidence_kind: "PRIMARY",
      source_title: "Support screenshot",
      role_confidence: 0.97,
      normalized_text: "The remaining balance is due 3 business days before the event.",
      segment_order: 1,
      occurred_at: "2026-09-01T00:00:01Z",
    },
  ]);

  renderPage(true, "/app/tenant-a/knowledge-base/candidates");
  fireEvent.click(await screen.findByRole("button", { name: "Review Payment timing" }));

  expect(await screen.findByText("Supporting customer context — not business truth")).toBeVisible();
  expect(screen.getByText("Business evidence")).toBeVisible();
  expect(screen.getByText(/\[REDACTED_EMAIL\]/)).toBeVisible();
  expect(screen.queryByText("customer@example.com")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve candidate" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Reject candidate" })).toBeVisible();
});

it("renders candidate review and gap lifecycle controls", async () => {
  mockedApi.listKnowledgeCandidates.mockResolvedValue([
    {
      id: "candidate-a",
      candidate_type: "GAP",
      proposed_title: "Answer",
      proposed_content: "Safe content",
      status: "NEEDS_REVIEW",
    },
  ]);
  mockedApi.getKnowledgeCandidateEvidence.mockResolvedValue([
    {
      conversation_id: "conversation-a",
      message_id: "message-a",
      channel_type: "WHATSAPP",
      sender_type: "USER",
      occurred_at: "2026-08-28T00:00:00Z",
    },
  ]);
  const candidateView = renderPage(
    true,
    "/app/tenant-a/knowledge-base/candidates",
  );
  expect(
    await screen.findByRole("button", { name: "Review Answer" }),
  ).toBeVisible();
  screen.getByRole("button", { name: "Review Answer" }).click();
  expect(
    await screen.findByRole("button", { name: "Approve candidate" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Reject candidate" }),
  ).toBeVisible();
  candidateView.unmount();

  mockedApi.listKnowledgeGaps.mockResolvedValue([
    {
      id: "gap-a",
      normalized_question: "Missing answer?",
      occurrence_count: 2,
      status: "NEEDS_REVIEW",
      suggested_candidate_id: null,
    },
  ]);
  mockedApi.getKnowledgeGapSignals.mockResolvedValue([
    {
      conversation_id: "conversation-a",
      message_id: "message-a",
      channel_type: "WHATSAPP",
      signal_type: "UNANSWERED",
      created_at: "2026-08-28T00:00:00Z",
    },
  ]);
  renderPage(true, "/app/tenant-a/knowledge-base/gaps");
  expect(
    await screen.findByRole("button", { name: "Review Missing answer?" }),
  ).toBeVisible();
  screen.getByRole("button", { name: "Review Missing answer?" }).click();
  expect(
    await screen.findByRole("button", { name: "Create suggested candidate" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Resolve gap" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Dismiss gap" })).toBeVisible();
});

it("allows recommendation generation after selecting an Assistant", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-a", tenant_id: "tenant-a", name: "Sales Assistant" },
  ]);
  renderPage(true, "/app/tenant-a/knowledge-base/configurations");
  const select = await screen.findByRole("combobox", { name: "Assistant" });
  await screen.findByRole("option", { name: "Sales Assistant" });
  fireEvent.change(select, { target: { value: "assistant-a" } });
  expect(
    await screen.findByRole("button", { name: "Generate recommendation" }),
  ).toBeVisible();
});

it("supports direct routed panels while preserving the legacy query route", async () => {
  mockedApi.listBusinessProfiles.mockResolvedValue([
    {
      id: "profile-one",
      profile_data: { summary: "Real profile" },
      status: "NEEDS_REVIEW",
      active_version_id: null,
    },
  ]);
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  expect(await screen.findByText("Business Profile profile-")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Business Profile" }),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Reject" })).toBeVisible();
});

it("renders structured tenant profile fields and provenance", async () => {
  mockedApi.listBusinessProfiles.mockResolvedValue([
    {
      id: "profile-active",
      schema_version: 2,
      profile_data: {
        company_identity: "Meridian Arc Technologies LLC",
        company_summary: "Enterprise technology company",
        services: ["Enterprise support"],
        pricing_information: ["35,650 AED"],
        supported_languages: ["English"],
      },
      evidence: [{ source_id: "source-a" }],
      status: "ACTIVE",
      active_version_id: "profile-active",
    },
  ]);
  renderPage(true, "/app/tenant-a/knowledge-base/profile");
  expect(await screen.findByText("Company Identity")).toBeVisible();
  expect(
    screen.getAllByText("Meridian Arc Technologies LLC").length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("SOURCE-DERIVED")).toBeVisible();
});

it("renders structured Assistant configuration and a safe runtime preview", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-a", tenant_id: "tenant-a", name: "Meridian Advisor" },
  ]);
  mockedApi.listBusinessProfiles.mockResolvedValue([
    {
      id: "profile-active",
      schema_version: 2,
      profile_data: { company_identity: "Meridian Arc Technologies LLC" },
      evidence: [{ source_id: "source-a" }],
      status: "ACTIVE",
      active_version_id: "profile-active",
    },
  ]);
  mockedApi.listAssistantConfigurations.mockResolvedValue([
    {
      id: "config-active",
      schema_version: 2,
      source_profile_version_id: "profile-active",
      configuration_data: {
        assistant_identity: "Meridian Client Advisor",
        role_and_purpose: "Support customers",
        tone: "Calm and precise",
        qualification_guidance: "Ask only relevant questions",
        fallback_guidance: "State when information is unavailable",
        follow_up_behavior: { enabled: true },
        scheduled_messaging_behavior: { enabled: true },
        prohibited_claims: ["Unsupported prices"],
      },
      status: "ACTIVE",
    },
  ]);
  renderPage(true, "/app/tenant-a/knowledge-base/configurations");
  const assistant = await screen.findByRole("combobox", { name: "Assistant" });
  await screen.findByRole("option", { name: "Meridian Advisor" });
  fireEvent.change(assistant, { target: { value: "assistant-a" } });
  expect(assistant).toHaveValue("assistant-a");
  await waitFor(() =>
    expect(mockedApi.listAssistantConfigurations).toHaveBeenCalledWith(
      "tenant-a",
      "assistant-a",
    ),
  );
  expect(await screen.findByText("Runtime Behavior Preview")).toBeVisible();
  expect(screen.getAllByText("Meridian Client Advisor")).toHaveLength(2);
  expect(screen.getAllByText("AI RECOMMENDED").length).toBeGreaterThan(0);
  expect(screen.queryByText(/PLATFORM RUNTIME SAFETY/)).not.toBeInTheDocument();
});

it("does not label an ACTIVE configuration without assistant identity as ACTIVE RUNTIME", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-a", tenant_id: "tenant-a", name: "Meridian Advisor" },
  ]);
  mockedApi.listBusinessProfiles.mockResolvedValue([
    {
      id: "profile-active",
      schema_version: 2,
      profile_data: { company_identity: "Meridian Arc Technologies LLC" },
      status: "ACTIVE",
      active_version_id: "profile-active",
    },
  ]);
  mockedApi.listAssistantConfigurations.mockResolvedValue([
    {
      id: "config-incomplete",
      schema_version: 2,
      source_profile_version_id: "profile-active",
      configuration_data: { tone: "Calm and precise" },
      status: "ACTIVE",
    },
  ]);

  renderPage(true, "/app/tenant-a/knowledge-base/configurations");
  const assistant = await screen.findByRole("combobox", { name: "Assistant" });
  await screen.findByRole("option", { name: "Meridian Advisor" });
  fireEvent.change(assistant, { target: { value: "assistant-a" } });

  await waitFor(() =>
    expect(mockedApi.listAssistantConfigurations).toHaveBeenCalledWith(
      "tenant-a",
      "assistant-a",
    ),
  );

  expect(await screen.findByText("ACTIVE · CONFIGURATION INCOMPLETE")).toBeVisible();
  expect(screen.queryByText("ACTIVE · ACTIVE RUNTIME")).not.toBeInTheDocument();
  expect(screen.queryByText("Runtime Behavior Preview")).not.toBeInTheDocument();
});

it("shows a scope-bound reused Recommendation terminal result without silent idle", async () => {
  cleanup();
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-a", tenant_id: "tenant-a", name: "Meridian Advisor" },
  ]);
  mockedApi.listBusinessProfiles.mockResolvedValue([
    {
      id: "profile-active",
      schema_version: 2,
      profile_data: { company_identity: "Meridian Arc Technologies LLC" },
      evidence: [],
      status: "APPROVED",
      active_version_id: "profile-active",
    },
  ]);
  mockedApi.generateKnowledgeRecommendation.mockResolvedValue({
    recommendation: {
      id: "recommendation-reused",
      recommendation_data: { tone: "Professional" },
      status: "NEEDS_REVIEW",
    },
    reused: true,
    run_id: "run-reused",
  });
  renderPage(true, "/app/tenant-a/knowledge-base/configurations");
  const assistantSelect = await screen.findByRole("combobox", { name: "Assistant" });
  await screen.findByRole("option", { name: "Meridian Advisor" });
  fireEvent.change(assistantSelect, {
    target: { value: "assistant-a" },
  });
  await waitFor(() => expect(assistantSelect).toHaveValue("assistant-a"));
  fireEvent.change(
    await screen.findByRole("combobox", { name: "ACTIVE Business Profile" }),
    { target: { value: "profile-active" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate recommendation" }));

  expect(await screen.findByText("Existing exact recommendation reused")).toBeVisible();
  expect(screen.getByText(/Recommendation recommen · NEEDS_REVIEW · NOT ACTIVE/)).toBeVisible();
  const reviewButton = screen.getByRole("button", { name: "Review recommendation" });
  expect(reviewButton).toBeVisible();
  expect(reviewButton).not.toBeDisabled();
  fireEvent.click(reviewButton);
  const recommendation = await screen.findByRole("article");
  expect(recommendation).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("region", { name: "Recommendation review" })).toBeVisible();
  expect(mockedApi.reviewRecommendation).not.toHaveBeenCalled();
});

it("keeps the Configuration page rendered when generation returns an unusable summary artifact", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-a", tenant_id: "tenant-a", name: "Meridian Advisor" },
  ]);
  mockedApi.listBusinessProfiles.mockResolvedValue([
    {
      id: "profile-active",
      schema_version: 2,
      profile_data: { company_identity: "Meridian Arc Technologies LLC" },
      status: "APPROVED",
      active_version_id: "profile-active",
    },
  ]);
  mockedApi.listKnowledgeRecommendations.mockResolvedValue([
    {
      id: "recommendation-approved",
      recommendation_data: { tone: "Professional" },
      status: "APPROVED",
    },
  ]);
  mockedApi.generateAssistantConfiguration.mockResolvedValue({
    configuration: {
      id: "configuration-new",
      status: "NEEDS_REVIEW",
    } as never,
    reused: false,
    run_id: "configuration-run",
  });

  renderPage(true, "/app/tenant-a/knowledge-base/configurations");
  const assistantSelect = await screen.findByRole("combobox", { name: "Assistant" });
  await screen.findByRole("option", { name: "Meridian Advisor" });
  fireEvent.change(assistantSelect, { target: { value: "assistant-a" } });
  await waitFor(() => expect(assistantSelect).toHaveValue("assistant-a"));
  fireEvent.click(await screen.findByRole("button", { name: "Generate configuration" }));

  expect(await screen.findByText("Configuration generation returned an unusable result. Refresh and retry.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Configurations" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review configuration" })).not.toBeInTheDocument();
});

it("surfaces and reviews the exact generated Configuration before refetch", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-a", tenant_id: "tenant-a", name: "Meridian Advisor" },
  ]);
  mockedApi.listBusinessProfiles.mockResolvedValue([
    {
      id: "profile-active",
      schema_version: 2,
      profile_data: { company_identity: "Meridian Arc Technologies LLC" },
      status: "APPROVED",
      active_version_id: "profile-active",
    },
  ]);
  mockedApi.listKnowledgeRecommendations.mockResolvedValue([
    {
      id: "recommendation-approved",
      recommendation_data: { tone: "Professional" },
      status: "APPROVED",
    },
  ]);
  mockedApi.generateAssistantConfiguration.mockResolvedValue({
    configuration: {
      id: "configuration-new",
      status: "NEEDS_REVIEW",
      configuration_data: { assistant_instructions: "Use approved facts." },
      source_profile_version_id: "profile-active",
      source_recommendation_id: "recommendation-approved",
    },
    reused: false,
    run_id: "configuration-run",
  });

  renderPage(true, "/app/tenant-a/knowledge-base/configurations");
  const assistantSelect = await screen.findByRole("combobox", { name: "Assistant" });
  await screen.findByRole("option", { name: "Meridian Advisor" });
  fireEvent.change(assistantSelect, { target: { value: "assistant-a" } });
  await waitFor(() => expect(assistantSelect).toHaveValue("assistant-a"));
  fireEvent.click(await screen.findByRole("button", { name: "Generate configuration" }));

  expect(await screen.findByText("Assistant Configuration generated")).toBeVisible();
  expect(screen.getByText(/Configuration configur · NEEDS_REVIEW · NOT ACTIVE/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Configurations" })).toBeVisible();
  const reviewButton = screen.getByRole("button", { name: "Review configuration" });
  expect(reviewButton).not.toBeDisabled();
  fireEvent.click(reviewButton);
  expect(screen.getByRole("region", { name: "Configuration review" })).toBeVisible();
  expect(mockedApi.reviewAssistantConfiguration).not.toHaveBeenCalled();
  expect(mockedApi.activateAssistantConfiguration).not.toHaveBeenCalled();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders the real Knowledge Intelligence overview and every lifecycle panel", async () => {
  renderPage();
  expect(await screen.findByText("3 ready sources")).toBeVisible();
  for (const name of [
    "Overview",
    "Sources",
    "Candidates",
    "Knowledge Gaps",
    "Business Profile",
    "Configurations",
    "Retrieval Test",
    "Legacy Knowledge Base",
  ]) {
    expect(screen.getByRole("link", { name })).toBeVisible();
  }
  expect(mockedApi.getKnowledgeOverview).toHaveBeenCalledWith("tenant-a");
});

it("uses readable dark navigation surfaces and a distinct active state", async () => {
  renderPage();
  await screen.findByText("3 ready sources");

  const active = screen.getByRole("link", { name: "Overview" });
  const inactive = screen.getByRole("link", { name: "Sources" });
  const legacy = screen.getByRole("link", { name: "Legacy Knowledge Base" });

  expect(active).toHaveAttribute("aria-current", "page");
  expect(active.className).toContain("bg-signal");
  expect(active.className).toContain("text-white");
  expect(inactive.className).toContain("bg-elevated");
  expect(inactive.className).toContain("text-stone-300");
  expect(inactive.className).not.toContain("bg-white");
  expect(legacy.className).toContain("bg-elevated");
  expect(legacy.className).toContain("text-stone-300");
  expect(legacy.className).not.toContain("bg-white");
});

it("keeps AGENT users read-only", async () => {
  renderPage(false);
  await screen.findByText("3 ready sources");
  expect(
    screen.queryByRole("button", { name: /generate|run retrieval/i }),
  ).toBeNull();
});

it("derives Assistant channel labels from real channel assignments", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-whatsapp", tenant_id: "tenant-a", name: "SamChe AI" },
    {
      id: "assistant-guide",
      tenant_id: "tenant-a",
      name: "Samcheguide Runtime",
    },
  ]);
  mockedApi.listChannels.mockResolvedValue([
    {
      id: "channel-wa",
      tenant_id: "tenant-a",
      assistant_id: "assistant-whatsapp",
      channel_type: "WHATSAPP",
      display_name: "WhatsApp",
      status: "active",
    },
    {
      id: "channel-web",
      tenant_id: "tenant-a",
      assistant_id: "assistant-whatsapp",
      channel_type: "WEB_CHAT",
      display_name: "Web Chat",
      status: "active",
    },
    {
      id: "channel-guide",
      tenant_id: "tenant-a",
      assistant_id: "assistant-guide",
      channel_type: "SAMCHEGUIDE",
      display_name: "AI Guide",
      status: "active",
    },
  ]);

  renderPage(true, "/app/tenant-a/knowledge?tab=retrieval");

  expect(
    await screen.findByRole("option", {
      name: "WhatsApp Chatbot • Web Chatbot",
    }),
  ).toBeVisible();
  expect(screen.getByRole("option", { name: "AI Guide" })).toBeVisible();
  expect(screen.queryByText("SamChe AI")).not.toBeInTheDocument();
  expect(screen.queryByText("Samcheguide Runtime")).not.toBeInTheDocument();
});

it("shows the same channel-aware Assistant labels when assigning a source", async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: "assistant-whatsapp", tenant_id: "tenant-a", name: "SamChe AI" },
  ]);
  mockedApi.listChannels.mockResolvedValue([
    {
      id: "channel-wa",
      tenant_id: "tenant-a",
      assistant_id: "assistant-whatsapp",
      channel_type: "WHATSAPP",
      display_name: "WhatsApp",
      status: "active",
    },
  ]);
  mockedApi.listKnowledgeSources.mockResolvedValue([
    {
      id: "source-a",
      title: "Sales policy",
      source_type: "PDF",
      processing_status: "READY",
      indexing_status: "READY",
      enabled: true,
    },
  ]);

  renderPage(true, "/app/tenant-a/knowledge?tab=sources");

  expect(
    await screen.findByRole("option", { name: "WhatsApp Chatbot" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Assign source" })).toBeDisabled();
});
