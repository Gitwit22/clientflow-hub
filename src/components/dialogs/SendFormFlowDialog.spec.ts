import { describe, expect, it } from "vitest";
import type { FormTemplate, Program } from "@/types";
import { getAvailableSendForms } from "./SendFormFlowDialog";

const template = (overrides: Partial<FormTemplate>): FormTemplate => ({
  id: "template-1",
  programId: null,
  scope: "program_section",
  name: "Inspired Detroit Initiative",
  description: "Program application",
  fields: [],
  emailTemplate: "",
  dueInDays: 7,
  isActive: true,
  ...overrides,
});

const program = (overrides: Partial<Program>): Program => ({
  id: "program-1",
  name: "Inspired Detroit Initiative",
  description: "",
  isActive: true,
  defaultFormTemplateId: "template-1",
  defaultMonitoringFrequency: "Monthly",
  defaultContractTemplateId: "Service Agreement",
  defaultWorkflow: [],
  requiredDocuments: [],
  statusPipeline: [],
  ...overrides,
});

describe("getAvailableSendForms", () => {
  it("shows an active program through its default form even when programId is missing", () => {
    const choices = getAvailableSendForms(
      [template({ scope: "master_core" })],
      [program({})],
    );

    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      template: { id: "template-1" },
      program: { id: "program-1", name: "Inspired Detroit Initiative" },
    });
  });

  it("omits inactive programs and programs without an active form", () => {
    const choices = getAvailableSendForms(
      [template({ isActive: false })],
      [program({}), program({ id: "program-2", isActive: false })],
    );

    expect(choices).toEqual([]);
  });
});