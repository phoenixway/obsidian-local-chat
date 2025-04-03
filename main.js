/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/

var O=Object.create;var v=Object.defineProperty;var T=Object.getOwnPropertyDescriptor;var x=Object.getOwnPropertyNames;var U=Object.getPrototypeOf,D=Object.prototype.hasOwnProperty;var A=(g,n)=>()=>(n||g((n={exports:{}}).exports,n),n.exports),P=(g,n)=>{for(var e in n)v(g,e,{get:n[e],enumerable:!0})},W=(g,n,e,t)=>{if(n&&typeof n=="object"||typeof n=="function")for(let s of x(n))!D.call(g,s)&&s!==e&&v(g,s,{get:()=>n[s],enumerable:!(t=T(n,s))||t.enumerable});return g};var B=(g,n,e)=>(e=g!=null?O(U(g)):{},W(n||!g||!g.__esModule?v(e,"default",{value:g,enumerable:!0}):e,g)),V=g=>W(v({},"__esModule",{value:!0}),g);var E=A((q,F)=>{"use strict";F.exports=function(){throw new Error("ws does not work in the browser. Browser clients must use the native WebSocket object")}});var _={};P(_,{default:()=>y});module.exports=V(_);var c=require("obsidian");var u=require("obsidian"),p="local-chat-view",k=class extends u.ItemView{constructor(e,t){super(e);this.knownUsers=new Map;this.plugin=t}getViewType(){return p}getDisplayText(){return"Local Chat"}getIcon(){return"message-circle"}async onOpen(){let e=this.containerEl.children[1];if(!e)return;e.empty(),e.addClass("local-chat-view-container");let t=e.createDiv({cls:"chat-sidebar"});t.createEl("h5",{text:"Online:",cls:"chat-user-list-header"}),this.userListEl=t.createDiv({cls:"chat-user-list"});let s=e.createDiv({cls:"chat-main-area"});this.messageContainerEl=s.createDiv({cls:"chat-message-area"}),this.messageContainerEl.id="chat-message-area-id";let i=s.createDiv({cls:"chat-input-area"});this.inputEl=i.createEl("input",{type:"text",placeholder:"Enter message...",cls:"chat-input"}),this.sendButtonEl=i.createEl("button",{cls:"chat-send-button",attr:{"aria-label":"Send"}}),(0,u.setIcon)(this.sendButtonEl,"send-horizontal"),this.fileButtonEl=i.createEl("button",{cls:"chat-file-button",attr:{"aria-label":"Send File"}}),(0,u.setIcon)(this.fileButtonEl,"paperclip"),this.inputEl.addEventListener("keydown",a=>{a.key==="Enter"&&!a.shiftKey&&(a.preventDefault(),this.handleSendMessage())}),this.sendButtonEl.addEventListener("click",this.handleSendMessage.bind(this)),this.fileButtonEl.onClickEvent(this.handleSendFileClick.bind(this)),console.log(`[${this.plugin.manifest.name}] ChatView opened`),this.inputEl.focus()}async onClose(){console.log(`[${this.plugin.manifest.name}] ChatView closed`)}handleSendMessage(){let e=this.inputEl.value.trim();if(!e)return;let t=null;this.plugin.sendMessage(t,e),this.inputEl.value="",this.inputEl.focus()}handleSendFileClick(){let e=createEl("input",{type:"file"});e.onchange=async()=>{if(!e.files||e.files.length===0)return;let t=null;for(let s=0;s<e.files.length;s++){let i=e.files[s];await this.plugin.initiateSendFile(i,t)}e.value=""},e.click()}displayMessage(e,t,s,i){if(!this.messageContainerEl)return;let a=this.messageContainerEl.createDiv({cls:`chat-message ${i?"own-message":"other-message"}`}),r=a.createDiv({cls:"message-header"});r.createSpan({cls:"message-sender",text:i?"You":e}),r.createSpan({cls:"message-timestamp",text:new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})});let o=t.replace(/</g,"&lt;").replace(/>/g,"&gt;");a.createDiv({cls:"message-content"}).innerHTML=o,this.scrollToBottom()}addUserToList(e){if(!this.userListEl){console.error("addUserToList: userListEl is not defined!");return}if(this.knownUsers.has(e.nickname)){let i=this.knownUsers.get(e.nickname);i!=null&&i.element&&(i.element.addClass("user-online"),i.element.removeClass("user-offline"));return}let t=this.userListEl.createDiv({cls:"chat-user-list-item user-online",attr:{"data-nickname":e.nickname}}),s=t.createSpan({cls:"user-icon"});(0,u.setIcon)(s,"user"),t.createSpan({cls:"user-nickname",text:e.nickname}),this.knownUsers.set(e.nickname,{nickname:e.nickname,element:t})}removeUserFromList(e){var s;let t=this.knownUsers.get(e);(s=t==null?void 0:t.element)==null||s.remove(),this.knownUsers.delete(e)&&console.log(`[${this.plugin.manifest.name}] Removed user '${e}' from UI list.`)}clearUserList(){this.userListEl&&this.userListEl.empty(),this.knownUsers.clear(),console.log(`[${this.plugin.manifest.name}] Cleared user list in UI.`)}displayFileOffer(e,t){if(!this.messageContainerEl)return;let s=this.messageContainerEl.createDiv({cls:"chat-message file-offer",attr:{"data-file-id":t.fileId}}),i=s.createDiv({cls:"message-header"});i.createSpan({cls:"message-sender",text:e}),i.createSpan({cls:"message-timestamp",text:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})});let a=s.createDiv({cls:"message-content"});a.setText(`${e} offers to send file: `),a.createEl("strong",{text:t.filename}),a.createSpan({text:` (${this.formatFileSize(t.size)})`});let r=s.createDiv({cls:"file-offer-actions"});r.createEl("button",{text:"Accept"}).addEventListener("click",()=>{this.plugin.acceptFileOffer(e,t.fileId),this.updateFileProgress(t.fileId,"download",0,t.size,"accepted")}),r.createEl("button",{text:"Decline",cls:"mod-danger"}).addEventListener("click",()=>{this.plugin.declineFileOffer(e,t.fileId),this.updateFileProgress(t.fileId,"download",0,t.size,"declined")}),this.scrollToBottom()}updateFileProgress(e,t,s,i,a){var m;if(!this.messageContainerEl)return;let r=this.messageContainerEl.querySelector(`.chat-message[data-file-id="${e}"]`);if(!r){(t!=="upload"||a!=="starting")&&console.warn(`Could not find message element for file transfer ${e} to update progress (Status: ${a}).`);return}let o=r.querySelector(".file-progress-container");o||(o=r.createDiv({cls:"file-progress-container"}),(m=r.querySelector(".file-offer-actions"))==null||m.empty()),o.empty();let l=i>0?Math.round(s/i*100):a==="completed"?100:0,d=o.createEl("progress");d.max=i,d.value=s;let h=o.createSpan({cls:"progress-text"});switch(r.removeClass("transfer-completed","transfer-error","offer-accepted","offer-declined"),a){case"waiting_accept":h.setText(" Waiting for acceptance..."),d.remove();break;case"starting":h.setText(t==="download"?" Download starting... 0%":" Upload starting... 0%");break;case"progressing":h.setText(` ${l}% (${this.formatFileSize(s)} / ${this.formatFileSize(i)})`);break;case"completed":d.remove();let S=t==="download"?"Received successfully.":"Sent successfully.";h.setText(` ${S} (${this.formatFileSize(i)})`),r.addClass("transfer-completed");break;case"error":d.remove(),h.setText(" Transfer Error."),h.addClass("progress-error"),r.addClass("transfer-error");break;case"accepted":h.setText(" Accepted. Waiting for data..."),r.addClass("offer-accepted");break;case"declined":d.remove(),h.setText(" Declined."),r.addClass("offer-declined");break}this.scrollToBottom()}displayUploadProgress(e){if(!this.messageContainerEl)return;let t=this.messageContainerEl.createDiv({cls:"chat-message own-message file-upload",attr:{"data-file-id":e.fileId}}),s=t.createDiv({cls:"message-header"});s.createSpan({cls:"message-sender",text:"You"}),s.createSpan({cls:"message-timestamp",text:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})});let i=t.createDiv({cls:"message-content"});i.setText("Sending file: "),i.createEl("strong",{text:e.filename}),i.createSpan({text:` (${this.formatFileSize(e.size)})`}),e.recipientNickname&&i.createSpan({text:` to ${e.recipientNickname}`}),t.createDiv({cls:"file-progress-container"}),this.updateFileProgress(e.fileId,"upload",0,e.size,"waiting_accept"),this.scrollToBottom()}formatFileSize(e,t=2){if(e===0)return"0 Bytes";let s=1024,i=t<0?0:t,a=["Bytes","KB","MB","GB","TB","PB"],r=Math.floor(Math.log(e)/Math.log(s));return parseFloat((e/Math.pow(s,r)).toFixed(i))+" "+a[r]}scrollToBottom(){this.messageContainerEl&&setTimeout(()=>{this.messageContainerEl.scrollTop=this.messageContainerEl.scrollHeight},50)}};var w=B(E()),b=class{constructor(n,e,t,s){this.wss=null;this.clients=new Map;this.clientsByNickname=new Map;this.port=n,this.serverNickname=e,this.callbacks=t,this.WSServerConstructor=s,console.log(`[WSServer] Initialized for server nickname: ${this.serverNickname}`)}start(){return new Promise((n,e)=>{if(this.wss){console.warn("[WSServer] Server already started."),n();return}try{console.log(`[WSServer] Starting server on port ${this.port}...`),this.wss=new this.WSServerConstructor({port:this.port}),this.wss.on("listening",()=>{console.log(`[WSServer] Successfully listening on port ${this.port}.`),n()}),this.wss.on("error",t=>{console.error("[WSServer] Server error:",t),this.callbacks.onError(t),this.wss=null,e(t)}),this.wss.on("connection",t=>{this._handleConnection(t)})}catch(t){console.error("[WSServer] Failed to create WebSocketServer:",t),this.callbacks.onError(t),e(t)}})}async stop(){return new Promise(n=>{if(!this.wss){n();return}console.log("[WSServer] Stopping server..."),this.clients.forEach(e=>{e.ws.terminate()}),this.clients.clear(),this.clientsByNickname.clear(),this.wss.close(e=>{e?(console.error("[WSServer] Error closing server:",e),this.callbacks.onError(e)):console.log("[WSServer] Server closed successfully."),this.wss=null,n()})})}_handleConnection(n){let e=`client_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;console.log(`[WSServer] Client connected with temporary ID: ${e}. Waiting for identification.`);let t={id:e,nickname:"",ws:n};this.clients.set(n,t),n.on("message",s=>{this._handleMessage(n,s)}),n.on("close",(s,i)=>{console.log(`[WSServer] Client connection closed. Code: ${s}, Reason: ${i.toString()}`),this._handleCloseOrError(n)}),n.on("error",s=>{console.error(`[WSServer] WebSocket error for client ${t.nickname||t.id}:`,s),this._handleCloseOrError(n,s)})}_handleMessage(n,e){let t=this.clients.get(n);if(!t){console.warn("[WSServer] Message from unknown client socket.");return}let s;try{s=JSON.parse(e.toString("utf-8"))}catch(i){console.warn(`[WSServer] Received non-JSON message from ${t.nickname||t.id}:`,e),n.send(JSON.stringify({type:"error",message:"Invalid message format (not JSON)."}));return}if(!t.nickname){if(s.type==="identify"){let i=s;if(i.nickname&&typeof i.nickname=="string"){let a=i.nickname.trim();if(!a){console.warn(`[WSServer] Received 'identify' with empty nickname from ${t.id}. Disconnecting.`),n.send(JSON.stringify({type:"error",message:"Nickname cannot be empty."})),n.terminate(),this.clients.delete(n);return}if(this.clientsByNickname.has(a)){console.warn(`[WSServer] Nickname '${a}' already taken. Disconnecting client ${t.id}.`),n.send(JSON.stringify({type:"error",message:"Nickname already taken."})),n.terminate(),this.clients.delete(n);return}t.nickname=a,this.clientsByNickname.set(t.nickname,n),console.log(`[WSServer] Client identified: ID=${t.id}, Nickname='${t.nickname}'`),this.callbacks.onClientConnected(t.id,t.nickname)}else console.warn(`[WSServer] Received invalid 'identify' message (missing/invalid nickname) from ${t.id}. Disconnecting.`),n.send(JSON.stringify({type:"error",message:"Invalid identification payload (missing nickname)."})),n.terminate(),this.clients.delete(n)}else console.warn(`[WSServer] Received invalid first message type '${s.type}' from ${t.id}. Disconnecting.`),n.send(JSON.stringify({type:"error",message:"Identification required as first message."})),n.terminate(),this.clients.delete(n);return}s.senderNickname||(s.senderNickname=t.nickname),this.callbacks.onMessage(t.id,t.nickname,s)}_handleCloseOrError(n,e){let t=this.clients.get(n);t&&(this.clients.delete(n),t.nickname?(this.clientsByNickname.delete(t.nickname),console.log(`[WSServer] Client '${t.nickname}' (ID: ${t.id}) disconnected.`),this.callbacks.onClientDisconnected(t.id,t.nickname)):console.log(`[WSServer] Unidentified client (ID: ${t.id}) disconnected.`))}broadcast(n,e){let t=JSON.stringify(e);this.clients.forEach(s=>{if(s.ws.readyState===w.WebSocket.OPEN&&s.id!==n)try{s.ws.send(t)}catch(i){console.error(`[WSServer] Failed to broadcast to ${s.nickname||s.id}:`,i)}})}sendToClient(n,e){let t=null;for(let[s,i]of this.clients.entries())if(i.id===n){t=s;break}if(t&&t.readyState===w.WebSocket.OPEN)try{return t.send(JSON.stringify(e)),!0}catch(s){return console.error(`[WSServer] Failed to send message to client ID ${n}:`,s),this._handleCloseOrError(t,s),!1}return!1}sendToClientByNickname(n,e){let t=this.clientsByNickname.get(n);if(t&&t.readyState===w.WebSocket.OPEN)try{return t.send(JSON.stringify(e)),!0}catch(s){return console.error(`[WSServer] Failed to send message to client '${n}':`,s),this._handleCloseOrError(t,s),!1}return console.warn(`[WSServer] Client with nickname '${n}' not found for sending message.`),!1}findClientIdByNickname(n){var t;let e=this.clientsByNickname.get(n);return e&&((t=this.clients.get(e))==null?void 0:t.id)||null}handleLocalMessage(n,e){n.senderNickname!==this.serverNickname&&(console.warn(`[WSServer] handleLocalMessage: Payload sender '${n.senderNickname}' differs from server nickname '${this.serverNickname}'. Correcting.`),n.senderNickname=this.serverNickname),console.log(`[WSServer] Handling local message (Type: ${n.type}, To: ${e!=null?e:"broadcast"})`),this.callbacks.onMessage("local_server",this.serverNickname,n),e===null?(console.log(`[WSServer] Broadcasting local message type ${n.type}`),this.broadcast(null,n)):e===this.serverNickname?console.log(`[WSServer] Local message addressed to self (${e}), already handled.`):(console.log(`[WSServer] Sending local message privately to ${e}`),this.sendToClientByNickname(e,n)||console.warn(`[WSServer] Failed to send local private message: Recipient '${e}' not found or disconnected.`))}};var L=require("obsidian"),C=class{constructor(n){this.socket=null;this.serverAddress=null;this._isConnected=!1;this.reconnectAttempts=0;this.maxReconnectAttempts=5;this.reconnectDelay=5e3;this.requestedNickname=null;this.callbacks=n}get isConnected(){return this._isConnected&&!!this.socket&&this.socket.readyState===WebSocket.OPEN}connect(n,e){if(this.socket&&(this.socket.readyState===WebSocket.CONNECTING||this.socket.readyState===WebSocket.OPEN)){console.warn(`[WSClient] Already connected or connecting to ${this.serverAddress}.`);return}if(!n){console.error("[WSClient] Cannot connect: Server address is empty.");return}this.serverAddress=n,this.requestedNickname=e,this._isConnected=!1,console.log(`[WSClient] Attempting to connect to ${this.serverAddress}...`);try{this.socket=new WebSocket(this.serverAddress),this.socket.onopen=t=>this._handleOpen(t),this.socket.onmessage=t=>this._handleMessage(t),this.socket.onerror=t=>this._handleError(t),this.socket.onclose=t=>this._handleClose(t)}catch(t){console.error(`[WSClient] Error creating WebSocket connection to ${this.serverAddress}:`,t),this.callbacks.onError(t),this.socket=null}}disconnect(){this.socket&&(console.log(`[WSClient] Disconnecting from ${this.serverAddress}...`),this.reconnectAttempts=this.maxReconnectAttempts+1,this.socket.close(1e3,"Client disconnecting normally")),this.socket=null,this._isConnected=!1,this.serverAddress=null,this.requestedNickname=null}async sendMessage(n){return new Promise((e,t)=>{if(!this._isConnected||!this.socket||this.socket.readyState!==WebSocket.OPEN){console.warn("[WSClient] Cannot send message: Not connected."),t(new Error("WebSocket is not connected."));return}try{this.socket.send(JSON.stringify(n)),e()}catch(s){console.error("[WSClient] Error sending message:",s),this.callbacks.onError(s),t(s)}})}_handleOpen(n){if(console.log(`[WSClient] Connection opened successfully to ${this.serverAddress}`),this._isConnected=!0,this.reconnectAttempts=0,this.requestedNickname){let e={type:"identify",nickname:this.requestedNickname};console.log("[WSClient] Sending identification:",e),this.sendMessage(e).catch(t=>{console.error("[WSClient] Failed to send identification message:",t)})}else{console.error("[WSClient] Cannot identify: Nickname was not provided during connect."),this.disconnect();return}this.callbacks.onOpen(n)}_handleMessage(n){if(typeof n.data=="string")try{let e=JSON.parse(n.data);this.callbacks.onMessage(e)}catch(e){console.error("[WSClient] Received non-JSON text message or parse error:",n.data,e)}else n.data instanceof ArrayBuffer?console.log(`[WSClient] Received binary message (ArrayBuffer), ${n.data.byteLength} bytes.`):n.data instanceof Blob?console.log(`[WSClient] Received binary message (Blob), ${n.data.size} bytes.`):console.warn("[WSClient] Received message with unknown data type:",n.data)}_handleError(n){console.error("[WSClient] WebSocket error:",n),this._isConnected=!1,this.callbacks.onError(n)}_handleClose(n){if(console.warn(`[WSClient] WebSocket closed. Code: ${n.code}, Reason: '${n.reason}', Clean: ${n.wasClean}`),this._isConnected=!1,this.socket=null,this.callbacks.onClose(n),n.code!==1e3&&this.reconnectAttempts<this.maxReconnectAttempts){this.reconnectAttempts++;let e=this.reconnectDelay*Math.pow(1.5,this.reconnectAttempts-1);console.log(`[WSClient] Attempting reconnect #${this.reconnectAttempts} in ${e/1e3}s...`),setTimeout(()=>{this.serverAddress&&this.requestedNickname?this.connect(this.serverAddress,this.requestedNickname):console.log("[WSClient] Cannot reconnect: connection info missing.")},e)}else n.code!==1e3&&(console.error(`[WSClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`),new L.Notice("Failed to reconnect to chat server.",1e4))}};var f=require("obsidian"),M=class extends f.PluginSettingTab{constructor(e,t){super(e,t);this.plugin=t}display(){let{containerEl:e}=this;e.empty(),e.createEl("h2",{text:"Local Chat Settings"}),new f.Setting(e).setName("Instance Role");let t=new f.Setting(e).setName("Server Address"),s=new f.Setting(e).setName("Server Port");this.plugin.settings.role==="server"&&!f.Platform.isMobile?(t.settingEl.style.display="none",s.settingEl.style.display=""):(t.settingEl.style.display="",s.settingEl.style.display="none"),f.Platform.isMobile&&(s.settingEl.style.display="none"),new f.Setting(e).setName("Your Nickname"),new f.Setting(e).setName("Save Chat History")}};var N={role:"client",serverAddress:"ws://127.0.0.1:61338",serverPort:61338,userNickname:`ObsidianUser_${Math.random().toString(36).substring(2,8)}`,saveHistory:!0,downloadPath:""};var y=class extends c.Plugin{constructor(){super(...arguments);this.chatView=null;this.webSocketClientManager=null;this.webSocketServerManager=null;this.outgoingFileOffers=new Map;this.incomingFileOffers=new Map;this.knownUsers=new Map}async onload(){let e=`[${this.manifest.name}]`;console.log(`${e} Loading plugin...`),await this.loadSettings(),console.log(`${e} Role: ${this.settings.role}. Nickname: ${this.settings.userNickname}.`);let t=this.createClientCallbacks(),s=this.createServerCallbacks();if(this.settings.role==="server")if(c.Platform.isMobile)new c.Notice("Error: 'Server' role is not supported on mobile.",1e4),console.error(`${e} Cannot start in server mode on mobile.`);else{console.log(`${e} Initializing in SERVER mode on port ${this.settings.serverPort}...`);try{if(typeof require=="undefined")throw new Error("'require' is not available.");let i=E(),a=i.WebSocketServer||i.Server;if(typeof a!="function")throw new Error('WebSocketServer class could not be obtained via require("ws").');this.webSocketServerManager=new b(this.settings.serverPort,this.settings.userNickname,s,a),await this.webSocketServerManager.start(),this.handleUserFound({nickname:this.settings.userNickname}),new c.Notice(`${this.manifest.name}: Server started on port ${this.settings.serverPort}.`)}catch(i){console.error(`${e} CRITICAL ERROR starting WebSocket server:`,i),new c.Notice(`[${this.manifest.name}] Failed to start server! Error: ${i.message}.`,1e4),this.webSocketServerManager=null}}else console.log(`${e} Initializing in CLIENT mode. Connecting to ${this.settings.serverAddress}...`),!this.settings.serverAddress||!this.settings.serverAddress.toLowerCase().startsWith("ws")?new c.Notice(`[${this.manifest.name}] Invalid server address: "${this.settings.serverAddress}".`,1e4):(this.webSocketClientManager=new C(t),this.webSocketClientManager.connect(this.settings.serverAddress,this.settings.userNickname));this.registerView(p,i=>(this.chatView=new k(i,this),this.populateInitialChatViewState(),this.chatView)),this.addRibbonIcon("message-circle","Open Local Chat",()=>this.activateView()),this.addCommand({id:"open-local-chat-view",name:"Open Local Chat panel",callback:()=>this.activateView()}),this.addSettingTab(new M(this.app,this)),console.log(`${e} Plugin UI initialized.`)}async onunload(){console.log(`[${this.manifest.name}] Unloading plugin...`),await this.cleanupNetworkServices(),this.app.workspace.detachLeavesOfType(p),this.chatView=null,this.outgoingFileOffers.clear(),this.incomingFileOffers.clear(),this.knownUsers.clear(),console.log(`[${this.manifest.name}] Plugin unloaded.`)}populateInitialChatViewState(){this.chatView&&this.knownUsers.forEach(e=>{var t;return(t=this.chatView)==null?void 0:t.addUserToList(e)})}async cleanupNetworkServices(){if(this.webSocketClientManager&&(this.webSocketClientManager.disconnect(),this.webSocketClientManager=null),this.webSocketServerManager){try{await this.webSocketServerManager.stop()}catch(e){console.error(`[${this.manifest.name}] Error stopping WebSocket server:`,e)}this.webSocketServerManager=null}console.log(`[${this.manifest.name}] Network services cleaned up.`)}createClientCallbacks(){return{onOpen:()=>{console.log(`[${this.manifest.name}] Client: Connected.`),new c.Notice("Chat connected.",3e3)},onClose:e=>{var t,s;console.warn(`[${this.manifest.name}] Client: Disconnected. Code: ${e.code}`),new c.Notice("Chat disconnected.",5e3),this.knownUsers.clear(),(s=(t=this.chatView)==null?void 0:t.clearUserList)==null||s.call(t)},onError:e=>{console.error(`[${this.manifest.name}] Client: WS Error`,e),new c.Notice(`Chat Connection Error: ${e instanceof Error?e.message:"Unknown"}`,5e3)},onMessage:e=>this.handleServerMessage(e)}}createServerCallbacks(){return{onClientConnected:(e,t)=>{var i;console.log(`[${this.manifest.name}] Server: Client '${t}' connected (ID: ${e})`),this.handleUserFound({nickname:t});let s={type:"userList",users:this.getAllUsers(),timestamp:Date.now()};(i=this.webSocketServerManager)==null||i.sendToClient(e,s)},onClientDisconnected:(e,t)=>{console.log(`[${this.manifest.name}] Server: Client '${t}' disconnected (ID: ${e})`),this.handleUserLeft({nickname:t})},onMessage:(e,t,s)=>this.handleClientMessage(e,t,s),onError:e=>{console.error(`[${this.manifest.name}] Server Error:`,e),new c.Notice(`Chat Server Error: ${e.message}`,5e3)}}}handleServerMessage(e){var t,s,i,a;switch(console.debug(`[${this.manifest.name}] Received from server:`,e),e.type){case"text":{let r=e,o=r.senderNickname||"Server";(t=this.chatView)==null||t.displayMessage(o,r.content,r.timestamp||Date.now(),!1);break}case"fileOffer":{let r=e,o=r.senderNickname||"Unknown Sender";this.incomingFileOffers.set(r.fileId,{...r,senderNickname:o}),(s=this.chatView)==null||s.displayFileOffer(o,r),this.isChatViewActive()||new c.Notice(`File offer '${r.filename}' from ${o}`);break}case"fileAccept":{let r=e;this.handleRemoteFileAccept(r.fileId,r.senderNickname);break}case"fileDecline":{let r=e;this.handleRemoteFileDecline(r.fileId,r.senderNickname);break}case"userList":{let r=e;this.knownUsers.clear(),r.users.forEach(o=>this.knownUsers.set(o.nickname,o)),(a=(i=this.chatView)==null?void 0:i.clearUserList)==null||a.call(i),this.knownUsers.forEach(o=>{var l;return(l=this.chatView)==null?void 0:l.addUserToList(o)});break}case"userJoin":{let r=e;this.handleUserFound({nickname:r.nickname});break}case"userLeave":{let r=e;this.handleUserLeft({nickname:r.nickname});break}case"error":{let r=e;console.error(`[${this.manifest.name}] Error from server:`,r.message),new c.Notice(`Server error: ${r.message}`,5e3);break}default:console.warn(`[${this.manifest.name}] Received unhandled message type from server:`,e.type)}}handleClientMessage(e,t,s){var i,a;if(this.webSocketServerManager)switch(s.senderNickname=t,s.timestamp=s.timestamp||Date.now(),s.type){case"text":{let r=s;if(!r.content)return;r.recipient?this.webSocketServerManager.sendToClientByNickname(r.recipient,r)||this.webSocketServerManager.sendToClient(e,{type:"error",message:`User '${r.recipient}' not found.`,timestamp:Date.now()}):this.webSocketServerManager.broadcast(e,r),(i=this.chatView)==null||i.displayMessage(r.senderNickname,r.content,r.timestamp,!1);break}case"fileOffer":{let r=s;if(!r.fileId||!r.filename||typeof r.size!="number"){console.warn("Invalid fileOffer received");break}r.recipient?this.webSocketServerManager.sendToClientByNickname(r.recipient,r)||this.webSocketServerManager.sendToClient(e,{type:"error",message:`User '${r.recipient}' not found for file offer.`,timestamp:Date.now()}):(this.webSocketServerManager.broadcast(e,r),this.incomingFileOffers.set(r.fileId,{...r,senderNickname:t,senderClientId:e}),(a=this.chatView)==null||a.displayFileOffer(t,r));break}case"fileAccept":case"fileDecline":{let r=s;if(!r.fileId||!r.originalSender){console.warn(`Invalid ${r.type} received (missing fileId or originalSender)`);break}this.webSocketServerManager.sendToClientByNickname(r.originalSender,r)||this.webSocketServerManager.sendToClient(e,{type:"error",message:`Original sender '${r.originalSender}' not found for file response.`,timestamp:Date.now()});break}default:console.warn(`[${this.manifest.name}] Received unhandled message type from client ${t}:`,s.type)}}handleUserFound(e){var t;if(!this.knownUsers.has(e.nickname)&&(console.log(`[${this.manifest.name}] User Found/Joined: ${e.nickname}`),this.knownUsers.set(e.nickname,e),(t=this.chatView)==null||t.addUserToList(e),this.settings.role==="server"&&this.webSocketServerManager&&e.nickname!==this.settings.userNickname)){let s={type:"userJoin",nickname:e.nickname,timestamp:Date.now()},i=this.webSocketServerManager.findClientIdByNickname(e.nickname);this.webSocketServerManager.broadcast(i,s)}}handleUserLeft(e){var t;if(this.knownUsers.delete(e.nickname)&&(console.log(`[${this.manifest.name}] User Left: ${e.nickname}`),(t=this.chatView)==null||t.removeUserFromList(e.nickname),this.settings.role==="server"&&this.webSocketServerManager)){let s={type:"userLeave",nickname:e.nickname,timestamp:Date.now()};this.webSocketServerManager.broadcast(null,s)}}getAllUsers(){return Array.from(this.knownUsers.values())}async sendMessage(e,t){var r,o;let s=this.settings.userNickname;if(!(t!=null&&t.trim()))return;let i=Date.now();(r=this.chatView)==null||r.displayMessage(s,t.trim(),i,!0);let a={type:"text",senderNickname:s,content:t.trim(),timestamp:i,recipient:e};try{if(this.settings.role==="client"&&((o=this.webSocketClientManager)!=null&&o.isConnected))await this.webSocketClientManager.sendMessage(a);else if(this.settings.role==="server"&&this.webSocketServerManager)this.webSocketServerManager.handleLocalMessage(a,e);else throw new Error("Chat service not ready.")}catch(l){console.error(`[${this.manifest.name}] Error sending message:`,l),new c.Notice(`Send Error: ${l.message}`)}}async initiateSendFile(e,t){var d,h,m,S;if(!(this.settings.role==="client"?(d=this.webSocketClientManager)==null?void 0:d.isConnected:!!this.webSocketServerManager)){new c.Notice("Chat service not ready.");return}let i=`file_${Date.now()}_${Math.random().toString(36).substring(2,9)}`,a=e.name,r=e.size,o={fileId:i,filePath:"N/A - Use fileObject",fileObject:e,filename:a,size:r,recipientNickname:t};this.outgoingFileOffers.set(i,o),console.log(`[${this.manifest.name}] Initiating file send offer: ${a} (ID: ${i})`),(h=this.chatView)==null||h.displayUploadProgress({fileId:i,filename:a,size:r,recipientNickname:t});let l={type:"fileOffer",senderNickname:this.settings.userNickname,fileId:i,filename:a,size:r,recipient:t,timestamp:Date.now()};try{if(this.settings.role==="client"&&this.webSocketClientManager)await this.webSocketClientManager.sendMessage(l);else if(this.settings.role==="server"&&this.webSocketServerManager)this.webSocketServerManager.handleLocalMessage(l,t);else throw new Error("Chat service not configured.");console.log(`[${this.manifest.name}] File offer ${i} sent.`)}catch($){console.error(`[${this.manifest.name}] Error sending fileOffer ${i}:`,$),new c.Notice(`Error sending file offer: ${$.message}`),this.outgoingFileOffers.delete(i),(S=(m=this.chatView)==null?void 0:m.updateFileProgress)==null||S.call(m,i,"upload",0,r,"error")}}async acceptFileOffer(e,t){var r,o,l,d,h;let s=this.incomingFileOffers.get(t);if(!s){new c.Notice("Error: File offer expired or invalid.");return}if(!(this.settings.role==="client"?(r=this.webSocketClientManager)==null?void 0:r.isConnected:!!this.webSocketServerManager)){new c.Notice("Chat service not ready.");return}console.log(`[${this.manifest.name}] Accepting file offer ${t} from ${e}`),(l=(o=this.chatView)==null?void 0:o.updateFileProgress)==null||l.call(o,t,"download",0,s.size,"accepted");let a={type:"fileAccept",senderNickname:this.settings.userNickname,fileId:t,originalSender:e,timestamp:Date.now()};try{if(this.settings.role==="client"&&this.webSocketClientManager)await this.webSocketClientManager.sendMessage(a);else if(this.settings.role==="server"&&this.webSocketServerManager){if(!this.webSocketServerManager.sendToClientByNickname(e,a))throw new Error(`Cannot send acceptance, user ${e} not found.`)}else throw new Error("Chat service not configured.");console.log(`[${this.manifest.name}] Acceptance for ${t} sent.`)}catch(m){console.error(`[${this.manifest.name}] Error sending file acceptance for ${t}:`,m),new c.Notice(`Error accepting file: ${m.message}`),this.incomingFileOffers.delete(t),(h=(d=this.chatView)==null?void 0:d.updateFileProgress)==null||h.call(d,t,"download",0,s.size,"error")}}async declineFileOffer(e,t){var r,o,l,d,h;let s=this.incomingFileOffers.get(t);if(!s){(o=(r=this.chatView)==null?void 0:r.updateFileProgress)==null||o.call(r,t,"download",0,0,"declined");return}console.log(`[${this.manifest.name}] Declining file offer ${t} from ${e}`),this.incomingFileOffers.delete(t),(d=(l=this.chatView)==null?void 0:l.updateFileProgress)==null||d.call(l,t,"download",0,s.size||0,"declined");let i={type:"fileDecline",senderNickname:this.settings.userNickname,fileId:t,originalSender:e,timestamp:Date.now()};if(this.settings.role==="client"?(h=this.webSocketClientManager)==null?void 0:h.isConnected:!!this.webSocketServerManager)try{this.settings.role==="client"&&this.webSocketClientManager?await this.webSocketClientManager.sendMessage(i):this.settings.role==="server"&&this.webSocketServerManager&&(this.webSocketServerManager.sendToClientByNickname(e,i)||console.warn(`[${this.manifest.name}] Cannot send decline, user ${e} not found.`)),console.log(`[${this.manifest.name}] Decline message for ${t} sent (or attempted).`)}catch(m){console.warn(`[${this.manifest.name}] Error sending file decline for ${t}: ${m.message}`)}}async handleRemoteFileAccept(e,t){var i,a,r,o;let s=this.outgoingFileOffers.get(e);if(!s){console.warn(`[${this.manifest.name}] Received accept for unknown outgoing offer ${e}`);return}if(!s.fileObject){console.error(`[${this.manifest.name}] Cannot start upload for ${e}: File object missing from offer state.`),new c.Notice(`Error starting upload: Cannot access file ${s.filename}`),this.outgoingFileOffers.delete(e),(a=(i=this.chatView)==null?void 0:i.updateFileProgress)==null||a.call(i,e,"upload",0,s.size,"error");return}console.log(`[${this.manifest.name}] User ${t} accepted file ${s.filename}. Starting upload...`),(o=(r=this.chatView)==null?void 0:r.updateFileProgress)==null||o.call(r,e,"upload",0,s.size,"starting"),console.error("<<<<< FILE UPLOAD STREAMING (from File object) VIA WEBSOCKET IS NOT IMPLEMENTED >>>>>"),new c.Notice(`File upload streaming for ${s.filename} not implemented yet.`),setTimeout(()=>this.handleFileTransferError(e,"upload",new Error("Upload not implemented")),1500)}handleFileTransferError(e,t,s){var o,l;let i=`[${this.manifest.name}]`;console.error(`${i} File transfer error: ${e} (${t})`,s);let a=t==="upload"?this.outgoingFileOffers.get(e):this.incomingFileOffers.get(e),r=(a==null?void 0:a.filename)||"file";new c.Notice(`\u041F\u043E\u043C\u0438\u043B\u043A\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0456 \u0444\u0430\u0439\u043B\u0443 '${r}': ${s.message}`,7e3),t==="upload"?this.outgoingFileOffers.delete(e)&&console.log(`${i} Removed outgoing offer state for ${e}`):this.incomingFileOffers.delete(e)&&console.log(`${i} Removed incoming offer state for ${e}`),(l=(o=this.chatView)==null?void 0:o.updateFileProgress)==null||l.call(o,e,t,0,0,"error")}handleRemoteFileDecline(e,t){var i,a;let s=this.outgoingFileOffers.get(e);s?(console.log(`[${this.manifest.name}] User ${t} declined file ${s.filename}`),new c.Notice(`User ${t} declined file: ${s.filename}`),this.outgoingFileOffers.delete(e),(a=(i=this.chatView)==null?void 0:i.updateFileProgress)==null||a.call(i,e,"upload",0,s.size||0,"declined")):console.warn(`[${this.manifest.name}] Received remote decline for unknown outgoing offer ID: ${e}`)}async loadSettings(){this.settings=Object.assign({},N,await this.loadData())}async saveSettings(){await this.saveData(this.settings),console.log(`[${this.manifest.name}] Settings saved.`),new c.Notice("Some chat settings require restart.",5e3)}async activateView(){var i;let{workspace:e}=this.app,t=null,s=e.getLeavesOfType(p);if(s.length>0)t=s[0];else{let a=(i=e.getRightLeaf(!1))!=null?i:e.getLeftLeaf(!1);if(a)t=a,await t.setViewState({type:p,active:!0});else{console.error(`[${this.manifest.name}] \u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u043E\u0442\u0440\u0438\u043C\u0430\u0442\u0438 \u043F\u0430\u043D\u0435\u043B\u044C \u0434\u043B\u044F \u0447\u0430\u0442\u0443.`),new c.Notice("\u041F\u043E\u043C\u0438\u043B\u043A\u0430: \u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0432\u0456\u0434\u043A\u0440\u0438\u0442\u0438 \u043F\u0430\u043D\u0435\u043B\u044C \u0447\u0430\u0442\u0443.");return}}t&&e.revealLeaf(t)}isChatViewActive(){let e=this.app.workspace.activeLeaf;return!!e&&e.getViewState().type===p}};
