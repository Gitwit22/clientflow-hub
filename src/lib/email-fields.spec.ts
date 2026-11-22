import { describe, expect, it } from "vitest";
import {
  CLIENT_EMAIL_FIELDS,
  WELCOME_EMAIL_FIELDS,
  blastFieldProblem,
  fillWithSamples,
  insertField,
  unknownEmailFields,
} from "./email-fields";

describe("email fields", () => {
  it("inserts a field in place of the selection with the cursor after it", () => {
    expect(
      insertField({ value: "Hi there!", selectionStart: 3, selectionEnd: 8 }, "client.firstName"),
    ).toEqual({
      value: "Hi {{client.firstName}}!",
      selectionStart: 23,
      selectionEnd: 23,
    });
    expect(
      insertField({ value: "", selectionStart: 0, selectionEnd: 0 }, "program.name").value,
    ).toBe("{{program.name}}");
  });

  it("finds fields that can't be filled in, each once, and accepts the older short names", () => {
    expect(
      unknownEmailFields(
        "Hi {{client.name}} {{ client.name }} {{client.firstName}} {{businessName}}",
        CLIENT_EMAIL_FIELDS,
      ),
    ).toEqual(["client.name"]);
    // The assigned staff member is for automatic emails only.
    expect(unknownEmailFields("From {{staff.name}}", CLIENT_EMAIL_FIELDS)).toEqual(["staff.name"]);
    expect(
      unknownEmailFields(
        "Since {{enrollment.startDate}}, {{client.fullName}}",
        WELCOME_EMAIL_FIELDS,
        "welcome",
      ),
    ).toEqual([]);
    expect(blastFieldProblem("S", "plain text")).toBeNull();
    expect(blastFieldProblem("{{a}}", "{{b}}")).toBe(
      `{{a}}, {{b}} aren't fields ClientFlow can fill in. Use "Insert field" to pick them.`,
    );
  });

  it("fills sample details for previews and leaves unknown fields visible", () => {
    expect(
      fillWithSamples(
        "Hi {{client.firstName}} of {{client.businessName}} {{x}}",
        CLIENT_EMAIL_FIELDS,
        { "client.firstName": "Ann" },
      ),
    ).toBe("Hi Ann of Rivers Bakery LLC {{x}}");
  });
});
