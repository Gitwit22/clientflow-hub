import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VersionHistory } from "./VersionHistory";

afterEach(cleanup);

const versions = [
  { id: "v5", name: "Version 5" },
  { id: "v4", name: "Version 4" },
  { id: "v3", name: "Version 3" },
];
const renderVersion = (version: { id: string; name: string }) => (
  <p key={version.id}>{version.name}</p>
);

describe("VersionHistory", () => {
  it("shows only the active version until older versions are expanded", () => {
    render(<VersionHistory versions={versions} activeId="v4" renderVersion={renderVersion} />);
    expect(screen.getByText("Version 4")).toBeTruthy();
    expect(screen.queryByText("Version 5")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 older versions" }));
    expect(screen.getByText("Version 5")).toBeTruthy();
    expect(screen.getByText("Version 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide older versions" }));
    expect(screen.queryByText("Version 3")).toBeNull();
  });

  it("shows the newest version when none is active, and no toggle for a single version", () => {
    const { unmount } = render(
      <VersionHistory versions={versions} activeId={null} renderVersion={renderVersion} />,
    );
    expect(screen.getByText("Version 5")).toBeTruthy();
    unmount();
    render(<VersionHistory versions={[versions[0]]} renderVersion={renderVersion} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
