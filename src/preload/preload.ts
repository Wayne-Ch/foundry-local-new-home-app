import { contextBridge, ipcRenderer } from "electron";
import type { RuntimeReadiness } from "../domain/types";
import {
  type BootstrapPayload,
  type DemoApi,
  ipcChannels,
  type PrepareOfflineResponse,
  type ProgressEvent,
  type RunTurnRequest,
  type RunTurnResponse,
} from "../shared/contracts";

const api: DemoApi = {
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.getBootstrap) as Promise<BootstrapPayload>,
  initializeRuntime: () => ipcRenderer.invoke(ipcChannels.initializeRuntime) as Promise<RuntimeReadiness>,
  prepareOffline: () => ipcRenderer.invoke(ipcChannels.prepareOffline) as Promise<PrepareOfflineResponse>,
  runTurn: (request: RunTurnRequest) =>
    ipcRenderer.invoke(ipcChannels.runTurn, request) as Promise<RunTurnResponse>,
  resetConversation: () => ipcRenderer.invoke(ipcChannels.resetConversation) as Promise<BootstrapPayload>,
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ProgressEvent) => {
      callback(progress);
    };
    ipcRenderer.on(ipcChannels.progress, listener);
    return () => ipcRenderer.removeListener(ipcChannels.progress, listener);
  },
};

contextBridge.exposeInMainWorld("demoApi", api);
