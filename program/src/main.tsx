// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Splash } from "./view/Splash.js";
import "./ui.css";

createRoot(document.getElementById("root")!).render(<><App /><Splash /></>);
