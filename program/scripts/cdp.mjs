// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
// THE RENDERER AS AN INSTRUMENT (2026-09-05): start the app with
//   npx vite & env -u ELECTRON_RUN_AS_NODE npx electron . --remote-debugging-port=9222   (another port: CDP_PORT=9223 node scripts/cdp.mjs …)
// then evaluate expressions in the running renderer:
//   node scripts/cdp.mjs 'window.__BIM__.open("/path/to/building.ifc").then(() => "loaded")' 'JSON.stringify(window.__BIM__.census().db)'
// Exceptions and console errors raised meanwhile are printed. Pixels stay the user's QC;
// this reads the scene graph the pixels come from.
// drive the running Electron renderer over the DevTools protocol: evaluate the expressions given on argv
const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json`)).json();
const page = targets.find((t) => t.type === "page" && /localhost:5190|index\.html/.test(t.url)) ?? targets.find((t) => t.type === "page" && !/devtools/.test(t.url));   // the app before the in-app browser window (2026-09-16)
if (!page) { console.log("no page target", targets.map((t) => t.url)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const prev = ws.onmessage;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === "Runtime.exceptionThrown") console.log("  !! exception:", (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 900)); else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) console.log(`  !! console.${m.params.type}:`, m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300)); else prev(ev); };
await send("Runtime.enable");
// A CONFIRM DIALOG IS ACCEPTED (2026-09-08): window.confirm blocks the renderer; the message is printed and the dialog accepted, so a flow behind one (remove a material, delete elements) can be driven
await send("Page.enable");
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.method === "Page.javascriptDialogOpening") { console.log(`  [dialog ${m.params.type}] ${m.params.message.slice(0, 200).replace(/\n/g, " ")} → accepted`); send("Page.handleJavaScriptDialog", { accept: true }); } });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.result?.exceptionDetails ? `EXC ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}` : JSON.stringify(r.result?.result?.value);
};
// REAL INPUT (2026-09-07): `!right:x,y` / `!left:x,y` send the browser's own mouse events
// through Input.dispatchMouseEvent, so a right-click reaches a row the way a hand's does —
// a synthetic MouseEvent dispatched from script never opened the context menu
const click = async (button, x, y) => {
  const base = { x, y, button, clickCount: 1, buttons: button === "right" ? 2 : 1 };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
};
// THE CAMERA GESTURES (2026-09-08): `!wheel:x,y,dy` turns the wheel over a point, `!drag:x0,y0,x1,y1[,right]`
// presses, moves in ten steps and releases, `!sleep:ms` lets a camera transition finish before the census reads it
const wheel = async (x, y, dy) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });
};
const drag = async (x0, y0, x1, y1, button = "left") => {
  const buttons = button === "right" ? 2 : 1;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button, buttons, clickCount: 1 });
  for (let i = 1; i <= 10; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10, button, buttons });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button, buttons: 0, clickCount: 1 });
};
// `!click:<expression>` (2026-09-08): the expression names an ELEMENT; it is scrolled into view and clicked with a real mouse
// event at its centre — a row found by its text, a button by its label — so a flow needs no coordinates read by hand.
// `@<file>` reads an expression from a file, past the shell's quoting
const clickElement = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(() => { const el = (${expression}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, text: (el.innerText ?? "").slice(0, 80) }; })()`, returnByValue: true });
  const v = r.result?.result?.value;
  if (!v) { console.log("  no element for", expression.slice(0, 100)); return; }
  await click("left", v.x, v.y);
  console.log(`  clicked at ${v.x.toFixed(0)},${v.y.toFixed(0)}: ${v.text.replace(/\s+/g, " ")}`);
};
// `!dblclick:<expression>` (2026-09-13): the browser's own double click at an element's centre — the calendar's zoom out
const dblclickElement = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(() => { const el = (${expression}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, text: (el.innerText ?? "").slice(0, 80) }; })()`, returnByValue: true });
  const v = r.result?.result?.value;
  if (!v) { console.log("  no element for", expression.slice(0, 100)); return; }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: v.x, y: v.y });
  for (const clickCount of [1, 2]) { const base = { x: v.x, y: v.y, button: "left", clickCount, buttons: 1 }; await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base }); }
  console.log(`  double-clicked at ${v.x.toFixed(0)},${v.y.toFixed(0)}: ${v.text.replace(/\s+/g, " ")}`);
};
for (let expr of process.argv.slice(2)) {
  // `@<file>` reads an expression from a file, past the shell's quoting — bare, or after a command's colon (`!rightat:@/tmp/pt.js`)
  if (expr.startsWith("@")) expr = (await import("node:fs")).readFileSync(expr.slice(1), "utf8");
  else if (/^![a-z]+(?::-?[\d.]+,-?[\d.]+)?:@\//.test(expr)) { const fs = await import("node:fs"); expr = expr.replace(/:@(\/\S+)$/, (_m, f) => ":" + fs.readFileSync(f, "utf8")); }
  const dc = /^!dblclick:([\s\S]+)$/.exec(expr);
  if (dc) { console.log(`> ${expr.slice(0, 110)}`); await dblclickElement(dc[1]); continue; }
  const c = /^!click:([\s\S]+)$/.exec(expr);
  if (c) { console.log(`> ${expr.slice(0, 110)}`); await clickElement(c[1]); continue; }
  // `!dragel:dx,dy:<expression>` (2026-09-10): a drag that STARTS at an element's centre and moves by (dx, dy) — a joint on a
  // line, a node's title — so a flow that reshapes the sheet needs no coordinates predicted by hand
  const de = /^!dragel:(-?[\d.]+),(-?[\d.]+):([\s\S]+)$/.exec(expr);
  if (de) {
    const r = await send("Runtime.evaluate", { expression: `(() => { const el = (${de[3]}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`, returnByValue: true });
    const v = r.result?.result?.value;
    console.log(`> ${expr.slice(0, 110)}`);
    if (!v) { console.log("  no element for", de[3].slice(0, 100)); continue; }
    await drag(v.x, v.y, v.x + Number(de[1]), v.y + Number(de[2]));
    console.log(`  dragged from ${v.x.toFixed(0)},${v.y.toFixed(0)} by ${de[1]},${de[2]}`);
    continue;
  }
  // `!leftat:<expression>` / `!rightat:<expression>` (2026-09-10): the expression yields a screen point {x, y} or [x, y] — a
  // point ON a line computed from its own path, where no element has a useful centre
  const at = /^!(leftat|rightat):([\s\S]+)$/.exec(expr);
  if (at) {
    const r = await send("Runtime.evaluate", { expression: `(() => { const v = (${at[2]}); return Array.isArray(v) ? { x: v[0], y: v[1] } : v; })()`, returnByValue: true });
    const v = r.result?.result?.value;
    console.log(`> ${expr.slice(0, 110)}`);
    if (!v || typeof v.x !== "number") { console.log("  no point from", at[2].slice(0, 100)); continue; }
    await click(at[1] === "rightat" ? "right" : "left", v.x, v.y);
    console.log(`  ${at[1]} at ${v.x.toFixed(0)},${v.y.toFixed(0)}`);
    continue;
  }
  const m = /^!(right|left):([\d.]+),([\d.]+)$/.exec(expr);
  if (m) { await click(m[1], Number(m[2]), Number(m[3])); console.log(`> ${expr}`); console.log("clicked"); continue; }
  const w = /^!wheel:([\d.]+),([\d.]+),(-?[\d.]+)$/.exec(expr);
  if (w) { await wheel(Number(w[1]), Number(w[2]), Number(w[3])); console.log(`> ${expr}`); continue; }
  const d = /^!drag:([\d.]+),([\d.]+),([\d.]+),([\d.]+)(?:,(right|left))?$/.exec(expr);
  if (d) { await drag(Number(d[1]), Number(d[2]), Number(d[3]), Number(d[4]), d[5] ?? "left"); console.log(`> ${expr}`); continue; }
  // `!shot:<path>` (2026-09-09): the window's pixels to a PNG — what the user sees, read when a thing is said to be missing
  const sh = /^!shot:(.+)$/.exec(expr);
  if (sh) { const r = await send("Page.captureScreenshot", { format: "png" }); const { writeFileSync } = await import("node:fs"); writeFileSync(sh[1], Buffer.from(r.result.data, "base64")); console.log(`> ${expr}\n  written`); continue; }
  if (expr === "!reload") { await send("Page.reload", {}); console.log("> !reload"); continue; }   // the renderer reloaded (2026-09-10): what survives it is the journal's
  const z = /^!sleep:(\d+)$/.exec(expr);
  if (z) { await new Promise((r) => setTimeout(r, Number(z[1]))); continue; }
  console.log(`> ${expr.slice(0, 110)}`);
  console.log(await evaluate(expr));
}
ws.close();
