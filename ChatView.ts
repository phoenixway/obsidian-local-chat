import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon } from "obsidian";
import LocalChatPlugin from "./main"; // Імпортуємо головний клас плагіну для взаємодії
import { UserInfo } from './types';
export const CHAT_VIEW_TYPE = "local-chat-view";

export class ChatView extends ItemView {
    plugin: LocalChatPlugin;
    messageContainerEl: HTMLElement; // Контейнер для повідомлень
    userListEl: HTMLElement; // Контейнер для списку користувачів
    inputEl: HTMLInputElement; // Поле вводу повідомлення
    sendButtonEl: HTMLElement; // Кнопка надсилання
    fileButtonEl: HTMLElement; // Кнопка надсилання файлу (додамо пізніше)

    // Зберігаємо відомих користувачів для легкого доступу/оновлення
    private knownUsers: Map<string, { nickname: string, element?: HTMLElement }> = new Map();


    constructor(leaf: WorkspaceLeaf, plugin: LocalChatPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Локальний Чат";
    }

    // Встановлюємо іконку для вкладки
    getIcon(): string {
        return "message-circle";
    }

    // Метод викликається при першому відкритті або перезавантаженні View
    async onOpen() {
        const container = this.containerEl.children[1]; // Основний контейнер від Obsidian
        container.empty();
        container.addClass('local-chat-view-container'); // Додамо клас для стилізації

        // --- Зона Списку Користувачів ---
        if (!container) return;
        const userListContainer = container.createDiv({ cls: 'chat-sidebar' });
        userListContainer.createEl("h5", { text: "Онлайн:", cls: 'chat-user-list-header' });
        this.userListEl = userListContainer.createDiv({ cls: "chat-user-list" });

        // --- Зона Чату ---
        const chatArea = container.createDiv({ cls: 'chat-main-area' });

        // --- Зона Повідомлень ---
        this.messageContainerEl = chatArea.createDiv({ cls: "chat-message-area" });
        this.messageContainerEl.id = 'chat-message-area-id'; // Для легкого доступу

        // --- Зона Вводу Повідомлення ---
        const inputArea = chatArea.createDiv({ cls: "chat-input-area" });
        this.inputEl = inputArea.createEl("input", { type: "text", placeholder: "Введіть повідомлення...", cls: "chat-input" });

        this.sendButtonEl = inputArea.createEl("button", { cls: "chat-send-button" });
        setIcon(this.sendButtonEl, "send-horizontal"); // Іконка для кнопки
        this.sendButtonEl.setAttribute("aria-label", "Надіслати");
        this.fileButtonEl = inputArea.createEl("button", { cls: "chat-file-button" });
        setIcon(this.fileButtonEl, "paperclip");
        this.fileButtonEl.setAttribute("aria-label", "Надіслати файл");
        this.fileButtonEl.onClickEvent(this.handleSendFileClick.bind(this)); // Використовуємо onClickEvent для зручності


        // --- Додавання Обробників Подій ---
        this.inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) { // Надіслати по Enter (не Shift+Enter)
                event.preventDefault(); // Запобігти стандартній дії Enter (новий рядок)
                this.handleSendMessage();
            }
        });

        this.sendButtonEl.addEventListener("click", () => {
            this.handleSendMessage();
        });


        // TODO: Додати кнопку та логіку для надсилання файлів
        // this.fileButtonEl = inputArea.createEl("button", { cls: "chat-file-button" });
        // setIcon(this.fileButtonEl, "paperclip");
        // this.fileButtonEl.setAttribute("aria-label", "Надіслати файл");
        // this.fileButtonEl.addEventListener("click", () => { this.handleSendFileClick(); });


        // TODO: Завантажити історію повідомлень, якщо налаштовано
        // const history = await this.plugin.getChatHistory();
        // history.forEach(msg => this.displayMessage(msg.sender, msg.content, msg.timestamp, msg.isOwn));

        // TODO: Запросити поточний список користувачів у плагіна
        // const currentUsers = this.plugin.getCurrentUsers();
        // currentUsers.forEach(user => this.addUserToList(user));

        console.log(`[${this.plugin.manifest.name}] ChatView відкрито`);
        this.inputEl.focus(); // Фокус на полі вводу при відкритті
    }
    private handleSendFileClick() {
        // Створюємо прихований input елемент для вибору файлу
        const fileInput = createEl('input', { type: 'file' });
        // fileInput.multiple = true; // Якщо потрібно дозволити вибір декількох файлів

        fileInput.onchange = async (e) => {
            if (!fileInput.files || fileInput.files.length === 0) {
                return;
            }

            // TODO: Визначити отримувача (recipientNickname)
            // Можливо, на основі вибраного користувача в списку, або показати діалог вибору?
            // Для прикладу, тимчасово надсилаємо всім (null)
            const recipientNickname = null;

            for (let i = 0; i < fileInput.files.length; i++) {
                const file = fileInput.files[i];
                console.log(`Обрано файл: ${file.name}, розмір: ${file.size}`);
                // Викликаємо метод плагіну для ініціації надсилання
                await this.plugin.initiateSendFile(file, recipientNickname);
            }

            // Очищаємо value, щоб можна було вибрати той самий файл знову
            fileInput.value = '';
            // Видаляємо input після використання (не обов'язково)
            // fileInput.remove();
        };

        // Клікаємо на прихований input, щоб відкрити діалог вибору файлу
        fileInput.click();
    }
    // Метод викликається при закритті View
    async onClose() {
        // Тут можна додати логіку очищення, якщо потрібно
        console.log(`[${this.plugin.manifest.name}] ChatView закрито`);
    }

    // --- Внутрішній метод для надсилання повідомлення ---
    private handleSendMessage() {
        const messageText = this.inputEl.value.trim();
        if (!messageText) {
            return; // Не надсилати порожні повідомлення
        }

        // TODO: Реалізувати вибір конкретного отримувача, якщо потрібно
        // Наразі припускаємо надсилання всім (Broadcast) або плагін сам вирішує
        try {
            // Викликаємо метод плагіну для надсилання
            this.plugin.sendMessage(null, messageText); // null означає "всім" або обробляється плагіном

            // Очищуємо поле вводу
            this.inputEl.value = "";
            this.inputEl.focus();

        } catch (error) {
            console.error(`[${this.plugin.manifest.name}] Помилка надсилання повідомлення:`, error);
            new Notice("Помилка надсилання повідомлення.");
        }
    }

    // --- Метод для відображення повідомлення в чаті (викликається плагіном) ---
    displayMessage(senderNickname: string, message: string, timestamp: number, isOwn: boolean) {
        const messageEl = this.messageContainerEl.createDiv({
            cls: `chat-message ${isOwn ? 'own-message' : 'other-message'}`
        });

        const headerEl = messageEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: isOwn ? "Ви" : senderNickname });
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });

        // Обробка потенційно небезпечного HTML (проста заміна)
        const sanitizedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        // TODO: Розглянути складнішу санітизацію або Markdown рендеринг, якщо потрібно
        messageEl.createDiv({ cls: 'message-content' }).innerHTML = sanitizedMessage; // Використовуємо innerHTML для можливих майбутніх покращень (наприклад, посилання)

        // Автоматична прокрутка донизу
        this.scrollToBottom();
    }
    addUserToList(userInfo: UserInfo): void { // Приймає { nickname: string }
        if (this.knownUsers.has(userInfo.nickname)) {
            const existing = this.knownUsers.get(userInfo.nickname);
            if (existing?.element) existing.element.addClass('user-online'); // Просто оновлюємо статус
            return; // Вже в списку
        }

        // Створюємо DOM елемент
        const userEl = this.userListEl.createDiv({ cls: "chat-user-list-item user-online" });
        userEl.dataset.nickname = userInfo.nickname;
        const iconEl = userEl.createSpan({ cls: 'user-icon' });
        setIcon(iconEl, 'user');
        userEl.createSpan({ cls: 'user-nickname', text: userInfo.nickname });

        // Додаємо до мапи об'єкт БЕЗ ip та port
        this.knownUsers.set(userInfo.nickname, { nickname: userInfo.nickname, element: userEl });
    }

    // --- Метод removeUserFromList ---
    removeUserFromList(nickname: string): void {
        const userData = this.knownUsers.get(nickname); // Отримує { nickname, element? }
        userData?.element?.remove(); // Видаляємо DOM елемент, якщо він є
        if (this.knownUsers.delete(nickname)) {
            console.log(`[${this.plugin.manifest.name}] Removed user '${nickname}' from UI list.`);
        }
    }

    // --- Метод clearUserList (додайте, якщо його ще немає) ---
    clearUserList(): void {
        if (this.userListEl) this.userListEl.empty(); // Перевірка наявності userListEl
        this.knownUsers.clear();
        console.log(`[${this.plugin.manifest.name}] Cleared user list in UI.`);
    }

    displayFileOffer(senderNickname: string, fileInfo: { fileId: string, filename: string, size: number }) {
        // Додаємо data-file-id до головного елемента повідомлення
        const offerEl = this.messageContainerEl.createDiv({
            cls: 'chat-message file-offer',
            attr: { 'data-file-id': fileInfo.fileId } // <--- ДОДАНО ЦЕ
        });

        // ... решта коду displayFileOffer залишається такою ж ...

        const headerEl = offerEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: senderNickname });
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });

        const contentEl = offerEl.createDiv({ cls: 'message-content' });
        contentEl.setText(`${senderNickname} пропонує надіслати файл: `);
        contentEl.createEl('strong', { text: fileInfo.filename });
        contentEl.createSpan({ text: ` (${this.formatFileSize(fileInfo.size)})` });

        const actionsEl = offerEl.createDiv({ cls: 'file-offer-actions' });

        const acceptButton = actionsEl.createEl('button', { text: 'Прийняти' });
        acceptButton.addEventListener('click', () => {
            this.plugin.acceptFileOffer(senderNickname, fileInfo.fileId);
            // Оновлюємо статус одразу в UI для миттєвого відгуку
            this.updateFileProgress(fileInfo.fileId, 'download', 0, fileInfo.size, 'accepted');
            // Попередня логіка оновлення тут більше не потрібна, все робить updateFileProgress
            // offerEl.addClass('offer-accepted');
            // actionsEl.empty();
            // actionsEl.setText('Прийнято. Очікування завантаження...');
        });

        const declineButton = actionsEl.createEl('button', { text: 'Відхилити', cls: 'mod-danger' });
        declineButton.addEventListener('click', () => {
            this.plugin.declineFileOffer(senderNickname, fileInfo.fileId);
            // Оновлюємо статус одразу в UI для миттєвого відгуку
            this.updateFileProgress(fileInfo.fileId, 'download', 0, fileInfo.size, 'declined');
            // Попередня логіка оновлення тут більше не потрібна
            // offerEl.addClass('offer-declined');
            // actionsEl.empty();
            // actionsEl.setText('Відхилено.');
        });

        this.scrollToBottom();
    }
    public updateFileProgress(
        fileId: string,
        direction: 'upload' | 'download',
        transferredBytes: number,
        totalSize: number,
        status: 'starting' | 'progressing' | 'completed' | 'error' | 'accepted' | 'declined' // Додамо статуси
    ): void {
        // Знаходимо DOM-елемент, що відповідає цій передачі файлу.
        // Найпростіше - додати data-атрибут до елемента повідомлення при його створенні.
        // Потрібно модифікувати displayFileOffer та, можливо, додати метод для відображення початку завантаження/відправки.
        const fileMessageEl = this.messageContainerEl.querySelector(`.chat-message[data-file-id="${fileId}"]`) as HTMLElement;

        if (!fileMessageEl) {
            // Якщо елемент ще не існує (наприклад, для upload, який не має попередньої "пропозиції")
            // TODO: Створити новий елемент повідомлення для відображення прогресу завантаження на сервер
            if (direction === 'upload') {
                console.warn(`UI element for uploading file ${fileId} not implemented yet.`);
                return; // Поки не реалізовано
            } else {
                console.warn(`Could not find message element for file transfer ${fileId} to update progress.`);
                return; // Не можемо знайти елемент для оновлення
            }
        }

        // Знаходимо або створюємо контейнер для прогресу всередині повідомлення
        let progressContainer = fileMessageEl.querySelector('.file-progress-container') as HTMLElement;
        if (!progressContainer) {
            progressContainer = fileMessageEl.createDiv({ cls: 'file-progress-container' });
            // Очищаємо попередні кнопки "Прийняти/Відхилити", якщо вони були
            const actionsEl = fileMessageEl.querySelector('.file-offer-actions');
            if (actionsEl) actionsEl.empty();
        }

        // Очищаємо контейнер перед оновленням
        progressContainer.empty();

        // Розраховуємо відсоток
        const percentage = totalSize > 0 ? Math.round((transferredBytes / totalSize) * 100) : 0;

        // Створюємо елемент <progress>
        const progressBar = progressContainer.createEl('progress');
        progressBar.max = totalSize;
        progressBar.value = transferredBytes;

        // Додаємо текстовий опис статусу
        const statusTextEl = progressContainer.createSpan({ cls: 'progress-text' });

        switch (status) {
            case 'starting':
                statusTextEl.setText(direction === 'download' ? ` Завантаження почалося... 0%` : ` Відправка почалася... 0%`);
                break;
            case 'progressing':
                statusTextEl.setText(` ${percentage}% (${this.formatFileSize(transferredBytes)} / ${this.formatFileSize(totalSize)})`);
                break;
            case 'completed':
                progressBar.remove(); // Прибираємо прогрес-бар
                const successMsg = direction === 'download' ? 'Завантажено успішно.' : 'Надіслано успішно.';
                statusTextEl.setText(` ${successMsg} (${this.formatFileSize(totalSize)})`);
                fileMessageEl.addClass('transfer-completed');
                // TODO: Якщо це download, можливо, зробити назву файлу посиланням?
                break;
            case 'error':
                progressBar.remove(); // Прибираємо прогрес-бар
                statusTextEl.setText(' Помилка передачі.');
                statusTextEl.addClass('progress-error');
                fileMessageEl.addClass('transfer-error');
                break;
            case 'accepted':
                // Статус після натискання "Прийняти", до початку передачі даних
                statusTextEl.setText(' Прийнято. Очікування даних...');
                fileMessageEl.removeClass('offer-declined'); // Прибираємо можливі старі статуси
                fileMessageEl.addClass('offer-accepted');
                break;
            case 'declined':
                // Статус після натискання "Відхилити" (або отримання відмови на наш upload)
                progressBar.remove();
                statusTextEl.setText(' Відхилено.');
                fileMessageEl.removeClass('offer-accepted');
                fileMessageEl.addClass('offer-declined');
                break;
        }

        // Переконуємось, що повідомлення видно (якщо воно внизу)
        this.scrollToBottom();
    }

    // --- Допоміжний метод для форматування розміру файлу ---
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // --- Допоміжний метод для прокрутки до останнього повідомлення ---
    private scrollToBottom(): void {
        // Невеликий таймаут може допомогти, якщо елемент додається асинхронно
        setTimeout(() => {
            this.messageContainerEl.scrollTop = this.messageContainerEl.scrollHeight;
        }, 50);
    }


    // TODO: Методи для відображення прогресу завантаження/відправки файлу
    // displayFileProgress(fileId: string, progress: number, direction: 'upload' | 'download') { ... }

    // TODO: Метод обробки кліку на кнопку "Надіслати файл"
    // private handleSendFileClick() { ... }
    public displayUploadProgress(offerInfo: { fileId: string, filename: string, size: number, recipientNickname: string | null }) {
        // Створюємо новий елемент повідомлення для відправки
        const uploadEl = this.messageContainerEl.createDiv({
            cls: 'chat-message own-message file-upload', // Стилізуємо як своє повідомлення
            attr: { 'data-file-id': offerInfo.fileId }
        });

        const headerEl = uploadEl.createDiv({ cls: 'message-header' });
        headerEl.createSpan({ cls: 'message-sender', text: "Ви" }); // Ми відправляємо
        headerEl.createSpan({ cls: 'message-timestamp', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });

        const contentEl = uploadEl.createDiv({ cls: 'message-content' });
        contentEl.setText(`Надсилання файлу: `);
        contentEl.createEl('strong', { text: offerInfo.filename });
        contentEl.createSpan({ text: ` (${this.formatFileSize(offerInfo.size)})` });
        if (offerInfo.recipientNickname) { // Якщо відомий отримувач
            contentEl.createSpan({ text: ` до ${offerInfo.recipientNickname}` });
        }

        // Додаємо контейнер для прогресу одразу
        uploadEl.createDiv({ cls: 'file-progress-container' });

        // Ініціалізуємо прогрес (очікування відповіді)
        this.updateFileProgress(offerInfo.fileId, 'upload', 0, offerInfo.size, 'starting'); // або 'waiting_accept'

        this.scrollToBottom();
    }


}