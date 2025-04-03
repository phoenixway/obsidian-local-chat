import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFolder, Platform } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './ChatView';
import { WebSocketServerManager, WebSocketServerCallbacks } from './WebSocketServerManager';
import { WebSocketClientManager, WebSocketClientCallbacks } from './WebSocketClientManager';
import {
	UserInfo,
	LocalChatPluginSettings,
	OutgoingFileOfferState,
	IncomingFileOfferState,
	WebSocketMessage,
	TextMessage,
	FileOfferMessage,
	FileAcceptMessage,
	FileDeclineMessage,
	UserListMessage,
	UserJoinMessage,
	UserLeaveMessage,
	IdentifyMessage,
	ErrorMessage,
	BaseMessage
} from './types'; // Імпортуємо всі типи з types.ts
import { ChatSettingTab } from './SettingsTab'; // Імпортуємо SettingsTab
import { DEFAULT_SETTINGS } from './types'; // Імпортуємо DEFAULT_SETTINGS з types.ts

import * as fs from 'fs';
import * as path from 'path';
// Прибираємо статичний імпорт ws, бо використовуємо require або динамічний імпорт
// import { WebSocketServer } from 'ws';


export default class LocalChatPlugin extends Plugin {
	settings: LocalChatPluginSettings;
	chatView: ChatView | null = null;
	webSocketClientManager: WebSocketClientManager | null = null;
	webSocketServerManager: WebSocketServerManager | null = null;

	// Стан передачі файлів (повернули)
	private outgoingFileOffers: Map<string, OutgoingFileOfferState> = new Map();
	private incomingFileOffers: Map<string, IncomingFileOfferState> = new Map();

	// Список користувачів
	private knownUsers: Map<string, UserInfo> = new Map(); // Ключ - nickname

	// --- Plugin Lifecycle ---

	async onload() {
		const pluginName = `[${this.manifest.name}]`;
		console.log(`${pluginName} Loading plugin...`);

		await this.loadSettings();
		console.log(`${pluginName} Role: ${this.settings.role}. Nickname: ${this.settings.userNickname}.`);

		const clientCallbacks: WebSocketClientCallbacks = this.createClientCallbacks();
		const serverCallbacks: WebSocketServerCallbacks = this.createServerCallbacks();

		// Ініціалізація та запуск відповідно до ролі
		if (this.settings.role === 'server') {
			if (Platform.isMobile) {
				new Notice("Error: 'Server' role is not supported on mobile.", 10000);
				console.error(`${pluginName} Cannot start in server mode on mobile.`);
			} else {
				console.log(`${pluginName} Initializing in SERVER mode on port ${this.settings.serverPort}...`);
				try {
					// Використовуємо require('ws') як найбільш надійний варіант для Electron наразі
					if (typeof require === 'undefined') throw new Error("'require' is not available.");
					const ws_require = require('ws');
					const WSServerConstructor = ws_require.WebSocketServer || ws_require.Server;
					if (typeof WSServerConstructor !== 'function') throw new Error('WebSocketServer class could not be obtained via require("ws").');

					this.webSocketServerManager = new WebSocketServerManager(
						this.settings.serverPort,
						this.settings.userNickname,
						serverCallbacks,
						WSServerConstructor
					);
					await this.webSocketServerManager!.start();
					this.handleUserFound({ nickname: this.settings.userNickname }); // Додаємо себе
					new Notice(`${this.manifest.name}: Server started on port ${this.settings.serverPort}.`);
				} catch (error: any) {
					console.error(`${pluginName} CRITICAL ERROR starting WebSocket server:`, error);
					new Notice(`[${this.manifest.name}] Failed to start server! Error: ${error.message}.`, 10000);
					this.webSocketServerManager = null;
				}
			}
		} else { // Role is 'client'
			console.log(`${pluginName} Initializing in CLIENT mode. Connecting to ${this.settings.serverAddress}...`);
			if (!this.settings.serverAddress || !this.settings.serverAddress.toLowerCase().startsWith('ws')) {
				new Notice(`[${this.manifest.name}] Invalid server address: "${this.settings.serverAddress}".`, 10000);
			} else {
				this.webSocketClientManager = new WebSocketClientManager(clientCallbacks);
				this.webSocketClientManager.connect(this.settings.serverAddress, this.settings.userNickname);
			}
		}

		// Реєстрація UI
		this.registerView(CHAT_VIEW_TYPE, (leaf) => {
			this.chatView = new ChatView(leaf, this);
			// this.populateInitialChatViewState();
			return this.chatView;
		});
		this.addRibbonIcon('message-circle', 'Open Local Chat', () => this.activateView());
		this.addCommand({ id: 'open-local-chat-view', name: 'Open Local Chat panel', callback: () => this.activateView() });
		this.addSettingTab(new ChatSettingTab(this.app, this));

		console.log(`${pluginName} Plugin UI initialized.`);
	}

