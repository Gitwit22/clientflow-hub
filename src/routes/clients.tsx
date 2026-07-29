import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
export const Route = createFileRoute("/clients")({ component: () => <Outlet /> });
