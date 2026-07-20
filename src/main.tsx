import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import AffinePrototype from "./AffinePrototype";
import Dashboard from "./Dashboard";
import EmbedParentDemo from "./EmbedParentDemo";
import EmbedTagger from "./EmbedTagger";
import ParentDemo from "./ParentDemo";
import TaggerSession from "./TaggerSession";

const routePath = window.location.pathname.replace(/^\/fishCrossTag/, "");
const Root =
  routePath === "/affine"
    ? AffinePrototype
    : routePath === "/dashboard"
      ? Dashboard
      : routePath === "/parent-demo"
        ? ParentDemo
        : routePath === "/embed-parent-demo"
          ? EmbedParentDemo
          : routePath === "/embed"
            ? EmbedTagger
            : routePath.startsWith("/s/")
              ? TaggerSession
              : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