	async onunload() {
		console.log(`[${this.manifest.name}] Unloading plugin...`);
		await this.cleanupNetworkServices();
		this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
		this.chatView = null;
		this.outgoingFileOffers.clear();
		this.incomingFileOffers.clear();
		this.knownUsers.clear();
		console.log(`[${this.manifest.name}] Plugin unloaded.`);
	}

	private populateInitialChatViewState(): void {
		if (!this.chatView) return;
		this.knownUsers.forEach(user => this.chatView?.addUserToList(user));
		// TODO: Load and display chat history
	}

	private async cleanupNetworkServices(): Promise<void> {
		if (this.webSocketClientManager) {
			this.webSocketClientManager.disconnect();
			this.webSocketClientManager = null;
		}
		if (this.webSocketServerManager) {
			try { await this.webSocketServerManager.stop(); }
			catch (err) { console.error(`[${this.manifest.name}] Error stopping WebSocket server:`, err); }
			this.webSocketServerManager = null;
		}
		console.log(`[${this.manifest.name}] Network services cleaned up.`);
	}

	// --- Callback Creation ---

	private createClientCallbacks(): WebSocketClientCallbacks {
		return {
			onOpen: () => { console.log(`[${this.manifest.name}] Client: Connected.`); new Notice("Chat connected.", 3000); },
			onClose: (event) => { console.warn(`[${this.manifest.name}] Client: Disconnected. Code: ${event.code}`); new Notice("Chat disconnected.", 5000); this.knownUsers.clear(); this.chatView?.clearUserList?.(); },
			onError: (e) => { console.error(`[${this.manifest.name}] Client: WS Error`, e); new Notice(`Chat Connection Error: ${e instanceof Error ? e.message : 'Unknown'}`, 5000); },
			onMessage: (message) => this.handleServerMessage(message),
		};
	}

	private createServerCallbacks(): WebSocketServerCallbacks {
		return {
			onClientConnected: (clientId: string, clientNickname: string) => {
				console.log(`[${this.manifest.name}] Server: Client '${clientNickname}' connected (ID: ${clientId})`);
				this.handleUserFound({ nickname: clientNickname });
				const userListPayload: UserListMessage = { type: 'userList', users: this.getAllUsers(), timestamp: Date.now() };
				this.webSocketServerManager?.sendToClient(clientId, userListPayload);
			},
			onClientDisconnected: (clientId: string, clientNickname: string) => {
				console.log(`[${this.manifest.name}] Server: Client '${clientNickname}' disconnected (ID: ${clientId})`);
				this.handleUserLeft({ nickname: clientNickname });
			},
			onMessage: (clientId: string, clientNickname: string, message: WebSocketMessage) => this.handleClientMessage(clientId, clientNickname, message),
			onError: (error) => { console.error(`[${this.manifest.name}] Server Error:`, error); new Notice(`Chat Server Error: ${error.message}`, 5000); },
		};
	}

	// --- Message Handling ---

