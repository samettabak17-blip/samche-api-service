import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DashboardButton,
  DashboardCheckbox,
  DashboardField,
  DashboardFileInput,
  DashboardInput,
  DashboardSelect,
  DashboardTextarea,
} from "../../components/ui/dashboard-control";
import { ConfirmationDialog } from "../../components/ui/confirmation-dialog";
import { EmptyState, SkeletonBlock } from "../../components/ui/async-state";
import { MutationFeedback } from "../../components/ui/mutation-feedback";
import { ApiError } from "../../lib/api-client";
import { tenantApi } from "../dashboard/dashboard-api";
import { useTenant } from "../tenants/tenant-context";
import type {
  GuideDomain,
  GuideExperienceData,
  GuideExperienceField,
  GuideExperienceVersion,
} from "../../types/api";

const defaults: GuideExperienceData = {
  brand_name: "AI Guide",
  assistant_display_name: "AI Guide",
  assistant_status_label: "Online",
  welcome_title: "How can we help?",
  welcome_message: "Ask a question to get started.",
  input_placeholder: "Type your message",
  launcher_label: "Send",
  empty_state_copy: "Start a conversation when you are ready.",
  logo_url: null,
  avatar_url: null,
  favicon_url: null,
  theme: {
    primary_color: "#1F4B99",
    accent_color: "#4F7FD8",
    background_color: "#F7F8FA",
    foreground_color: "#18212F",
    surface_color: "#FFFFFF",
    border_color: "#D9E0EA",
    font_family: "SYSTEM",
    corner_radius: "MEDIUM",
    density: "COMFORTABLE",
  },
  layout: {
    preset: "PROFESSIONAL",
    launcher_style: "PILL",
    header_style: "STANDARD",
    panel_style: "CARD",
  },
  modules: { chat: true, guide: true, calculator: true, ctas: true },
  hero: { title: "How can we help?", message: "Choose a path or ask a question to get started.", cta_label: "" },
  roadmap: { enabled: true, title: "Your roadmap", description: "Share a few details and we will help shape the next step.", steps: [{ id: "goal", label: "What would you like to achieve?", description: "", input_type: "TEXT", required: true, options: [], min: null, max: null, unit: "" }] },
  interactive_tool: { enabled: true, title: "Planning snapshot", description: "Capture your indicative budget to share with the assistant.", currency: "", result_label: "Your planning snapshot", fields: [{ id: "budget", label: "Indicative budget", description: "", input_type: "NUMBER", required: false, options: [], min: 0, max: 100000000, unit: "" }], calculation: { base_amount: 0, terms: [{ field_id: "budget", kind: "NUMBER_MULTIPLIER", multiplier: 1 }] } },
};
const clone = (value: GuideExperienceData) => structuredClone(value);
const newRoadmapStep = (): GuideExperienceField => ({ id: `step_${Date.now()}`, label: "New roadmap step", description: "", input_type: "TEXT", required: false, options: [], min: null, max: null, unit: "" });
const newToolField = (): GuideExperienceField => ({ id: `field_${Date.now()}`, label: "New tool field", description: "", input_type: "NUMBER", required: false, options: [], min: 0, max: 100000000, unit: "" });
const optionsFromLabels = (value: string) => value.split(',').map((label) => label.trim()).filter(Boolean).slice(0, 20).map((label, index) => ({ value: `option_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value'}_${index + 1}`.slice(0, 40), label }));
const extractLogoCandidates = async (file: File): Promise<string[]> => new Promise((resolve) => {
  const image = new Image(); const url = URL.createObjectURL(file);
  image.onload = () => { const canvas = document.createElement('canvas'); const side = 48; canvas.width = side; canvas.height = side; const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) { URL.revokeObjectURL(url); resolve([]); return; } context.drawImage(image, 0, 0, side, side); const data = context.getImageData(0, 0, side, side).data; const values: string[] = []; for (let index = 0; index < data.length; index += 16) { if (data[index + 3] < 180) continue; values.push(`#${[data[index], data[index + 1], data[index + 2]].map((item) => item.toString(16).padStart(2, '0')).join('').toUpperCase()}`); } URL.revokeObjectURL(url); resolve(values.slice(0, 64)); };
  image.onerror = () => { URL.revokeObjectURL(url); resolve([]); }; image.src = url;
});
const guideDomainFailureMessage = (error: unknown, fallback: string) => {
  const code =
    error instanceof ApiError &&
    error.body &&
    typeof error.body === "object" &&
    "code" in error.body
      ? (error.body as { code?: unknown }).code
      : null;
  return typeof code === "string" && code.startsWith("GUIDE_DOMAIN_INGRESS_")
    ? "Platform domain ingress is not available yet. Contact a platform owner."
    : fallback;
};
function ExperiencePreview({
  experience,
}: {
  experience: GuideExperienceData;
}) {
  const { theme } = experience;
  return (
    <section
      aria-label="Guide draft preview"
      className="overflow-hidden rounded-2xl border shadow-panel"
      style={{
        background: theme.background_color,
        color: theme.foreground_color,
        borderColor: theme.border_color,
      }}
    >
      <header
        className="flex items-center gap-3 border-b p-4"
        style={{ borderColor: theme.border_color }}
      >
        {experience.avatar_url ? (
          <img
            src={experience.avatar_url}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        ) : (
          <div
            className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white"
            style={{ background: theme.primary_color }}
          >
            {experience.assistant_display_name.slice(0, 1)}
          </div>
        )}
        <div>
          <p className="font-semibold">{experience.assistant_display_name}</p>
          <p className="text-xs" style={{ color: theme.accent_color }}>
            {experience.assistant_status_label}
          </p>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {experience.logo_url ? (
          <img
            src={experience.logo_url}
            alt={`${experience.brand_name} logo`}
            className="max-h-12 max-w-40 object-contain"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        ) : null}
        <h2 className="text-xl font-semibold">{experience.welcome_title}</h2>
        <p className="text-sm leading-6">{experience.welcome_message}</p>
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
          {experience.modules.guide ? <span className="rounded-lg border p-2" style={{ borderColor: theme.border_color }}>Roadmap</span> : null}
          {experience.modules.calculator ? <span className="rounded-lg border p-2" style={{ borderColor: theme.border_color }}>Interactive Tool</span> : null}
          {experience.modules.chat ? <span className="rounded-lg border p-2" style={{ borderColor: theme.border_color }}>AI Assistant</span> : null}
        </div>
        <p
          className="rounded-xl border p-3 text-sm"
          style={{
            borderColor: theme.border_color,
            background: theme.surface_color,
          }}
        >
          {experience.roadmap.title} · {experience.interactive_tool.title}
        </p>
        <button
          type="button"
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ background: theme.primary_color }}
        >
          {experience.launcher_label}
        </button>
      </div>
    </section>
  );
}
export function GuideExperiencePage() {
  const { selectedTenant, canManage } = useTenant();
  const tenantId = selectedTenant?.id ?? "";
  const client = useQueryClient();
  const [assistantId, setAssistantId] = useState("");
  const [draft, setDraft] = useState<GuideExperienceData>(clone(defaults));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] =
    useState<GuideExperienceVersion | null>(null);
  const [hostname, setHostname] = useState("");
  const [managedSlug, setManagedSlug] = useState("");
  const [domainMode, setDomainMode] = useState<"MANAGED" | "CUSTOM">("MANAGED");
  const [channelId, setChannelId] = useState("");
  const [logoCandidates, setLogoCandidates] = useState<string[]>([]);
  const [archiveDomainTarget, setArchiveDomainTarget] =
    useState<GuideDomain | null>(null);
  const assistants = useQuery({
    queryKey: ["tenant", tenantId, "assistants"],
    queryFn: () => tenantApi.listAssistants(tenantId),
    enabled: Boolean(tenantId),
  });
  const channels = useQuery({
    queryKey: ["tenant", tenantId, "channels"],
    queryFn: () => tenantApi.listChannels(tenantId),
    enabled: Boolean(tenantId),
  });
  useEffect(() => {
    if (!assistantId && assistants.data?.[0])
      setAssistantId(assistants.data[0].id);
  }, [assistantId, assistants.data]);
  const versions = useQuery({
    queryKey: ["tenant", tenantId, "guide-experience", assistantId],
    queryFn: () => tenantApi.listGuideExperiences(tenantId, assistantId),
    enabled: Boolean(tenantId && assistantId),
  });
  const publicationDiagnostics = useQuery({
    queryKey: ["tenant", tenantId, "guide-publication-diagnostics", assistantId],
    queryFn: () => tenantApi.getGuidePublicationDiagnostics(tenantId, assistantId),
    enabled: Boolean(tenantId && assistantId),
  });
  const domains = useQuery({
    queryKey: ["tenant", tenantId, "guide-domains", assistantId],
    queryFn: () => tenantApi.listGuideDomains(tenantId, assistantId),
    enabled: Boolean(tenantId && assistantId),
  });
  const guideChannels = useMemo(
    () =>
      channels.data?.filter(
        (item) =>
          item.channel_type === "SAMCHEGUIDE" &&
          item.status === "active" &&
          item.assistant_id === assistantId,
      ) ?? [],
    [channels.data, assistantId],
  );
  useEffect(() => {
    if (!channelId && guideChannels[0]) setChannelId(guideChannels[0].id);
  }, [channelId, guideChannels]);
  useEffect(() => {
    const active = versions.data?.find((item) => item.status === "PUBLISHED");
    if (active) setDraft(clone(active.experience));
  }, [versions.data]);
  const invalidate = () =>
    void client.invalidateQueries({
      queryKey: ["tenant", tenantId, "guide-experience", assistantId],
    });
  const invalidatePublicationDiagnostics = () =>
    void client.invalidateQueries({
      queryKey: ["tenant", tenantId, "guide-publication-diagnostics", assistantId],
    });
  const invalidateDomains = () =>
    void client.invalidateQueries({
      queryKey: ["tenant", tenantId, "guide-domains", assistantId],
    });
  const save = useMutation({
    mutationFn: () =>
      tenantApi.createGuideExperienceDraft(tenantId, assistantId, draft),
    onSuccess: (version) => {
      invalidate();
      invalidatePublicationDiagnostics();
      setFeedback(`Draft v${version.version} saved. Preview remains private.`);
    },
    onError: () => setFeedback("Draft could not be saved safely."),
  });
  const generateRecommendation = useMutation({
    mutationFn: () => tenantApi.createRecommendedGuideExperienceDraft(tenantId, assistantId),
    onSuccess: ({ version, recommendation }) => { setDraft(clone(version.experience)); invalidate(); setFeedback(`Recommended ${recommendation.classification.sector.replace(/_/g, ' ').toLowerCase()} Guide saved as private draft v${version.version}. Review before publishing.`); },
    onError: () => setFeedback("A recommendation could not be generated because active tenant intelligence is unavailable."),
  });
  const recommendTheme = useMutation({
    mutationFn: () => tenantApi.recommendGuideTheme(tenantId, assistantId, logoCandidates),
    onSuccess: (theme) => { setDraft((current) => ({ ...current, theme: { ...current.theme, ...theme } })); setFeedback("Recommended accessible logo palette applied to this unsaved draft. Review and save when ready."); },
    onError: () => setFeedback("A theme recommendation could not be generated safely from this logo."),
  });
  const publish = useMutation({
    mutationFn: (id: string) =>
      tenantApi.publishGuideExperience(tenantId, assistantId, id),
    onSuccess: (version) => {
      invalidate();
      setFeedback(`Guide experience v${version.version} is now published.`);
    },
    onError: () =>
      setFeedback("Guide experience could not be published safely."),
  });
  const rollback = useMutation({
    mutationFn: (id: string) =>
      tenantApi.rollbackGuideExperience(tenantId, assistantId, id),
    onSuccess: (version) => {
      setRollbackTarget(null);
      invalidate();
      invalidatePublicationDiagnostics();
      setFeedback(`Guide experience rolled back to v${version.version}.`);
    },
    onError: () =>
      setFeedback("Guide experience could not be rolled back safely."),
  });
  const assetUpload = useMutation({
    mutationFn: ({ kind, file }: { kind: "LOGO" | "AVATAR"; file: File }) =>
      tenantApi.uploadGuideExperienceAsset(tenantId, assistantId, kind, file),
    onSuccess: (asset, variables) => {
      setDraft((current) => ({
        ...current,
        [variables.kind === "LOGO" ? "logo_url" : "avatar_url"]:
          asset.public_url,
      }));
      setFeedback(
        `${variables.kind === "LOGO" ? "Logo" : "Avatar"} uploaded. Save a draft to preview it privately.`,
      );
    },
    onError: () => setFeedback("Branding asset could not be uploaded safely."),
  });
  const createDomain = useMutation({
    mutationFn: () =>
      tenantApi.createGuideDomain(tenantId, assistantId, {
        domain_mode: domainMode,
        ...(domainMode === "MANAGED" ? { slug: managedSlug } : { hostname }),
        channel_id: channelId,
      }),
    onSuccess: (domain) => {
      setHostname("");
      setManagedSlug("");
      invalidateDomains();
      setFeedback(
        domain.domain_mode === "MANAGED"
          ? `${domain.hostname} is reserved. It will become active after platform ingress verification.`
          : `Domain ${domain.hostname} added. Set the displayed DNS CNAME, then verify it.`,
      );
    },
    onError: (error) =>
      setFeedback(
        guideDomainFailureMessage(
          error,
          "Guide domain could not be added safely.",
        ),
      ),
  });
  const verifyDomain = useMutation({
    mutationFn: (id: string) =>
      tenantApi.verifyGuideDomain(tenantId, assistantId, id),
    onSuccess: (domain) => {
      invalidateDomains();
      setFeedback(
        domain.status === "ACTIVE"
          ? `Domain ${domain.hostname} is active.`
          : `DNS is correct. ${domain.hostname} is waiting for ingress verification.`,
      );
    },
    onError: (error) =>
      setFeedback(
        guideDomainFailureMessage(
          error,
          "Guide domain DNS verification failed. Check the CNAME and retry.",
        ),
      ),
  });
  const archiveDomain = useMutation({
    mutationFn: (id: string) =>
      tenantApi.archiveGuideDomain(tenantId, assistantId, id),
    onSuccess: (domain) => {
      setArchiveDomainTarget(null);
      invalidateDomains();
      setFeedback(`Domain ${domain.hostname} was archived.`);
    },
    onError: (error) =>
      setFeedback(
        guideDomainFailureMessage(
          error,
          "Guide domain could not be archived safely.",
        ),
      ),
  });
  const drafts = useMemo(
    () => versions.data?.filter((item) => item.status === "DRAFT") ?? [],
    [versions.data],
  );
  const archived = useMemo(
    () => versions.data?.filter((item) => item.status === "ARCHIVED") ?? [],
    [versions.data],
  );
  const managedSuffix =
    (domains.data as (GuideDomain[] & { managed_domain_suffix?: string }) | undefined)
      ?.managed_domain_suffix ??
    "guide.staging.samchecompany.com";
  const managedPreview = managedSlug
    ? `${managedSlug}.${managedSuffix}`
    : `your-slug.${managedSuffix}`;
  const update = (
    key:
      | "brand_name"
      | "assistant_display_name"
      | "welcome_title"
      | "welcome_message",
    value: string,
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const updateRoadmapStep = (index: number, patch: Partial<GuideExperienceField>) =>
    setDraft((current) => ({
      ...current,
      roadmap: { ...current.roadmap, steps: current.roadmap.steps.map((step, itemIndex) => itemIndex === index ? { ...step, ...patch } : step) },
    }));
  const updateToolField = (index: number, patch: Partial<GuideExperienceField>) =>
    setDraft((current) => ({
      ...current,
      interactive_tool: { ...current.interactive_tool, fields: current.interactive_tool.fields.map((field, itemIndex) => itemIndex === index ? { ...field, ...patch } : field) },
    }));
  const setToolMultiplier = (fieldId: string, multiplier: number) =>
    setDraft((current) => ({
      ...current,
      interactive_tool: {
        ...current.interactive_tool,
        calculation: {
          ...current.interactive_tool.calculation,
          terms: [
            ...current.interactive_tool.calculation.terms.filter((term) => term.field_id !== fieldId),
            { field_id: fieldId, kind: 'NUMBER_MULTIPLIER', multiplier },
          ],
        },
      },
    }));
  if (!canManage)
    return (
      <EmptyState
        title="Guide Experience is read-only"
        description="A tenant administrator manages customer-facing Guide branding."
      />
    );
  if (assistants.isLoading) return <SkeletonBlock className="h-80" />;
  return (
    <section className="space-y-6">
      <header>
        <p className="eyebrow">AI Guide</p>
        <h1 className="page-title mt-2">Guide Experience</h1>
      <p className="mt-2 text-sm text-stone-400">
        Configure customer-facing branding, Roadmap and Interactive Tool.
        Provider, model and runtime behavior stay platform controlled.
      </p>
      <section className="panel mt-4 space-y-2 p-4" aria-label="Publication diagnostics summary">
        <p className="dashboard-section-label">Publication diagnostics</p>
        <p className="text-sm text-stone-300">
          {publicationDiagnostics.data
            ? `Current public version: ${publicationDiagnostics.data.public_bootstrap_version ?? "None"} · ${publicationDiagnostics.data.consistency}`
            : "Loading publication state…"}
        </p>
      </section>
      </header>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
        <form
          className="panel space-y-5 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DashboardField label="Assistant">
            <DashboardSelect
              aria-label="Guide assistant"
              value={assistantId}
              onChange={(event) => {
                setAssistantId(event.target.value);
                setChannelId("");
              }}
            >
              {assistants.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </DashboardSelect>
          </DashboardField>
          <div className="grid gap-4 sm:grid-cols-2">
            <DashboardField label="Brand name">
              <DashboardInput
                value={draft.brand_name}
                onChange={(event) => update("brand_name", event.target.value)}
              />
            </DashboardField>
            <DashboardField label="Assistant display name">
              <DashboardInput
                value={draft.assistant_display_name}
                onChange={(event) =>
                  update("assistant_display_name", event.target.value)
                }
              />
            </DashboardField>
          </div>
          <DashboardField label="Welcome title">
            <DashboardInput
              value={draft.welcome_title}
              onChange={(event) => update("welcome_title", event.target.value)}
            />
          </DashboardField>
          <DashboardField label="Welcome message">
            <DashboardTextarea
              value={draft.welcome_message}
              onChange={(event) =>
                update("welcome_message", event.target.value)
              }
            />
          </DashboardField>
          <section className="space-y-4 rounded-xl border border-line p-4" aria-label="Guide hero configuration">
            <p className="dashboard-section-label">Hero</p>
            <DashboardField label="Hero title">
              <DashboardInput value={draft.hero.title} onChange={(event) => setDraft((current) => ({ ...current, hero: { ...current.hero, title: event.target.value } }))} />
            </DashboardField>
            <DashboardField label="Hero message">
              <DashboardTextarea value={draft.hero.message} onChange={(event) => setDraft((current) => ({ ...current, hero: { ...current.hero, message: event.target.value } }))} />
            </DashboardField>
          </section>
          <section className="space-y-4 rounded-xl border border-line p-4" aria-label="Roadmap configuration">
            <div className="flex items-center justify-between gap-3"><p className="dashboard-section-label">Roadmap</p><DashboardCheckbox label="Enabled" checked={draft.modules.guide} onChange={(event) => setDraft((current) => ({ ...current, modules: { ...current.modules, guide: event.target.checked }, roadmap: { ...current.roadmap, enabled: event.target.checked } }))} /></div>
            <DashboardField label="Roadmap title"><DashboardInput value={draft.roadmap.title} onChange={(event) => setDraft((current) => ({ ...current, roadmap: { ...current.roadmap, title: event.target.value } }))} /></DashboardField>
            <DashboardField label="Roadmap description"><DashboardTextarea value={draft.roadmap.description} onChange={(event) => setDraft((current) => ({ ...current, roadmap: { ...current.roadmap, description: event.target.value } }))} /></DashboardField>
            <div className="space-y-3">
              {draft.roadmap.steps.map((step, index) => <div key={step.id} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_10rem_auto]">
                <DashboardInput aria-label={`Roadmap step ${index + 1} label`} value={step.label} onChange={(event) => updateRoadmapStep(index, { label: event.target.value })} />
                <DashboardSelect aria-label={`Roadmap step ${index + 1} type`} value={step.input_type} onChange={(event) => updateRoadmapStep(index, { input_type: event.target.value as GuideExperienceField['input_type'], options: event.target.value === 'SELECT' ? [{ value: 'option_1', label: 'Option 1' }] : [] })}><option value="TEXT">Free text</option><option value="NUMBER">Number</option><option value="SELECT">Options</option><option value="BOOLEAN">Yes / No</option></DashboardSelect>
                <DashboardButton type="button" variant="outline" disabled={draft.roadmap.steps.length <= 1} onClick={() => setDraft((current) => ({ ...current, roadmap: { ...current.roadmap, steps: current.roadmap.steps.filter((_, itemIndex) => itemIndex !== index) } }))}>Remove</DashboardButton>
              </div>)}
              <DashboardButton type="button" variant="outline" disabled={draft.roadmap.steps.length >= 12} onClick={() => setDraft((current) => ({ ...current, roadmap: { ...current.roadmap, steps: [...current.roadmap.steps, newRoadmapStep()] } }))}>Add roadmap step</DashboardButton>
              {draft.roadmap.steps.map((step, index) => step.input_type === "SELECT" ? <DashboardField key={`${step.id}-options`} label={`Options for ${step.label}`} helper="Comma-separated labels"><DashboardInput value={step.options.map((option) => option.label).join(", ")} onChange={(event) => updateRoadmapStep(index, { options: optionsFromLabels(event.target.value) })} placeholder="Corporate event, Gala dinner" /></DashboardField> : null)}
            </div>
          </section>
          <section className="space-y-4 rounded-xl border border-line p-4" aria-label="Interactive Tool configuration">
            <div className="flex items-center justify-between gap-3"><p className="dashboard-section-label">Interactive Tool / Calculator</p><DashboardCheckbox label="Enabled" checked={draft.modules.calculator} onChange={(event) => setDraft((current) => ({ ...current, modules: { ...current.modules, calculator: event.target.checked }, interactive_tool: { ...current.interactive_tool, enabled: event.target.checked } }))} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><DashboardField label="Tool title"><DashboardInput value={draft.interactive_tool.title} onChange={(event) => setDraft((current) => ({ ...current, interactive_tool: { ...current.interactive_tool, title: event.target.value } }))} /></DashboardField><DashboardField label="Currency (optional)"><DashboardInput value={draft.interactive_tool.currency} placeholder="AED" onChange={(event) => setDraft((current) => ({ ...current, interactive_tool: { ...current.interactive_tool, currency: event.target.value.toUpperCase() } }))} /></DashboardField></div>
            <DashboardField label="Tool description"><DashboardTextarea value={draft.interactive_tool.description} onChange={(event) => setDraft((current) => ({ ...current, interactive_tool: { ...current.interactive_tool, description: event.target.value } }))} /></DashboardField>
            <DashboardField label="Base estimate"><DashboardInput type="number" value={String(draft.interactive_tool.calculation.base_amount)} onChange={(event) => setDraft((current) => ({ ...current, interactive_tool: { ...current.interactive_tool, calculation: { ...current.interactive_tool.calculation, base_amount: Number(event.target.value || 0) } } }))} /></DashboardField>
            <div className="space-y-3">{draft.interactive_tool.fields.map((field, index) => <div key={field.id} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_10rem_auto]"><DashboardInput aria-label={`Tool field ${index + 1} label`} value={field.label} onChange={(event) => updateToolField(index, { label: event.target.value })} /><DashboardSelect aria-label={`Tool field ${index + 1} type`} value={field.input_type} onChange={(event) => updateToolField(index, { input_type: event.target.value as GuideExperienceField['input_type'], options: event.target.value === 'SELECT' ? [{ value: 'option_1', label: 'Option 1' }] : [] })}><option value="NUMBER">Number</option><option value="SELECT">Options</option><option value="BOOLEAN">Yes / No</option></DashboardSelect><DashboardButton type="button" variant="outline" disabled={draft.interactive_tool.fields.length <= 1} onClick={() => setDraft((current) => ({ ...current, interactive_tool: { ...current.interactive_tool, fields: current.interactive_tool.fields.filter((_, itemIndex) => itemIndex !== index), calculation: { ...current.interactive_tool.calculation, terms: current.interactive_tool.calculation.terms.filter((term) => term.field_id !== field.id) } } }))}>Remove</DashboardButton></div>)}<DashboardButton type="button" variant="outline" disabled={draft.interactive_tool.fields.length >= 12} onClick={() => setDraft((current) => ({ ...current, interactive_tool: { ...current.interactive_tool, fields: [...current.interactive_tool.fields, newToolField()] } }))}>Add tool field</DashboardButton>{draft.interactive_tool.fields.map((field, index) => field.input_type === "SELECT" ? <DashboardField key={`${field.id}-options`} label={`Options for ${field.label}`} helper="Comma-separated labels"><DashboardInput value={field.options.map((option) => option.label).join(", ")} onChange={(event) => updateToolField(index, { options: optionsFromLabels(event.target.value) })} placeholder="Basic, Premium" /></DashboardField> : field.input_type === "NUMBER" ? <DashboardField key={`${field.id}-multiplier`} label={`Estimate per ${field.label}`} helper="Safe deterministic numeric multiplier"><DashboardInput type="number" value={String(draft.interactive_tool.calculation.terms.find((term) => term.field_id === field.id && term.kind === "NUMBER_MULTIPLIER")?.multiplier ?? 0)} onChange={(event) => setToolMultiplier(field.id, Number(event.target.value || 0))} /></DashboardField> : null)}</div>
          </section>
          <section className="space-y-3 rounded-xl border border-line p-4" aria-label="AI Assistant configuration">
            <p className="dashboard-section-label">AI Assistant</p>
            <DashboardCheckbox label="Enable AI Assistant" checked={draft.modules.chat} onChange={(event) => setDraft((current) => ({ ...current, modules: { ...current.modules, chat: event.target.checked } }))} />
            <p className="text-xs text-stone-400">The assistant uses the platform-selected runtime together with the active Business Profile, Assistant Configuration and approved tenant knowledge. Provider and model selection are not customer controls.</p>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <DashboardField
              label="Brand logo"
              helper="PNG, JPEG or WebP — maximum 5 MB"
            >
              <DashboardFileInput
                accept="image/png,image/jpeg,image/webp"
                chooseLabel="Upload logo"
                disabled={!assistantId || assetUpload.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) { void extractLogoCandidates(file).then(setLogoCandidates); assetUpload.mutate({ kind: "LOGO", file }); }
                }}
              />
            </DashboardField>
            <DashboardField
              label="Assistant avatar"
              helper="PNG, JPEG or WebP — maximum 5 MB"
            >
              <DashboardFileInput
                accept="image/png,image/jpeg,image/webp"
                chooseLabel="Upload avatar"
                disabled={!assistantId || assetUpload.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) assetUpload.mutate({ kind: "AVATAR", file });
                }}
              />
            </DashboardField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DashboardField label="Primary color">
              <DashboardInput
                value={draft.theme.primary_color}
                onChange={(event) =>
                  setDraft((c) => ({
                    ...c,
                    theme: { ...c.theme, primary_color: event.target.value },
                  }))
                }
              />
            </DashboardField>
            <DashboardField label="Accent color">
              <DashboardInput
                value={draft.theme.accent_color}
                onChange={(event) =>
                  setDraft((c) => ({
                    ...c,
                    theme: { ...c.theme, accent_color: event.target.value },
                  }))
                }
              />
            </DashboardField>
            <DashboardField label="Layout preset">
              <DashboardSelect
                value={draft.layout.preset}
                onChange={(event) =>
                  setDraft((c) => ({
                    ...c,
                    layout: {
                      ...c.layout,
                      preset: event.target
                        .value as GuideExperienceData["layout"]["preset"],
                    },
                  }))
                }
              >
                {[
                  "PROFESSIONAL",
                  "PREMIUM",
                  "MINIMAL",
                  "CONVERSATIONAL",
                  "COMMERCE",
                  "SERVICE",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </DashboardSelect>
            </DashboardField>
          </div>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4" aria-label="Guide recommendations">
            <div><p className="dashboard-section-label">Tenant-aware recommendations</p><p className="text-xs text-stone-400">Uses the active Business Profile and Assistant Configuration. It creates a private Draft only; publishing remains explicit.</p></div>
            <div className="flex flex-wrap gap-2">
              <DashboardButton type="button" variant="outline" disabled={!assistantId || generateRecommendation.isPending} onClick={() => generateRecommendation.mutate()}>{generateRecommendation.isPending ? "Generating…" : "Generate recommended draft"}</DashboardButton>
              <DashboardButton type="button" variant="outline" disabled={!assistantId || !logoCandidates.length || recommendTheme.isPending} onClick={() => recommendTheme.mutate()}>{recommendTheme.isPending ? "Analyzing…" : "Apply logo theme"}</DashboardButton>
            </div>
          </section>
          <DashboardCheckbox
            label="Show optional calculator module"
            checked={draft.modules.calculator}
            onChange={(event) =>
              setDraft((c) => ({
                ...c,
                modules: { ...c.modules, calculator: event.target.checked },
              }))
            }
          />
          <div className="flex flex-wrap gap-3">
            <DashboardButton
              type="submit"
              variant="secondary"
              disabled={!assistantId || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save draft"}
            </DashboardButton>
            {drafts.map((item) => (
              <DashboardButton
                key={item.id}
                type="button"
                variant="primary"
                disabled={publish.isPending}
                onClick={() => publish.mutate(item.id)}
              >
                Publish draft v{item.version}
              </DashboardButton>
            ))}
          </div>
          {feedback ? (
            <MutationFeedback
              error={
                feedback.includes("could not") ? new Error(feedback) : undefined
              }
              success={feedback.includes("could not") ? undefined : feedback}
            />
          ) : null}
        </form>
        <aside className="space-y-4">
          <p className="dashboard-section-label">Private draft preview</p>
          <ExperiencePreview experience={draft} />
          <p className="text-xs text-stone-400">
            Draft changes are never public until an explicit Publish action.
          </p>
          <section className="panel space-y-3 p-4">
            <p className="dashboard-section-label">Published history</p>
            {archived.length ? (
              archived.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"
                >
                  <span className="text-sm text-stone-200">
                    Version {version.version}
                  </span>
                  <DashboardButton
                    type="button"
                    variant="outline"
                    onClick={() => setRollbackTarget(version)}
                  >
                    Restore
                  </DashboardButton>
                </div>
              ))
            ) : (
              <p className="text-sm text-stone-400">
                No earlier published versions yet.
              </p>
            )}
          </section>
          <section className="panel space-y-3 p-4" aria-label="Publication diagnostics">
            <p className="dashboard-section-label">Publication diagnostics</p>
            {publicationDiagnostics.data ? (
              <>
                <p className="text-sm text-stone-300">Consistency: {publicationDiagnostics.data.consistency}</p>
                <p className="text-sm text-stone-300">Current public version: {publicationDiagnostics.data.public_bootstrap_version ?? "None"}</p>
                <div className="space-y-1 text-xs text-stone-400">
                  {publicationDiagnostics.data.versions.map((version) => <p key={version.id}>v{version.version} · {version.status} · {version.published_at ?? "not published"}</p>)}
                </div>
              </>
            ) : <p className="text-sm text-stone-400">Publication state is unavailable.</p>}
          </section>
          <section className="panel space-y-3 p-4">
            <p className="dashboard-section-label">Domains</p>
            <p className="text-xs text-stone-400">
              Choose a SamChe-managed hostname for automatic onboarding, or
              attach a customer-owned domain. Publishing never remaps ownership.
            </p>
            <DashboardField label="Domain mode">
              <DashboardSelect
                aria-label="Guide domain mode"
                value={domainMode}
                onChange={(event) =>
                  setDomainMode(event.target.value as "MANAGED" | "CUSTOM")
                }
              >
                <option value="MANAGED">SamChe Domain (recommended)</option>
                <option value="CUSTOM">Custom Domain</option>
              </DashboardSelect>
            </DashboardField>
            {domainMode === "MANAGED" ? (
              <DashboardField
                label="Available slug"
                helper={`Your public address will be ${managedPreview}`}
              >
                <DashboardInput
                  aria-label="Managed Guide slug"
                  value={managedSlug}
                  placeholder="customer"
                  onChange={(event) =>
                    setManagedSlug(event.target.value.toLowerCase())
                  }
                />
              </DashboardField>
            ) : (
              <DashboardField
                label="Customer hostname"
                helper="DNS instructions are shown after provisioning"
              >
                <DashboardInput
                  aria-label="Guide hostname"
                  value={hostname}
                  placeholder="guide.customer.example"
                  onChange={(event) => setHostname(event.target.value)}
                />
              </DashboardField>
            )}
            <DashboardField label="Guide channel">
              <DashboardSelect
                aria-label="Guide domain channel"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
              >
                <option value="">Select channel</option>
                {guideChannels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name}
                  </option>
                ))}
              </DashboardSelect>
            </DashboardField>
            <DashboardButton
              type="button"
              variant="secondary"
              disabled={
                !channelId ||
                (domainMode === "MANAGED" ? !managedSlug : !hostname) ||
                createDomain.isPending
              }
              onClick={() => createDomain.mutate()}
            >
              {createDomain.isPending
                ? "Adding…"
                : domainMode === "MANAGED"
                  ? "Add SamChe domain"
                  : "Add custom domain"}
            </DashboardButton>
            {domains.data?.length ? (
              domains.data.map((domain) => (
                <div
                  key={domain.id}
                  className="space-y-2 rounded-xl border border-line p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="break-all text-sm font-medium text-stone-200">
                      {domain.hostname}
                    </span>
                    <span className="text-xs text-stone-400">
                      {domain.domain_mode === "MANAGED"
                        ? "SAMCHE MANAGED"
                        : "CUSTOM"}{" "}
                      · {domain.status}
                    </span>
                  </div>
                  {domain.domain_mode === "CUSTOM" ? (
                    <p className="text-xs text-stone-400">
                      DNS: {domain.verification_record_type} →{" "}
                      {domain.verification_target}
                    </p>
                  ) : (
                    <p className="text-xs text-stone-400">
                      Managed ingress; no tenant DNS record is required after
                      platform wildcard setup.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {["PENDING", "FAILED", "VERIFIED"].includes(
                      domain.status,
                    ) ? (
                      <DashboardButton
                        type="button"
                        variant="outline"
                        disabled={verifyDomain.isPending}
                        onClick={() => verifyDomain.mutate(domain.id)}
                      >
                        Verify
                      </DashboardButton>
                    ) : null}
                    {domain.status !== "ARCHIVED" ? (
                      <DashboardButton
                        type="button"
                        variant="outline"
                        onClick={() => setArchiveDomainTarget(domain)}
                      >
                        Archive
                      </DashboardButton>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-stone-400">
                No Guide domain configured yet.
              </p>
            )}
          </section>
        </aside>
      </div>
      <ConfirmationDialog
        open={Boolean(rollbackTarget)}
        title="Restore Guide experience"
        description={
          rollbackTarget
            ? `Make published version ${rollbackTarget.version} public again. This does not change channels, profiles, configurations, providers or models.`
            : ""
        }
        confirmLabel="Restore version"
        isPending={rollback.isPending}
        onCancel={() => setRollbackTarget(null)}
        onConfirm={() => rollbackTarget && rollback.mutate(rollbackTarget.id)}
      />
      <ConfirmationDialog
        open={Boolean(archiveDomainTarget)}
        title="Archive Guide domain"
        description={
          archiveDomainTarget
            ? `Stop serving ${archiveDomainTarget.hostname}. This does not change channels, profiles, configurations, providers or models.`
            : ""
        }
        confirmLabel="Archive domain"
        isPending={archiveDomain.isPending}
        onCancel={() => setArchiveDomainTarget(null)}
        onConfirm={() =>
          archiveDomainTarget && archiveDomain.mutate(archiveDomainTarget.id)
        }
      />
    </section>
  );
}
