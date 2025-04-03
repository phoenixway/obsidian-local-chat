import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './ChatView'; // Припускаємо, що ChatView в окремому файлі
import { NetworkManager, NetworkManagerCallbacks } from './NetworkManager'; // Припускаємо, що мережева логіка тут
// import { UserDiscovery } from './UserDiscovery'; // Припускаємо, що логіка виявлення тут

// Інтерфейс для налаштувань плагіну
interface LocalChatPluginSettings {
	userNickname: string;
	listenPort: number;
	saveHistory: boolean;
	downloadPath: string;
	// Додайте інші налаштування за потреби
}

// Налаштування за замовчуванням
const DEFAULT_SETTINGS: LocalChatPluginSettings = {
	userNickname: `ObsidianUser_${Math.random().toString(36).substring(2, 8)}`, // Генеруємо випадковий нік
	listenPort: 61337, // Стандартний порт
	saveHistory: true,
	downloadPath: '',
}

export default class LocalChatPlugin extends Plugin {
	settings: LocalChatPluginSettings;
	chatView: ChatView | null = null; // Зберігаємо посилання на екземпляр View

	// TODO: Екземпляри класів для мережі та виявлення

	networkManager: NetworkManager | null = null;
	// userDiscovery: UserDiscovery;
	private outgoingFileOffers: Map<string, {
		fileId: string;
		filePath: string; // Абсолютний шлях до файлу на диску відправника
		filename: string;
		size: number; // <-- ДОДАНО ЦЕ ПОЛЕ
		recipientNickname: string | null; // null для broadcast або якщо ще не визначено
	}> = new Map();



	async onload() {
		console.log(`[${this.manifest.name}] Завантаження плагіну...`);

		// --- Завантаження Налаштувань ---
		await this.loadSettings();

		// --- Ініціалізація Основних Компонентів (Мережа, Виявлення) ---
		// Важливо: Це місце, де ви створите та налаштуєте ваші мережеві модулі
		console.log(`[${this.manifest.name}] Використовується псевдонім: ${this.settings.userNickname}`);
		console.log(`[${this.manifest.name}] Очікуваний порт: ${this.settings.listenPort}`);

		// Приклад ініціалізації (потрібно створити ці класи/модулі):

		// 2. Визначаємо об'єкт з callback-функціями для NetworkManager
		// Важливо використовувати .bind(this), щоб зберегти контекст 'this' всередині обробників
		const networkCallbacks: NetworkManagerCallbacks = {
			onMessageReceived: this.handleIncomingMessage.bind(this),
			onFileOfferReceived: this.handleIncomingFileOffer.bind(this),
			onFileAcceptReceived: this.handleFileAcceptReceived.bind(this),
			onFileDeclineReceived: this.handleFileDeclineReceived.bind(this),
			onFileTransferStart: this.handleFileTransferStart.bind(this),
			onFileTransferProgress: this.handleFileTransferProgress.bind(this),
			onFileTransferComplete: this.handleFileTransferComplete.bind(this),
			onFileTransferError: this.handleFileTransferError.bind(this),
			onClientConnected: (clientInfo) => {
				console.log(`[${this.manifest.name}] Клієнт підключився: ${clientInfo.ip}:${clientInfo.port}`);
				// TODO: Можливо оновити статус користувача в UI, якщо відстежуємо з'єднання
			},
			onClientDisconnected: (clientInfo) => {
				console.log(`[${this.manifest.name}] Клієнт відключився: ${clientInfo.ip}:${clientInfo.port}`);
				// TODO: Можливо оновити статус користувача в UI
			},
			onNetworkError: (context: string, error: Error) => {
				// Уникаємо надто нав'язливих повідомлень про типові помилки з'єднання
				if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
					console.warn(`[${this.manifest.name}] Мережева помилка (${context}): ${error.message}`);
				} else {
					console.error(`[${this.manifest.name}] Серйозна мережева помилка (${context}):`, error);
					new Notice(`Помилка мережі (${context}): ${error.message}`);
				}
			},
		};

		// 3. Створюємо екземпляр NetworkManager
		this.networkManager = new NetworkManager(this.settings.listenPort, networkCallbacks);

		// 4. Запускаємо сервер NetworkManager (а потім UserDiscovery)
		try {
			await this.networkManager.startServer();
			console.log(`[${this.manifest.name}] TCP сервер успішно запущено на порті ${this.settings.listenPort}.`);

			// --- Тут ініціалізуємо та запускаємо UserDiscovery ---
			/*
			const discoveryCallbacks = {
				onUserFound: this.handleUserFound.bind(this),
				onUserLeft: this.handleUserLeft.bind(this),
			};
			this.userDiscovery = new UserDiscovery({
					nickname: this.settings.userNickname,
					port: this.settings.listenPort
				}, discoveryCallbacks);

			await this.userDiscovery.start();
			console.log(`[${this.manifest.name}] Виявлення користувачів запущено.`);
			*/
			// ----------------------------------------------------

			new Notice(`[${this.manifest.name}] Чат активний.`);

		} catch (error: any) {
			console.error(`[${this.manifest.name}] КРИТИЧНА ПОМИЛКА запуску мережевих сервісів:`, error);
			new Notice(`[${this.manifest.name}] Не вдалося запустити сервіси чату! Помилка: ${error.message}. Функціонал недоступний.`);
			// Важливо зупинити те, що могло запуститись, і скинути стан
			if (this.networkManager) {
				await this.networkManager.stopServer();
				this.networkManager = null;
			}
			/* if (this.userDiscovery) {
				await this.userDiscovery.stop();
				this.userDiscovery = null;
			} */
			return; // Зупиняємо подальше завантаження плагіну
		}