	/** Handles messages received BY THE CLIENT from the server */
	private handleServerMessage(message: WebSocketMessage): void {
		console.debug(`[${this.manifest.name}] Received from server:`, message);
		switch (message.type) {
			case 'text': {
				const msg = message as TextMessage;
				const sender = msg.senderNickname || 'Server';
				this.chatView?.displayMessage(sender, msg.content, msg.timestamp || Date.now(), false);
				// TODO: Save history
				break;
			}
			case 'fileOffer': {
				const offerMsg = message as FileOfferMessage;
				const sender = offerMsg.senderNickname || 'Unknown Sender';
				this.incomingFileOffers.set(offerMsg.fileId, { ...offerMsg, senderNickname: sender });
				this.chatView?.displayFileOffer(sender, offerMsg);
				if (!this.isChatViewActive()) new Notice(`File offer '${offerMsg.filename}' from ${sender}`);
				break;
			}
			case 'fileAccept': {
				const acceptMsg = message as FileAcceptMessage;
				this.handleRemoteFileAccept(acceptMsg.fileId, acceptMsg.senderNickname);
				break;
			}
			case 'fileDecline': {
				const declineMsg = message as FileDeclineMessage;
				this.handleRemoteFileDecline(declineMsg.fileId, declineMsg.senderNickname);
				break;
			}
			case 'userList': {
				const listMsg = message as UserListMessage;
				this.knownUsers.clear();
				listMsg.users.forEach((user) => this.knownUsers.set(user.nickname, user));
				this.chatView?.clearUserList?.();
				this.knownUsers.forEach(user => this.chatView?.addUserToList(user));
				break;
			}
			case 'userJoin': {
				const joinMsg = message as UserJoinMessage;
				this.handleUserFound({ nickname: joinMsg.nickname });
				break;
			}
			case 'userLeave': {
				const leaveMsg = message as UserLeaveMessage;
				this.handleUserLeft({ nickname: leaveMsg.nickname });
				break;
			}
			case 'error': {
				const errorMsg = message as ErrorMessage;
				console.error(`[${this.manifest.name}] Error from server:`, errorMsg.message);
				new Notice(`Server error: ${errorMsg.message}`, 5000);
				break;
			}
			// TODO: Handle incoming file chunks
			default:
				console.warn(`[${this.manifest.name}] Received unhandled message type from server:`, message.type);
		}
	}

	/** Handles messages received BY THE SERVER from a specific client */
	private handleClientMessage(clientId: string, clientNickname: string, message: WebSocketMessage): void {
		if (!this.webSocketServerManager) return;
		message.senderNickname = clientNickname; // Ensure sender is correct
		message.timestamp = message.timestamp || Date.now();

		switch (message.type) {
			case 'text': {
				const msg = message as TextMessage;
				if (!msg.content) return;
				if (msg.recipient) { // Private relay
					if (!this.webSocketServerManager.sendToClientByNickname(msg.recipient, msg)) {
						this.webSocketServerManager.sendToClient(clientId, { type: 'error', message: `User '${msg.recipient}' not found.`, timestamp: Date.now() } as ErrorMessage);
					}
				} else { // Broadcast
					this.webSocketServerManager.broadcast(clientId, msg);
				}
				// Also display on server UI
				this.chatView?.displayMessage(msg.senderNickname, msg.content, msg.timestamp, false);
				// TODO: Save history (on server)
				break;
			}
			case 'fileOffer': {
				const offerMsg = message as FileOfferMessage;
				if (!offerMsg.fileId || !offerMsg.filename || typeof offerMsg.size !== 'number') { console.warn("Invalid fileOffer received"); break; }
				if (offerMsg.recipient) { // Private Offer Relay
					if (!this.webSocketServerManager.sendToClientByNickname(offerMsg.recipient, offerMsg)) {
						this.webSocketServerManager.sendToClient(clientId, { type: 'error', message: `User '${offerMsg.recipient}' not found for file offer.`, timestamp: Date.now() } as ErrorMessage);
					}
				} else { // Broadcast Offer
					this.webSocketServerManager.broadcast(clientId, offerMsg);
					// Also show offer on server's UI
					this.incomingFileOffers.set(offerMsg.fileId, { ...offerMsg, senderNickname: clientNickname, senderClientId: clientId });
					this.chatView?.displayFileOffer(clientNickname, offerMsg);
				}
				break;
			}
			case 'fileAccept':
			case 'fileDecline': {
				const responseMsg = message as FileAcceptMessage | FileDeclineMessage;
				if (!responseMsg.fileId || !responseMsg.originalSender) { console.warn(`Invalid ${responseMsg.type} received (missing fileId or originalSender)`); break; }
				// Relay response back to the original sender
				if (!this.webSocketServerManager.sendToClientByNickname(responseMsg.originalSender, responseMsg)) {
					this.webSocketServerManager.sendToClient(clientId, { type: 'error', message: `Original sender '${responseMsg.originalSender}' not found for file response.`, timestamp: Date.now() } as ErrorMessage);
				}
				break;
			}
			// TODO: Handle file chunks from client and relay them
			default:
				console.warn(`[${this.manifest.name}] Received unhandled message type from client ${clientNickname}:`, message.type);
		}
	}

	// --- User List Management ---

