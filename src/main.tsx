import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import AffinePrototype from "./AffinePrototype";

const routePath = window.location.pathname.replace(/^\/fishCrossTag/, "");
const Root = routePath === "/affine" ? AffinePrototype : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
