// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// The explain window's preload: it puts the text the app sends into the page (the page itself runs no script) and asks to close
// on its Close button or Esc. The HTML is the app's own, built from explain.md with every character of the file escaped.
const { ipcRenderer } = require("electron");

ipcRenderer.on("explain:content", (_ev, title, html) => {
  const put = () => {
    document.getElementById("title").textContent = title;
    document.title = `Explain · ${title}`;   // the window's title bar reads the page's title
    document.getElementById("body").innerHTML = html;
    document.getElementById("body").scrollTop = 0;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put, { once: true }); else put();
});
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("close").addEventListener("click", () => ipcRenderer.send("explain:close"));
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape") ipcRenderer.send("explain:close"); });
