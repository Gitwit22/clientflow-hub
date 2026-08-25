import { createFileRoute } from "@tanstack/react-router";
import { ProgramsPage } from "./programs";

export const Route = createFileRoute("/programs/")({
  component: ProgramsPage,
});