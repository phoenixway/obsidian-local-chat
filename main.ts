import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFolder, Platform } from 'obsidian'; // Use TFolder
import { ChatView, CHAT_VIEW_TYPE } from './ChatView';
// Import managers and their callbacks
import { WebSocketServerManager, WebSocketServerCallbacks } from './WebSocketServerManager';
import { WebSocketClientManager, WebSocketClientCallbacks } from './WebSocketClientManager';
// Import shared types from types.ts
import {
	UserInfo,
	LocalChatPluginSettings,
	OutgoingFileOfferState,
	IncomingFileOfferState,
	WebSocketMessage,
	DEFAULT_SETTINGS,
	TextMessage,
	FileOfferMessage,
	FileAcceptMessage,
	FileDeclineMessage,
	UserListMessage,
	UserJoinMessage,
	UserLeaveMessage,
	IdentifyMessage, // Assuming this was added to types.ts
	BaseMessage,

} from './types';
import { ChatSettingTab } from './SettingsTab'
import { WebSocketServer } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
export default class LocalChatPlugin extends Plugin {
	settings: LocalChatPluginSettings;
	chatView: ChatView | null = null;
	webSocketClientManager: WebSocketClientManager | null = null;
	webSocketServerManager: WebSocketServerManager | null = null;

	// File transfer state
	private outgoingFileOffers: Map<string, OutgoingFileOfferState> = new Map();
	// Ensure IncomingFileOfferState requires senderNickname
	private incomingFileOffers: Map<string, IncomingFileOfferState> = new Map();

	// User list (key: nickname)
	private knownUsers: Map<string, UserInfo> = new Map();

	// --- Plugin Lifecycle ---

