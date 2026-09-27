import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import "@wist/ui/fonts.css";
import "@wist/ui/tokens.css";
import "./styles/base.css";

import { App, NotFound } from "./App";
import { captureLaunchToken } from "./data/launch-token";
import { Overview } from "./screens/Overview";
import { SharePreview } from "./screens/SharePreview";

// Before the router reads the URL: take the launch token out of it.
captureLaunchToken();

const router = createBrowserRouter([
  {
    path: "/",
    Component: App,
    children: [
      { index: true, Component: Overview },
      { path: "share", Component: SharePreview },
      { path: "*", Component: NotFound },
    ],
  },
]);

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Dashboard root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
