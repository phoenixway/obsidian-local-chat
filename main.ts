import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';
import { ChatView, CHAT_VIEW_TYPE } from './ChatView'; // Припускаємо, що ChatView в окремому файлі
import { NetworkManager, NetworkManagerCallbacks } from './NetworkManager'; // Припускаємо, що мережева логіка тут
import { UserDiscovery } from './UserDiscovery'; // Припускаємо, що логіка виявлення тут

import * as fs from 'fs';
import * as path from 'path';

// Інтерфейс для налаштувань плагіну
interface LocalChatPluginSettings {
	userNickname: string;
	listenPort: number;
	saveHistory: boolean;
	downloadPath: string;
	// Додайте інші налаштування за потреби
}

// Інтерфейс для інформації про користувача (повертається UserDiscovery)
export interface UserInfo {
	nickname: string;
	ip: string;
	port: number;
	// Можна додати інші поля, якщо UserDiscovery їх надає (наприклад, статус, id)
}

// Налаштування за замовчуванням
export const DEFAULT_SETTINGS: LocalChatPluginSettings = {
	userNickname: `ObsidianUser_${Math.random().toString(36).substring(2, 8)}`, // Генеруємо випадковий нік
	listenPort: 61337, // Стандартний порт
	saveHistory: true,
	downloadPath: '',
}

export default class LocalChatPlugin extends Plugin {
	settings: LocalChatPluginSettings;
	chatView: ChatView | null = null; // Зберігаємо посилання на екземпляр View
	networkManager: NetworkManager | null = null;
	userDiscovery: UserDiscovery;
	private outgoingFileOffers: Map<string, {
		fileId: string;
		filePath: string; // Абсолютний шлях до файлу на диску відправника
		filename: string;
		size: number; // <-- ДОДАНО ЦЕ ПОЛЕ
		recipientNickname: string | null; // null для broadcast або якщо ще не визначено
	}> = new Map();