	private handleUserFound(userInfo: UserInfo): void {
		if (this.knownUsers.has(userInfo.nickname)) { // Avoid duplicates / redundant updates for now
			// Could update existing entry if needed later
			return;
		}
		console.log(`[${this.manifest.name}] User Found/Joined: ${userInfo.nickname}`);
		this.knownUsers.set(userInfo.nickname, userInfo);
		this.chatView?.addUserToList(userInfo);

		// If WE are the server, broadcast userJoin (excluding the joining user only if they are not us)
		if (this.settings.role === 'server' && this.webSocketServerManager && userInfo.nickname !== this.settings.userNickname) {
			const joinPayload: UserJoinMessage = { type: 'userJoin', nickname: userInfo.nickname, timestamp: Date.now() };
			const clientIdToExclude = this.webSocketServerManager.findClientIdByNickname(userInfo.nickname);
			this.webSocketServerManager.broadcast(clientIdToExclude, joinPayload);
		}
	}

	private handleUserLeft(userInfo: { nickname: string }): void {
		if (this.knownUsers.delete(userInfo.nickname)) {
			console.log(`[${this.manifest.name}] User Left: ${userInfo.nickname}`);
			this.chatView?.removeUserFromList(userInfo.nickname);
			// Broadcast leave if running as server
			if (this.settings.role === 'server' && this.webSocketServerManager) {
				const leavePayload: UserLeaveMessage = { type: 'userLeave', nickname: userInfo.nickname, timestamp: Date.now() };
				this.webSocketServerManager.broadcast(null, leavePayload);
			}
		}
	}

	public getAllUsers(): UserInfo[] {
		return Array.from(this.knownUsers.values());
	}

	// --- Public Methods (API for ChatView) ---

