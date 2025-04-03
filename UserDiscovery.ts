import { Bonjour, Service, Browser } from 'bonjour-service';
import { UserInfo } from './main'; // Припускаємо, що інтерфейс UserInfo визначено в main.ts
import * as net from 'net'; // Потрібно для _selectIpAddress

// --- Інтерфейси ---

/** Конфігурація для UserDiscovery */
export interface UserDiscoveryConfig {
    nickname: string; // Псевдонім цього користувача для публікації
    port: number;     // Порт, на якому слухає NetworkManager цього користувача
    serviceType?: string; // Тип сервісу mDNS (за замовчуванням 'obsidian-local-chat')
}

/** Callback-функції для сповіщення main.ts про події виявлення */
export interface UserDiscoveryCallbacks {
    /** Викликається, коли знайдено нового користувача (який не є нами) */
    onUserFound: (userInfo: UserInfo) => void;
    /** Викликається, коли користувач зникає з мережі */
    onUserLeft: (userInfo: { nickname: string }) => void; // Передаємо лише нік для ідентифікації
    /** Викликається при помилках в процесі виявлення */
    onDiscoveryError: (context: string, error: Error) => void;
}

const DEFAULT_SERVICE_TYPE = 'obsidian-local-chat'; // Унікальний ідентифікатор нашого сервісу

export class UserDiscovery {
    private config: UserDiscoveryConfig;
    private callbacks: UserDiscoveryCallbacks;
    private bonjour: Bonjour | null = null;
    private publishedService: Service | null = null;
    private browser: Browser | null = null;

    // Зберігаємо локально знайдених користувачів (ключ - nickname)
    private discoveredUsers: Map<string, UserInfo> = new Map();

    // Зберігаємо власну інформацію для фільтрації
    private ownServiceKey: string;

    constructor(config: UserDiscoveryConfig, callbacks: UserDiscoveryCallbacks) {
        if (!config || !config.nickname || !config.port) {
            throw new Error("UserDiscovery: Missing required config (nickname, port).");
        }
        if (!callbacks || typeof callbacks.onUserFound !== 'function' || typeof callbacks.onUserLeft !== 'function' || typeof callbacks.onDiscoveryError !== 'function') {
            throw new Error("UserDiscovery: Missing required callbacks (onUserFound, onUserLeft, onDiscoveryError).");
        }

        this.config = {
            ...config,
            serviceType: config.serviceType || DEFAULT_SERVICE_TYPE,
        };
        this.callbacks = callbacks;

        // Генеруємо ключ для власного сервісу для легкого порівняння
        // Примітка: Використання лише nickname/port може бути недостатньо унікальним в деяких мережах,
        // можливо, варто додати унікальний ID в TXT запис сервісу.
        this.ownServiceKey = `${this.config.nickname}:${this.config.port}`;

        console.log(`[UserDiscovery] Ініціалізовано для '${this.config.nickname}' на порті ${this.config.port}, тип сервісу '${this.config.serviceType}'`);
    }

    /**
     * Запускає процес публікації власного сервісу та пошуку інших.
     */
    public async start(): Promise<void> {
        if (this.bonjour) {
            console.warn("[UserDiscovery] Discovery is already running.");
            return;
        }

        console.log("[UserDiscovery] Starting mDNS discovery...");
        try {
            this.bonjour = new Bonjour();
            this.discoveredUsers.clear(); // Очищуємо список при старті

            // 1. Публікація власного сервісу
            this.publishService();

            // 2. Пошук інших сервісів
            this.startBrowse();

            console.log("[UserDiscovery] Publishing and Browse started.");

        } catch (error: any) {
            console.error("[UserDiscovery] Failed to initialize Bonjour:", error);
            this.callbacks.onDiscoveryError("Bonjour Initialization", error);
            await this.stop(); // Зупиняємо все, якщо ініціалізація не вдалася
            throw error; // Повторно кидаємо помилку
        }
    }

    // У файлі UserDiscovery.ts всередині класу UserDiscovery

