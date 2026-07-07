import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import AffinePrototype from "./AffinePrototype";
import Dashboard from "./Dashboard";

const routePath = window.location.pathname.replace(/^\/fishCrossTag/, "");
const Root = routePath === "/affine" ? AffinePrototype : routePath === "/dashboard" ? Dashboard : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
