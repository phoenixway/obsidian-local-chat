// WebSocketServerManager.ts
import { WebSocketServer, WebSocket } from 'ws'; // Requires: npm install ws @types/ws
import { UserInfo, WebSocketMessage, BaseMessage, IdentifyMessage } from './types'; // Import shared types

// Інтерфейс для Callbacks, які викликаються в main.ts
export interface WebSocketServerCallbacks {
    onClientConnected: (clientId: string, clientNickname: string) => void;
    onClientDisconnected: (clientId: string, clientNickname: string) => void;
    /** Called when server receives a structured message from a client */
    onMessage: (clientId: string, clientNickname: string, message: WebSocketMessage) => void;
    /** Called for internal server errors */
    onError: (error: Error) => void;
    /** TODO: Callback for receiving binary data (file chunks) */
    // onBinaryMessage: (clientId: string, clientNickname: string, data: Buffer) => void;
}

// Інформація про підключеного клієнта
interface ClientInfo {
    id: string;
    nickname: string;
    ws: WebSocket;
}

export class WebSocketServerManager {
    private port: number;
    private callbacks: WebSocketServerCallbacks;
    private wss: WebSocketServer | null = null;
    // Використовуємо Map для зберігання клієнтів: ws -> ClientInfo
    private clients: Map<WebSocket, ClientInfo> = new Map();
    // Додаткова мапа для швидкого пошуку за ніком: nickname -> ws
    private clientsByNickname: Map<string, WebSocket> = new Map();
    private WSServerConstructor: typeof WebSocketServer; // Конструктор передається з main.ts
    private serverNickname: string;


    constructor(
        port: number,
        serverNickname: string, // Додано параметр
        callbacks: WebSocketServerCallbacks,
        WSServerConstructor: typeof WebSocketServer
    ) {
        this.port = port;
        this.serverNickname = serverNickname; // Зберігаємо нікнейм
        this.callbacks = callbacks;
        this.WSServerConstructor = WSServerConstructor;
        console.log(`[WSServer] Initialized for server nickname: ${this.serverNickname}`);
    }