	private incomingFileOffers: Map<string, {
		fileId: string;
		filename: string;
		size: number;
		senderNickname: string; // Зберігаємо нік відправника
		senderAddress: string; // Зберігаємо ip:port відправника
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
			// const attachmentPath = this.app.vault.getConfig('attachmentFolderPath'); // '/_attachments'
			const attachmentPath = (this.app.vault as any).getConfig('attachmentFolderPath');


			if (attachmentPath && typeof attachmentPath === 'string') {
				if (attachmentPath.startsWith('/')) {
					downloadDir = attachmentPath.substring(1);

				}
				else {
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
			} else {
				console.warn("Не вдалося отримати attachmentFolderPath або це не рядок, використовуємо корінь сховища.");
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
	// async sendMessage(recipientNickname: string | null, message: string): Promise<void> {
	// 	if (!this.networkManager) {
	// 		new Notice("Мережевий менеджер не активний.");
	// 		return;
	// 	}

	// 	const senderNickname = this.settings.userNickname;
	// 	const timestamp = Date.now();
	// 	const payload = {
	// 		type: 'text',
	// 		senderNickname: senderNickname,
	// 		content: message,
	// 		timestamp: timestamp
	// 	};

	// 	let sent = false; // Флаг успішного надсилання хоча б одному

	// 	try {
	// 		if (recipientNickname === null) { // Broadcast
	// 			// const recipients = this.userDiscovery?.getAllUsers().filter(u => u.nickname !== senderNickname) || [];
	// 			const recipients: Array<{ nickname: string, ip: string, port: number }> = []; // Заглушка, потрібен UserDiscovery
	// 			if (recipients.length === 0) {
	// 				console.log("Немає отримувачів для broadcast.");
	// 				// Чи показувати власне повідомлення, якщо нема кому слати?
	// 			}
	// 			const sendPromises = recipients.map(user =>
	// 				this.networkManager!.sendData(user.ip, user.port, payload)
	// 					.then(() => { sent = true; })
	// 					.catch(err => console.warn(`Помилка надсилання broadcast до ${user.nickname}: ${err.message}`))
	// 			);
	// 			await Promise.all(sendPromises);
	// 		} else { // Private
	// 			// const userInfo = this.userDiscovery?.getUserInfo(recipientNickname);
	// 			const userInfo: { nickname: string, ip: string, port: number } | null = null; // Заглушка
	// 			if (userInfo) {
	// 				await this.networkManager.sendData(userInfo.ip, userInfo.port, payload);
	// 				sent = true;
	// 			} else {
	// 				new Notice(`Користувач ${recipientNickname} не знайдений.`);
	// 			}
	// 		}

	// 		if (sent || recipientNickname === null) { // Показуємо своє, якщо broadcast або успішне приватне
	// 			this.chatView?.displayMessage(senderNickname, message, timestamp, true);
	// 			// TODO: Зберегти в історію
	// 		}
	// 	} catch (error: any) {
	// 		console.error("Помилка надсилання повідомлення:", error);
	// 		new Notice(`Помилка надсилання: ${error.message}`);
	// 	}
	// }

	// Перевизначаємо метод, щоб він використовував NetworkManager
	async acceptFileOffer(senderNickname: string, fileId: string): Promise<void> {
		if (!this.networkManager) {
			console.error(`[${this.manifest.name}] acceptFileOffer: NetworkManager is not initialized.`);
			new Notice("Мережевий сервіс не активний.");
			return;
		}
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) {
			console.error(`[${this.manifest.name}] acceptFileOffer: Не знайдено інформацію про вхідну пропозицію файлу ${fileId}`);
			new Notice("Помилка: Пропозицію файлу не знайдено.");
			return;
		}

		// Оголошуємо через 'let', щоб дозволити переприсвоєння
		let senderInfo: { nickname: string, ip: string, port: number } | null = null;

		// Спочатку намагаємося знайти користувача через UserDiscovery (якщо він реалізований)
		if (this.userDiscovery) {
			senderInfo = this.userDiscovery.getUserInfo(senderNickname);
		}

		// Якщо UserDiscovery не знайшов користувача (або не існує),
		// намагаємося використати збережену адресу з пропозиції
		if (!senderInfo) {
			console.log(`[${this.manifest.name}] acceptFileOffer: Користувач ${senderNickname} не знайдений через UserDiscovery, спроба використати збережену адресу ${offer.senderAddress}`);
			const addrParts = offer.senderAddress?.split(':'); // Перевіряємо наявність senderAddress

			if (offer.senderAddress && addrParts && addrParts.length === 2) {
				const ip = addrParts[0];
				const port = parseInt(addrParts[1]);

				if (ip && !isNaN(port)) {
					// Тепер присвоєння можливе, бо senderInfo оголошено через 'let'
					senderInfo = { nickname: senderNickname, ip: ip, port: port };
					console.log(`[${this.manifest.name}] acceptFileOffer: Використовуємо збережену адресу ${ip}:${port} для ${senderNickname}`);
				} else {
					new Notice(`Не вдалося розпізнати збережену адресу для ${senderNickname}`);
					console.error(`[${this.manifest.name}] acceptFileOffer: Не вдалося розпарсити збережену адресу: ${offer.senderAddress}`);
					return; // Не можемо продовжити без коректної адреси
				}
			} else {
				// Немає збереженої адреси АБО користувача не знайдено через UserDiscovery
				new Notice(`Не вдалося знайти адресу відправника ${senderNickname}`);
				console.error(`[${this.manifest.name}] acceptFileOffer: Не вдалося отримати адресу відправника для ${senderNickname} (fileId: ${fileId})`);
				return; // Не можемо продовжити без адреси відправника
			}
		}

		// Якщо ми дійшли сюди, senderInfo має містити валідні дані (або з UserDiscovery, або зі збереженої адреси)

		try {
			const savePath = await this.determineSavePath(offer.filename);
			console.log(`[${this.manifest.name}] acceptFileOffer: Прийняття файлу ${fileId}. Шлях збереження: ${savePath}`);

			// Готуємо NM до прийому файлу
			// Передаємо senderInfo!.ip і senderInfo!.port, бо ми впевнені, що senderInfo не null на цьому етапі
			await this.networkManager.prepareToReceiveFile(fileId, savePath, offer.size, `${senderNickname} (${senderInfo!.ip}:${senderInfo!.port})`);

			// Надсилаємо підтвердження відправнику
			const payload = { type: 'fileAccept', receiverNickname: this.settings.userNickname, fileId: fileId };
			await this.networkManager.sendData(senderInfo!.ip, senderInfo!.port, payload);

			console.log(`[${this.manifest.name}] acceptFileOffer: Підтвердження прийняття ${fileId} надіслано до ${senderNickname}. Очікування даних...`);
			// UI має оновитися через callback onFileTransferStart або подібний

		} catch (error: any) {
			console.error(`[${this.manifest.name}] acceptFileOffer: Помилка під час прийняття файлу ${fileId}:`, error);
			new Notice(`Помилка при прийнятті файлу: ${error.message}`);
			// Потрібно очистити стан, якщо prepareToReceiveFile не вдалося
			// Доступ до приватних полів не є ідеальним, краще мати публічний метод очищення в NetworkManager
			if (this.networkManager && (this.networkManager as any)['receivingFiles']?.has(fileId)) {
				(this.networkManager as any)['_cleanupReceivingFile'](fileId, error);
			}
		}
	}

	// У файлі main.ts всередині класу LocalChatPlugin

	async declineFileOffer(senderNickname: string, fileId: string): Promise<void> {
		// 1. Перевірка NetworkManager
		if (!this.networkManager) {
			console.error(`[${this.manifest.name}] declineFileOffer: NetworkManager is not initialized.`);
			// Не показуємо Notice, користувач сам ініціював дію
			return;
		}

		// 2. Отримання інформації про пропозицію
		const offer = this.incomingFileOffers.get(fileId);
		if (!offer) {
			// Пропозиції вже немає, можливо, вона була видалена раніше
			console.warn(`[${this.manifest.name}] declineFileOffer: Cannot decline non-existent or already handled offer ${fileId}`);
			// Намагаємось оновити UI про всяк випадок, якщо елемент залишився
			this.chatView?.updateFileProgress?.(fileId, 'download', 0, 0, 'declined');
			return;
		}

		// 3. Визначення адреси відправника
		let senderInfo: UserInfo | null = null;
		// Намагаємося отримати актуальну інформацію (якщо UserDiscovery працює)
		if (this.userDiscovery) {
			senderInfo = this.userDiscovery.getUserInfo(senderNickname);
		}

		// Якщо не знайдено або UserDiscovery немає, використовуємо збережену адресу
		if (!senderInfo && offer.senderAddress) {
			console.log(`[${this.manifest.name}] declineFileOffer: User ${senderNickname} not found live, using stored address ${offer.senderAddress}`);
			const addrParts = offer.senderAddress.split(':');
			if (addrParts.length === 2) {
				const ip = addrParts[0];
				const port = parseInt(addrParts[1]);
				if (ip && !isNaN(port)) {
					senderInfo = { nickname: senderNickname, ip: ip, port: port }; // Присвоюємо, бо 'let'
				} else {
					console.warn(`[${this.manifest.name}] declineFileOffer: Failed to parse stored address ${offer.senderAddress}`);
					// Не можемо надіслати відповідь, але все одно відхилимо локально
				}
			}
		}

		// 4. Надсилання повідомлення про відмову (якщо адреса відома)
		if (senderInfo) {
			// Всередині цього блоку 'senderInfo' гарантовано не null (логічно)
			const payload = { type: 'fileDecline', receiverNickname: this.settings.userNickname, fileId: fileId };
			try {
				// Використовуємо non-null assertion '!' для підказки TypeScript
				await this.networkManager.sendData(senderInfo!.ip, senderInfo!.port, payload);
				console.log(`[${this.manifest.name}] Decline message for file ${fileId} sent to ${senderNickname}.`);
			} catch (error: any) {
				// Логуємо помилку, але продовжуємо локальне відхилення
				console.warn(`[${this.manifest.name}] Failed to send decline message for ${fileId} to ${senderNickname}: ${error.message}`);
			}
		} else {
			// Не вдалося визначити адресу відправника
			console.warn(`[${this.manifest.name}] Sender ${senderNickname} address unknown, cannot send decline message for ${fileId}. Declining locally.`);
		}

		// 5. Завжди видаляємо пропозицію з локального стану та оновлюємо UI
		this.incomingFileOffers.delete(fileId);
		console.log(`[${this.manifest.name}] Removed incoming offer ${fileId} locally.`);
		// Оновлюємо UI, щоб показати статус "Відхилено"
		this.chatView?.updateFileProgress?.(fileId, 'download', 0, offer.size || 0, 'declined');
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
	 * Ініціює процес надсилання файлу: зберігає інформацію, показує в UI, надсилає пропозицію.
	 * @param file Об'єкт File, отриманий з input[type=file]
	 * @param recipientNickname Нік отримувача (або null для надсилання всім знайденим користувачам)
	 */
	async initiateSendFile(file: File, recipientNickname: string | null): Promise<void> {
		// 1. Перевірка наявності необхідних сервісів
		if (!this.networkManager) {
			new Notice("Мережевий сервіс не активний.");
			console.error(`[${this.manifest.name}] initiateSendFile: NetworkManager is not initialized.`);
			return;
		}
		// Перевіряємо UserDiscovery тільки якщо це приватне повідомлення (recipientNickname не null)
		if (recipientNickname !== null && !this.userDiscovery) {
			new Notice("Сервіс виявлення користувачів не активний.");
			console.warn(`[${this.manifest.name}] initiateSendFile: UserDiscovery is needed to send private file offer to ${recipientNickname}`);
			return;
		}

		// 2. Підготовка інформації про файл
		const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const filename = file.name;
		const size = file.size;

		// 3. Обробка шляху до файлу (ВАЖЛИВА ЗАГЛУШКА!)
		// Отримання реального шляху 'filePath' з об'єкту 'File' є нетривіальним
		// завданням в Electron/Obsidian з міркувань безпеки.
		// Потрібна реальна стратегія: копіювання файлу, використання FileSystemAdapter тощо.
		// Поки що використовуємо ЗАГЛУШКУ. Якщо шлях не отримано, виходимо.
		const filePath = (file as any).path || "НЕВІДОМИЙ_ШЛЯХ_ДО_ФАЙЛУ/" + filename; // ЗАГЛУШКА!
		if (filePath.startsWith("НЕВІДОМИЙ_ШЛЯХ")) {
			new Notice("Помилка: Неможливо отримати шлях до файлу для надсилання.", 5000);
			console.error("initiateSendFile: Failed to determine file path for", filename);
			return; // Не продовжуємо без шляху
		}

		// 4. Збереження інформації про вихідну пропозицію (включаючи розмір)
		this.outgoingFileOffers.set(fileId, {
			fileId,
			filePath: filePath, // Зберігаємо отриманий (потенційно некоректний) шлях
			filename,
			size,              // Зберігаємо розмір
			recipientNickname
		});

		console.log(`[${this.manifest.name}] Ініційовано надсилання файлу: ${filename} (${size} байт), ID: ${fileId}`);

		// 5. Підготовка payload для мережевої пропозиції
		const fileOfferPayload = {
			type: 'fileOffer',
			senderNickname: this.settings.userNickname,
			fileId: fileId,
			filename: filename,
			size: size
		};

		// 6. Оновлення локального UI (показуємо, що почали надсилати)
		// Цей метод має існувати в ChatView.ts
		this.chatView?.displayUploadProgress({ fileId, filename, size, recipientNickname });

		// 7. Надсилання пропозиції мережею
		try {
			if (recipientNickname === null) { // Надіслати всім (Broadcast)
				console.log(`[${this.manifest.name}] Надсилання fileOffer (broadcast) для ${fileId}`);
				// const recipients = this.userDiscovery?.getAllUsers().filter(u => u.nickname !== this.settings.userNickname) || []; // Потребує UserDiscovery
				const recipients: Array<{ nickname: string, ip: string, port: number }> = []; // ЗАГЛУШКА

				if (recipients.length === 0) {
					new Notice("Не знайдено активних користувачів для надсилання файлу.");
					throw new Error("No recipients found for broadcast file offer."); // Генеруємо помилку, щоб спрацював catch
				}

				// Надсилаємо всім, логуємо індивідуальні помилки, але не зупиняємось
				const sendPromises = recipients.map(user =>
					this.networkManager!.sendData(user.ip, user.port, fileOfferPayload)
						.catch(err => console.warn(`[${this.manifest.name}] Помилка надсилання fileOffer (broadcast) до ${user.nickname}: ${err.message}`))
				);
				await Promise.all(sendPromises);
				console.log(`[${this.manifest.name}] Пропозицію файлу ${fileId} надіслано (broadcast). Очікування відповідей...`);

			} else { // Надіслати конкретному користувачу (Private)
				console.log(`[${this.manifest.name}] Надсилання fileOffer (private) для ${fileId} до ${recipientNickname}`);
				// --- ВИПРАВЛЕНА ЧАСТИНА ---
				const userInfo = this.userDiscovery?.getUserInfo(recipientNickname); // Використовуємо реальний виклик

				if (userInfo) { // Перевіряємо, чи користувача знайдено
					// Надсилаємо пропозицію
					await this.networkManager.sendData(userInfo.ip, userInfo.port, fileOfferPayload); // Помилка 'never' тут зникне
					console.log(`[${this.manifest.name}] Пропозицію файлу ${fileId} надіслано до ${recipientNickname}. Очікування відповіді...`);
				} else {
					// Користувача не знайдено сервісом UserDiscovery
					throw new Error(`Користувач ${recipientNickname} не знайдений.`); // Генеруємо помилку, щоб спрацював catch
				}
			}
		} catch (error: any) { // Перехоплюємо помилки (нема отримувачів, користувач не знайдений, помилка sendData)
			console.error(`[${this.manifest.name}] Помилка під час надсилання fileOffer для ${fileId}:`, error);
			new Notice(`Помилка надсилання пропозиції файлу: ${error.message}`);
			this.outgoingFileOffers.delete(fileId); // Очищуємо стан пропозиції при помилці
			// Оновлюємо UI, показуючи помилку
			this.chatView?.updateFileProgress?.(fileId, 'upload', 0, size, 'error');
		}
	}


	/**
		 * Надсилає текстове повідомлення в мережу.
		 * Показує повідомлення локально одразу.
		 * @param recipientNickname - Нік отримувача або null для надсилання всім.
		 * @param message - Текст повідомлення.
		 */
	async sendMessage(recipientNickname: string | null, message: string): Promise<void> {
		const senderNickname = this.settings.userNickname;
		const timestamp = Date.now();

		// 1. Перевірка та підготовка повідомлення
		if (!message?.trim()) {
			console.log(`[${this.manifest.name}] Спроба надіслати порожнє повідомлення.`);
			return;
		}
		const trimmedMessage = message.trim();

		// 2. Негайне відображення та збереження локально
		// Показуємо своє повідомлення в UI
		this.chatView?.displayMessage(senderNickname, trimmedMessage, timestamp, true); // true = isOwn

		// TODO: Реалізувати та викликати збереження в історію
		// if (this.settings.saveHistory) {
		//     this.addMessageToHistory({ /* ... дані повідомлення ... */ });
		// }

		// 3. Перевірка мережевих компонентів та присвоєння локальним змінним
		if (!this.networkManager || !this.userDiscovery) { // Перевірка на null
			console.error(`[${this.manifest.name}] sendMessage: NetworkManager або UserDiscovery не ініціалізовано.`);
			new Notice("Помилка: Мережеві компоненти не готові для надсилання.");
			// TODO: Оновити статус повідомлення в історії на 'failed'
			return;
		}
		// Присвоєння локальним константам після перевірки на null
		// TypeScript тепер знає, що nm та ud не null в цьому скоупі
		const nm = this.networkManager;
		const ud = this.userDiscovery;

		// 4. Підготовка мережевого payload
		const payload = {
			type: 'text',
			senderNickname: senderNickname,
			content: trimmedMessage,
			timestamp: timestamp
		};

		// 5. Надсилання мережею
		try {
			if (recipientNickname === null) {
				// --- Broadcast ---
				console.log(`[${this.manifest.name}] Надсилання повідомлення (broadcast)...`);
				// Явно вказуємо тип UserInfo[] для результату getAllUsers (якщо він такий)
				const allUsers: UserInfo[] = ud.getAllUsers(); // ЗАГЛУШКА: Потрібна реалізація UserDiscovery
				// Явно вказуємо тип user: UserInfo в filter
				const recipients = allUsers.filter((user: UserInfo) => user.nickname !== senderNickname);

				if (recipients.length === 0) {
					console.log(`[${this.manifest.name}] Немає отримувачів для broadcast.`);
					// Повідомлення вже відображено локально, просто виходимо
					return;
				}

				// Використовуємо Promise.allSettled для обробки індивідуальних помилок
				// Явно вказуємо тип user: UserInfo в map
				const sendPromises = recipients.map((user: UserInfo) =>
					nm.sendData(user.ip, user.port, payload)
						.catch(err => {
							// Обгортаємо помилку в об'єкт для кращого звітування
							return Promise.reject({ nickname: user.nickname, address: `${user.ip}:${user.port}`, error: err });
						})
				);

				const results = await Promise.allSettled(sendPromises);

				// Обробка результатів надсилання
				const failedSends = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
				if (failedSends.length > 0) {
					console.warn(`[${this.manifest.name}] Не вдалося надіслати broadcast ${failedSends.length} отримувачам:`);
					failedSends.forEach(failure => {
						const reason = failure.reason as { nickname: string, address: string, error: Error };
						console.warn(`  - До ${reason.nickname} (${reason.address}): ${reason.error.message}`);
						// TODO: Опціонально позначити користувача як офлайн або оновити статус повідомлення для нього
					});
					// new Notice(`Помилка надсилання до ${failedSends.length} отримувачів.`);
				} else {
					console.log(`[${this.manifest.name}] Broadcast повідомлення успішно ініційовано для ${recipients.length} отримувачів.`);
					// TODO: Оновити статус повідомлення в історії на 'sent'/'delivered'?
				}

			} else {
				// --- Приватне повідомлення ---
				console.log(`[${this.manifest.name}] Надсилання приватного повідомлення до ${recipientNickname}...`);
				// Явно вказуємо тип UserInfo | null для результату getUserInfo (якщо він такий)
				const recipientInfo: UserInfo | null = ud.getUserInfo(recipientNickname); // ЗАГЛУШКА: Потрібна реалізація UserDiscovery

				if (recipientInfo) {
					try {
						// Використовуємо recipientInfo.ip / recipientInfo.port
						await nm.sendData(recipientInfo.ip, recipientInfo.port, payload);
						console.log(`[${this.manifest.name}] Приватне повідомлення успішно надіслано до ${recipientNickname}.`);
						// TODO: Оновити статус повідомлення в історії
					} catch (error: any) {
						console.error(`[${this.manifest.name}] Помилка надсилання приватного повідомлення до ${recipientNickname} (${recipientInfo.ip}:${recipientInfo.port}):`, error);
						new Notice(`Помилка надсилання повідомлення до ${recipientNickname}: ${error.message}`);
						// TODO: Оновити статус повідомлення в історії на 'failed'
					}
				} else {
					console.error(`[${this.manifest.name}] Отримувача не знайдено: ${recipientNickname}`);
					new Notice(`Помилка: Користувач ${recipientNickname} не знайдений або офлайн.`);
					// TODO: Оновити статус повідомлення в історії на 'failed'
				}
			}
		} catch (error) { // Перехоплення неочікуваних помилок (наприклад, якщо getAllUsers/getUserInfo небезпечні)
			console.error(`[${this.manifest.name}] Неочікувана помилка в sendMessage:`, error);
			new Notice("Неочікувана помилка надсилання повідомлення.");
			// TODO: Оновити статус повідомлення в історії на 'failed'
		}
	}

	// // --- Метод для прийняття пропозиції файлу ---
	// async acceptFileOffer(senderNickname: string, fileId: string): Promise<void> {
	// 	if (!this.networkManager || !this.userDiscovery) {
	// 		console.error(`[${this.manifest.name}] NetworkManager або UserDiscovery не ініціалізовано.`);
	// 		new Notice("Помилка: Мережеві компоненти не готові.");
	// 		return;
	// 	}

	// 	const senderInfo = this.userDiscovery.getUserInfo(senderNickname);
	// 	if (!senderInfo) {
	// 		console.error(`[${this.manifest.name}] Не знайдено інформацію для відправника ${senderNickname} при прийнятті файлу ${fileId}.`);
	// 		new Notice(`Помилка: Відправник ${senderNickname} не знайдений.`);
	// 		return;
	// 	}

	// 	console.log(`[${this.manifest.name}] Прийняття файлу ${fileId} від ${senderNickname}`);

	// 	const payload = {
	// 		type: 'fileAccept',
	// 		receiverNickname: this.settings.userNickname,
	// 		fileId: fileId
	// 	};

	// 	try {
	// 		// Повідомляємо відправника про згоду
	// 		await this.networkManager.sendData(senderInfo.ip, senderInfo.port, payload);

	// 		// TODO: Підготувати NetworkManager до отримання даних для fileId
	// 		// Наприклад:
	// 		// const fileDetails = this.getPendingFileOfferDetails(fileId); // Отримати ім'я, розмір
	// 		// if (fileDetails) {
	// 		//    const savePath = await this.determineSavePath(fileDetails.filename); // Визначити шлях збереження
	// 		//    await this.networkManager.prepareToReceiveFile(fileId, savePath);
	// 		//    console.log(`[${this.manifest.name}] Готовий отримувати файл ${fileId} в ${savePath}`);
	// 		//    // Можливо, оновити UI в ChatView, показати "Очікування завантаження..."
	// 		//    this.chatView?.updateFileOfferStatus(fileId, 'accepted');
	// 		// } else {
	// 		//    console.error(`[${this.manifest.name}] Не знайдено деталей пропозиції для файлу ${fileId}`);
	// 		//    throw new Error("File offer details not found"); // Генеруємо помилку, щоб відправити відмову або сповістити користувача
	// 		// }
	// 		console.log(`[${this.manifest.name}] Підтвердження прийняття файлу ${fileId} надіслано до ${senderNickname}`);

	// 	} catch (error) {
	// 		console.error(`[${this.manifest.name}] Помилка надсилання підтвердження прийняття файлу ${fileId} до ${senderNickname}:`, error);
	// 		new Notice(`Помилка прийняття файлу від ${senderNickname}.`);
	// 		// TODO: Можливо, потрібно відправити 'fileDecline' або очистити стан?
	// 	}
	// 	// }


	// 	// --- Метод для відхилення пропозиції файлу ---
	// 	async declineFileOffer(senderNickname: string, fileId: string): Promise<void> {
	// 		if (!this.networkManager || !this.userDiscovery) {
	// 			console.error(`[${this.manifest.name}] NetworkManager або UserDiscovery не ініціалізовано.`);
	// 			// Не показуємо Notice користувачу, бо він сам натиснув "Відхилити"
	// 			return;
	// 		}

	// 		const senderInfo = this.userDiscovery.getUserInfo(senderNickname);
	// 		if (!senderInfo) {
	// 			console.warn(`[${this.manifest.name}] Не знайдено інформацію для відправника ${senderNickname} при відхиленні файлу ${fileId}. Можливо, він вже офлайн.`);
	// 			// Не потрібно нічого надсилати, якщо відправник невідомий
	// 			// TODO: Очистити локальний стан пропозиції файлу, якщо він є
	// 			// this.removePendingFileOffer(fileId);
	// 			return;
	// 		}

	// 		console.log(`[${this.manifest.name}] Відхилення файлу ${fileId} від ${senderNickname}`);

	// 		const payload = {
	// 			type: 'fileDecline',
	// 			receiverNickname: this.settings.userNickname,
	// 			fileId: fileId
	// 		};

	// 		try {
	// 			// Повідомляємо відправника про відмову
	// 			await this.networkManager.sendData(senderInfo.ip, senderInfo.port, payload);
	// 			console.log(`[${this.manifest.name}] Відмова від файлу ${fileId} надіслана до ${senderNickname}`);

	// 			// TODO: Очистити локальний стан пропозиції файлу
	// 			// this.removePendingFileOffer(fileId);
	// 			// Можливо, оновити UI в ChatView
	// 			// this.chatView?.updateFileOfferStatus(fileId, 'declined');

	// 		} catch (error) {
	// 			console.error(`[${this.manifest.name}] Помилка надсилання відмови від файлу ${fileId} до ${senderNickname}:`, error);
	// 			// Не турбуємо користувача повідомленням, бо він вже відхилив
	// 		}
	// 	}
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






}