		// 5. Реєструємо решту компонентів Obsidian (View, команди, налаштування)
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => {
				this.chatView = new ChatView(leaf, this);
				// Одразу передаємо поточний список користувачів у View, якщо він є
				// this.userDiscovery?.getAllUsers().forEach(user => this.chatView?.addUserToList(user));
				// TODO: Передати історію
				return this.chatView;
			}
		);

		this.addRibbonIcon('message-circle', 'Відкрити Локальний Чат', (evt: MouseEvent) => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-local-chat-view',
			name: 'Відкрити панель Локального Чату',
			callback: () => { this.activateView(); }
		});

		this.addSettingTab(new ChatSettingTab(this.app, this));

		console.log(`[${this.manifest.name}] Плагін успішно завантажено та готовий до роботи.`);

		/*this.userDiscovery = new UserDiscovery({
			nickname: this.settings.userNickname,
			port: this.settings.listenPort,
			onUserFound: this.handleUserFound.bind(this),
			onUserLeft: this.handleUserLeft.bind(this),
		});

		try {
			await this.networkManager.startServer(); // Запускаємо TCP сервер
			await this.userDiscovery.start();      // Запускаємо mDNS виявлення/рекламу
			new Notice(`[${this.manifest.name}] Сервер та виявлення запущені.`);
		} catch (error) {
			console.error(`[${this.manifest.name}] Помилка запуску мережевих сервісів:`, error);
			new Notice(`[${this.manifest.name}] Помилка запуску мережевих сервісів! Див. консоль.`);
		}
		*/


		// --- Реєстрація View для Чату ---
		this.registerView(
			CHAT_VIEW_TYPE,
			(leaf) => {
				this.chatView = new ChatView(leaf, this); // Передаємо посилання на плагін у View
				// TODO: Передати в ChatView посилання на networkManager/userDiscovery або функції для взаємодії
				return this.chatView;
			}
		);

		// --- Додавання Іконки на Бічну Панель ---
		this.addRibbonIcon('message-circle', 'Відкрити Локальний Чат', (evt: MouseEvent) => {
			this.activateView();
		});

		// --- Додавання Команди ---
		this.addCommand({
			id: 'open-local-chat-view',
			name: 'Відкрити панель Локального Чату',
			callback: () => {
				this.activateView();
			}
		});

		// --- Додавання Сторінки Налаштувань ---
		this.addSettingTab(new ChatSettingTab(this.app, this));

		console.log(`[${this.manifest.name}] Плагін завантажено.`);
	}

	async onunload() {
		console.log(`[${this.manifest.name}] Вивантаження плагіну...`);

		// Зупиняємо мережеві компоненти (спочатку виявлення, потім сервер)
		/* if (this.userDiscovery) {
			try {
				await this.userDiscovery.stop();
				console.log(`[${this.manifest.name}] Виявлення користувачів зупинено.`);
			} catch(err) { console.error(`[${this.manifest.name}] Помилка зупинки UserDiscovery:`, err); }
			this.userDiscovery = null;
		} */
		if (this.networkManager) {
			try {
				await this.networkManager.stopServer();
				console.log(`[${this.manifest.name}] TCP сервер зупинено.`);
			} catch (err) { console.error(`[${this.manifest.name}] Помилка зупинки NetworkManager:`, err); }
			this.networkManager = null;
		}

		this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
		this.chatView = null; // Очищаємо посилання
		this.outgoingFileOffers.clear();
		this.incomingFileOffers.clear();

		console.log(`[${this.manifest.name}] Плагін вивантажено.`);
	}

	// --- Методи-обробники для NetworkManager Callbacks ---
	// (Додайте сюди реалізацію ВСІХ функцій, визначених у NetworkManagerCallbacks)

	private handleIncomingMessage(sender: { ip: string, port: number }, message: any): void {
		console.log(`[${this.manifest.name}] Отримано message від ${sender.ip}:${sender.port}`, message);
		// Знаходимо нік відправника (якщо UserDiscovery працює)
		// const senderNickname = this.userDiscovery?.findUserByAddress(sender.ip, sender.port)?.nickname || `${sender.ip}:${sender.port}`;
		const senderNickname = message.senderNickname || `${sender.ip}:${sender.port}`; // Беремо з повідомлення або fallback

		if (message.type === 'text' && message.content) {
			this.chatView?.displayMessage(senderNickname, message.content, message.timestamp || Date.now(), false);

			// TODO: Збереження в історію
			// if (this.settings.saveHistory) { ... }

			// Показуємо сповіщення, якщо чат не активний
			if (!this.isChatViewActive()) {
				new Notice(`${senderNickname}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`);
			}
		} else {
			console.warn(`[${this.manifest.name}] Отримано невідомий тип повідомлення або не 'text':`, message);
		}
	}

	private handleIncomingFileOffer(sender: { ip: string, port: number }, fileInfo: { fileId: string, filename: string, size: number }): void {
		console.log(`[${this.manifest.name}] Отримано fileOffer від ${sender.ip}:${sender.port}`, fileInfo);
		// const senderNickname = this.userDiscovery?.findUserByAddress(sender.ip, sender.port)?.nickname || `${sender.ip}:${sender.port}`;
		const senderNickname = "UnknownSender"; // Потрібно знайти спосіб отримати нік з UserDiscovery або додати в payload

		// Зберігаємо інформацію про пропозицію локально
		this.incomingFileOffers.set(fileInfo.fileId, {
			...fileInfo,
			senderNickname: senderNickname, // TODO: Get real nickname
			senderAddress: `${sender.ip}:${sender.port}`
		});

		// Показуємо пропозицію в UI
		this.chatView?.displayFileOffer(senderNickname, fileInfo); // TODO: Pass real nickname

		// Показуємо сповіщення, якщо чат не активний
		if (!this.isChatViewActive()) {
			new Notice(`Пропозиція файлу '${fileInfo.filename}' від ${senderNickname}`);
		}
	}

	private handleFileAcceptReceived(sender: { ip: string, port: number }, fileId: string): void {
		console.log(`[${this.manifest.name}] Отримано fileAccept для ${fileId} від ${sender.ip}:${sender.port}`);
		const offer = this.outgoingFileOffers.get(fileId);

		if (offer && this.networkManager) {
			console.log(`[${this.manifest.name}] Починаємо надсилання файлу ${offer.filename} (${offer.filePath})`);
			this.networkManager.startFileTransfer(sender.ip, sender.port, fileId, offer.filePath)
				.then(() => {
					console.log(`[${this.manifest.name}] StartFileTransfer для ${fileId} ініційовано.`);
					// Оновлюємо UI через updateFileProgress
					this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size, 'starting'); // Статус початку
				})
				.catch(err => {
					console.error(`[${this.manifest.name}] Помилка ініціалізації startFileTransfer для ${fileId}:`, err);
					new Notice(`Не вдалося почати передачу файлу ${offer.filename}.`);
					this.outgoingFileOffers.delete(fileId); // Очищаємо стан
					// Оновлюємо UI через updateFileProgress
					this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size, 'error'); // Статус помилки
				});
		} else {
			console.error(`[${this.manifest.name}] Отримано fileAccept для невідомого або неактивного fileId: ${fileId}`);
		}
	}
	private handleFileDeclineReceived(sender: { ip: string, port: number }, fileId: string): void {
		console.log(`[${this.manifest.name}] Отримано fileDecline для ${fileId} від ${sender.ip}:${sender.port}`);
		const offer = this.outgoingFileOffers.get(fileId);
		if (offer) {
			new Notice(`Користувач відхилив передачу файлу: ${offer.filename}`);
			this.outgoingFileOffers.delete(fileId);
			// Оновлюємо UI через updateFileProgress
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, offer.size || 0, 'declined'); // Статус відхилено
		} else {
			console.warn(`[${this.manifest.name}] Отримано fileDecline для невідомого fileId: ${fileId}`);
		}
	}

	private handleFileTransferStart(fileId: string, direction: 'upload' | 'download', totalSize: number): void {
		console.log(`[${this.manifest.name}] Початок передачі файлу ${fileId} (${direction}), розмір: ${totalSize}`);
		// TODO: Оновити UI, показати початок прогресу
		this.chatView?.updateFileProgress?.(fileId, direction, 0, totalSize, 'starting');
	}

	private handleFileTransferProgress(fileId: string, direction: 'upload' | 'download', transferredBytes: number, totalSize: number): void {
		// Оновлюємо прогрес не надто часто, щоб не навантажувати UI
		// Можна додати логіку тротлінгу тут, якщо потрібно
		console.log(`[${this.manifest.name}] Прогрес ${fileId} (${direction}): ${transferredBytes}/${totalSize}`);
		// TODO: Оновити UI, показати прогрес
		this.chatView?.updateFileProgress?.(fileId, direction, transferredBytes, totalSize, 'progressing');
	}

	private handleFileTransferComplete(fileId: string, direction: 'upload' | 'download', filePath: string | null): void {
		if (direction === 'download' && filePath) {
			const offer = this.incomingFileOffers.get(fileId);
			const filename = offer?.filename || path.basename(filePath);
			console.log(`[${this.manifest.name}] Файл ${fileId} (${filename}) успішно отримано: ${filePath}`);
			new Notice(`Файл '${filename}' завантажено.`);
			this.incomingFileOffers.delete(fileId); // Очищаємо стан
			// TODO: Оновити UI, показати завершення
			this.chatView?.updateFileProgress?.(fileId, direction, offer?.size || 0, offer?.size || 0, 'completed');
		} else if (direction === 'upload') {
			const offer = this.outgoingFileOffers.get(fileId);
			const filename = offer?.filename || 'файл';
			console.log(`[${this.manifest.name}] Файл ${fileId} (${filename}) успішно надіслано.`);
			new Notice(`Файл '${filename}' надіслано.`);
			this.outgoingFileOffers.delete(fileId); // Очищаємо стан
			// TODO: Оновити UI, показати завершення
			this.chatView?.updateFileProgress?.(fileId, direction, offer?.size || 0, offer?.size || 0, 'completed'); // Потрібно знати розмір файлу
		}
	}

	private handleFileTransferError(fileId: string, direction: 'upload' | 'download', error: Error): void {
		console.error(`[${this.manifest.name}] Помилка передачі файлу ${fileId} (${direction}):`, error);
		const filename = (direction === 'upload' ? this.outgoingFileOffers.get(fileId)?.filename : this.incomingFileOffers.get(fileId)?.filename) || 'файл';
		new Notice(`Помилка передачі файлу '${filename}': ${error.message}`);

		// Очищаємо стан
		if (direction === 'upload') this.outgoingFileOffers.delete(fileId);
		if (direction === 'download') this.incomingFileOffers.delete(fileId);

		// TODO: Оновити UI, показати помилку
		this.chatView?.updateFileProgress?.(fileId, direction, 0, 0, 'error');
	}


	// --- Допоміжні методи ---

	/** Перевіряє, чи відкрита та активна панель чату */
	private isChatViewActive(): boolean {
		const chatLeaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (chatLeaves.length === 0) return false;
		// Перевіряємо, чи активна хоча б одна з панелей чату
		return chatLeaves.some(leaf => this.app.workspace.activeLeaf === leaf);
	}

	/** Визначає шлях для збереження файлу */
	private async determineSavePath(filename: string): Promise<string> {
		let downloadDir = this.settings.downloadPath;

		// Якщо шлях не вказано, використовуємо папку вкладень сховища
		if (!downloadDir) {
			const attachmentPath = this.app.vault.getConfig('attachmentFolderPath'); // '/_attachments'
			if (attachmentPath.startsWith('/')) {
				// Шлях від кореня сховища
				downloadDir = attachmentPath.substring(1); // Прибираємо початковий слеш
			} else {
				// Відносний шлях (рідко, але можливо) - буде створено відносно кореня
				downloadDir = attachmentPath;
			}
			// Переконуємось, що базова папка існує (Obsidian зазвичай це робить сам для вкладень)
			try {
				const abstractBase = this.app.vault.getAbstractFileByPath(downloadDir);
				if (!abstractBase) {
					await this.app.vault.createFolder(downloadDir);
				}
			} catch (err) {
				console.error(`Не вдалося створити/перевірити папку вкладень ${downloadDir}, використовуємо корінь сховища`, err);
				downloadDir = ''; // Корінь сховища як fallback
			}
		}

		// Потрібен абсолютний шлях для fs.createWriteStream
		const vaultBasePath = (this.app.vault.adapter as any).getBasePath(); // Недокументований API, може змінитись!
		const absoluteDir = path.join(vaultBasePath, downloadDir);

		// Перевірка та створення директорії (про всяк випадок)
		try {
			if (!fs.existsSync(absoluteDir)) {
				await fs.promises.mkdir(absoluteDir, { recursive: true });
			}
		} catch (err) {
			console.error(`Не вдалося створити директорію ${absoluteDir}, використовуємо корінь сховища`, err);
			// Якщо не вдалося створити вказану/папку вкладень, зберігаємо в корінь сховища
			return path.join(vaultBasePath, this.sanitizeFilename(filename));
		}


		// Обробка конфліктів імен: додаємо (1), (2) тощо.
		let savePath = path.join(absoluteDir, this.sanitizeFilename(filename));
		let counter = 1;
		while (fs.existsSync(savePath)) {
			const extension = path.extname(filename);
			const baseName = path.basename(filename, extension);
			savePath = path.join(absoluteDir, `${this.sanitizeFilename(baseName)} (${counter})${extension}`);
			counter++;
		}
		return savePath;
	}

	/** Проста санітизація імені файлу */
	private sanitizeFilename(filename: string): string {
		// Видаляємо символи, які не дозволені в іменах файлів у Windows/Mac/Linux
		// Це базовий приклад, можна вдосконалити
		return filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '_$1$2');
	}


	// --- Публічні методи, які може викликати ChatView ---

	// Перевизначаємо метод з попереднього прикладу, щоб він використовував NetworkManager
	async sendMessage(recipientNickname: string | null, message: string): Promise<void> {
		if (!this.networkManager) {
			new Notice("Мережевий менеджер не активний.");
			return;
		}

		const senderNickname = this.settings.userNickname;
		const timestamp = Date.now();
		const payload = {
			type: 'text',
			senderNickname: senderNickname,
			content: message,
			timestamp: timestamp
		};

		let sent = false; // Флаг успішного надсилання хоча б одному

		try {
			if (recipientNickname === null) { // Broadcast
				// const recipients = this.userDiscovery?.getAllUsers().filter(u => u.nickname !== senderNickname) || [];
				const recipients: Array<{ nickname: string, ip: string, port: number }> = []; // Заглушка, потрібен UserDiscovery
				if (recipients.length === 0) {
					console.log("Немає отримувачів для broadcast.");
					// Чи показувати власне повідомлення, якщо нема кому слати?
				}
				const sendPromises = recipients.map(user =>
					this.networkManager!.sendData(user.ip, user.port, payload)
						.then(() => { sent = true; })
						.catch(err => console.warn(`Помилка надсилання broadcast до ${user.nickname}: ${err.message}`))
				);
				await Promise.all(sendPromises);
			} else { // Private
				// const userInfo = this.userDiscovery?.getUserInfo(recipientNickname);
				const userInfo: { nickname: string, ip: string, port: number } | null = null; // Заглушка
				if (userInfo) {
					await this.networkManager.sendData(userInfo.ip, userInfo.port, payload);
					sent = true;
				} else {
					new Notice(`Користувач ${recipientNickname} не знайдений.`);
				}
			}

			if (sent || recipientNickname === null) { // Показуємо своє, якщо broadcast або успішне приватне
				this.chatView?.displayMessage(senderNickname, message, timestamp, true);
				// TODO: Зберегти в історію
			}
		} catch (error: any) {
			console.error("Помилка надсилання повідомлення:", error);
			new Notice(`Помилка надсилання: ${error.message}`);
		}
	}

	// Перевизначаємо метод, щоб він використовував NetworkManager
	async acceptFileOffer(senderNickname: string, fileId: string): Promise<void> {
		if (!this.networkManager) return;
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) {
			console.error(`Не знайдено інформацію про вхідну пропозицію файлу ${fileId}`);
			new Notice("Помилка: Пропозицію файлу не знайдено.");
			return;
		}
		// const senderInfo = this.userDiscovery?.getUserInfo(senderNickname);
		const senderInfo: { nickname: string, ip: string, port: number } | null = null; // Заглушка
		if (!senderInfo) {
			// Спробуємо взяти адресу зі збереженої пропозиції, якщо юзер вже офлайн
			const addrParts = offer.senderAddress.split(':');
			if (addrParts.length !== 2) {
				new Notice(`Не вдалося знайти адресу відправника ${senderNickname}`);
				return;
			}
			senderInfo = { nickname: senderNickname, ip: addrParts[0], port: parseInt(addrParts[1]) };
		}


		try {
			const savePath = await this.determineSavePath(offer.filename);
			console.log(`Прийняття файлу ${fileId}. Шлях збереження: ${savePath}`);

			// Готуємо NM до прийому
			await this.networkManager.prepareToReceiveFile(fileId, savePath, offer.size, `${senderNickname} (${senderInfo.ip}:${senderInfo.port})`);

			// Надсилаємо підтвердження відправнику
			const payload = { type: 'fileAccept', receiverNickname: this.settings.userNickname, fileId: fileId };
			await this.networkManager.sendData(senderInfo.ip, senderInfo.port, payload);

			console.log(`Підтвердження прийняття ${fileId} надіслано до ${senderNickname}. Очікування даних...`);
			// UI має оновитися через callback onFileTransferStart

		} catch (error: any) {
			console.error(`Помилка при прийнятті файлу ${fileId}:`, error);
			new Notice(`Помилка при прийнятті файлу: ${error.message}`);
			// Потрібно очистити стан, якщо prepareToReceiveFile не вдалося
			if (this.networkManager['receivingFiles']?.has(fileId)) { // Доступ до приватного поля для очищення - не ідеально
				this.networkManager['_cleanupReceivingFile'](fileId, error);
			}
		}
	}

	// Перевизначаємо метод, щоб він використовував NetworkManager
	async declineFileOffer(senderNickname: string, fileId: string): Promise<void> {
		if (!this.networkManager) return;
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) {
			console.warn(`Спроба відхилити вже неактуальну пропозицію файлу ${fileId}`);
			return; // Нічого не робимо, пропозиції вже нема
		}
		// const senderInfo = this.userDiscovery?.getUserInfo(senderNickname);
		const senderInfo: { nickname: string, ip: string, port: number } | null = null; // Заглушка

		if (senderInfo) {
			const payload = { type: 'fileDecline', receiverNickname: this.settings.userNickname, fileId: fileId };
			try {
				await this.networkManager.sendData(senderInfo.ip, senderInfo.port, payload);
				console.log(`Відмова від файлу ${fileId} надіслана до ${senderNickname}.`);
			} catch (error: any) {
				console.warn(`Помилка надсилання відмови для ${fileId} до ${senderNickname}: ${error.message}`);
			}
		} else {
			console.warn(`Відправник ${senderNickname} не знайдений для надсилання відмови ${fileId}.`);
		}
		// Видаляємо пропозицію з локального стану незалежно від успіху надсилання відмови
		this.incomingFileOffers.delete(fileId);
		// Можна оновити UI, якщо потрібно
		this.chatView?.updateFileOfferStatus?.(fileId, 'declined');
	}

	// --- Методи для Роботи з Налаштуваннями ---
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// TODO: Повідомити мережеві компоненти про можливі зміни (нік, порт)
		// наприклад: this.userDiscovery?.updateSettings(this.settings);
		//           this.networkManager?.updateSettings(this.settings);
	}

	// --- Метод для Активації/Відкриття View Чату ---
	async activateView() {
		// Перевіряємо, чи View вже існує
		const existingLeaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			// Якщо існує, просто активуємо її
			this.app.workspace.revealLeaf(existingLeaves[0]);
		} else {
			// Якщо не існує, створюємо нову панель праворуч
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: CHAT_VIEW_TYPE,
					active: true,
				});
				this.app.workspace.revealLeaf(leaf);
			} else {
				console.error(`[${this.manifest.name}] Не вдалося отримати праву панель.`);
				new Notice("Помилка: Не вдалося відкрити панель чату.");
			}
		}
	}

	// --- Обробники Подій від Мережевих Компонентів (Приклади) ---
	/*
	handleIncomingMessage(senderNickname: string, message: string, timestamp: number) {
		console.log(`[${this.manifest.name}] Отримано повідомлення від ${senderNickname}: ${message}`);
		if (this.chatView) {
			this.chatView.displayMessage(senderNickname, message, timestamp, false); // false - не моє повідомлення
			// TODO: Зберегти в історію, якщо ввімкнено
			// TODO: Показати сповіщення?
		} else {
			// Якщо View закритий, показати сповіщення Obsidian
			new Notice(`${senderNickname}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
		}
	}

	handleIncomingFileOffer(senderNickname: string, fileInfo: { fileId: string, filename: string, size: number }) {
		console.log(`[${this.manifest.name}] Отримано пропозицію файлу ${fileInfo.filename} від ${senderNickname}`);
		if (this.chatView) {
			this.chatView.displayFileOffer(senderNickname, fileInfo);
		} else {
			new Notice(`Пропозиція файлу ${fileInfo.filename} від ${senderNickname}`);
		}
	}

	handleUserFound(userInfo: { nickname: string, ip: string, port: number }) {
		console.log(`[${this.manifest.name}] Знайдено користувача: ${userInfo.nickname} (${userInfo.ip}:${userInfo.port})`);
		if (this.chatView) {
			this.chatView.addUserToList(userInfo);
		}
	}

	handleUserLeft(userInfo: { nickname: string }) {
		console.log(`[${this.manifest.name}] Користувач вийшов: ${userInfo.nickname}`);
		if (this.chatView) {
			this.chatView.removeUserFromList(userInfo.nickname);
		}
	}
	*/

	// --- Методи для Взаємодії з Мережею (Викликаються з ChatView) ---
	/*
	async sendMessage(recipientNickname: string, message: string) {
		// Знайти IP/Port за ніком через userDiscovery або збережений список
		// const recipientInfo = this.userDiscovery.getUserInfo(recipientNickname);
		// if (recipientInfo) {
		//	 await this.networkManager.sendMessage(recipientInfo.ip, recipientInfo.port, message);
		//   if (this.chatView) {
		//       this.chatView.displayMessage(this.settings.userNickname, message, Date.now(), true); // true - моє повідомлення
		//   }
		//	 // TODO: Зберегти в історію
		// } else {
		//    console.error(`[${this.manifest.name}] Не знайдено інформацію для ${recipientNickname}`);
		//    new Notice(`Помилка: Користувач ${recipientNickname} не знайдений.`);
		// }
	}

	async sendFile(recipientNickname: string, file: File) {
		// Логіка надсилання файлу через networkManager
	}
	*/
	/**
   * Метод викликається з ChatView, коли користувач обирає файл для надсилання.
   * @param file Об'єкт File, отриманий з input[type=file]
   * @param recipientNickname Нік отримувача (або null для broadcast/вибору пізніше)
   */
	async initiateSendFile(file: File, recipientNickname: string | null): Promise<void> {
		if (!this.networkManager) {
			new Notice("Мережевий сервіс не активний.");
			return;
		}

		const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const filename = file.name;
		const size = file.size;
		// ВАЖЛИВО: Отримання повного шляху (filePath) до оригінального файлу
		// з об'єкта File в Electron/браузері напряму неможливе з міркувань безпеки.
		// Зазвичай потрібно або:
		// 1. Скопіювати файл у тимчасову директорію плагіна і працювати з копією.
		// 2. Використовувати специфічні API Electron для роботи з файлами (менш портативно).
		// 3. Передавати сам об'єкт File або його дані (ArrayBuffer) далі.
		// Для прикладу, ми збережемо лише ім'я і розмір, а NetworkManager.startFileTransfer
		// потребуватиме модифікації, щоб працювати з об'єктом File або ArrayBuffer,
		// АБО припустимо, що ми якимось чином отримали реальний шлях (filePath).
		// Давайте тимчасово збережемо сам об'єкт File в мапі (не найкраща практика для великих файлів).
		// Краще - зберегти шлях до копії.

		// --- Приклад збереження об'єкта File (потребує змін в NetworkManager) ---
		// Змінимо тип outgoingFileOffers, щоб зберігати File замість filePath
		/* this.outgoingFileOffers.set(fileId, {
			fileId,
			fileObject: file, // Зберігаємо сам об'єкт File
			filename,
			size,
			recipientNickname
		}); */

		// --- Приклад зі збереженням ШЛЯХУ (як було задумано спочатку) ---
		// Припустимо, що 'file.path' існує (це НЕ стандартна властивість File API!)
		// або ми отримали шлях іншим способом (наприклад, скопіювали файл).
		// Замість file.path використаємо фіктивний шлях для прикладу
		const filePath = (file as any).path || "НЕВІДОМИЙ_ШЛЯХ_ДО_ФАЙЛУ/" + filename; // ЗАГЛУШКА! Потрібен реальний шлях до файлу або копії.
		if (filePath.startsWith("НЕВІДОМИЙ_ШЛЯХ")) {
			new Notice("Помилка: Неможливо отримати шлях до файлу для надсилання.", 5000);
			console.error("Помилка: Неможливо отримати шлях до файлу для надсилання. Збереження скасовано.");
			return; // Не продовжуємо, якщо шлях невідомий
		}


		// Зберігаємо інформацію, включаючи РОЗМІР
		this.outgoingFileOffers.set(fileId, {
			fileId,
			filePath: filePath, // Використовуємо шлях
			filename,
			size, // <--- ЗБЕРІГАЄМО РОЗМІР
			recipientNickname
		});


		console.log(`[${this.manifest.name}] Ініційовано надсилання файлу: ${filename} (${size} байт), ID: ${fileId}`);

		// Створюємо payload для fileOffer
		const fileOfferPayload = {
			type: 'fileOffer',
			senderNickname: this.settings.userNickname,
			fileId: fileId,
			filename: filename,
			size: size
		};

		// Показуємо прогрес відправки в своєму UI
		this.chatView?.displayUploadProgress({ fileId, filename, size, recipientNickname });


		// Надсилаємо пропозицію отримувачу(чам)
		try {
			if (recipientNickname === null) { // Broadcast
				// const recipients = this.userDiscovery?.getAllUsers().filter(u => u.nickname !== this.settings.userNickname) || [];
				const recipients: Array<{ nickname: string, ip: string, port: number }> = []; // Заглушка
				if (recipients.length === 0) {
					new Notice("Немає активних користувачів для надсилання файлу.");
					this.outgoingFileOffers.delete(fileId); // Видаляємо, бо нема кому слати
					this.chatView?.updateFileProgress?.(fileId, 'upload', 0, size, 'error'); // Показуємо помилку в UI
					return;
				}
				const sendPromises = recipients.map(user =>
					this.networkManager!.sendData(user.ip, user.port, fileOfferPayload)
						.catch(err => console.warn(`Помилка надсилання fileOffer (broadcast) до ${user.nickname}: ${err.message}`))
				);
				await Promise.all(sendPromises);
			} else { // Private
				// const userInfo = this.userDiscovery?.getUserInfo(recipientNickname);
				const userInfo: { nickname: string, ip: string, port: number } | null = null; // Заглушка
				if (userInfo) {
					await this.networkManager.sendData(userInfo.ip, userInfo.port, fileOfferPayload);
				} else {
					this.outgoingFileOffers.delete(fileId); // Видаляємо, бо нема кому слати
					this.chatView?.updateFileProgress?.(fileId, 'upload', 0, size, 'error'); // Показуємо помилку в UI
					new Notice(`Не вдалося надіслати пропозицію: користувач ${recipientNickname} не знайдений.`);
					return;
				}
			}
			console.log(`[${this.manifest.name}] Пропозицію файлу ${fileId} надіслано.`);
			// Очікуємо на fileAccept або fileDecline...
		} catch (error: any) {
			console.error(`[${this.manifest.name}] Помилка надсилання fileOffer для ${fileId}:`, error);
			new Notice(`Помилка надсилання пропозиції файлу: ${error.message}`);
			this.outgoingFileOffers.delete(fileId); // Очищаємо стан при помилці
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, size, 'error'); // Показуємо помилку в UI
		}
	}
}

