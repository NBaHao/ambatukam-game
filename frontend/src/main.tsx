import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account/AccountProvider";
import { App } from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AccountProvider>
        <App />
      </AccountProvider>
    </I18nProvider>
  </StrictMode>,
);