    /**
     * Зупиняє публікацію та пошук, очищує ресурси.
     */
    public async stop(): Promise<void> {
        if (!this.bonjour) {
            // Вже зупинено або не було запущено
            return;
        }

        console.log("[UserDiscovery] Stopping mDNS discovery...");
        const bonjourInstance = this.bonjour; // Зберігаємо посилання перед тим, як зробити null
        this.bonjour = null; // Позначаємо, що процес зупинки почався

        // 1. Зупиняємо пошук (браузер)
        if (this.browser) {
            try {
                this.browser.stop();
                console.log("[UserDiscovery] Browser stopped.");
            } catch (err: any) {
                console.warn("[UserDiscovery] Error stopping browser:", err.message);
                // Ігноруємо помилку зупинки браузера, продовжуємо очищення
            } finally {
                this.browser = null;
            }
        }

        // 2. Знімаємо ВСІ публікації та знищуємо екземпляр Bonjour
        // Використовуємо unpublishAll та destroy для надійного очищення.
        try {
            await new Promise<void>((resolve, reject) => {
                console.log("[UserDiscovery] Calling unpublishAll...");
                // unpublishAll викликає callback після завершення
                bonjourInstance.unpublishAll((err: Error | undefined) => { // Тепер тип err відомий
                    if (err) {
                        // Тепер можна безпечно звертатись до err.message тощо
                        console.warn("[UserDiscovery] Error during unpublishAll:", err.message);
                    } else {
                        console.log("[UserDiscovery] UnpublishAll completed.");
                    }
                    resolve();
                });
                // Додамо таймаут про всяк випадок, якщо callback не викликається
                setTimeout(() => {
                    console.warn("[UserDiscovery] UnpublishAll timeout reached, proceeding with destroy.");
                    resolve();
                }, 2000); // Таймаут 2 секунди
            });

            // Після спроби зняття публікацій, знищуємо екземпляр
            console.log("[UserDiscovery] Calling destroy...");
            bonjourInstance.destroy(); // Використовуємо збережене посилання
            console.log("[UserDiscovery] Bonjour instance destroyed.");

        } catch (err: any) {
            // Ловимо помилки від самого destroy або якщо Promise був відхилений (малоймовірно з callback)
            console.error("[UserDiscovery] Error during Bonjour cleanup (destroy):", err);
            this.callbacks.onDiscoveryError("Bonjour Cleanup", err);
        } finally {
            // Переконуємось, що всі посилання очищено
            this.publishedService = null;
            this.browser = null;
            if (this.bonjour === bonjourInstance) { // Якщо ніхто інший не присвоїв null раніше
                this.bonjour = null;
            }
        }

        this.discoveredUsers.clear(); // Очищуємо список знайдених користувачів
        console.log("[UserDiscovery] Discovery stopped and resources released.");
    }

    // ... (решта коду класу UserDiscovery) ...
    /**
     * Отримує інформацію про конкретного користувача за його ніком.
     */
    public getUserInfo(nickname: string): UserInfo | null {
        return this.discoveredUsers.get(nickname) || null;
    }

    /**
     * Повертає масив всіх знайдених на даний момент користувачів.
     */
    public getAllUsers(): UserInfo[] {
        return Array.from(this.discoveredUsers.values());
    }


    // --- Приватні методи ---

    /** Налаштовує та запускає публікацію сервісу */
    private publishService(): void {
        if (!this.bonjour) return;

        try {
            this.publishedService = this.bonjour.publish({
                name: this.config.nickname, // Ім'я сервісу = нікнейм
                type: this.config.serviceType!, // Тип сервісу
                port: this.config.port,       // Порт нашого TCP сервера
                // Можна додати TXT записи для дод. інформації
                // txt: { version: '1.0', id: 'unique-instance-id' }
            });
            console.log(`[UserDiscovery] Service '${this.config.nickname}' published on port ${this.config.port}.`);

            this.publishedService.on('error', (error: Error) => {
                console.error(`[UserDiscovery] Error publishing service '${this.config.nickname}':`, error);
                this.callbacks.onDiscoveryError("Service Publish", error);
                // Спробувати перезапустити публікацію? Або зупинити все?
                this.publishedService = null; // Прибираємо посилання на проблемний сервіс
            });

        } catch (error: any) {
            console.error(`[UserDiscovery] Exception during bonjour.publish:`, error);
            this.callbacks.onDiscoveryError("Service Publish Init", error);
        }
    }

    /** Налаштовує та запускає пошук сервісів */
    private startBrowse(): void {
        if (!this.bonjour) return;

        try {
            this.browser = this.bonjour.find({ type: this.config.serviceType! });

            this.browser.on('up', (service: Service) => {
                this._handleServiceUp(service);
            });

            this.browser.on('down', (service: Service) => {
                this._handleServiceDown(service);
            });

            // 'error' подія для браузера менш поширена, але може бути
            this.browser.on('error', (error: Error) => {
                console.error(`[UserDiscovery] Browser error:`, error);
                this.callbacks.onDiscoveryError("Service Browse", error);
            });

            console.log(`[UserDiscovery] Started Browse for '${this.config.serviceType}' services.`);
            // Можна викликати browser.update() для негайного пошуку, але зазвичай не потрібно
            // this.browser.update();

        } catch (error: any) {
            console.error(`[UserDiscovery] Exception during bonjour.find:`, error);
            this.callbacks.onDiscoveryError("Service Browse Init", error);
        }
    }

