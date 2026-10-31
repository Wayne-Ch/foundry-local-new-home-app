import { contextBridge, ipcRenderer } from "electron";
import type {
  AudioCapturePayload,
  AudioPartialTranscriptEvent,
  AudioStreamCancelRequest,
  AudioStreamChunkRequest,
  AudioStreamChunkResponse,
  AudioStreamFinishRequest,
  AudioStreamStartRequest,
  AudioStreamStartResponse,
  PrepareAudioRequest,
} from "../audio/audio-types";
import type { ManualPlacementRequest } from "../domain/manual-placement";
import type { RuntimeReadiness } from "../domain/types";
import {
  type AudioTranscriptionResponse,
  type BootstrapPayload,
  type DemoApi,
  ipcChannels,
  type ManualPlacementResponse,
  type MicrophoneAuthorizationRequest,
  type PrepareAudioResponse,
  type PrepareOfflineResponse,
  type ProgressEvent,
  type RunTurnRequest,
  type RunTurnResponse,
} from "../shared/contracts";

const api: DemoApi = {
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.getBootstrap) as Promise<BootstrapPayload>,
  initializeRuntime: () => ipcRenderer.invoke(ipcChannels.initializeRuntime) as Promise<RuntimeReadiness>,
  prepareOffline: () => ipcRenderer.invoke(ipcChannels.prepareOffline) as Promise<PrepareOfflineResponse>,
  prepareAudio: (request: PrepareAudioRequest) =>
    ipcRenderer.invoke(ipcChannels.prepareAudio, request) as Promise<PrepareAudioResponse>,
  authorizeMicrophone: () => {
    const request: MicrophoneAuthorizationRequest = {
      hasTransientUserActivation: navigator.userActivation.isActive,
    };
    return ipcRenderer.invoke(ipcChannels.authorizeMicrophone, request) as Promise<void>;
  },
  transcribeAudio: (request: AudioCapturePayload) =>
    ipcRenderer.invoke(ipcChannels.transcribeAudio, request) as Promise<AudioTranscriptionResponse>,
  startAudioStream: (request: AudioStreamStartRequest) =>
    ipcRenderer.invoke(ipcChannels.startAudioStream, request) as Promise<AudioStreamStartResponse>,
  appendAudioChunk: (request: AudioStreamChunkRequest) =>
    ipcRenderer.invoke(ipcChannels.appendAudioChunk, request) as Promise<AudioStreamChunkResponse>,
  finishAudioStream: (request: AudioStreamFinishRequest) =>
    ipcRenderer.invoke(ipcChannels.finishAudioStream, request) as Promise<AudioTranscriptionResponse>,
  cancelAudioStream: (request: AudioStreamCancelRequest) =>
    ipcRenderer.invoke(ipcChannels.cancelAudioStream, request) as Promise<void>,
  runTurn: (request: RunTurnRequest) =>
    ipcRenderer.invoke(ipcChannels.runTurn, request) as Promise<RunTurnResponse>,
  applyManualPlacement: (request: ManualPlacementRequest) =>
    ipcRenderer.invoke(ipcChannels.applyManualPlacement, request) as Promise<ManualPlacementResponse>,
  resetConversation: () => ipcRenderer.invoke(ipcChannels.resetConversation) as Promise<BootstrapPayload>,
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ProgressEvent) => {
      callback(progress);
    };
    ipcRenderer.on(ipcChannels.progress, listener);
    return () => ipcRenderer.removeListener(ipcChannels.progress, listener);
  },
  onAudioPartial: (callback: (event: AudioPartialTranscriptEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, partial: AudioPartialTranscriptEvent) => {
      callback(partial);
    };
    ipcRenderer.on(ipcChannels.audioPartial, listener);
    return () => ipcRenderer.removeListener(ipcChannels.audioPartial, listener);
  },
};

contextBridge.exposeInMainWorld("demoApi", api);
