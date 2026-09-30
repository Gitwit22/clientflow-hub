import { describe, expect, it } from "vitest";
import type { PublicFormField } from "@/lib/apiClient";
import { requiredProgress } from "./PublicFieldInput";

const field = (id: string, required: boolean, type = "text") =>
  ({ id, label: id, type, required }) as PublicFormField;

describe("requiredProgress", () => {
  const sections = [
    {
      fields: [
        field("name", true),
        field("email", true),
        field("notes", false),
        field("website", false),
      ],
    },
    {
      fields: [
        field("agree", true, "checkbox"),
        field("upload", true, "file"),
        field("extra", false),
      ],
    },
  ];

  it("counts only required fields, so it can never exceed the total (no '7 of 3')", () => {
    const answers: Record<string, unknown> = { name: "Pat", notes: "", website: "", extra: "" };
    const progress = requiredProgress(sections, (_index, id) => answers[id] as never);
    // name, email, agree are required (file uploads aren't); only name is answered.
    expect(progress).toEqual({ completed: 1, required: 3, percent: 33 });
  });

  it("reaches 100% when every required field is answered", () => {
    const answers: Record<string, unknown> = { name: "Pat", email: "p@x.com", agree: true };
    expect(requiredProgress(sections, (_index, id) => answers[id] as never)).toEqual({
      completed: 3,
      required: 3,
      percent: 100,
    });
  });

  it("is complete when nothing is required", () => {
    expect(requiredProgress([{ fields: [field("notes", false)] }], () => undefined)).toEqual({
      completed: 0,
      required: 0,
      percent: 100,
    });
  });
});
