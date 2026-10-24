import { describe, expect, it } from "vitest";
import { formattedEmailHtml, insertLink, toggleList, wrapSelection } from "./email-format";

describe("email formatting", () => {
  it("renders bold, italic, links and lists, and escapes everything else", () => {
    const html = formattedEmailHtml(
      "Hi **all**, _see you_ at [our site](https://ea.example.com/a_b?x=1&y=2).\n\n- one\n- two\n1. first\n\n<b>x</b> [bad](javascript:alert(1)) snake_case",
    );
    expect(html).toBe(
      '<p>Hi <strong>all</strong>, <em>see you</em> at <a href="https://ea.example.com/a_b?x=1&amp;y=2" target="_blank" rel="noopener noreferrer" class="underline text-primary">our site</a>.</p>' +
        "<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>" +
        "<p>&lt;b&gt;x&lt;/b&gt; [bad](javascript:alert(1)) snake_case</p>",
    );
  });

  it("toolbar edits wrap the selection, toggle lists and insert links", () => {
    expect(
      wrapSelection({ value: "Hello world", selectionStart: 6, selectionEnd: 11 }, "**", "x"),
    ).toEqual({ value: "Hello **world**", selectionStart: 8, selectionEnd: 13 });
    expect(
      wrapSelection({ value: "Hi ", selectionStart: 3, selectionEnd: 3 }, "_", "italic text").value,
    ).toBe("Hi _italic text_");

    const listed = toggleList(
      { value: "Intro\nApples\nPears", selectionStart: 7, selectionEnd: 15 },
      "numbered",
    );
    expect(listed.value).toBe("Intro\n1. Apples\n2. Pears");
    expect(toggleList({ ...listed }, "numbered").value).toBe("Intro\nApples\nPears");
    expect(
      toggleList({ value: "Apples", selectionStart: 0, selectionEnd: 0 }, "bullet").value,
    ).toBe("- Apples");

    expect(
      insertLink(
        { value: "Sign up here", selectionStart: 8, selectionEnd: 12 },
        "ea.example.com/join",
      )?.value,
    ).toBe("Sign up [here](https://ea.example.com/join)");
    expect(
      insertLink({ value: "", selectionStart: 0, selectionEnd: 0 }, "info@ea.example.com")?.value,
    ).toBe("[info@ea.example.com](mailto:info@ea.example.com)");
    expect(insertLink({ value: "", selectionStart: 0, selectionEnd: 0 }, "  ")).toBeNull();
  });
});
