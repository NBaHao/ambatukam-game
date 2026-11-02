import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountProvider } from "./account/AccountProvider";
import { App } from "./App";
import { FriendsProvider } from "./friends/FriendsProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AccountProvider>
        <FriendsProvider>
          <App />
        </FriendsProvider>
      </AccountProvider>
    </I18nProvider>
  </StrictMode>,
);
