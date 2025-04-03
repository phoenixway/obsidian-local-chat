// main.ts
import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFolder } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './ChatView';
import { NetworkManager, NetworkManagerCallbacks } from './NetworkManager';
import { UserDiscovery, UserDiscoveryCallbacks, UserDiscoveryConfig } from './UserDiscovery'; // Assuming UserDiscovery exports these
import * as fs from 'fs';
import * as path from 'path';

// --- Interfaces & Types ---

// Export UserInfo so UserDiscovery.ts can import it from here
export interface UserInfo {
	nickname: string;
	ip: string;
	port: number;
}

// Define settings interface
interface LocalChatPluginSettings {
	userNickname: string;
	listenPort: number;
	saveHistory: boolean;
	downloadPath: string; // Path relative to vault root, or empty for default attachment folder
}

// --- Constants ---

export const DEFAULT_SETTINGS: LocalChatPluginSettings = {
	userNickname: `ObsidianUser_${Math.random().toString(36).substring(2, 8)}`,
	listenPort: 61337,
	saveHistory: true,
	downloadPath: '',
}

// --- Main Plugin Class ---

export default class LocalChatPlugin extends Plugin {
	settings: LocalChatPluginSettings;
	chatView: ChatView | null = null;
	networkManager: NetworkManager | null = null;
	userDiscovery: UserDiscovery | null = null; // Initialize as null

	// File transfer state
	private outgoingFileOffers: Map<string, { fileId: string; filePath: string; filename: string; size: number; recipientNickname: string | null; }> = new Map();
	private incomingFileOffers: Map<string, { fileId: string; filename: string; size: number; senderNickname: string; senderAddress: string; }> = new Map();

	// --- Plugin Lifecycle ---

	async onload() {
		const pluginName = `[${this.manifest.name}]`;
		console.log(`${pluginName} Loading plugin...`);

		await this.loadSettings();
		console.log(`${pluginName} Settings loaded. Nickname: ${this.settings.userNickname}, Port: ${this.settings.listenPort}`);

		// Define callbacks
		const networkCallbacks: NetworkManagerCallbacks = this.createNetworkCallbacks();
		const discoveryCallbacks: UserDiscoveryCallbacks = this.createUserDiscoveryCallbacks();

		// Initialize Network components
		this.networkManager = new NetworkManager(this.settings.listenPort, networkCallbacks);
		this.userDiscovery = new UserDiscovery({
			nickname: this.settings.userNickname,
			port: this.settings.listenPort
		}, discoveryCallbacks);

		// Start network services sequentially
		try {
			await this.networkManager.startServer();
			console.log(`${pluginName} TCP server started on port ${this.settings.listenPort}.`);

			await this.userDiscovery.start();
			console.log(`${pluginName} User discovery started.`);

			new Notice(`${this.manifest.name}: Chat service active.`);

		} catch (error: any) {
			console.error(`${pluginName} CRITICAL ERROR starting network services:`, error);
			new Notice(`[${this.manifest.name}] Failed to start chat services! Error: ${error.message}. Chat will be unavailable.`);
			await this.cleanupNetworkServices(); // Attempt cleanup
			return; // Prevent further loading
		}

		// Register Obsidian UI components
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => {
				this.chatView = new ChatView(leaf, this);
				this.populateInitialChatViewState(); // Populate users/history on view open
				return this.chatView;
			}
		);

		this.addRibbonIcon('message-circle', 'Open Local Chat', () => this.activateView());
		this.addCommand({
			id: 'open-local-chat-view',
			name: 'Open Local Chat panel',
			callback: () => this.activateView(),
		});
		this.addSettingTab(new ChatSettingTab(this.app, this));

