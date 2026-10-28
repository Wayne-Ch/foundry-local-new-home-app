import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { ipcChannels, type RunTurnRequest } from "../shared/contracts";
import { DemoController } from "./demo-controller";

let mainWindow: BrowserWindow | null = null;
let shutdownStarted = false;
const controller = new DemoController();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

if (process.env.DEMO_CAPTURE_PATH?.trim()) {
  app.disableHardwareAcceleration();
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: "#07111f",
    title: "Foundry Local New Home Layout Demo",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(currentDirectory, "..", "renderer", "index.html"));
  window.once("ready-to-show", () => {
    window.show();
  });
  if (process.env.DEMO_SMOKE_AND_EXIT === "1") {
    window.webContents.once("did-finish-load", () => {
      setTimeout(() => app.quit(), 5000);
    });
  }
  if (process.env.DEMO_OPEN_DEVTOOLS === "1") {
    window.webContents.openDevTools({ mode: "detach" });
  }

  const capturePath = process.env.DEMO_CAPTURE_PATH?.trim();
  if (capturePath) {
    window.webContents.once("did-finish-load", async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const image = await window.webContents.capturePage();
        await mkdir(path.dirname(capturePath), { recursive: true });
        await writeFile(capturePath, image.toPNG());
        if (process.env.DEMO_CAPTURE_AND_EXIT === "1") {
          app.quit();
        }
      } catch (error) {
        console.error("Failed to capture Electron UI:", error);
        app.exit(1);
      }
    });
  }

  return window;
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.getBootstrap, () => controller.bootstrap());
  ipcMain.handle(ipcChannels.initializeRuntime, () => controller.initializeRuntime());
  ipcMain.handle(ipcChannels.prepareOffline, () =>
    controller.prepareOffline((event) => {
      mainWindow?.webContents.send(ipcChannels.progress, event);
    }),
  );
  ipcMain.handle(ipcChannels.runTurn, (_event, request: RunTurnRequest) =>
    controller.runTurn(request, (progress) => {
      mainWindow?.webContents.send(ipcChannels.progress, progress);
    }),
  );
  ipcMain.handle(ipcChannels.resetConversation, () => controller.reset());
}

registerIpc();

app.whenReady().then(() => {
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownStarted) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  void controller
    .shutdown()
    .catch((error: unknown) => {
      console.error("Failed to shut down Foundry Local cleanly:", error);
    })
    .finally(() => app.quit());
});