    /** Запускає WebSocket сервер */
    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.wss) {
                console.warn("[WSServer] Server already started.");
                resolve();
                return;
            }
            try {
                console.log(`[WSServer] Starting server on port ${this.port}...`);
                this.wss = new this.WSServerConstructor({ port: this.port });

                this.wss.on('listening', () => {
                    console.log(`[WSServer] Successfully listening on port ${this.port}.`);
                    resolve();
                });

                this.wss.on('error', (error: Error) => {
                    console.error("[WSServer] Server error:", error);
                    this.callbacks.onError(error);
                    this.wss = null; // Reset server instance on critical error
                    reject(error); // Reject the promise on startup error
                });

                this.wss.on('connection', (ws: WebSocket) => {
                    this._handleConnection(ws);
                });

            } catch (error: any) {
                console.error("[WSServer] Failed to create WebSocketServer:", error);
                this.callbacks.onError(error);
                reject(error);
            }
        });
    }

    /** Зупиняє WebSocket сервер */
    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.wss) {
                resolve();
                return;
            }
            console.log("[WSServer] Stopping server...");
            // Закриваємо всі клієнтські з'єднання
            this.clients.forEach((clientInfo) => {
                clientInfo.ws.terminate(); // Примусове закриття
            });
            this.clients.clear();
            this.clientsByNickname.clear();

            this.wss.close((err) => {
                if (err) {
                    console.error("[WSServer] Error closing server:", err);
                    this.callbacks.onError(err);
                } else {
                    console.log("[WSServer] Server closed successfully.");
                }
                this.wss = null;
                resolve();
            });
        });
    }

    /** Обробляє нове підключення клієнта */
    private _handleConnection(ws: WebSocket): void {
        const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        console.log(`[WSServer] Client connected with temporary ID: ${clientId}. Waiting for identification.`);

        // Створюємо початковий запис без нікнейму
        const clientInfo: ClientInfo = { id: clientId, nickname: '', ws: ws };
        this.clients.set(ws, clientInfo);

        // Встановлюємо обробники для цього клієнта
        ws.on('message', (messageBuffer: Buffer) => {
            this._handleMessage(ws, messageBuffer);
        });

        ws.on('close', (code: number, reason: Buffer) => {
            console.log(`[WSServer] Client connection closed. Code: ${code}, Reason: ${reason.toString()}`);
            this._handleCloseOrError(ws);
        });

        ws.on('error', (error: Error) => {
            console.error(`[WSServer] WebSocket error for client ${clientInfo.nickname || clientInfo.id}:`, error);
            this._handleCloseOrError(ws, error);
        });

        // TODO: Додати таймаут для ідентифікації? Якщо клієнт не надішле нікнейм протягом X секунд - відключити.
    }

    /** Обробляє отримане повідомлення від клієнта */
    private _handleMessage(ws: WebSocket, messageBuffer: Buffer): void {
        const clientInfo = this.clients.get(ws);
        if (!clientInfo) {
            console.warn("[WSServer] Message from unknown client socket.");
            return;
        }

        let message: WebSocketMessage;
        try {
            message = JSON.parse(messageBuffer.toString('utf-8')) as WebSocketMessage;
        } catch (e) {
            console.warn(`[WSServer] Received non-JSON message from ${clientInfo.nickname || clientInfo.id}:`, messageBuffer);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format (not JSON).' }));
            return;
        }

        // Обробка ідентифікації для ще не ідентифікованих клієнтів
        if (!clientInfo.nickname) {
            if (message.type === 'identify') {
                // Використовуємо приведення типу (type assertion) 'as',
                // оскільки ми перевірили type === 'identify'.
                // Або можна було б зробити додаткову перевірку 'nickname' in message.
                const identifyMsg = message as IdentifyMessage;

                if (identifyMsg.nickname && typeof identifyMsg.nickname === 'string') {
                    const requestedNickname = identifyMsg.nickname.trim();
                    if (!requestedNickname) {
                        console.warn(`[WSServer] Received 'identify' with empty nickname from ${clientInfo.id}. Disconnecting.`);
                        ws.send(JSON.stringify({ type: 'error', message: 'Nickname cannot be empty.' }));
                        ws.terminate();
                        this.clients.delete(ws); // Видаляємо тимчасовий запис
                        return;
                    }

                    // Перевірка на унікальність нікнейму
                    if (this.clientsByNickname.has(requestedNickname)) {
                        console.warn(`[WSServer] Nickname '${requestedNickname}' already taken. Disconnecting client ${clientInfo.id}.`);
                        ws.send(JSON.stringify({ type: 'error', message: 'Nickname already taken.' }));
                        ws.terminate();
                        this.clients.delete(ws); // Видаляємо тимчасовий запис
                        return;
                    }

                    // Успішна ідентифікація
                    clientInfo.nickname = requestedNickname;
                    this.clientsByNickname.set(clientInfo.nickname, ws);
                    console.log(`[WSServer] Client identified: ID=${clientInfo.id}, Nickname='${clientInfo.nickname}'`);
                    // Повідомляємо main.ts (і розсилаємо іншим)
                    this.callbacks.onClientConnected(clientInfo.id, clientInfo.nickname);

                } else {
                    console.warn(`[WSServer] Received invalid 'identify' message (missing/invalid nickname) from ${clientInfo.id}. Disconnecting.`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid identification payload (missing nickname).' }));
                    ws.terminate();
                    this.clients.delete(ws);
                }
            } else {
                // Перше повідомлення не є 'identify'
                console.warn(`[WSServer] Received invalid first message type '${message.type}' from ${clientInfo.id}. Disconnecting.`);
                ws.send(JSON.stringify({ type: 'error', message: 'Identification required as first message.' }));
                ws.terminate();
                this.clients.delete(ws);
            }
            // Завершуємо обробку для неідентифікованого клієнта тут
            return;
        }

        // --- Обробка повідомлень від вже ідентифікованих клієнтів ---
        // Додаємо senderNickname, якщо його немає (краще, щоб клієнт додавав)
        if (!message.senderNickname) message.senderNickname = clientInfo.nickname;
        // Викликаємо загальний обробник в main.ts
        this.callbacks.onMessage(clientInfo.id, clientInfo.nickname, message);
    }


    /** Обробляє закриття з'єднання або помилку сокету клієнта */
    private _handleCloseOrError(ws: WebSocket, error?: Error): void {
        const clientInfo = this.clients.get(ws);
        if (!clientInfo) return; // Вже оброблено або невідомий

        this.clients.delete(ws);
        if (clientInfo.nickname) {
            this.clientsByNickname.delete(clientInfo.nickname);
            console.log(`[WSServer] Client '${clientInfo.nickname}' (ID: ${clientInfo.id}) disconnected.`);
            this.callbacks.onClientDisconnected(clientInfo.id, clientInfo.nickname);
        } else {
            console.log(`[WSServer] Unidentified client (ID: ${clientInfo.id}) disconnected.`);
            // Не викликаємо onClientDisconnected, бо він так і не підключився повністю
        }
    }

    /**
     * Надсилає повідомлення всім підключеним клієнтам, крім одного (за ID).
     * Якщо senderClientId = null, надсилає всім без винятку.
     */
    public broadcast(senderClientId: string | null, payload: WebSocketMessage): void {
        const messageString = JSON.stringify(payload);
        this.clients.forEach((clientInfo) => {
            if (clientInfo.ws.readyState === WebSocket.OPEN && clientInfo.id !== senderClientId) {
                try {
                    clientInfo.ws.send(messageString);
                } catch (err: any) {
                    console.error(`[WSServer] Failed to broadcast to ${clientInfo.nickname || clientInfo.id}:`, err);
                    // Можливо, видалити цього клієнта, якщо відправка не вдається?
                    // this._handleCloseOrError(clientInfo.ws, err);
                }
            }
        });
    }

    /** Надсилає повідомлення конкретному клієнту за його WebSocket ID */
    public sendToClient(clientId: string, payload: WebSocketMessage): boolean {
        let targetWs: WebSocket | null = null;
        // Шукаємо клієнта за ID
        for (const [ws, info] of this.clients.entries()) {
            if (info.id === clientId) {
                targetWs = ws;
                break;
            }
        }

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            try {
                targetWs.send(JSON.stringify(payload));
                return true;
            } catch (err: any) {
                console.error(`[WSServer] Failed to send message to client ID ${clientId}:`, err);
                this._handleCloseOrError(targetWs, err); // Вважаємо, що з'єднання проблемне
                return false;
            }
        }
        return false; // Клієнт не знайдений або не підключений
    }

    /** Надсилає повідомлення конкретному клієнту за його нікнеймом */
    public sendToClientByNickname(nickname: string, payload: WebSocketMessage): boolean {
        const targetWs = this.clientsByNickname.get(nickname);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            try {
                targetWs.send(JSON.stringify(payload));
                return true;
            } catch (err: any) {
                console.error(`[WSServer] Failed to send message to client '${nickname}':`, err);
                this._handleCloseOrError(targetWs, err);
                return false;
            }
        }
        console.warn(`[WSServer] Client with nickname '${nickname}' not found for sending message.`);
        return false;
    }

    /** Знаходить WebSocket ID клієнта за нікнеймом */
    public findClientIdByNickname(nickname: string): string | null {
        const targetWs = this.clientsByNickname.get(nickname);
        if (targetWs) {
            return this.clients.get(targetWs)?.id || null;
        }
        return null;
    }


    /**
     * Обробляє повідомлення, створене локально на серверному екземплярі.
     * Показує його локально та розсилає іншим (broadcast або private).
     */
    // --- ОНОВЛЕНИЙ МЕТОД handleLocalMessage ---
    /**
     * Обробляє повідомлення, створене локально на серверному екземплярі.
     * Показує його локально та розсилає іншим (broadcast або private).
     * @param payload Повідомлення (має містити senderNickname = нікнейм сервера)
     * @param recipientNickname Цільовий нікнейм, або null для broadcast.
     */
    public handleLocalMessage(payload: WebSocketMessage, recipientNickname: string | null): void {
        // Переконуємось, що відправник в payload - це сам сервер
        if (payload.senderNickname !== this.serverNickname) {
            console.warn(`[WSServer] handleLocalMessage: Payload sender '${payload.senderNickname}' differs from server nickname '${this.serverNickname}'. Correcting.`);
            payload.senderNickname = this.serverNickname;
        }

        console.log(`[WSServer] Handling local message (Type: ${payload.type}, To: ${recipientNickname ?? 'broadcast'})`);

        // 1. Відобразити локально (через callback до main.ts)
        // Використовуємо 'local_server' як фіктивний clientId для локальних повідомлень сервера
        this.callbacks.onMessage('local_server', this.serverNickname, payload);

        // 2. Розіслати іншим клієнтам
        if (recipientNickname === null) {
            // --- Broadcast ---
            console.log(`[WSServer] Broadcasting local message type ${payload.type}`);
            // senderClientId=null означає надіслати всім без винятку (бо відправник - сам сервер)
            this.broadcast(null, payload);
        } else {
            // --- Private ---
            // Перевіряємо, чи отримувач - це сам сервер
            if (recipientNickname === this.serverNickname) {
                // Повідомлення адресоване самому собі. Воно вже відображене локально вище.
                console.log(`[WSServer] Local message addressed to self (${recipientNickname}), already handled.`);
            } else {
                // Надсилаємо конкретному клієнту
                console.log(`[WSServer] Sending local message privately to ${recipientNickname}`);
                if (!this.sendToClientByNickname(recipientNickname, payload)) {
                    console.warn(`[WSServer] Failed to send local private message: Recipient '${recipientNickname}' not found or disconnected.`);
                    // TODO: Можливо, показати помилку в UI сервера? new Notice(...) тут не спрацює.
                    // Потрібно передати помилку назад в main.ts через callback?
                    // this.callbacks.onError(new Error(`Recipient ${recipientNickname} not found for local message`));
                }
            }
        }
    }

    // TODO: Implement methods for handling file chunk relay if needed
    // public relayFileChunk(senderClientId: string, recipientNickname: string, fileId: string, chunk: Buffer) { ... }

}