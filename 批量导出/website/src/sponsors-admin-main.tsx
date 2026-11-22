import React from "react";
import ReactDOM from "react-dom/client";
import { SponsorAdminPage } from "./pages/SponsorAdminPage";
import "./styles.css";
import "./sponsors.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SponsorAdminPage />
  </React.StrictMode>
);