	/** Sends a text message to the server/clients */
	async sendMessage(recipientNickname: string | null, message: string): Promise<void> {
		const senderNickname = this.settings.userNickname;
		if (!message?.trim()) return;
		const timestamp = Date.now();

		// Display locally immediately
		this.chatView?.displayMessage(senderNickname, message.trim(), timestamp, true);
		// TODO: Save history { status: 'sending' }

		const payload: TextMessage = { type: 'text', senderNickname, content: message.trim(), timestamp, recipient: recipientNickname };

		try {
			if (this.settings.role === 'client' && this.webSocketClientManager?.isConnected) {
				await this.webSocketClientManager.sendMessage(payload);
			} else if (this.settings.role === 'server' && this.webSocketServerManager) {
				this.webSocketServerManager.handleLocalMessage(payload, recipientNickname);
			} else {
				throw new Error("Chat service not ready.");
			}
			// TODO: Update history status? ('sent' / depends on ack)
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error sending message:`, error);
			new Notice(`Send Error: ${error.message}`);
			// TODO: Update history status ('failed')
		}
	}

	/** Initiates sending a file offer */
	async initiateSendFile(file: File, recipientNickname: string | null): Promise<void> {
		const isActiveManager = this.settings.role === 'client' ? this.webSocketClientManager?.isConnected : !!this.webSocketServerManager;
		if (!isActiveManager) { new Notice("Chat service not ready."); return; }

		const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const filename = file.name;
		const size = file.size;

		// --- CRITICAL TODO: File reading/handling strategy ---
		// Storing the File object in the map. Need to read it when upload starts.
		// This section needs a robust implementation for reading the file content later.
		const offerState: OutgoingFileOfferState = {
			fileId,
			filePath: "N/A - Use fileObject", // Indicate path is not used
			fileObject: file, // Store File object
			filename,
			size,
			recipientNickname
		};
		this.outgoingFileOffers.set(fileId, offerState);
		// ------------------------------------------------------

		console.log(`[${this.manifest.name}] Initiating file send offer: ${filename} (ID: ${fileId})`);
		this.chatView?.displayUploadProgress({ fileId, filename, size, recipientNickname }); // Show pending status

		const fileOfferPayload: FileOfferMessage = { type: 'fileOffer', senderNickname: this.settings.userNickname, fileId, filename, size, recipient: recipientNickname, timestamp: Date.now() };

		try {
			if (this.settings.role === 'client' && this.webSocketClientManager) {
				await this.webSocketClientManager.sendMessage(fileOfferPayload);
			} else if (this.settings.role === 'server' && this.webSocketServerManager) {
				this.webSocketServerManager.handleLocalMessage(fileOfferPayload, recipientNickname);
			} else { throw new Error("Chat service not configured."); } // Should be covered by isActiveManager
			console.log(`[${this.manifest.name}] File offer ${fileId} sent.`);
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error sending fileOffer ${fileId}:`, error);
			new Notice(`Error sending file offer: ${error.message}`);
			this.outgoingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, size, 'error');
		}
	}

	/** Accepts an incoming file offer */
	async acceptFileOffer(senderNickname: string, fileId: string): Promise<void> {
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) { new Notice("Error: File offer expired or invalid."); return; }
		const isActiveManager = this.settings.role === 'client' ? this.webSocketClientManager?.isConnected : !!this.webSocketServerManager;
		if (!isActiveManager) { new Notice("Chat service not ready."); return; }

		console.log(`[${this.manifest.name}] Accepting file offer ${fileId} from ${senderNickname}`);
		this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size, 'accepted');

		const payload: FileAcceptMessage = { type: 'fileAccept', senderNickname: this.settings.userNickname, fileId, originalSender: senderNickname, timestamp: Date.now() };

		try {
			if (this.settings.role === 'client' && this.webSocketClientManager) {
				await this.webSocketClientManager.sendMessage(payload);
			} else if (this.settings.role === 'server' && this.webSocketServerManager) {
				if (!this.webSocketServerManager.sendToClientByNickname(senderNickname, payload)) {
					throw new Error(`Cannot send acceptance, user ${senderNickname} not found.`);
				}
			} else { throw new Error("Chat service not configured."); }
			console.log(`[${this.manifest.name}] Acceptance for ${fileId} sent.`);
			// TODO: Prepare for receiving binary data chunks
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error sending file acceptance for ${fileId}:`, error);
			new Notice(`Error accepting file: ${error.message}`);
			this.incomingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size, 'error');
		}
	}

	/** Declines an incoming file offer */
	async declineFileOffer(senderNickname: string, fileId: string): Promise<void> {
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) { this.chatView?.updateFileProgress?.(fileId, 'download', 0, 0, 'declined'); return; } // Already handled

		console.log(`[${this.manifest.name}] Declining file offer ${fileId} from ${senderNickname}`);
		this.incomingFileOffers.delete(fileId);
		this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size || 0, 'declined'); // Update UI first

		const payload: FileDeclineMessage = { type: 'fileDecline', senderNickname: this.settings.userNickname, fileId, originalSender: senderNickname, timestamp: Date.now() };
		const isActiveManager = this.settings.role === 'client' ? this.webSocketClientManager?.isConnected : !!this.webSocketServerManager;

		if (isActiveManager) { // Try sending if connected
			try {
				if (this.settings.role === 'client' && this.webSocketClientManager) {
					await this.webSocketClientManager.sendMessage(payload);
				} else if (this.settings.role === 'server' && this.webSocketServerManager) {
					if (!this.webSocketServerManager.sendToClientByNickname(senderNickname, payload)) {
						console.warn(`[${this.manifest.name}] Cannot send decline, user ${senderNickname} not found.`);
					}
				}
				console.log(`[${this.manifest.name}] Decline message for ${fileId} sent (or attempted).`);
			} catch (error: any) {
				console.warn(`[${this.manifest.name}] Error sending file decline for ${fileId}: ${error.message}`);
			}
		}
	}

	/** Handles remote acceptance of our file offer */
	private async handleRemoteFileAccept(fileId: string, remoteUserNickname: string): Promise<void> {
		const offer = this.outgoingFileOffers.get(fileId);
		if (!offer) { console.warn(`[${this.manifest.name}] Received accept for unknown outgoing offer ${fileId}`); return; }
		// Use offer.fileObject instead of offer.filePath now
		if (!offer.fileObject) {
			console.error(`[${this.manifest.name}] Cannot start upload for ${fileId}: File object missing from offer state.`);
			new Notice(`Error starting upload: Cannot access file ${offer.filename}`);
			this.outgoingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size, 'error');
			return;
		}

		console.log(`[${this.manifest.name}] User ${remoteUserNickname} accepted file ${offer.filename}. Starting upload...`);
		this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size, 'starting');

		// --- CRITICAL TODO: Implement file reading (from offer.fileObject) & chunking over WS ---
		console.error("<<<<< FILE UPLOAD STREAMING (from File object) VIA WEBSOCKET IS NOT IMPLEMENTED >>>>>");
		new Notice(`File upload streaming for ${offer.filename} not implemented yet.`);
		// Pseudocode:
		// 1. Determine target (clientId on server, or send directly if client)
		// 2. Use FileReader or fileObject.arrayBuffer() to read content.
		// 3. Split ArrayBuffer into chunks (e.g., 64KB).
		// 4. Send chunks as binary WebSocket messages, potentially with metadata.
		// 5. Handle completion and errors.

		// Temporary error simulation:
		setTimeout(() => this.handleFileTransferError(fileId, 'upload', new Error("Upload not implemented")), 1500);
	}


	/**
		* Обробляє помилку, що виникла під час передачі файлу (upload або download).
		* Очищує стан та оновлює UI.
		* @param fileId Ідентифікатор передачі файлу, де сталася помилка.
		* @param direction Напрямок передачі ('upload' або 'download').
		* @param error Об'єкт помилки.
		*/
	private handleFileTransferError(fileId: string, direction: 'upload' | 'download', error: Error): void {
		const pluginName = `[${this.manifest.name}]`; // Для логування
		console.error(`${pluginName} File transfer error: ${fileId} (${direction})`, error);

		// Знаходимо інформацію про файл для повідомлення
		const offer = (direction === 'upload')
			? this.outgoingFileOffers.get(fileId)
			: this.incomingFileOffers.get(fileId);
		const filename = offer?.filename || 'file'; // Використовуємо ім'я файлу або заглушку

		// Показуємо повідомлення користувачу
		new Notice(`Помилка передачі файлу '${filename}': ${error.message}`, 7000); // Показуємо довше

		// Очищуємо стан передачі
		if (direction === 'upload') {
			if (this.outgoingFileOffers.delete(fileId)) {
				console.log(`${pluginName} Removed outgoing offer state for ${fileId}`);
			}
		} else { // direction === 'download'
			if (this.incomingFileOffers.delete(fileId)) {
				console.log(`${pluginName} Removed incoming offer state for ${fileId}`);
			}
		}

		// Оновлюємо UI, показуючи помилку
		this.chatView?.updateFileProgress?.(fileId, direction, 0, 0, 'error');
	}


	/** Handles remote decline of our file offer */
	private handleRemoteFileDecline(fileId: string, remoteUserNickname: string): void {
		const offer = this.outgoingFileOffers.get(fileId);
		if (offer) {
			console.log(`[${this.manifest.name}] User ${remoteUserNickname} declined file ${offer.filename}`);
			new Notice(`User ${remoteUserNickname} declined file: ${offer.filename}`);
			this.outgoingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size || 0, 'declined');
		} else {
			console.warn(`[${this.manifest.name}] Received remote decline for unknown outgoing offer ID: ${fileId}`);
		}
	}

	// --- Settings Management --- (Keep as before)
	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); console.log(`[${this.manifest.name}] Settings saved.`); new Notice("Some chat settings require restart.", 5000); }

	// --- View Management --- (Keep as before)
	async activateView() {
		const { workspace } = this.app;
		let leafToReveal: WorkspaceLeaf | null = null; // Може бути null

		// 1. Шукаємо існуючу панель
		const existingLeaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			leafToReveal = existingLeaves[0]; // Знайшли, тепер НЕ null
		} else {
			// 2. Створюємо нову, якщо немає існуючої
			// Намагаємось праворуч, потім ліворуч
			let newLeaf = workspace.getRightLeaf(false) ?? workspace.getLeftLeaf(false);
			if (newLeaf) {
				// Створили успішно
				leafToReveal = newLeaf; // Присвоїли, тепер НЕ null
				// Встановлюємо стан для нової панелі
				await leafToReveal.setViewState({ type: CHAT_VIEW_TYPE, active: true });
			} else {
				// Не вдалося створити панель НІДЕ
				console.error(`[${this.manifest.name}] Не вдалося отримати панель для чату.`);
				new Notice("Помилка: Не вдалося відкрити панель чату.");
				return; // <-- ВАЖЛИВО: Виходимо, якщо панель не створено
			}
		}

		// 3. Показуємо панель, ТІЛЬКИ якщо вона точно існує
		if (leafToReveal) { // <-- КЛЮЧОВА ПЕРЕВІРКА НА NULL
			// Всередині цього блоку TypeScript знає, що leafToReveal НЕ null
			workspace.revealLeaf(leafToReveal);
		}
		// Немає else, бо якщо leafToReveal === null, ми вже вийшли з функції раніше через return
	}

	// --- Helpers --- (Keep isChatViewActive, remove file path helpers)
	private isChatViewActive(): boolean {
		const activeLeaf = this.app.workspace.activeLeaf;
		// Check if activeLeaf exists and if its view state type matches
		return !!activeLeaf && activeLeaf.getViewState().type === CHAT_VIEW_TYPE;
	}
} // End of LocalChatPlugin class