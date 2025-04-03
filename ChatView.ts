import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian"; // Removed TFile, Notice
import LocalChatPlugin from "./main";
import { UserInfo } from './types';

export const CHAT_VIEW_TYPE = "local-chat-view";

export class ChatView extends ItemView {
    plugin: LocalChatPlugin;
    messageContainerEl: HTMLElement;
    userListEl: HTMLElement;
    inputEl: HTMLInputElement;
    sendButtonEl: HTMLElement;
    fileButtonEl: HTMLButtonElement; // Keep as ButtonElement for onClickEvent

    private knownUsers: Map<string, { nickname: string, element?: HTMLElement }> = new Map();

    constructor(leaf: WorkspaceLeaf, plugin: LocalChatPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Local Chat"; // Changed to English for consistency, adjust if needed
    }

    getIcon(): string {
        return "message-circle";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        if (!container) return; // Guard if container isn't ready
        container.empty();
        container.addClass('local-chat-view-container');

        // User List Area
        const userListContainer = container.createDiv({ cls: 'chat-sidebar' });
        userListContainer.createEl("h5", { text: "Online:", cls: 'chat-user-list-header' });
        this.userListEl = userListContainer.createDiv({ cls: "chat-user-list" });

        // Chat Area
        const chatArea = container.createDiv({ cls: 'chat-main-area' });
        this.messageContainerEl = chatArea.createDiv({ cls: "chat-message-area" });
        this.messageContainerEl.id = 'chat-message-area-id';

        // Input Area
        const inputArea = chatArea.createDiv({ cls: "chat-input-area" });
        this.inputEl = inputArea.createEl("input", { type: "text", placeholder: "Enter message...", cls: "chat-input" });
        this.sendButtonEl = inputArea.createEl("button", { cls: "chat-send-button", attr: { "aria-label": "Send" } });
        setIcon(this.sendButtonEl, "send-horizontal");
        this.fileButtonEl = inputArea.createEl("button", { cls: "chat-file-button", attr: { "aria-label": "Send File" } });
        setIcon(this.fileButtonEl, "paperclip");

        // Event Listeners
        this.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                this.handleSendMessage();
            }
        });
        this.sendButtonEl.addEventListener("click", this.handleSendMessage.bind(this));
        this.fileButtonEl.onClickEvent(this.handleSendFileClick.bind(this)); // Use onClickEvent helper

        // TODO: Load history and initial users (call plugin methods or wait for server push)
        // this.plugin.requestInitialState(); // Example call

        console.log(`[${this.plugin.manifest.name}] ChatView opened`);
        this.inputEl.focus();
    }

    async onClose() {
        console.log(`[${this.plugin.manifest.name}] ChatView closed`);
        // Optional: Cleanup specific listeners if needed, though Obsidian handles DOM removal
    }

    private handleSendMessage() {
        const messageText = this.inputEl.value.trim();
        if (!messageText) return;
        // TODO: Implement recipient selection (currently broadcast null)
        const recipientNickname = null;
        this.plugin.sendMessage(recipientNickname, messageText);
        this.inputEl.value = "";
        this.inputEl.focus();
    }

    private handleSendFileClick() {
        const fileInput = createEl('input', { type: 'file' });
        fileInput.onchange = async () => {
            if (!fileInput.files || fileInput.files.length === 0) return;
            // TODO: Implement recipient selection (currently broadcast null)
            const recipientNickname = null;
            for (let i = 0; i < fileInput.files.length; i++) {
                const file = fileInput.files[i];
                // Call plugin method to initiate send offer
                await this.plugin.initiateSendFile(file, recipientNickname);
            }
            fileInput.value = ''; // Clear input for potential reuse
        };
        fileInput.click(); // Open file dialog
    }

    displayMessage(senderNickname: string, message: string, timestamp: number, isOwn: boolean) {
        if (!this.messageContainerEl) return; // Guard if view not fully ready
        const messageEl = this.messageContainerEl.createDiv({
            cls: `chat-message ${isOwn ? 'own-message' : 'other-message'}`
        });
        const headerEl = messageEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: isOwn ? "You" : senderNickname });
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        // Basic sanitization - consider a library like DOMPurify for richer content if needed
        const sanitizedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        messageEl.createDiv({ cls: 'message-content' }).innerHTML = sanitizedMessage;
        this.scrollToBottom();
    }

    // У файлі ChatView.ts всередині класу ChatView

    addUserToList(userInfo: UserInfo): void { // Приймає { nickname: string }
        if (!this.userListEl) {
            console.error("addUserToList: userListEl is not defined!");
            return; // Перевірка, чи існує контейнер списку
        }

        if (this.knownUsers.has(userInfo.nickname)) {
            // Користувач вже існує, просто оновлюємо статус елемента
            const existing = this.knownUsers.get(userInfo.nickname);
            if (existing?.element) { // Перевіряємо, чи елемент існує
                // --- ВИПРАВЛЕННЯ: Викликаємо методи окремо ---
                existing.element.addClass('user-online');    // Спочатку додаємо клас
                existing.element.removeClass('user-offline'); // Потім видаляємо інший клас
                // --- КІНЕЦЬ ВИПРАВЛЕННЯ ---
            }
            return; // Виходимо, бо користувач вже оброблений
        }

        // --- Логіка створення НОВОГО елемента користувача ---
        const userEl = this.userListEl.createDiv({
            cls: "chat-user-list-item user-online", // Починаємо зі статусу онлайн
            attr: { 'data-nickname': userInfo.nickname } // Додаємо data-атрибут
        });

        const iconEl = userEl.createSpan({ cls: 'user-icon' });
        setIcon(iconEl, 'user');
        userEl.createSpan({ cls: 'user-nickname', text: userInfo.nickname });

        // Зберігаємо інформацію в мапі
        this.knownUsers.set(userInfo.nickname, { nickname: userInfo.nickname, element: userEl });

        // TODO: Додати обробник кліку на userEl для вибору отримувача?
    }

    // ... решта коду класу ChatView ...

    removeUserFromList(nickname: string): void {
        const userData = this.knownUsers.get(nickname);
        userData?.element?.remove();
        if (this.knownUsers.delete(nickname)) {
            console.log(`[${this.plugin.manifest.name}] Removed user '${nickname}' from UI list.`);
        }
    }

    clearUserList(): void {
        if (this.userListEl) this.userListEl.empty();
        this.knownUsers.clear();
        console.log(`[${this.plugin.manifest.name}] Cleared user list in UI.`);
    }

    displayFileOffer(senderNickname: string, fileInfo: { fileId: string, filename: string, size: number }) {
        if (!this.messageContainerEl) return;
        const offerEl = this.messageContainerEl.createDiv({
            cls: 'chat-message file-offer',
            attr: { 'data-file-id': fileInfo.fileId }
        });
        const headerEl = offerEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: senderNickname });
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        const contentEl = offerEl.createDiv({ cls: 'message-content' });
        contentEl.setText(`${senderNickname} offers to send file: `);
        contentEl.createEl('strong', { text: fileInfo.filename });
        contentEl.createSpan({ text: ` (${this.formatFileSize(fileInfo.size)})` });
        const actionsEl = offerEl.createDiv({ cls: 'file-offer-actions' });
        const acceptButton = actionsEl.createEl('button', { text: 'Accept' });
        acceptButton.addEventListener('click', () => {
            this.plugin.acceptFileOffer(senderNickname, fileInfo.fileId);
            this.updateFileProgress(fileInfo.fileId, 'download', 0, fileInfo.size, 'accepted');
        });
        const declineButton = actionsEl.createEl('button', { text: 'Decline', cls: 'mod-danger' });
        declineButton.addEventListener('click', () => {
            this.plugin.declineFileOffer(senderNickname, fileInfo.fileId);
            this.updateFileProgress(fileInfo.fileId, 'download', 0, fileInfo.size, 'declined');
        });
        this.scrollToBottom();
    }

    updateFileProgress(
        fileId: string,
        direction: 'upload' | 'download',
        transferredBytes: number,
        totalSize: number,
        status: 'starting' | 'progressing' | 'completed' | 'error' | 'accepted' | 'declined' | 'waiting_accept' // Added waiting_accept
    ): void {
        if (!this.messageContainerEl) return;
        const fileMessageEl = this.messageContainerEl.querySelector(`.chat-message[data-file-id="${fileId}"]`) as HTMLElement;
        if (!fileMessageEl) {
            // If upload element isn't displayed yet via displayUploadProgress, ignore update for now
            if (direction !== 'upload' || status !== 'starting') { // Avoid warning on initial upload placeholder creation
                console.warn(`Could not find message element for file transfer ${fileId} to update progress (Status: ${status}).`);
            }
            return;
        }
        let progressContainer = fileMessageEl.querySelector('.file-progress-container') as HTMLElement;
        if (!progressContainer) {
            progressContainer = fileMessageEl.createDiv({ cls: 'file-progress-container' });
            fileMessageEl.querySelector('.file-offer-actions')?.empty(); // Clear accept/decline buttons
        }
        progressContainer.empty(); // Clear previous progress info

        const percentage = totalSize > 0 ? Math.round((transferredBytes / totalSize) * 100) : (status === 'completed' ? 100 : 0);
        const progressBar = progressContainer.createEl('progress');
        progressBar.max = totalSize;
        progressBar.value = transferredBytes;
        const statusTextEl = progressContainer.createSpan({ cls: 'progress-text' });

        fileMessageEl.removeClass('transfer-completed', 'transfer-error', 'offer-accepted', 'offer-declined'); // Reset classes

        switch (status) {
            case 'waiting_accept': // For uploads after offer sent
                statusTextEl.setText(` Waiting for acceptance...`);
                progressBar.remove();
                break;
            case 'starting':
                statusTextEl.setText(direction === 'download' ? ` Download starting... 0%` : ` Upload starting... 0%`);
                break;
            case 'progressing':
                statusTextEl.setText(` ${percentage}% (${this.formatFileSize(transferredBytes)} / ${this.formatFileSize(totalSize)})`);
                break;
            case 'completed':
                progressBar.remove();
                const successMsg = direction === 'download' ? 'Received successfully.' : 'Sent successfully.';
                statusTextEl.setText(` ${successMsg} (${this.formatFileSize(totalSize)})`);
                fileMessageEl.addClass('transfer-completed');
                // TODO: Make filename a link for downloads? Needs file path info from main.ts
                break;
            case 'error':
                progressBar.remove();
                statusTextEl.setText(' Transfer Error.');
                statusTextEl.addClass('progress-error');
                fileMessageEl.addClass('transfer-error');
                break;
            case 'accepted': // Incoming offer accepted by local user
                statusTextEl.setText(' Accepted. Waiting for data...');
                fileMessageEl.addClass('offer-accepted');
                break;
            case 'declined': // Incoming offer declined by local user, OR remote user declined our offer
                progressBar.remove();
                statusTextEl.setText(' Declined.');
                fileMessageEl.addClass('offer-declined');
                break;
        }
        this.scrollToBottom();
    }

    displayUploadProgress(offerInfo: { fileId: string, filename: string, size: number, recipientNickname: string | null }) {
        if (!this.messageContainerEl) return;
        const uploadEl = this.messageContainerEl.createDiv({
            cls: 'chat-message own-message file-upload',
            attr: { 'data-file-id': offerInfo.fileId }
        });
        const headerEl = uploadEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: "You" });
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        const contentEl = uploadEl.createDiv({ cls: 'message-content' });
        contentEl.setText(`Sending file: `);
        contentEl.createEl('strong', { text: offerInfo.filename });
        contentEl.createSpan({ text: ` (${this.formatFileSize(offerInfo.size)})` });
        if (offerInfo.recipientNickname) contentEl.createSpan({ text: ` to ${offerInfo.recipientNickname}` });
        uploadEl.createDiv({ cls: 'file-progress-container' }); // Create container for progress updates
        // Initial status before acceptance (waiting for response)
        this.updateFileProgress(offerInfo.fileId, 'upload', 0, offerInfo.size, 'waiting_accept');
        this.scrollToBottom();
    }

    private formatFileSize(bytes: number, decimals = 2): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    private scrollToBottom(): void {
        if (!this.messageContainerEl) return;
        // Give DOM a moment to update before scrolling
        setTimeout(() => {
            this.messageContainerEl.scrollTop = this.messageContainerEl.scrollHeight;
        }, 50);
    }

}