import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FBSQuoteScoper from "./FBSQuoteScoper.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <FBSQuoteScoper />
  </StrictMode>
);
