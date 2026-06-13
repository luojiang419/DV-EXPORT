"use strict";

const path = require("path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const pluginRoot = __dirname;

function createWindow() {
  const window = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1280,
    minHeight: 760,
    title: "达芬奇批量导出",
    backgroundColor: "#1b1d21",
    webPreferences: {
      preload: path.join(pluginRoot, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.removeMenu();
  window.loadFile(path.join(pluginRoot, "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("dv-batch-export:select-output-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择导出目录",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
