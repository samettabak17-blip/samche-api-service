import type { ReactNode } from "react";
import { DashboardButton } from "./dashboard-control";

export type DashboardWorkflowStep = {
  id: string;
  label: string;
  description?: string;
};

export function DashboardWorkflow({ steps, activeStep, onStepChange, children, actions }: { steps: DashboardWorkflowStep[]; activeStep: string; onStepChange: (id: string) => void; children: ReactNode; actions?: ReactNode }) {
  const index = Math.max(0, steps.findIndex((step) => step.id === activeStep));
  return <section className="dashboard-workflow" aria-label="Editing workflow">
    <nav className="dashboard-workflow__steps" aria-label="Workflow steps">
      {steps.map((step, itemIndex) => <DashboardButton key={step.id} type="button" variant={step.id === activeStep ? "selected" : "ghost"} aria-current={step.id === activeStep ? "step" : undefined} onClick={() => onStepChange(step.id)}>{itemIndex + 1}. {step.label}</DashboardButton>)}
    </nav>
    <div className="dashboard-workflow__body">{children}</div>
    <footer className="dashboard-workflow__actions">
      <DashboardButton type="button" variant="outline" disabled={index === 0} onClick={() => onStepChange(steps[index - 1].id)}>Back</DashboardButton>
      {actions}
      <DashboardButton type="button" variant="secondary" disabled={index >= steps.length - 1} onClick={() => onStepChange(steps[index + 1].id)}>Next</DashboardButton>
    </footer>
  </section>;
}
