import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DashboardWorkflow } from "./dashboard-workflow";

it("keeps navigation presentation-only and exposes compact Back/Next controls", () => {
  const change = vi.fn();
  render(<DashboardWorkflow steps={[{ id: "identity", label: "Identity" }, { id: "roadmap", label: "Roadmap" }]} activeStep="identity" onStepChange={change}><p>Identity controls</p></DashboardWorkflow>);
  expect(screen.getByText("Identity controls")).toBeVisible();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(change).toHaveBeenCalledWith("roadmap");
});
