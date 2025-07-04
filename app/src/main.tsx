import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { WalletProvider } from "./contexts/WalletContext.tsx";

import { Buffer } from "buffer";

if (typeof globalThis !== "undefined") {
  globalThis.Buffer = Buffer;
}

if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
}

if (typeof global !== "undefined") {
  (global as any).Buffer = Buffer;
}

if (Buffer && !Buffer.isBuffer) {
  Buffer.isBuffer = (obj: any): obj is Buffer => {
    return obj && typeof obj === "object" && obj.constructor === Buffer;
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>
);