		console.log(`${pluginName} Plugin loaded successfully.`);
	}

	async onunload() {
		console.log(`[${this.manifest.name}] Unloading plugin...`);
		await this.cleanupNetworkServices();

		// Clean up UI and plugin state
		this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
		this.chatView = null;
		this.outgoingFileOffers.clear();
		this.incomingFileOffers.clear();

		console.log(`[${this.manifest.name}] Plugin unloaded.`);
	}

	/** Populates the chat view with current users and potentially history */
	private populateInitialChatViewState(): void {
		if (!this.chatView) return;
		// Add currently known users to the list
		this.userDiscovery?.getAllUsers().forEach(user => this.chatView?.addUserToList(user));
		// TODO: Load and display chat history from storage
		console.log(`[${this.manifest.name}] Populated initial chat view state.`);
	}

	// --- Network Service Cleanup ---
	private async cleanupNetworkServices(): Promise<void> {
		if (this.userDiscovery) {
			try {
				await this.userDiscovery.stop();
				console.log(`[${this.manifest.name}] User discovery stopped.`);
			} catch (err) { console.error(`[${this.manifest.name}] Error stopping UserDiscovery:`, err); }
			this.userDiscovery = null;
		}
		if (this.networkManager) {
			try {
				await this.networkManager.stopServer();
				console.log(`[${this.manifest.name}] TCP server stopped.`);
			} catch (err) { console.error(`[${this.manifest.name}] Error stopping NetworkManager:`, err); }
			this.networkManager = null;
		}
	}

	// --- Callback Creation ---

	private createNetworkCallbacks(): NetworkManagerCallbacks {
		// Return the object with bound methods
		return {
			onMessageReceived: this.handleIncomingMessage.bind(this),
			onFileOfferReceived: this.handleIncomingFileOffer.bind(this),
			onFileAcceptReceived: this.handleFileAcceptReceived.bind(this),
			onFileDeclineReceived: this.handleFileDeclineReceived.bind(this),
			onFileTransferStart: this.handleFileTransferStart.bind(this),
			onFileTransferProgress: this.handleFileTransferProgress.bind(this),
			onFileTransferComplete: this.handleFileTransferComplete.bind(this),
			onFileTransferError: this.handleFileTransferError.bind(this),
			onClientConnected: (clientInfo) => console.log(`[${this.manifest.name}] Client connected: ${clientInfo.ip}:${clientInfo.port}`),
			onClientDisconnected: (clientInfo) => console.log(`[${this.manifest.name}] Client disconnected: ${clientInfo.ip}:${clientInfo.port}`),
			onNetworkError: (context, error) => {
				const isCommonError = ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'].some(code => error.message.includes(code));
				if (isCommonError) console.warn(`[${this.manifest.name}] Network Error (${context}): ${error.message}`);
				else { console.error(`[${this.manifest.name}] Serious Network Error (${context}):`, error); new Notice(`Network Error (${context}): ${error.message}`); }
			},
		};
	}

	private createUserDiscoveryCallbacks(): UserDiscoveryCallbacks {
		// Return the object with bound methods
		return {
			onUserFound: this.handleUserFound.bind(this),
			onUserLeft: this.handleUserLeft.bind(this),
			onDiscoveryError: (context, error) => {
				console.error(`[${this.manifest.name}] Discovery Error (${context}):`, error);
				new Notice(`Discovery Error: ${error.message}`);
			}
		};
	}

	// --- Network & Discovery Callback Handlers ---

	private handleIncomingMessage(sender: { ip: string, port: number }, message: any): void {
		const senderInfo = this.userDiscovery?.getAllUsers().find(u => u.ip === sender.ip && u.port === sender.port);
		const senderNickname = senderInfo?.nickname || message.senderNickname || `${sender.ip}:${sender.port}`;

		if (message.type === 'text' && message.content) {
			console.log(`[${this.manifest.name}] Received text from ${senderNickname}`);
			this.chatView?.displayMessage(senderNickname, message.content, message.timestamp || Date.now(), false);
			// TODO: Save message to history
			if (!this.isChatViewActive()) new Notice(`${senderNickname}: ${message.content.substring(0, 50)}...`);
		} else {
			console.warn(`[${this.manifest.name}] Received unknown message type:`, message);
		}
	}

	private handleIncomingFileOffer(sender: { ip: string, port: number }, fileInfo: { fileId: string, filename: string, size: number }): void {
		const senderInfo = this.userDiscovery?.getAllUsers().find(u => u.ip === sender.ip && u.port === sender.port);
		const senderNickname = senderInfo?.nickname || "Unknown Sender"; // Use found nickname or fallback
		const senderAddress = `${sender.ip}:${sender.port}`;

		console.log(`[${this.manifest.name}] Received file offer '${fileInfo.filename}' from ${senderNickname} (${senderAddress}) (ID: ${fileInfo.fileId})`);
		this.incomingFileOffers.set(fileInfo.fileId, { ...fileInfo, senderNickname, senderAddress });
		this.chatView?.displayFileOffer(senderNickname, fileInfo);
		if (!this.isChatViewActive()) new Notice(`File offer '${fileInfo.filename}' from ${senderNickname}`);
	}

	private handleFileAcceptReceived(sender: { ip: string, port: number }, fileId: string): void {
		console.log(`[${this.manifest.name}] Received fileAccept for ${fileId} from ${sender.ip}:${sender.port}`);
		const offer = this.outgoingFileOffers.get(fileId);

		if (!offer) { console.error(`[${this.manifest.name}] Unknown outgoing offer ID for fileAccept: ${fileId}`); return; }
		if (!this.networkManager) { console.error(`[${this.manifest.name}] NM inactive, cannot start transfer ${fileId}`); return; }

		console.log(`[${this.manifest.name}] Starting upload for ${offer.filename}`);
		this.networkManager.startFileTransfer(sender.ip, sender.port, fileId, offer.filePath)
			.then(() => console.log(`[${this.manifest.name}] Upload initiated for ${fileId}.`))
			.catch(err => {
				console.error(`[${this.manifest.name}] Failed initiate startFileTransfer ${fileId}:`, err);
				new Notice(`Failed to start sending ${offer.filename}.`);
				this.outgoingFileOffers.delete(fileId);
				this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size, 'error');
			});
	}

	private handleFileDeclineReceived(sender: { ip: string, port: number }, fileId: string): void {
		console.log(`[${this.manifest.name}] Received fileDecline for ${fileId} from ${sender.ip}:${sender.port}`);
		const offer = this.outgoingFileOffers.get(fileId);
		if (offer) {
			new Notice(`User declined file: ${offer.filename}`);
			this.outgoingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size || 0, 'declined');
		} else {
			console.warn(`[${this.manifest.name}] Received fileDecline for unknown outgoing offer ID: ${fileId}`);
		}
	}

	private handleFileTransferStart(fileId: string, direction: 'upload' | 'download', totalSize: number): void {
		console.log(`[${this.manifest.name}] Transfer started: ${fileId} (${direction}), Size: ${totalSize}`);
		this.chatView?.updateFileProgress?.(fileId, direction, 0, totalSize, 'starting');
	}

	private handleFileTransferProgress(fileId: string, direction: 'upload' | 'download', transferredBytes: number, totalSize: number): void {
		this.chatView?.updateFileProgress?.(fileId, direction, transferredBytes, totalSize, 'progressing');
	}

	private handleFileTransferComplete(fileId: string, direction: 'upload' | 'download', filePath: string | null): void {
		const offer = direction === 'download' ? this.incomingFileOffers.get(fileId) : this.outgoingFileOffers.get(fileId);
		const filename = offer?.filename || (filePath ? path.basename(filePath) : 'file');
		const offerSize = offer?.size || 0;

		const message = direction === 'download' ? `File '${filename}' received.` : `File '${filename}' sent.`;
		console.log(`[${this.manifest.name}] ${message} (ID: ${fileId})`);
		new Notice(message, 4000); // Show notice for 4 seconds

		if (direction === 'download') this.incomingFileOffers.delete(fileId);
		if (direction === 'upload') this.outgoingFileOffers.delete(fileId);
		this.chatView?.updateFileProgress?.(fileId, direction, offerSize, offerSize, 'completed');
	}

	private handleFileTransferError(fileId: string, direction: 'upload' | 'download', error: Error): void {
		console.error(`[${this.manifest.name}] File transfer error: ${fileId} (${direction})`, error);
		const offer = (direction === 'upload') ? this.outgoingFileOffers.get(fileId) : this.incomingFileOffers.get(fileId);
		const filename = offer?.filename || 'file';
		new Notice(`Error transferring file '${filename}': ${error.message}`, 5000); // Show error longer

		if (direction === 'upload') this.outgoingFileOffers.delete(fileId);
		if (direction === 'download') this.incomingFileOffers.delete(fileId);
		this.chatView?.updateFileProgress?.(fileId, direction, 0, 0, 'error');
	}

	private handleUserFound(userInfo: UserInfo): void {
		console.log(`[${this.manifest.name}] User Found: ${userInfo.nickname} (${userInfo.ip}:${userInfo.port})`);
		this.chatView?.addUserToList(userInfo);
		// TODO: Request history from new user or send welcome?
	}

	private handleUserLeft(userInfo: { nickname: string }): void {
		console.log(`[${this.manifest.name}] User Left: ${userInfo.nickname}`);
		this.chatView?.removeUserFromList(userInfo.nickname);
	}

	// --- Public Methods (API for ChatView) ---

	/** Sends a text message */
	async sendMessage(recipientNickname: string | null, message: string): Promise<void> {
		const senderNickname = this.settings.userNickname;
		const timestamp = Date.now();
		if (!message?.trim()) return;
		const trimmedMessage = message.trim();

		// Display & Save locally first
		this.chatView?.displayMessage(senderNickname, trimmedMessage, timestamp, true);
		// TODO: Save to history -> { ..., status: 'sending' }

		// Check prerequisites
		if (!this.networkManager) { new Notice("Network Error: Service not active."); /* TODO: update history status */ return; }
		if (recipientNickname !== null && !this.userDiscovery) { new Notice("Discovery Error: Cannot send private message."); /* TODO: update history status */ return; }

		const nm = this.networkManager;
		const ud = this.userDiscovery;
		const payload = { type: 'text', senderNickname, content: trimmedMessage, timestamp };
		let noticeMessage: string | null = null;
		let failedSends = 0;

		try {
			if (recipientNickname === null) { // Broadcast
				const recipients = ud ? ud.getAllUsers().filter((user) => user.nickname !== senderNickname) : [];
				if (recipients.length === 0) { console.log(`[${this.manifest.name}] No users for broadcast.`); return; }

				const results = await Promise.allSettled(
					recipients.map((user) => nm.sendData(user.ip, user.port, payload).catch(err => Promise.reject({ nickname: user.nickname, error: err })))
				);
				failedSends = results.filter(r => r.status === 'rejected').length;
				if (failedSends > 0) {
					console.warn(`[${this.manifest.name}] Failed broadcast to ${failedSends} user(s).`);
					noticeMessage = `Message sent, but failed for ${failedSends} user(s).`;
				} else console.log(`[${this.manifest.name}] Broadcast message initiated for ${recipients.length} users.`);
				// TODO: Update history status (sent/delivered/failed per user?)

			} else { // Private
				const recipientInfo = ud ? ud.getUserInfo(recipientNickname) : null;
				if (!recipientInfo) throw new Error(`User ${recipientNickname} not found.`);
				await nm.sendData(recipientInfo.ip, recipientInfo.port, payload);
				console.log(`[${this.manifest.name}] Private message sent to ${recipientNickname}.`);
				// TODO: Update history status (sent/delivered)
			}
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error sending message:`, error);
			noticeMessage = `Error sending message: ${error.message}`;
			// TODO: Update history status (failed)
		}
		if (noticeMessage) new Notice(noticeMessage);
	}

	/** Initiates sending a file selected by the user */
	async initiateSendFile(file: File, recipientNickname: string | null): Promise<void> {
		if (!this.networkManager) { new Notice("Network service not ready."); return; }
		if (recipientNickname !== null && !this.userDiscovery) { new Notice("User discovery not ready."); return; }

		const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const filename = file.name;
		const size = file.size;

		// --- CRITICAL TODO: Implement reliable filePath retrieval ---
		// This placeholder WILL NOT WORK in a real scenario.
		// Suggestion: Copy the file to plugin's data dir using vault adapter's writeBinary
		// and use the path to the copy. This requires careful management of temporary files.
		const filePath = (file as any).path || `PLACEHOLDER_PATH/${filename}`;
		if (filePath.startsWith("PLACEHOLDER_PATH")) {
			new Notice("Error: File path determination not implemented.", 10000); // Show longer
			console.error("initiateSendFile: CRITICAL - File path determination needs implementation!");
			return;
		}
		// ------------------------------------------------------------

		this.outgoingFileOffers.set(fileId, { fileId, filePath, filename, size, recipientNickname });
		console.log(`[${this.manifest.name}] Initiating file send: ${filename} (ID: ${fileId})`);
		this.chatView?.displayUploadProgress({ fileId, filename, size, recipientNickname }); // Show placeholder in UI

		const fileOfferPayload = { type: 'fileOffer', senderNickname: this.settings.userNickname, fileId, filename, size };
		const nm = this.networkManager;
		const ud = this.userDiscovery;
		let noticeMessage: string | null = null;

		try {
			if (recipientNickname === null) { // Broadcast offer
				const recipients = ud ? ud.getAllUsers().filter(u => u.nickname !== this.settings.userNickname) : [];
				if (recipients.length === 0) throw new Error("No users found to send file offer.");
				const sendPromises = recipients.map(user => nm.sendData(user.ip, user.port, fileOfferPayload).catch(err => console.warn(`Failed sending fileOffer broadcast to ${user.nickname}: ${err.message}`)));
				await Promise.all(sendPromises);
				console.log(`[${this.manifest.name}] File offer ${fileId} broadcasted.`);
			} else { // Private offer
				const userInfo = ud ? ud.getUserInfo(recipientNickname) : null;
				if (!userInfo) throw new Error(`User ${recipientNickname} not found.`);
				await nm.sendData(userInfo.ip, userInfo.port, fileOfferPayload);
				console.log(`[${this.manifest.name}] File offer ${fileId} sent to ${recipientNickname}.`);
			}
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error sending fileOffer for ${fileId}:`, error);
			noticeMessage = `Error sending file offer: ${error.message}`;
			this.outgoingFileOffers.delete(fileId); // Clean up state
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, size, 'error'); // Update UI
		}
		if (noticeMessage) new Notice(noticeMessage);
	}

	/** Accepts an incoming file offer received previously */
	async acceptFileOffer(senderNickname: string, fileId: string): Promise<void> {
		if (!this.networkManager) { new Notice("Network service not ready."); return; }
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) { new Notice("Error: File offer not found or already handled."); return; }

		let senderInfo: UserInfo | null = this.userDiscovery?.getUserInfo(senderNickname) || null;
		if (!senderInfo && offer.senderAddress) { // Fallback to stored address
			const parts = offer.senderAddress.split(':');
			if (parts.length === 2) { const port = parseInt(parts[1]); if (parts[0] && !isNaN(port)) senderInfo = { nickname: senderNickname, ip: parts[0], port }; }
		}
		if (!senderInfo) { new Notice(`Error: Cannot find address for sender ${senderNickname}.`); return; }

		try {
			const savePath = await this.determineSavePath(offer.filename);
			console.log(`[${this.manifest.name}] Accepting file ${fileId}. Save path: ${savePath}`);
			await this.networkManager.prepareToReceiveFile(fileId, savePath, offer.size, `${senderNickname} (${senderInfo!.ip}:${senderInfo!.port})`);
			const payload = { type: 'fileAccept', receiverNickname: this.settings.userNickname, fileId };
			await this.networkManager.sendData(senderInfo!.ip, senderInfo!.port, payload);
			console.log(`[${this.manifest.name}] Acceptance for ${fileId} sent. Waiting for data...`);
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Error accepting file ${fileId}:`, error);
			new Notice(`Error accepting file: ${error.message}`);
			if (this.networkManager && (this.networkManager as any)['receivingFiles']?.has(fileId)) { (this.networkManager as any)['_cleanupReceivingFile'](fileId, error); }
			this.incomingFileOffers.delete(fileId);
			this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size, 'error');
		}
	}

	/** Declines an incoming file offer */
	async declineFileOffer(senderNickname: string, fileId: string): Promise<void> {
		if (!this.networkManager) { console.error("NM not ready"); return; } // No notice, user action
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) { this.chatView?.updateFileProgress?.(fileId, 'download', 0, 0, 'declined'); return; } // Already handled

		let senderInfo: UserInfo | null = this.userDiscovery?.getUserInfo(senderNickname) || null;
		if (!senderInfo && offer.senderAddress) { // Fallback
			const parts = offer.senderAddress.split(':');
			if (parts.length === 2) { const port = parseInt(parts[1]); if (parts[0] && !isNaN(port)) senderInfo = { nickname: senderNickname, ip: parts[0], port }; }
		}

		if (senderInfo) {
			const payload = { type: 'fileDecline', receiverNickname: this.settings.userNickname, fileId };
			// Send decline message, but don't wait or error out if it fails
			this.networkManager.sendData(senderInfo!.ip, senderInfo!.port, payload)
				.then(() => console.log(`[${this.manifest.name}] Decline message for ${fileId} sent.`))
				.catch(error => console.warn(`[${this.manifest.name}] Failed sending decline message for ${fileId}: ${error.message}`));
		} else {
			console.warn(`[${this.manifest.name}] Sender ${senderNickname} not found, cannot send decline for ${fileId}.`);
		}
		// Always cleanup locally and update UI immediately
		this.incomingFileOffers.delete(fileId);
		this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size || 0, 'declined');
	}

	// --- Settings Management ---
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// TODO: Notify NetworkManager/UserDiscovery if nickname/port changed and handle restart/update logic
		console.log(`[${this.manifest.name}] Settings saved.`);
	}

	// У файлі main.ts всередині класу LocalChatPlugin

	// У файлі main.ts всередині класу LocalChatPlugin

	async activateView() {
		const { workspace } = this.app;
		let leafToReveal: WorkspaceLeaf | null = null; // Використовуємо нове ім'я для ясності

		// 1. Шукаємо існуючу панель нашого типу
		const existingLeaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			leafToReveal = existingLeaves[0]; // Знайшли існуючу
			console.log(`[${this.manifest.name}] activateView: Revealing existing leaf.`);
		} else {
			// 2. Якщо існуючої немає, створюємо нову
			console.log(`[${this.manifest.name}] activateView: Creating new leaf.`);
			// Намагаємось створити праворуч
			let newLeaf = workspace.getRightLeaf(false);
			if (!newLeaf) {
				// Якщо праворуч не вийшло, намагаємось ліворуч
				console.log(`[${this.manifest.name}] activateView: Could not get right leaf, trying left.`);
				newLeaf = workspace.getLeftLeaf(false);
			}

			// Перевіряємо, чи вдалося створити панель (ліворуч або праворуч)
			if (newLeaf) {
				leafToReveal = newLeaf; // Запам'ятовуємо створену панель
				await leafToReveal.setViewState({ type: CHAT_VIEW_TYPE, active: true });
				console.log(`[${this.manifest.name}] activateView: New leaf created and view state set.`);
			} else {
				// Якщо не вдалося створити ніде
				console.error(`[${this.manifest.name}] activateView: Failed to get leaf for new view.`);
				new Notice("Error: Could not open chat panel.");
				return; // Виходимо з функції, бо панелі немає
			}
		}

		// 3. Переконуємось, що маємо панель, та активуємо її
		// Додаємо явну перевірку на null перед revealLeaf
		if (leafToReveal) {
			workspace.revealLeaf(leafToReveal); // Тепер TypeScript впевнений, що leafToReveal не null
		} else {
			// Цей блок не мав би виконатись через return вище, але про всяк випадок
			console.error(`[${this.manifest.name}] activateView: leafToReveal is unexpectedly null before revealLeaf.`);
		}
	}

	// ... (решта коду класу LocalChatPlugin) ...

	// ... (решта коду класу LocalChatPlugin) ...

	// --- Helpers ---
	private isChatViewActive(): boolean {
		const activeLeaf = this.app.workspace.activeLeaf;
		return !!activeLeaf && activeLeaf.getViewState().type === CHAT_VIEW_TYPE;
	}

	private async determineSavePath(filename: string): Promise<string> {
		let downloadDir = this.settings.downloadPath?.trim() || '';
		let useDefaultAttachmentFolder = false;

		if (!downloadDir) {
			useDefaultAttachmentFolder = true;
			try {
				// Using undocumented getConfig - safer inside try-catch
				const attachmentPath = (this.app.vault as any).getConfig('attachmentFolderPath');
				if (attachmentPath && typeof attachmentPath === 'string') {
					downloadDir = attachmentPath.startsWith('/') ? attachmentPath.substring(1) : attachmentPath;
				} else { downloadDir = ''; }
			} catch (e) { downloadDir = ''; }
		}

		// Ensure download directory exists relative to vault root
		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(downloadDir);
			// ЗАМІНІТЬ 'Folder' НА 'TFolder' В ЦЬОМУ РЯДКУ:
			if (abstractFile && !(abstractFile instanceof TFolder)) {
				console.warn(`[<span class="math-inline">\{this\.manifest\.name\}\] Specified download path '</span>{downloadDir}' exists but is not a folder. Using vault root.`);
				downloadDir = ''; // Fallback to root if path is not a folder
			} else if (!abstractFile) {
				console.log(`[${this.manifest.name}] Creating download directory: ${downloadDir}`);
				// Перевіряємо чи шлях не порожній перед створенням
				if (downloadDir) {
					await this.app.vault.createFolder(downloadDir);
				} else {
					// Якщо downloadDir порожній (корінь сховища), нічого не створюємо
					console.log(`[${this.manifest.name}] Download path is vault root, no need to create folder.`);
				}
			}
			// Якщо abstractFile існує і є TFolder, нічого не робимо - папка вже існує
		} catch (err) {
			console.error(`[<span class="math-inline">\{this\.manifest\.name\}\] Error ensuring download directory '</span>{downloadDir}' exists, using vault root.`, err);
			downloadDir = ''; // Fallback to root on error
		}

		// Get absolute base path using adapter (undocumented)
		const adapter = this.app.vault.adapter as any;
		if (typeof adapter.getBasePath !== 'function') { throw new Error("Cannot determine vault base path via adapter."); }
		const vaultBasePath = adapter.getBasePath();
		const absoluteDir = path.join(vaultBasePath, downloadDir);

		// Handle filename conflicts reliably
		let counter = 0;
		const sanitizedOriginalName = this.sanitizeFilename(filename);
		let finalFilename = sanitizedOriginalName;
		let savePath = path.join(absoluteDir, finalFilename);
		const maxAttempts = 100; // Safety limit

		while (await this.adapterFileExists(savePath) && counter < maxAttempts) {
			counter++;
			const extension = path.extname(sanitizedOriginalName);
			const baseName = path.basename(sanitizedOriginalName, extension);
			finalFilename = `${baseName} (${counter})${extension}`;
			savePath = path.join(absoluteDir, finalFilename);
		}

		if (counter >= maxAttempts) { throw new Error(`Failed to find unique filename for ${filename} after ${maxAttempts} attempts.`); }
		console.log(`[${this.manifest.name}] Determined save path: ${savePath}`);
		return savePath;
	}

	// Helper to check file existence using Obsidian adapter
	private async adapterFileExists(absolutePath: string): Promise<boolean> {
		try {
			const adapter = this.app.vault.adapter as any;
			if (typeof adapter.getBasePath !== 'function' || typeof adapter.stat !== 'function') {
				// Fallback if adapter methods are missing
				return fs.existsSync(absolutePath);
			}
			const vaultBasePath = adapter.getBasePath();
			const vaultRelativePath = path.relative(vaultBasePath, absolutePath).replace(/\\/g, '/'); // Use forward slashes for Obsidian API

			if (!vaultRelativePath || vaultRelativePath.startsWith('..')) {
				console.warn(`[${this.manifest.name}] Calculated relative path is outside vault: ${vaultRelativePath}. Checking with fs.existsSync.`);
				return fs.existsSync(absolutePath); // Fallback if path seems outside vault
			}

			const stats = await adapter.stat(vaultRelativePath);
			return !!stats; // Exists if stat doesn't error and returns stats
		} catch (e: any) {
			// stat throws error if not found, check error code if possible (though unreliable across adapters)
			// console.debug(`Adapter stat error for ${absolutePath}: ${e.message}`);
			return false;
		}
	}

	private sanitizeFilename(filename: string): string {
		// Remove characters forbidden in Windows/macOS/Linux filenames & reserved names
		const forbiddenChars = /[<>:"/\\|?*\x00-\x1F]/g;
		const reservedNames = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
		let sanitized = filename.replace(forbiddenChars, '_');
		if (reservedNames.test(sanitized)) {
			sanitized = `_${sanitized}`;
		}
		return sanitized.trim() || "downloaded_file"; // Ensure not empty
	}

} // End of LocalChatPlugin class

// --- Settings Tab Class ---
// Included here for completeness, assuming it's in a separate file normally
// and importing DEFAULT_SETTINGS and LocalChatPlugin
// import { DEFAULT_SETTINGS } from './main'; // Assuming this file is main.ts

class ChatSettingTab extends PluginSettingTab {
	plugin: LocalChatPlugin;

	constructor(app: App, plugin: LocalChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Local Chat Settings' });

		// Nickname Setting
		new Setting(containerEl)
			.setName('Your Nickname')
			.setDesc('How you will appear to others on the network.')
			.addText(text => text
				.setPlaceholder('Enter nickname')
				.setValue(this.plugin.settings.userNickname)
				.onChange(async (value) => {
					this.plugin.settings.userNickname = value?.trim() || DEFAULT_SETTINGS.userNickname;
					await this.plugin.saveSettings();
					// TODO: Notify UserDiscovery about nickname change if it's running
					// this.plugin.userDiscovery?.updateNickname?.(this.plugin.settings.userNickname);
				}));

		// Port Setting
		new Setting(containerEl)
			.setName('Listening Port')
			.setDesc('TCP port the plugin will use. Requires Obsidian restart to apply.')
			.addText(text => text
				.setPlaceholder(String(DEFAULT_SETTINGS.listenPort))
				.setValue(String(this.plugin.settings.listenPort))
				.onChange(async (value) => {
					const port = parseInt(value);
					let portChanged = false;
					if (!isNaN(port) && port > 1024 && port < 65535) {
						if (this.plugin.settings.listenPort !== port) {
							this.plugin.settings.listenPort = port;
							portChanged = true;
						}
					} else if (value !== String(this.plugin.settings.listenPort)) {
						text.setValue(String(this.plugin.settings.listenPort));
						new Notice("Invalid port. Enter a number between 1025 and 65534.");
					}
					if (portChanged) {
						await this.plugin.saveSettings();
						new Notice("Port changed. Restart Obsidian for the change to take effect.");
					}
				}));

		// Download Path Setting
		new Setting(containerEl)
			.setName('Download Folder')
			.setDesc('Where to save received files. Leave empty to use the vault attachment folder (relative to vault root).')
			.addText(text => text
				.setPlaceholder('e.g., ChatDownloads')
				.setValue(this.plugin.settings.downloadPath)
				.onChange(async (value) => {
					this.plugin.settings.downloadPath = value?.trim() || '';
					await this.plugin.saveSettings();
				}));

		// Save History Setting
		new Setting(containerEl)
			.setName('Save Chat History')
			.setDesc('Whether to keep message history between Obsidian sessions.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.saveHistory)
				.onChange(async (value) => {
					this.plugin.settings.saveHistory = value;
					await this.plugin.saveSettings();
				}));

		// TODO: Add "Clear History" button
	}
}