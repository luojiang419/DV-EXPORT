import React from "react";
import ReactDOM from "react-dom/client";
import { SponsorPage } from "./pages/SponsorPage";
import "./styles.css";
import "./sponsors.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SponsorPage />
  </React.StrictMode>
);
