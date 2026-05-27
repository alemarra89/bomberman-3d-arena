import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const appModule = import.meta.env.MODE === "static" ? import("./StaticApp") : import("./App");

void appModule.then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
});
