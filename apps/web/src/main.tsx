import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { applyTheme, readTheme } from "./theme.js";
import "./styles.css";
// 像素风皮肤叠在 styles.css 上面；白天版由 day-theme.ts 接在它后面生成，theme-day.css 是手调的部分。
import "./guandan-pixel.css";
import "./theme-day.css";

applyTheme(readTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
