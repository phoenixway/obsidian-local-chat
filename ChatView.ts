// ChatView.ts
// Додаємо MarkdownRenderer та Component
import { ItemView, WorkspaceLeaf, Notice, setIcon, MarkdownRenderer, Component } from "obsidian";
import LocalChatPlugin from "./main";
import { UserInfo } from './types'; // Переконуємось, що UserInfo імпортовано

export const CHAT_VIEW_TYPE = "local-chat-view";

export class ChatView extends ItemView {
    plugin: LocalChatPlugin;
    messageContainerEl: HTMLElement;
    userListEl: HTMLElement;
    inputEl: HTMLInputElement;
    sendButtonEl: HTMLElement;
    fileButtonEl: HTMLButtonElement;
    private knownUsers: Map<string, { nickname: string, element?: HTMLElement }> = new Map();

    constructor(leaf: WorkspaceLeaf, plugin: LocalChatPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return CHAT_VIEW_TYPE; }
    getDisplayText(): string { return "Local Chat"; }
    getIcon(): string { return "message-circle"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        if (!container) return;
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
        this.inputEl = inputArea.createEl("input", { type: "text", placeholder: "Enter message (Markdown supported)...", cls: "chat-input" }); // Оновили placeholder
        this.sendButtonEl = inputArea.createEl("button", { cls: "chat-send-button", attr: { "aria-label": "Send" } });
        setIcon(this.sendButtonEl, "send-horizontal");
        this.fileButtonEl = inputArea.createEl("button", { cls: "chat-file-button", attr: { "aria-label": "Send File" } });
        setIcon(this.fileButtonEl, "paperclip");

        // Event Listeners
        this.inputEl.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.handleSendMessage(); } });
        this.sendButtonEl.addEventListener("click", this.handleSendMessage.bind(this));
        this.fileButtonEl.onClickEvent(this.handleSendFileClick.bind(this));

        // Populate initial state
        this.populateInitialViewState(); // Викликаємо новий метод

        this.inputEl.focus();
        console.log(`[${this.plugin.manifest.name}] ChatView opened.`);
    }

    async onClose() {
        console.log(`[${this.plugin.manifest.name}] ChatView closed`);
    }

    /** Заповнює початковий стан UI */
    private populateInitialViewState(): void {
        console.log(`[${this.plugin.manifest.name}] Populating initial chat view state...`);
        // Отримуємо та відображаємо поточних користувачів
        const currentUsers = this.plugin.getAllUsers();
        this.clearUserList(); // Очистимо про всяк випадок
        currentUsers.forEach(user => this.addUserToList(user));

        // TODO: Завантажити та відобразити історію чату тут
        // console.log(`[${this.plugin.manifest.name}] Loading chat history...`);
        // const history = await this.plugin.getHistory();
        // history.forEach(msg => this.displayMessage(msg.senderNickname, msg.content, msg.timestamp, msg.isOwn, true)); // Додаємо флаг isHistory=true?
    }

    // --- Message Sending ---
    private handleSendMessage() { /* ... як раніше ... */
        const messageText = this.inputEl.value.trim();
        if (!messageText) return;
        const recipientNickname = null; // TODO: Implement recipient selection
        this.plugin.sendMessage(recipientNickname, messageText);
        this.inputEl.value = "";
        this.inputEl.focus();
    }
    private handleSendFileClick() { /* ... як раніше ... */
        const fileInput = createEl('input', { type: 'file' });
        fileInput.onchange = async () => {
            if (!fileInput.files || fileInput.files.length === 0) return;
            const recipientNickname = null; // TODO: Implement recipient selection
            for (let i = 0; i < fileInput.files.length; i++) {
                await this.plugin.initiateSendFile(fileInput.files[i], recipientNickname);
            }
            fileInput.value = '';
        };
        fileInput.click();
    }

    // --- Message Display (ОНОВЛЕНО) ---
    async displayMessage(senderNickname: string, message: string, timestamp: number, isOwn: boolean, isHistory: boolean = false) {
        if (!this.messageContainerEl) return;

        const messageEl = this.messageContainerEl.createDiv({
            cls: `chat-message ${isOwn ? 'own-message' : 'other-message'}`
        });
        // Зберігаємо оригінальний Markdown для копіювання
        messageEl.dataset.rawMessage = message;

        // --- Header ---
        const headerEl = messageEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: isOwn ? "You" : senderNickname });

        const controlsWrapper = headerEl.createDiv({ cls: 'message-controls' });
        // Timestamp
        controlsWrapper.createSpan({ cls: 'message-timestamp', text: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        // Copy Button
        const copyButton = controlsWrapper.createEl('button', { cls: 'message-copy-button', attr: { 'aria-label': 'Copy message' } });
        setIcon(copyButton, 'copy');
        copyButton.addEventListener('click', (event) => {
            event.stopPropagation();
            navigator.clipboard.writeText(message) // Копіюємо оригінальний Markdown
                .then(() => {
                    new Notice("Message copied!", 1500);
                    setIcon(copyButton, 'check'); // Змінюємо іконку
                    setTimeout(() => setIcon(copyButton, 'copy'), 1500); // Повертаємо іконку
                })
                .catch(err => {
                    console.error("Failed to copy message:", err);
                    new Notice("Failed to copy message.", 2000);
                });
        });

        // --- Content (Rendered Markdown) ---
        const contentEl = messageEl.createDiv({ cls: 'message-content' });
        try {
            // Рендеримо Markdown
            // Передаємо this як Component для правильної обробки внутрішніх посилань Obsidian (якщо вони будуть)
            // sourcePath можна залишити порожнім або вказати шлях до фіктивного файлу
            await MarkdownRenderer.renderMarkdown(message, contentEl, this.app.vault.getRoot().path, this as Component);

            // Додатково: Робимо зовнішні посилання в чаті безпечними
            contentEl.querySelectorAll('a').forEach(link => {
                // Перевіряємо, чи це не внутрішнє посилання Obsidian
                if (!link.classList.contains('internal-link') && (link.href.startsWith('http:') || link.href.startsWith('https:'))) {
                    link.setAttribute('target', '_blank'); // Відкривати в новій вкладці
                    link.setAttribute('rel', 'noopener noreferrer'); // З міркувань безпеки
                }
                // Можна додати обробку кліків на internal-link, якщо потрібно (напр. відкрити нотатку)
            });
        } catch (error) {
            console.error("Error rendering markdown:", error);
            contentEl.setText(`Error rendering message: ${message}`); // Показати як простий текст при помилці рендерингу
        }

        // --- Scrolling ---
        // Прокручуємо вниз, лише якщо це не повідомлення з історії (щоб не стрибати при завантаженні)
        // Або якщо користувач вже внизу
        const isScrolledToBottom = this.messageContainerEl.scrollHeight - this.messageContainerEl.clientHeight <= this.messageContainerEl.scrollTop + 5; // +5 для похибки
        if (!isHistory || isScrolledToBottom) {
            this.scrollToBottom();
        }
    }

    // --- User List Management --- (addUserToList, removeUserFromList, clearUserList - як раніше)
    addUserToList(userInfo: UserInfo): void { /* ... як раніше, з перевіркою this.userListEl ... */
        if (!this.userListEl) { console.error("addUserToList Error: userListEl not ready."); return; }
        if (this.knownUsers.has(userInfo.nickname)) { /* ... update status ... */ return; }
        const userEl = this.userListEl.createDiv({ cls: "chat-user-list-item user-online", attr: { 'data-nickname': userInfo.nickname } });
        setIcon(userEl.createSpan({ cls: 'user-icon' }), 'user');
        userEl.createSpan({ cls: 'user-nickname', text: userInfo.nickname });
        this.knownUsers.set(userInfo.nickname, { nickname: userInfo.nickname, element: userEl });
    }
    removeUserFromList(nickname: string): void { /* ... як раніше ... */
        const userData = this.knownUsers.get(nickname);
        userData?.element?.remove();
        this.knownUsers.delete(nickname);
    }
    clearUserList(): void { /* ... як раніше ... */
        if (this.userListEl) this.userListEl.empty();
        this.knownUsers.clear();
    }


    // --- File Transfer UI --- (displayFileOffer, updateFileProgress, displayUploadProgress, formatFileSize - як раніше)
    displayFileOffer(senderNickname: string, fileInfo: { fileId: string, filename: string, size: number }) { /* ... як раніше, з data-file-id ... */
        if (!this.messageContainerEl) return;
        const offerEl = this.messageContainerEl.createDiv({ cls: 'chat-message file-offer', attr: { 'data-file-id': fileInfo.fileId } });
        const headerEl = offerEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: senderNickname });
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        const contentEl = offerEl.createDiv({ cls: 'message-content' });
        contentEl.setText(`${senderNickname} offers file: `);
        contentEl.createEl('strong', { text: fileInfo.filename });
        contentEl.createSpan({ text: ` (${this.formatFileSize(fileInfo.size)})` });
        const actionsEl = offerEl.createDiv({ cls: 'file-offer-actions' });
        const acceptButton = actionsEl.createEl('button', { text: 'Accept' });
        acceptButton.addEventListener('click', () => { this.plugin.acceptFileOffer(senderNickname, fileInfo.fileId); this.updateFileProgress(fileInfo.fileId, 'download', 0, fileInfo.size, 'accepted'); });
        const declineButton = actionsEl.createEl('button', { text: 'Decline', cls: 'mod-danger' });
        declineButton.addEventListener('click', () => { this.plugin.declineFileOffer(senderNickname, fileInfo.fileId); this.updateFileProgress(fileInfo.fileId, 'download', 0, fileInfo.size, 'declined'); });
        this.scrollToBottom();
    }
    updateFileProgress(fileId: string, direction: 'upload' | 'download', transferredBytes: number, totalSize: number, status: 'starting' | 'progressing' | 'completed' | 'error' | 'accepted' | 'declined' | 'waiting_accept') { /* ... як раніше ... */
        if (!this.messageContainerEl) return;
        const fileMessageEl = this.messageContainerEl.querySelector(`.chat-message[data-file-id="${fileId}"]`) as HTMLElement;
        if (!fileMessageEl) { if (direction !== 'upload' || status !== 'starting') { console.warn(`No msg element for file ${fileId} (status: ${status})`); } return; }
        let progressContainer = fileMessageEl.querySelector('.file-progress-container') as HTMLElement;
        if (!progressContainer) { progressContainer = fileMessageEl.createDiv({ cls: 'file-progress-container' }); fileMessageEl.querySelector('.file-offer-actions')?.empty(); }
        progressContainer.empty();
        const percentage = totalSize > 0 ? Math.round((transferredBytes / totalSize) * 100) : (status === 'completed' ? 100 : 0);
        const progressBar = progressContainer.createEl('progress'); progressBar.max = totalSize; progressBar.value = transferredBytes;
        const statusTextEl = progressContainer.createSpan({ cls: 'progress-text' });
        fileMessageEl.removeClass('transfer-completed', 'transfer-error', 'offer-accepted', 'offer-declined');
        switch (status) { /* ... case 'starting', 'progressing' ... */
            case 'starting': statusTextEl.setText(direction === 'download' ? ` Download starting... 0%` : ` Upload starting... 0%`); break;
            case 'progressing': statusTextEl.setText(` ${percentage}% (${this.formatFileSize(transferredBytes)} / ${this.formatFileSize(totalSize)})`); break;
            case 'completed': progressBar.remove(); statusTextEl.setText(` ${direction === 'download' ? 'Received' : 'Sent'} successfully. (${this.formatFileSize(totalSize)})`); fileMessageEl.addClass('transfer-completed'); break;
            case 'error': progressBar.remove(); statusTextEl.setText(' Transfer Error.'); statusTextEl.addClass('progress-error'); fileMessageEl.addClass('transfer-error'); break;
            case 'accepted': statusTextEl.setText(' Accepted. Waiting for data...'); fileMessageEl.addClass('offer-accepted'); break;
            case 'declined': progressBar.remove(); statusTextEl.setText(' Declined.'); fileMessageEl.addClass('offer-declined'); break;
            case 'waiting_accept': statusTextEl.setText(` Waiting for acceptance...`); progressBar.remove(); break;
        }
        this.scrollToBottom();
    }
    displayUploadProgress(offerInfo: { fileId: string, filename: string, size: number, recipientNickname: string | null }) { /* ... як раніше ... */
        if (!this.messageContainerEl) return;
        const uploadEl = this.messageContainerEl.createDiv({ cls: 'chat-message own-message file-upload', attr: { 'data-file-id': offerInfo.fileId } });
        const headerEl = uploadEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: "You" });
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        const contentEl = uploadEl.createDiv({ cls: 'message-content' });
        contentEl.setText(`Sending file: `); contentEl.createEl('strong', { text: offerInfo.filename }); contentEl.createSpan({ text: ` (${this.formatFileSize(offerInfo.size)})` });
        if (offerInfo.recipientNickname) contentEl.createSpan({ text: ` to ${offerInfo.recipientNickname}` });
        uploadEl.createDiv({ cls: 'file-progress-container' });
        this.updateFileProgress(offerInfo.fileId, 'upload', 0, offerInfo.size, 'waiting_accept'); // Use 'waiting_accept' status
        this.scrollToBottom();
    }


    // --- Helpers ---
    private formatFileSize(bytes: number, decimals = 2): string { /* ... як раніше ... */
        if (bytes <= 0) return '0 Bytes'; const k = 1024; const dm = decimals < 0 ? 0 : decimals; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    private scrollToBottom(): void { /* ... як раніше ... */
        if (!this.messageContainerEl) return; setTimeout(() => { this.messageContainerEl.scrollTop = this.messageContainerEl.scrollHeight; }, 50);
    }

} // Кінець класу ChatView