// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// THE EXPLAIN WINDOW (user, 2026-10-15: "Can the Explain dialog be moved out of the program window?" — yes, for a second
// monitor): a small window of its own, floating above the app, moved and resized like any window and onto any screen. The page
// sends it the text of the header the mouse rests on; it is shown without taking the focus, so the app keeps the keyboard. Its
// place is remembered in the user-data folder and checked against the screens connected now — a monitor unplugged since puts it
// back beside the app. Sandboxed, no Node; its preload only receives the text and asks to close.

const { BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT = { width: 420, height: 380 };
let win = null;
let saveTimer = null;

function register(app, getMainWin) {
  const store = () => path.join(app.getPath("userData"), "explain-window.json");
  const readBounds = () => { try { return JSON.parse(fs.readFileSync(store(), "utf8")); } catch { return null; } };
  const saveBounds = () => { if (win && !win.isDestroyed()) try { fs.writeFileSync(store(), JSON.stringify(win.getBounds())); } catch { /* a place, not data */ } };
  const onScreen = (b) => b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
  });
  const besideApp = () => {
    const m = getMainWin();
    const mb = m && !m.isDestroyed() ? m.getBounds() : screen.getPrimaryDisplay().workArea;
    return { ...DEFAULT, x: mb.x + mb.width - DEFAULT.width - 24, y: mb.y + 96 };
  };

  const create = () => {
    const saved = readBounds();
    const b = onScreen(saved) ? saved : besideApp();
    win = new BrowserWindow({
      ...b, minWidth: 260, minHeight: 160, show: false, title: "Explain", backgroundColor: "#12161f",
      alwaysOnTop: true, fullscreenable: false, minimizable: false,
      webPreferences: { preload: path.join(__dirname, "explainPreload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, "floating");
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (ev) => ev.preventDefault());
    const later = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveBounds, 300); };
    win.on("moved", later);
    win.on("resized", later);
    win.on("close", saveBounds);
    win.on("closed", () => { win = null; });
    return win.loadFile(path.join(__dirname, "explain.html"));
  };

  ipcMain.handle("explain:show", async (_ev, title, html) => {
    if (!win || win.isDestroyed()) await create();
    win.webContents.send("explain:content", String(title), String(html));
    if (!win.isVisible()) win.showInactive();
    return { ok: true };
  });
  ipcMain.handle("explain:hide", () => { if (win && !win.isDestroyed()) win.close(); return { ok: true }; });
  ipcMain.on("explain:close", () => { if (win && !win.isDestroyed()) win.close(); });
}

/** the app's window closed: the explain window goes with it, so the app can quit */
function closeWithApp() { if (win && !win.isDestroyed()) win.close(); }

module.exports = { register, closeWithApp };
