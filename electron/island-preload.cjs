const { contextBridge, ipcRenderer } = require("electron");
const commands = ["toggleExpanded", "toggleCapture", "toggleVoice", "send", "openChat", "pause", "refreshOmi", "configureOmi", "disconnectOmi", "stop", "spoken", "saveToOmi", "dictate", "enableComputer"];
contextBridge.exposeInMainWorld("island", Object.fromEntries(commands.map(command => [command,
  (...args) => ipcRenderer.send("island:command", command, ...args),
])));