// --- Клас для Сторінки Налаштувань ---
class ChatSettingTab extends PluginSettingTab {
	plugin: LocalChatPlugin;

	constructor(app: App, plugin: LocalChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Налаштування Локального Чату' });

		new Setting(containerEl)
			.setName('Ваш Псевдонім')
			.setDesc('Як вас бачитимуть інші користувачі в мережі.')
			.addText(text => text
				.setPlaceholder('Введіть псевдонім')
				.setValue(this.plugin.settings.userNickname)
				.onChange(async (value) => {
					this.plugin.settings.userNickname = value.trim() || DEFAULT_SETTINGS.userNickname; // Не дозволяємо порожній нік
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Порт для прослуховування')
			.setDesc('TCP порт, який буде використовувати плагін. Потребує перезапуску Obsidian для застосування.')
			.addText(text => text
				.setPlaceholder(String(DEFAULT_SETTINGS.listenPort))
				.setValue(String(this.plugin.settings.listenPort))
				.onChange(async (value) => {
					const port = parseInt(value);
					if (!isNaN(port) && port > 1024 && port < 65535) {
						this.plugin.settings.listenPort = port;
					} else {
						// Якщо введено некоректне значення, скидаємо до дефолтного (або попереднього)
						text.setValue(String(this.plugin.settings.listenPort));
						new Notice("Некоректний порт. Введіть число від 1025 до 65534.");
					}
					// Примітка: Збереження відбувається, але для реального застосування порту потрібен перезапуск
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Зберігати історію чату')
			.setDesc('Чи зберігати повідомлення між сесіями Obsidian.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.saveHistory)
				.onChange(async (value) => {
					this.plugin.settings.saveHistory = value;
					await this.plugin.saveSettings();
				}));

		// TODO: Додати кнопку "Очистити історію чату" тут
		// new Setting(containerEl)
		//     .setName('Очистити історію')
		//     .setDesc('Видаляє всі збережені повідомлення.')
		//     .addButton(button => button
		//         .setButtonText('Очистити')
		//         .setWarning() // Робить кнопку червоною
		//         .onClick(async () => {
		//             // Показати підтвердження перед очисткою
		//             if (confirm('Ви впевнені, що хочете видалити всю історію чату?')) {
		//                 // TODO: Викликати метод очищення історії
		//                 // await this.plugin.clearChatHistory();
		//                 new Notice('Історію чату очищено.');
		//             }
		//         }));
	}

	async sendMessage(recipientNickname: string | null, message: string): Promise<void> {
		if (!this.networkManager || !this.userDiscovery) {
			console.error(`[${this.manifest.name}] NetworkManager або UserDiscovery не ініціалізовано.`);
			new Notice("Помилка: Мережеві компоненти не готові.");
			return;
		}
		if (!message) return; // Не надсилати порожні

		const senderNickname = this.settings.userNickname;
		const timestamp = Date.now();
		const payload = {
			type: 'text',
			senderNickname: senderNickname,
			content: message,
			timestamp: timestamp
		};

		let sent = false; // Прапорець, чи було надіслано хоча б комусь

		try {
			if (recipientNickname === null) {
				// --- Broadcast ---
				console.log(`[${this.manifest.name}] Надсилання повідомлення (broadcast)...`);
				const allUsers = this.userDiscovery.getAllUsers();
				const recipients = allUsers.filter(user => user.nickname !== senderNickname); // Не надсилати собі

				if (recipients.length === 0) {
					new Notice("Немає активних користувачів для надсилання.");
					console.log(`[${this.manifest.name}] Немає отримувачів для broadcast.`);
					// Можливо, все одно показати власне повідомлення?
					// Залежить від бажаної логіки
				}

				const sendPromises = recipients.map(user =>
					this.networkManager.sendData(user.ip, user.port, payload)
						.then(() => { sent = true; }) // Позначити, що надіслано хоч одному
						.catch(err => {
							console.error(`[${this.manifest.name}] Помилка надсилання до ${user.nickname} (${user.ip}:${user.port}):`, err);
							// Можливо, показати помилку в UI або позначити користувача як недоступного
						})
				);
				await Promise.all(sendPromises); // Чекаємо завершення всіх спроб надсилання

			} else {
				// --- Приватне повідомлення ---
				console.log(`[${this.manifest.name}] Надсилання приватного повідомлення до ${recipientNickname}...`);
				const recipientInfo = this.userDiscovery.getUserInfo(recipientNickname);

				if (recipientInfo) {
					await this.networkManager.sendData(recipientInfo.ip, recipientInfo.port, payload);
					sent = true; // Позначити, що надіслано
				} else {
					console.error(`[${this.manifest.name}] Не знайдено інформацію для отримувача: ${recipientNickname}`);
					new Notice(`Помилка: Користувач ${recipientNickname} не знайдений або офлайн.`);
				}
			}

			// --- Показати власне повідомлення в UI, якщо було надіслано ---
			// Або завжди показувати, навіть якщо не було отримувачів? - Залежить від вимог
			if (sent || recipientNickname === null) { // Показуємо якщо broadcast або вдало надіслано приватно
				this.chatView?.displayMessage(senderNickname, message, timestamp, true); // true - це моє повідомлення

				// TODO: Зберегти повідомлення в історію, якщо ввімкнено
				// if (this.settings.saveHistory) {
				//     this.addMessageToHistory({ sender: senderNickname, content: message, timestamp: timestamp, isOwn: true, recipient: recipientNickname });
				// }
			}

		} catch (error) {
			console.error(`[${this.manifest.name}] Загальна помилка надсилання повідомлення:`, error);
			new Notice("Помилка надсилання повідомлення. Див. консоль.");
		}
	}


	// --- Метод для прийняття пропозиції файлу ---
	async acceptFileOffer(senderNickname: string, fileId: string): Promise<void> {
		if (!this.networkManager || !this.userDiscovery) {
			console.error(`[${this.manifest.name}] NetworkManager або UserDiscovery не ініціалізовано.`);
			new Notice("Помилка: Мережеві компоненти не готові.");
			return;
		}

		const senderInfo = this.userDiscovery.getUserInfo(senderNickname);
		if (!senderInfo) {
			console.error(`[${this.manifest.name}] Не знайдено інформацію для відправника ${senderNickname} при прийнятті файлу ${fileId}.`);
			new Notice(`Помилка: Відправник ${senderNickname} не знайдений.`);
			return;
		}

		console.log(`[${this.manifest.name}] Прийняття файлу ${fileId} від ${senderNickname}`);

		const payload = {
			type: 'fileAccept',
			receiverNickname: this.settings.userNickname,
			fileId: fileId
		};

		try {
			// Повідомляємо відправника про згоду
			await this.networkManager.sendData(senderInfo.ip, senderInfo.port, payload);

			// TODO: Підготувати NetworkManager до отримання даних для fileId
			// Наприклад:
			// const fileDetails = this.getPendingFileOfferDetails(fileId); // Отримати ім'я, розмір
			// if (fileDetails) {
			//    const savePath = await this.determineSavePath(fileDetails.filename); // Визначити шлях збереження
			//    await this.networkManager.prepareToReceiveFile(fileId, savePath);
			//    console.log(`[${this.manifest.name}] Готовий отримувати файл ${fileId} в ${savePath}`);
			//    // Можливо, оновити UI в ChatView, показати "Очікування завантаження..."
			//    this.chatView?.updateFileOfferStatus(fileId, 'accepted');
			// } else {
			//    console.error(`[${this.manifest.name}] Не знайдено деталей пропозиції для файлу ${fileId}`);
			//    throw new Error("File offer details not found"); // Генеруємо помилку, щоб відправити відмову або сповістити користувача
			// }
			console.log(`[${this.manifest.name}] Підтвердження прийняття файлу ${fileId} надіслано до ${senderNickname}`);

		} catch (error) {
			console.error(`[${this.manifest.name}] Помилка надсилання підтвердження прийняття файлу ${fileId} до ${senderNickname}:`, error);
			new Notice(`Помилка прийняття файлу від ${senderNickname}.`);
			// TODO: Можливо, потрібно відправити 'fileDecline' або очистити стан?
		}
	}


	// --- Метод для відхилення пропозиції файлу ---
	async declineFileOffer(senderNickname: string, fileId: string): Promise<void> {
		if (!this.networkManager || !this.userDiscovery) {
			console.error(`[${this.manifest.name}] NetworkManager або UserDiscovery не ініціалізовано.`);
			// Не показуємо Notice користувачу, бо він сам натиснув "Відхилити"
			return;
		}

		const senderInfo = this.userDiscovery.getUserInfo(senderNickname);
		if (!senderInfo) {
			console.warn(`[${this.manifest.name}] Не знайдено інформацію для відправника ${senderNickname} при відхиленні файлу ${fileId}. Можливо, він вже офлайн.`);
			// Не потрібно нічого надсилати, якщо відправник невідомий
			// TODO: Очистити локальний стан пропозиції файлу, якщо він є
			// this.removePendingFileOffer(fileId);
			return;
		}

		console.log(`[${this.manifest.name}] Відхилення файлу ${fileId} від ${senderNickname}`);

		const payload = {
			type: 'fileDecline',
			receiverNickname: this.settings.userNickname,
			fileId: fileId
		};

		try {
			// Повідомляємо відправника про відмову
			await this.networkManager.sendData(senderInfo.ip, senderInfo.port, payload);
			console.log(`[${this.manifest.name}] Відмова від файлу ${fileId} надіслана до ${senderNickname}`);

			// TODO: Очистити локальний стан пропозиції файлу
			// this.removePendingFileOffer(fileId);
			// Можливо, оновити UI в ChatView
			// this.chatView?.updateFileOfferStatus(fileId, 'declined');

		} catch (error) {
			console.error(`[${this.manifest.name}] Помилка надсилання відмови від файлу ${fileId} до ${senderNickname}:`, error);
			// Не турбуємо користувача повідомленням, бо він вже відхилив
		}
	}




}