	async onload() {
		const pluginName = `[${this.manifest.name}]`;
		console.log(`${pluginName} Loading plugin...`);

		await this.loadSettings();
		console.log(`${pluginName} Role: ${this.settings.role}. Nickname: ${this.settings.userNickname}.`);

		const clientCallbacks: WebSocketClientCallbacks = this.createClientCallbacks();
		const serverCallbacks: WebSocketServerCallbacks = this.createServerCallbacks();

		if (this.settings.role === 'server') {
			if (Platform.isMobile) {
				new Notice("Error: 'Server' role is not supported on mobile. Please change in settings.", 10000);
				console.error(`${pluginName} Cannot start in server mode on mobile.`);
			} else {
				console.log(`${pluginName} Initializing in SERVER mode on port ${this.settings.serverPort}...`);
				try {
					// // --- ЗМІНЕНИЙ БЛОК ІМПОРТУ ТА ПЕРЕВІРКИ ---
					// // Використовуємо деструктуризацію для отримання іменованого експорту
					const { WebSocketServer } = await import('ws');

					// // Додаткова перевірка, чи отримали ми функцію-конструктор
					if (typeof WebSocketServer !== 'function') {
						// Якщо імпорт не вдався, логуємо структуру отриманого об'єкту для діагностики
						console.error("Failed to import WebSocketServer constructor correctly from 'ws' module. Imported object:", await import('ws'));
						throw new Error('WebSocketServer class could not be imported correctly.');
					}
					// // --- КІНЕЦЬ ЗМІНЕНОГО БЛОКУ ---

					this.webSocketServerManager = new WebSocketServerManager(
						this.settings.serverPort,
						this.settings.userNickname,
						serverCallbacks,
						WebSocketServer // Використовуємо імпортований конструктор
					);
					await this.webSocketServerManager.start();
					this.handleUserFound({ nickname: this.settings.userNickname });
					new Notice(`${this.manifest.name}: Server started on port ${this.settings.serverPort}.`);


				} catch (error: any) {
					console.error(`${pluginName} CRITICAL ERROR starting WebSocket server:`, error);
					new Notice(`[${this.manifest.name}] Failed to start server! Error: ${error.message}.`, 10000);
					this.webSocketServerManager = null; // Скидаємо стан при помилці
				}
			}
		} else { // Role is 'client'
			console.log(`${pluginName} Initializing in CLIENT mode. Connecting to ${this.settings.serverAddress}...`);
			if (!this.settings.serverAddress || !this.settings.serverAddress.toLowerCase().startsWith('ws')) {
				new Notice(`[${this.manifest.name}] Invalid server address: "${this.settings.serverAddress}". Check settings.`, 10000);
				console.error(`${pluginName} Invalid server address.`);
			} else {
				this.webSocketClientManager = new WebSocketClientManager(clientCallbacks);
				// Attempt connection (success/failure handled by callbacks)
				this.webSocketClientManager.connect(this.settings.serverAddress, this.settings.userNickname);
			}
		}

		// Register UI components (always register, functionality depends on network status)
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => {
				this.chatView = new ChatView(leaf, this);
				this.populateInitialChatViewState();
				return this.chatView;
			}
		);
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
			console.log(`[${this.manifest.name}] WebSocket client disconnected.`);
		}
		if (this.webSocketServerManager) {
			try {
				await this.webSocketServerManager.stop();
				console.log(`[${this.manifest.name}] WebSocket server stopped.`);
			} catch (err) { console.error(`[${this.manifest.name}] Error stopping WebSocket server:`, err); }
			this.webSocketServerManager = null;
		}
	}

	// --- Callback Creation ---

	private createClientCallbacks(): WebSocketClientCallbacks {
		return {
			onOpen: () => {
				console.log(`[${this.manifest.name}] Client: Connected.`);
				new Notice("Chat connected.", 3000);
				// Server should send user list automatically after identification
			},
			onClose: (event) => {
				console.warn(`[${this.manifest.name}] Client: Disconnected. Code: ${event.code}`);
				new Notice("Chat disconnected.", 5000);
				this.knownUsers.clear();
				this.chatView?.clearUserList?.(); // Call method to clear UI list
				// Reconnect logic is handled within WebSocketClientManager
			},
			onError: (event) => {
				console.error(`[${this.manifest.name}] Client: WebSocket Error`, event);
				new Notice("Chat connection error.", 5000);
			},
			onMessage: (message) => {
				console.debug(`[${this.manifest.name}] Client: Received message`, message);
				this.handleServerMessage(message); // Route message for processing
			},
		};
	}

	private createServerCallbacks(): WebSocketServerCallbacks {
		return {
			// Note: clientId type should be string in the interface definition
			onClientConnected: (clientId: string, clientNickname: string) => {
				console.log(`[${this.manifest.name}] Server: Client '${clientNickname}' connected (ID: ${clientId})`);
				const newUserInfo: UserInfo = { nickname: clientNickname };
				this.handleUserFound(newUserInfo); // Add user and notify others

				// Send current user list to the newly connected client
				const userListPayload: UserListMessage = {
					type: 'userList',
					users: this.getAllUsers(),
					timestamp: Date.now() // Add timestamp
				};
				this.webSocketServerManager?.sendToClient(clientId, userListPayload);
			},
			onClientDisconnected: (clientId: string, clientNickname: string) => {
				console.log(`[${this.manifest.name}] Server: Client '${clientNickname}' disconnected (ID: ${clientId})`);
				this.handleUserLeft({ nickname: clientNickname }); // Remove user and notify others
			},
			// Note: clientId type should be string
			onMessage: (clientId: string, clientNickname: string, message: WebSocketMessage) => {
				console.debug(`[${this.manifest.name}] Server: Message from '${clientNickname}' (ID: ${clientId})`, message);
				this.handleClientMessage(clientId, clientNickname, message); // Route message for processing/relay
			},
			onError: (error) => {
				console.error(`[${this.manifest.name}] Server: Error`, error);
				new Notice(`Chat Server Error: ${error.message}`, 5000);
			},
		};
	}

	// --- Message Handling ---

	/** Handles messages received BY THE CLIENT from the server */
	private handleServerMessage(message: WebSocketMessage): void {
		// Use type guards before accessing specific properties
		switch (message.type) {
			case 'text': { // Use braces for block scope
				const msg = message as TextMessage;
				// Use fallback for senderNickname if it's optional in BaseMessage but required here
				const sender = msg.senderNickname || 'Unknown';
				console.log(`[${this.manifest.name}] Handling incoming text from ${sender}`);
				this.chatView?.displayMessage(sender, msg.content, msg.timestamp || Date.now(), false);
				// TODO: Save history
				break;
			}
			case 'fileOffer': {
				const offerMsg = message as FileOfferMessage;
				const sender = offerMsg.senderNickname || 'Unknown'; // Provide fallback
				console.log(`[${this.manifest.name}] Handling incoming fileOffer from ${sender}`);
				// Ensure senderNickname in the state is non-optional string
				this.incomingFileOffers.set(offerMsg.fileId, { ...offerMsg, senderNickname: sender });
				this.chatView?.displayFileOffer(sender, offerMsg);
				if (!this.isChatViewActive()) new Notice(`File offer '${offerMsg.filename}' from ${sender}`);
				break;
			}
			case 'fileAccept': {
				const acceptMsg = message as FileAcceptMessage;
				console.log(`[${this.manifest.name}] Handling incoming fileAccept for ${acceptMsg.fileId} from ${acceptMsg.senderNickname}`);
				// Call the method that STARTS the upload process
				this.handleRemoteFileAccept(acceptMsg.fileId, acceptMsg.senderNickname);
				break;
			}
			case 'fileDecline': {
				const declineMsg = message as FileDeclineMessage;
				console.log(`[${this.manifest.name}] Handling incoming fileDecline for ${declineMsg.fileId} from ${declineMsg.senderNickname}`);
				// Call the method that HANDLES the remote decline
				this.handleRemoteFileDecline(declineMsg.fileId, declineMsg.senderNickname);
				break;
			}
			case 'userList': {
				const listMsg = message as UserListMessage;
				console.log(`[${this.manifest.name}] Received user list from server`, listMsg.users);
				this.knownUsers.clear();
				// Ensure users received have the correct UserInfo structure ({ nickname })
				listMsg.users.forEach((user: UserInfo) => this.knownUsers.set(user.nickname, user));
				this.chatView?.clearUserList?.(); // Call the method here
				this.knownUsers.forEach(user => this.chatView?.addUserToList(user)); // Use updated UserInfo type
				break;
			}
			case 'userJoin': {
				const joinMsg = message as UserJoinMessage;
				console.log(`[${this.manifest.name}] User joined: ${joinMsg.nickname}`);
				// Pass simplified UserInfo
				this.handleUserFound({ nickname: joinMsg.nickname });
				break;
			}
			case 'userLeave': {
				const leaveMsg = message as UserLeaveMessage;
				console.log(`[${this.manifest.name}] User left: ${leaveMsg.nickname}`);
				this.handleUserLeft({ nickname: leaveMsg.nickname });
				break;
			}
			default:
				console.warn(`[${this.manifest.name}] Received unhandled message type from server:`, message.type);
		}
	}

	/** Handles messages received BY THE SERVER from a specific client */
	private handleClientMessage(clientId: string, clientNickname: string, message: WebSocketMessage): void {
		if (!this.webSocketServerManager) return;

		// Ensure senderNickname matches the identified client
		if (message.senderNickname && message.senderNickname !== clientNickname) {
			console.warn(`[${this.manifest.name}] Message senderNickname mismatch from client ${clientId}. Claimed: '${message.senderNickname}', Actual: '${clientNickname}'. Using actual.`);
		}
		message.senderNickname = clientNickname; // Always set sender to identified client

		// Use type guards before accessing specific properties
		switch (message.type) {
			case 'text': {
				const msg = message as TextMessage;
				console.log(`[${this.manifest.name}] Broadcasting text from ${clientNickname}`);
				// Broadcast to others, excluding sender
				this.webSocketServerManager.broadcast(clientId, msg);
				// Display on server's own UI
				this.chatView?.displayMessage(msg.senderNickname, msg.content, msg.timestamp || Date.now(), false);
				// TODO: Save history (on server)
				break;
			}
			case 'fileOffer': {
				const offerMsg = message as FileOfferMessage;
				const recipient = offerMsg.recipient; // Check if recipient is specified
				if (recipient) { // Relay private offer
					console.log(`[${this.manifest.name}] Relaying private fileOffer from ${clientNickname} to ${recipient}`);
					if (!this.webSocketServerManager.sendToClientByNickname(recipient, offerMsg)) {
						console.warn(`[${this.manifest.name}] Recipient ${recipient} not found for file offer relay.`);
						// TODO: Notify sender of failure? ({ type: 'error', message: `User ${recipient} not found` })
					}
				} else { // Broadcast offer
					console.log(`[${this.manifest.name}] Broadcasting fileOffer from ${clientNickname}`);
					this.webSocketServerManager.broadcast(clientId, offerMsg);
					// Also show offer on server's UI
					this.incomingFileOffers.set(offerMsg.fileId, { ...offerMsg, senderNickname: clientNickname, senderClientId: clientId });
					this.chatView?.displayFileOffer(clientNickname, offerMsg);
				}
				break;
			}
			case 'fileAccept':
			case 'fileDecline': {
				// Relay accept/decline back to the original sender of the file offer
				const responseMsg = message as FileAcceptMessage | FileDeclineMessage; // Use specific types
				const originalSenderNick = responseMsg.originalSender; // Client MUST include who they are responding to
				if (originalSenderNick) {
					console.log(`[${this.manifest.name}] Relaying ${responseMsg.type} for ${responseMsg.fileId} from ${clientNickname} to original sender ${originalSenderNick}`);
					if (!this.webSocketServerManager.sendToClientByNickname(originalSenderNick, responseMsg)) {
						console.warn(`[${this.manifest.name}] Cannot relay ${responseMsg.type}: Original sender ${originalSenderNick} not found.`);
						// TODO: Maybe notify client who sent accept/decline that original sender is offline?
					}
				} else {
					console.warn(`[${this.manifest.name}] Cannot relay ${responseMsg.type}: Original sender not specified in message from ${clientNickname}.`, responseMsg);
				}
				break;
			}
			// TODO: Handle file chunks ('fileChunk' type?) - receive chunk from client, relay to intended recipient(s)
			// case 'fileChunk': { ... }
			default:
				console.warn(`[${this.manifest.name}] Received unhandled message type from client ${clientNickname}:`, message.type);
		}
	}

	// --- User List Management ---

	private handleUserFound(userInfo: UserInfo): void {
		// Add/Update user in local map
		this.knownUsers.set(userInfo.nickname, userInfo);
		// Update UI list
		this.chatView?.addUserToList(userInfo); // Expects UserInfo { nickname }

		// If WE are the server, broadcast userJoin to others (except the new user)
		if (this.settings.role === 'server' && this.webSocketServerManager && userInfo.nickname !== this.settings.userNickname) {
			const joinPayload: UserJoinMessage = {
				type: 'userJoin',
				nickname: userInfo.nickname,
				timestamp: Date.now() // Add timestamp
			};
			// Find client ID to exclude them from broadcast
			const clientIdToExclude = this.webSocketServerManager.findClientIdByNickname(userInfo.nickname);
			this.webSocketServerManager.broadcast(clientIdToExclude, joinPayload);
		}
	}

	private handleUserLeft(userInfo: { nickname: string }): void {
		if (this.knownUsers.delete(userInfo.nickname)) {
			console.log(`[${this.manifest.name}] User Left: ${userInfo.nickname}`);
			this.chatView?.removeUserFromList(userInfo.nickname);
			// If WE are the server, broadcast userLeave to everyone else
			if (this.settings.role === 'server' && this.webSocketServerManager) {
				const leavePayload: UserLeaveMessage = {
					type: 'userLeave',
					nickname: userInfo.nickname,
					timestamp: Date.now() // Add timestamp
				};
				this.webSocketServerManager.broadcast(null, leavePayload); // null clientId = send to all
			}
		}
	}

	public getAllUsers(): UserInfo[] {
		return Array.from(this.knownUsers.values());
	}

	// --- Public Methods (API for ChatView) ---

	async sendMessage(recipientNickname: string | null, message: string): Promise<void> {
		const senderNickname = this.settings.userNickname;
		if (!message?.trim()) return;
		const trimmedMessage = message.trim();
		const timestamp = Date.now();

		this.chatView?.displayMessage(senderNickname, trimmedMessage, timestamp, true);
		// TODO: Save history -> { ..., status: 'sending' }

		const payload: TextMessage = { type: 'text', senderNickname, content: trimmedMessage, timestamp, recipient: recipientNickname };
		let noticeMessage: string | null = null;

		try {
			if (this.settings.role === 'client' && this.webSocketClientManager) {
				await this.webSocketClientManager.sendMessage(payload);
				// TODO: Update history status? ('sent')
			} else if (this.settings.role === 'server' && this.webSocketServerManager) {
				this.webSocketServerManager.handleLocalMessage(payload, recipientNickname);
				// TODO: Update history status? ('sent'/'delivered' handled locally)
			} else {
				throw new Error("Chat service not configured or active.");
			}
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error sending message:`, error);
			noticeMessage = `Send Error: ${error.message}`;
			// TODO: Update history status ('failed')
		}
		if (noticeMessage) new Notice(noticeMessage);
	}

	// --- File Transfer Methods (Need complete rewrite for WebSockets) ---

	/** Initiates sending a file selected by the user - NEEDS WS REWRITE */
	/**
	 * Initiates the process of sending a file selected by the user.
	 * Stores offer details, updates local UI, and sends a 'fileOffer' message via WebSocket.
	 * @param file The File object selected by the user.
	 * @param recipientNickname Target user's nickname, or null for broadcast.
	 */
	async initiateSendFile(file: File, recipientNickname: string | null): Promise<void> {
		const pluginName = `[${this.manifest.name}]`; // For logging

		// 1. --- Prerequisite Checks ---
		const isActiveManager = this.settings.role === 'client' ? this.webSocketClientManager : this.webSocketServerManager;
		if (!isActiveManager) {
			new Notice("Chat service is not ready to send files.");
			console.error(`${pluginName} initiateSendFile: No active WebSocket manager.`);
			return;
		}
		// Check UserDiscovery only if sending a private message/offer
		// if (recipientNickname !== null && !this.userDiscover) {
		if (recipientNickname !== null) {

			new Notice("User discovery service not ready for private file offer.");
			console.warn(`${pluginName} initiateSendFile: UserDiscovery needed for private offer to ${recipientNickname}`);
			return;
		}

		// 2. --- Gather File Information ---
		const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const filename = file.name;
		const size = file.size;

		// 3. --- CRITICAL: Determine File Path (Placeholder Logic) ---
		// Retrieving a usable, persistent file path from a File object chosen via
		// <input type="file"> is generally NOT possible in standard web/Electron contexts
		// due to security restrictions. The '.path' property is non-standard.
		//
		// >> RECOMMENDED REAL IMPLEMENTATION STRATEGY: <<
		// A) Copy File: Use `file.arrayBuffer()` then `app.vault.adapter.writeBinary()`
		//    to save a copy to a temporary location (e.g., plugin data folder, vault temp).
		//    Store the path to THIS COPY in `filePath`. Manage cleanup of temp files.
		// B) Read Immediately: Read the file content into an ArrayBuffer here and store IT
		//    in the offer state (instead of filePath). This might consume significant memory.
		//
		// Using the placeholder below WILL LIKELY FAIL during the actual upload step.
		const filePath = (file as any).path; // Non-standard, likely undefined or unreliable!

		if (!filePath || typeof filePath !== 'string') {
			const errorMsg = "Error: Could not determine file path. File sending may require copying the file first (feature not fully implemented).";
			new Notice(errorMsg, 10000);
			console.error(`${pluginName} initiateSendFile: Failed to determine file path for '${filename}'. '.path' property is unreliable.`);
			// Do not proceed without a path (or alternative data handling)
			return;
		}
		console.warn(`${pluginName} initiateSendFile: Using potentially unreliable file path: ${filePath}`); // Warn about placeholder

		// 4. --- Store Offer State ---
		const offerState: OutgoingFileOfferState = {
			fileId,
			filePath, // Store the obtained path (needs reliable source)
			filename,
			size,
			recipientNickname
		};
		this.outgoingFileOffers.set(fileId, offerState);
		console.log(`${pluginName} Stored outgoing file offer: ${filename} (ID: ${fileId})`);

		// 5. --- Update Local UI ---
		// Show pending upload status in the chat view
		this.chatView?.displayUploadProgress({ fileId, filename, size, recipientNickname });

		// 6. --- Prepare and Send Network Offer ---
		const fileOfferPayload: FileOfferMessage = {
			type: 'fileOffer',
			senderNickname: this.settings.userNickname,
			fileId,
			filename,
			size,
			recipient: recipientNickname, // Include recipient for server routing
			timestamp: Date.now()
		};

		let noticeMessage: string | null = null;
		try {
			console.log(`${pluginName} Sending fileOffer ${fileId} (To: ${recipientNickname ?? 'broadcast'})...`);
			if (this.settings.role === 'client') {
				if (!this.webSocketClientManager) throw new Error("Client manager not available.");
				await this.webSocketClientManager.sendMessage(fileOfferPayload);
			} else { // Role is 'server'
				if (!this.webSocketServerManager) throw new Error("Server manager not available.");
				// Server handles sending its own offer via handleLocalMessage
				this.webSocketServerManager.handleLocalMessage(fileOfferPayload, recipientNickname);
			}
			console.log(`${pluginName} File offer ${fileId} sent successfully.`);
			// Now wait for 'fileAccept' or 'fileDecline' message

		} catch (error: any) {
			console.error(`${pluginName} Error sending fileOffer for ${fileId}:`, error);
			noticeMessage = `Error sending file offer: ${error.message}`;
			// Clean up failed offer state
			this.outgoingFileOffers.delete(fileId);
			// Update UI to show error
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, size, 'error');
		}

		// Show notice if sending failed
		if (noticeMessage) {
			new Notice(noticeMessage);
		}
	}

	/** Called by client UI to accept an offer */
	async acceptFileOffer(senderNickname: string, fileId: string): Promise<void> {
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) { new Notice("Error: File offer not found or already handled."); return; }

		console.log(`[${this.manifest.name}] Accepting file offer ${fileId} from ${senderNickname}`);

		// 1. Update local UI immediately
		this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size, 'accepted'); // 'accepted' status

		// 2. Prepare payload to send back
		const payload: FileAcceptMessage = {
			type: 'fileAccept',
			senderNickname: this.settings.userNickname, // We are the one accepting
			fileId: fileId,
			originalSender: senderNickname, // Tell server/client who the original offer was from
			timestamp: Date.now()
		};

		// 3. Send accept message via network
		let noticeMessage: string | null = null;
		try {
			if (this.settings.role === 'client' && this.webSocketClientManager) {
				await this.webSocketClientManager.sendMessage(payload);
			} else if (this.settings.role === 'server' && this.webSocketServerManager) {
				// Server accepts an offer shown on its own UI -> tell the original sender
				if (!this.webSocketServerManager.sendToClientByNickname(senderNickname, payload)) {
					throw new Error(`Cannot send acceptance, user ${senderNickname} not found.`);
				}
			} else {
				throw new Error("Chat service not configured or active.");
			}
			console.log(`[${this.manifest.name}] File acceptance for ${fileId} sent.`);
			// TODO: Now prepare to receive binary data for this fileId!
			// This involves setting up a buffer/stream associated with fileId
			// possibly in NetworkManager or ClientManager/ServerManager's binary message handler
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error sending file acceptance for ${fileId}:`, error);
			noticeMessage = `Error accepting file: ${error.message}`;
			// Revert UI / cleanup state?
			this.incomingFileOffers.delete(fileId); // Remove offer if accept failed to send
			this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size, 'error');
		}
		if (noticeMessage) new Notice(noticeMessage);
	}

	/** Called by client UI to decline an offer */
	async declineFileOffer(senderNickname: string, fileId: string): Promise<void> {
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) { this.chatView?.updateFileProgress?.(fileId, 'download', 0, 0, 'declined'); return; } // Already handled

		console.log(`[${this.manifest.name}] Declining file offer ${fileId} from ${senderNickname}`);

		// Update UI immediately
		this.incomingFileOffers.delete(fileId); // Remove locally first
		this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size || 0, 'declined');

		// Prepare decline message
		const payload: FileDeclineMessage = {
			type: 'fileDecline',
			senderNickname: this.settings.userNickname, // We are declining
			fileId: fileId,
			originalSender: senderNickname,
			timestamp: Date.now()
		};

		// Try to send decline message (best effort)
		try {
			if (this.settings.role === 'client' && this.webSocketClientManager) {
				await this.webSocketClientManager.sendMessage(payload);
			} else if (this.settings.role === 'server' && this.webSocketServerManager) {
				if (!this.webSocketServerManager.sendToClientByNickname(senderNickname, payload)) {
					console.warn(`[${this.manifest.name}] Cannot send decline, user ${senderNickname} not found.`);
				}
			} else {
				// Service not ready, but we declined locally anyway
			}
			console.log(`[${this.manifest.name}] Decline message for ${fileId} sent (or attempted).`);
		} catch (error: any) {
			console.warn(`[${this.manifest.name}] Error sending file decline for ${fileId}: ${error.message}`);
			// No notice to user, they already see the decline in UI
		}
	}



	/** This method is called by handleServerMessage when a remote user declines OUR file offer */
	private handleRemoteFileDecline(fileId: string, remoteUserNickname: string): void {
		const offer = this.outgoingFileOffers.get(fileId);
		if (offer) {
			console.log(`[${this.manifest.name}] User ${remoteUserNickname} declined file ${offer.filename} (ID: ${fileId})`);
			new Notice(`User ${remoteUserNickname} declined file: ${offer.filename}`);
			this.outgoingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size || 0, 'declined');
		} else {
			console.warn(`[${this.manifest.name}] Received remote fileDecline for unknown outgoing offer ID: ${fileId}`);
		}
	}
	/**
		* Обробляє ситуацію, коли віддалений користувач прийняв НАШУ пропозицію файлу.
		* Запускає процес читання файлу та надсилання його частин через WebSocket.
		* @param fileId Ідентифікатор файлу, пропозицію якого прийняли.
		* @param remoteUserNickname Нікнейм користувача, який прийняв пропозицію.
		*/
	private async handleRemoteFileAccept(fileId: string, remoteUserNickname: string): Promise<void> {
		const offer = this.outgoingFileOffers.get(fileId);
		if (!offer) {
			console.warn(`[${this.manifest.name}] Received acceptance for unknown outgoing offer ${fileId}`);
			return;
		}

		console.log(`[${this.manifest.name}] User ${remoteUserNickname} accepted file ${offer.filename} (ID: ${fileId}). Preparing upload...`);

		// 1. Перевірка доступності файлу за шляхом filePath
		// ВИДАЛЯЄМО перевірку offer.fileObject
		// Перевіряємо offer.filePath за допомогою адаптера
		const fileExists = await this.adapterFileExists(offer.filePath);

		if (!fileExists) {
			console.error(`[${this.manifest.name}] Cannot start upload for ${fileId}: File not accessible at path: ${offer.filePath}.`);
			console.error(`Reminder: The method to obtain 'filePath' in 'initiateSendFile' needs a proper implementation (e.g., copying the file).`);
			new Notice(`Error starting upload: Cannot access file ${offer.filename}`);
			// Повідомляємо UI про помилку та очищаємо стан
			this.outgoingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size, 'error');
			// TODO: Можливо, варто надіслати повідомлення про помилку користувачу, який прийняв пропозицію?
			return;
		}

		// 2. Файл доступний, оновлюємо UI і готуємось до надсилання
		this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size, 'starting'); // Статус початку надсилання

		// --- КРИТИЧНЕ TODO: Реалізувати читання файлу та надсилання через WebSocket ---
		console.error("<<<<< FILE UPLOAD STREAMING VIA WEBSOCKET IS NOT IMPLEMENTED >>>>>");
		new Notice(`File upload streaming for ${offer.filename} not implemented yet.`);
		// Тут має бути логіка:
		// - Створити ReadStream для offer.filePath (використовуючи Node.js 'fs' на десктопі).
		// - Читати файл частинами (chunks).
		// - Для кожного chunk:
		//   - Формувати бінарне повідомлення WebSocket (можливо, з метаданими: fileId, chunkIndex, isLast).
		//   - Надсилати через активний WebSocket менеджер (клієнтський або серверний для ретрансляції).
		//   - Оновлювати UI прогресу через this.handleFileTransferProgress.
		// - Обробляти завершення потоку (надіслати фінальне повідомлення).
		// - Обробляти помилки читання потоку.

		// Тимчасово симулюємо помилку, оскільки функціонал не реалізовано:
		setTimeout(() => {
			console.warn(`[${this.manifest.name}] Placeholder: Simulating error for unimplemented upload of ${fileId}`);
			this.handleFileTransferError(fileId, 'upload', new Error("File upload streaming not implemented"));
		}, 1500);
	}

	// --- Обробник повідомлення типу 'fileAccept' від сервера/клієнта ---
	// Цей метод викликає handleRemoteFileAccept
	// Потрібно переконатися, що він передає правильні параметри
	private handleFileAcceptReceived(
		senderInfo: { clientId?: string | null, nickname: string }, // Отримуємо нік того, ХТО ПРИЙНЯВ
		message: FileAcceptMessage // Повідомлення містить fileId та originalSender (той, ХТО НАДСИЛАВ ПРОПОЗИЦІЮ)
	): void {
		// Переконуємось, що ми є тим, хто надсилав пропозицію
		if (message.originalSender === this.settings.userNickname) {
			console.log(`[${this.manifest.name}] Handling fileAccept message from ${senderInfo.nickname} for our offer ${message.fileId}`);
			// Викликаємо метод, який почне завантаження файлу
			// Передаємо fileId і нік того, хто прийняв (remoteUserNickname)
			this.handleRemoteFileAccept(message.fileId, senderInfo.nickname);
		} else {
			// Це прийняття пропозиції, яку надсилав хтось інший (сервер переслав нам помилково?)
			console.warn(`[${this.manifest.name}] Received fileAccept message for an offer not originated by us. Original Sender: ${message.originalSender}, File ID: ${message.fileId}`);
		}
	}
	/**
	 * Обробляє помилку, що виникла під час передачі файлу (upload або download).
	 * Викликається відповідним WebSocket менеджером.
	 * @param fileId Ідентифікатор передачі файлу, де сталася помилка.
	 * @param direction Напрямок передачі ('upload' або 'download').
	 * @param error Об'єкт помилки.
	 */
	private handleFileTransferError(fileId: string, direction: 'upload' | 'download', error: Error): void {
		console.error(`[${this.manifest.name}] File transfer error: ${fileId} (${direction})`, error);

		// Спробуємо знайти інформацію про файл для більш інформативного повідомлення
		const offer = (direction === 'upload')
			? this.outgoingFileOffers.get(fileId)
			: this.incomingFileOffers.get(fileId);
		const filename = offer?.filename || 'файл'; // Використовуємо назву з пропозиції або заглушку

		// Показуємо повідомлення користувачу
		new Notice(`Помилка передачі файлу '${filename}': ${error.message}`, 7000); // Показуємо довше

		// Очищуємо стан для цієї передачі файлу
		if (direction === 'upload') {
			this.outgoingFileOffers.delete(fileId);
		} else { // direction === 'download'
			this.incomingFileOffers.delete(fileId);
		}

		// Оновлюємо UI, щоб показати статус помилки
		// Передаємо 0/0 для байтів/розміру, оскільки передача не завершена
		this.chatView?.updateFileProgress?.(fileId, direction, 0, 0, 'error');
	}

	// --- Settings Management ---
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		console.log(`[${this.manifest.name}] Settings saved.`);
		// TODO: Handle role/address/port changes - this currently requires an Obsidian restart
		// A Notice is added in SettingsTab to inform the user.
	}

	// Last version of activateView provided
	async activateView() {
		const { workspace } = this.app;
		let leafToReveal: WorkspaceLeaf | null = null; // Initialized as potentially null

		const existingLeaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			leafToReveal = existingLeaves[0]; // Assigned non-null WorkspaceLeaf
		} else {
			// Try to create new leaf
			let newLeaf = workspace.getRightLeaf(false) ?? workspace.getLeftLeaf(false); // Result is WorkspaceLeaf | null
			if (newLeaf) { // Check if leaf was created
				leafToReveal = newLeaf; // Assigned non-null WorkspaceLeaf
				await leafToReveal.setViewState({ type: CHAT_VIEW_TYPE, active: true });
			} else {
				// Could not create leaf
				console.error("Could not get a side leaf.");
				new Notice("Error opening chat panel.");
				return; // Exit function
			}
		}

		// Final check before revealing
		if (leafToReveal) { // Explicit null check
			workspace.revealLeaf(leafToReveal); // Inside check, leafToReveal is WorkspaceLeaf
		} else {
			console.error(`Logic error in activateView: leafToReveal is unexpectedly null.`);
		}
	}

	// --- Helpers ---
	private isChatViewActive(): boolean {
		const activeLeaf = this.app.workspace.activeLeaf;
		return !!activeLeaf && activeLeaf.getViewState().type === CHAT_VIEW_TYPE;
	}

	/** Determines absolute path for saving, handling conflicts and default folders */
	private async determineSavePath(filename: string): Promise<string> {
		let downloadDir = this.settings.downloadPath?.trim() || '';

		// Use default attachment folder if downloadPath is empty
		if (!downloadDir) {
			try {
				const attachmentPathSetting = (this.app.vault as any).getConfig('attachmentFolderPath');
				if (attachmentPathSetting && typeof attachmentPathSetting === 'string') {
					downloadDir = attachmentPathSetting.startsWith('/') ? attachmentPathSetting.substring(1) : attachmentPathSetting;
				} else { downloadDir = ''; } // Fallback to vault root if setting invalid/missing
			} catch (e) {
				console.warn(`[${this.manifest.name}] Error reading attachment folder setting, using vault root.`, e);
				downloadDir = '';
			}
		}

		// Ensure download directory exists relative to vault root
		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(downloadDir);
			if (abstractFile && !(abstractFile instanceof TFolder)) { // Use TFolder
				console.warn(`[${this.manifest.name}] Download path '${downloadDir}' is not a folder. Using vault root.`);
				downloadDir = '';
			} else if (!abstractFile && downloadDir) { // Only create if not vault root
				await this.app.vault.createFolder(downloadDir);
			}
		} catch (err) {
			console.error(`[${this.manifest.name}] Error ensuring download directory '${downloadDir}' exists. Using vault root.`, err);
			downloadDir = '';
		}

		// Get absolute base path using adapter (use check for getBasePath)
		const adapter = this.app.vault.adapter as any;
		if (typeof adapter.getBasePath !== 'function') {
			throw new Error("Cannot determine vault base path via adapter.");
		}
		const absoluteDir = path.join(adapter.getBasePath(), downloadDir);

		// Handle filename conflicts reliably
		let counter = 0;
		const sanitizedOriginalName = this.sanitizeFilename(filename);
		let finalFilename = sanitizedOriginalName;
		let savePath = path.join(absoluteDir, finalFilename);
		const maxAttempts = 100;

		while (await this.adapterFileExists(savePath) && counter < maxAttempts) {
			counter++;
			const extension = path.extname(sanitizedOriginalName);
			const baseName = path.basename(sanitizedOriginalName, extension);
			finalFilename = `${baseName} (${counter})${extension}`;
			savePath = path.join(absoluteDir, finalFilename);
		}
		if (counter >= maxAttempts) throw new Error(`Failed to find unique filename for ${filename}`);
		console.log(`[${this.manifest.name}] Determined save path: ${savePath}`);
		return savePath;
	}

	// Helper uses adapter stat for potentially better reliability within Obsidian
	private async adapterFileExists(absolutePath: string): Promise<boolean> {
		try {
			const adapter = this.app.vault.adapter as any;
			if (typeof adapter.getBasePath !== 'function' || typeof adapter.stat !== 'function') {
				console.warn("[adapterFileExists] Adapter missing required methods, falling back to fs.existsSync");
				return fs.existsSync(absolutePath);
			}
			const vaultBasePath = adapter.getBasePath();
			const vaultRelativePath = path.relative(vaultBasePath, absolutePath).replace(/\\/g, '/'); // Use forward slashes

			if (!vaultRelativePath || vaultRelativePath.startsWith('..')) {
				// Path seems outside vault, fs.existsSync might be more appropriate? Or just return false?
				console.warn(`[adapterFileExists] Path outside vault? ${vaultRelativePath}. Using fs.existsSync.`);
				return fs.existsSync(absolutePath);
			}
			return !!(await adapter.stat(vaultRelativePath));
		} catch (e) { return false; } // stat throws error if not found
	}

	private sanitizeFilename(filename: string): string {
		const forbiddenChars = /[<>:"/\\|?*\x00-\x1F]/g;
		const reservedNames = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
		let sanitized = filename.replace(forbiddenChars, '_');
		if (reservedNames.test(sanitized)) sanitized = `_${sanitized}`;
		return (sanitized.trim() || "downloaded_file").substring(0, 200); // Add length limit
	}

}