    /** Обробляє подію знаходження нового сервісу ('up') */
    private _handleServiceUp(service: Service): void {
        const serviceKey = `${service.name}:${service.port}`;
        // console.log(`[UserDiscovery] Service UP detected: ${service.name} (${service.host}:${service.port}), Key: ${serviceKey}, OwnKey: ${this.ownServiceKey}`);

        // 1. Ігноруємо себе
        if (service.name === this.config.nickname && service.port === this.config.port) {
            // console.log(`[UserDiscovery] Ignored self-discovery for ${service.name}`);
            return;
        }

        // 2. Ігноруємо, якщо вже знаємо про цей сервіс (за ніком)
        if (this.discoveredUsers.has(service.name)) {
            // console.log(`[UserDiscovery] Service ${service.name} already known.`);
            // Можливо, варто оновити IP/порт, якщо вони змінились?
            const existingUser = this.discoveredUsers.get(service.name)!;
            const newIp = this._selectIpAddress(service.addresses);
            if (newIp && (existingUser.ip !== newIp || existingUser.port !== service.port)) {
                console.log(`[UserDiscovery] Updating user info for ${service.name}: IP ${existingUser.ip}=>${newIp}, Port ${existingUser.port}=>${service.port}`);
                const updatedUserInfo: UserInfo = {
                    nickname: service.name,
                    ip: newIp,
                    port: service.port
                };
                this.discoveredUsers.set(service.name, updatedUserInfo);
                this.callbacks.onUserFound(updatedUserInfo); // Повідомляємо про оновлення (хоча callback називається onUserFound)
            }
            return;
        }

        // 3. Отримуємо IP адресу (надаємо перевагу IPv4)
        const ipAddress = this._selectIpAddress(service.addresses);
        if (!ipAddress) {
            console.warn(`[UserDiscovery] Could not find suitable IP address for service ${service.name} in addresses:`, service.addresses);
            return; // Не можемо додати користувача без IP
        }

        // 4. Створюємо об'єкт UserInfo та додаємо до списку
        const newUserInfo: UserInfo = {
            nickname: service.name,
            ip: ipAddress,
            port: service.port
        };
        this.discoveredUsers.set(newUserInfo.nickname, newUserInfo);
        console.log(`[UserDiscovery] >>> User Found: ${newUserInfo.nickname} (${newUserInfo.ip}:${newUserInfo.port})`);

        // 5. Повідомляємо main.ts
        this.callbacks.onUserFound(newUserInfo);
    }

    /** Обробляє подію зникнення сервісу ('down') */
    private _handleServiceDown(service: Service): void {
        // console.log(`[UserDiscovery] Service DOWN detected: ${service.name}:${service.port}`);

        // 1. Ігноруємо себе (хоча 'down' для себе не мав би приходити)
        if (service.name === this.config.nickname && service.port === this.config.port) {
            // console.log(`[UserDiscovery] Ignored self-down event for ${service.name}`);
            return;
        }

        // 2. Перевіряємо, чи ми знали про цей сервіс (за ніком)
        if (this.discoveredUsers.has(service.name)) {
            const removedUserInfo = this.discoveredUsers.get(service.name)!;
            this.discoveredUsers.delete(service.name);
            console.log(`[UserDiscovery] <<< User Left: ${removedUserInfo.nickname} (was ${removedUserInfo.ip}:${removedUserInfo.port})`);

            // 3. Повідомляємо main.ts
            this.callbacks.onUserLeft({ nickname: removedUserInfo.nickname });
        } else {
            // console.log(`[UserDiscovery] Ignored down event for unknown service ${service.name}`);
        }
    }

    /** Обирає найбільш підходящу IP адресу зі списку (надає перевагу IPv4) */
    private _selectIpAddress(addresses: string[] | undefined): string | null {
        if (!addresses || addresses.length === 0) {
            return null;
        }
        // Шукаємо першу IPv4 адресу, яка не є loopback
        let firstIPv4: string | null = null;
        for (const addr of addresses) {
            try {
                // net.isIP вертає 4 для IPv4, 6 для IPv6, 0 якщо не IP
                const version = net.isIP(addr);
                if (version === 4 && !this._isLoopback(addr)) {
                    return addr; // Знайшли підходящу IPv4
                }
                if (version === 4 && !firstIPv4) {
                    firstIPv4 = addr; // Запам'ятовуємо першу IPv4 (може бути loopback)
                }
            } catch (e) {
                // net.isIP може кидати помилки на невалідних рядках
                console.warn(`[UserDiscovery] Error checking IP version for address '${addr}':`, e);
            }
        }

        // Якщо не знайшли не-loopback IPv4, повертаємо першу знайдену IPv4 (навіть якщо loopback)
        if (firstIPv4) {
            return firstIPv4;
        }

        // Якщо не знайшли IPv4 взагалі, повертаємо першу адресу зі списку (може бути IPv6)
        // яка не є loopback IPv6
        for (const addr of addresses) {
            if (!this._isLoopback(addr)) {
                return addr;
            }
        }

        // Якщо всі адреси loopback або список порожній після фільтрації
        return addresses[0] || null; // Повертаємо першу адресу як останній варіант
    }

    /** Перевіряє, чи є адреса локальною (loopback) */
    private _isLoopback(addr: string): boolean {
        try {
            if (net.isIPv4(addr)) {
                return addr.startsWith('127.');
            }
            if (net.isIPv6(addr)) {
                return addr === '::1' || addr.toLowerCase() === '::ffff:127.0.0.1'; // Порівнюємо і ::1, і IPv4-mapped loopback
            }
        } catch (e) { }
        return false; // Якщо не IP або помилка
    }

} // Кінець класу UserDiscovery