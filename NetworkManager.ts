import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream'; // Only if using stream pipelining explicitly without pipe()

// --- Інтерфейси ---

// Інформація про передачу файлу, що приймається
interface ReceivingFile {
    fileId: string;
    filePath: string;
    writeStream: fs.WriteStream;
    receivedBytes: number;
    expectedSize: number;
    senderInfo: string; // e.g., "nickname (ip:port)" for logging
    socket?: net.Socket; // Посилання на сокет, через який йде передача
}

// Інформація про передачу файлу, що надсилається
interface SendingFile {
    fileId: string;
    filePath: string;
    readStream?: fs.ReadStream; // Створюється при старті передачі
    socket: net.Socket;
    receiverInfo: string;
    sentBytes: number;
    totalSize: number;
}

// Конфігурація та обробники подій, що передаються з main.ts
export interface NetworkManagerCallbacks {
    onMessageReceived: (sender: { ip: string, port: number }, message: any) => void; // Універсальний обробник JSON
    onFileOfferReceived: (sender: { ip: string, port: number }, fileInfo: { fileId: string, filename: string, size: number }) => void;
    onFileAcceptReceived: (sender: { ip: string, port: number }, fileId: string) => void;
    onFileDeclineReceived: (sender: { ip: string, port: number }, fileId: string) => void;
    onFileTransferStart: (fileId: string, direction: 'upload' | 'download', totalSize: number) => void;
    onFileTransferProgress: (fileId: string, direction: 'upload' | 'download', transferredBytes: number, totalSize: number) => void;
    onFileTransferComplete: (fileId: string, direction: 'upload' | 'download', filePath: string | null) => void; // filePath null on upload success
    onFileTransferError: (fileId: string, direction: 'upload' | 'download', error: Error) => void;
    onClientConnected: (clientInfo: { ip: string, port: number }) => void; // Необов'язково, для логування
    onClientDisconnected: (clientInfo: { ip: string, port: number }) => void; // Необов'язково
    onNetworkError: (context: string, error: Error) => void; // Загальна помилка
}

export class NetworkManager {
    private port: number;
    private callbacks: NetworkManagerCallbacks;
    private server: net.Server | null = null;
    private activeServerSockets: Map<string, net.Socket> = new Map(); // Сокети, що підключені до нашого *сервера*
    private receivingFiles: Map<string, ReceivingFile> = new Map(); // Активні завантаження (ключ - fileId)
    private sendingFiles: Map<string, SendingFile> = new Map(); // Активні відправки (ключ - fileId)

    // Буфер для неповних даних від сокетів сервера
    private socketBuffers: Map<string, string> = new Map();


    constructor(port: number, callbacks: NetworkManagerCallbacks) {
        this.port = port;
        this.callbacks = callbacks;

        if (!callbacks) {
            throw new Error("NetworkManager callbacks are required.");
        }
        // Перевірка наявності всіх необхідних обробників (опціонально, але корисно)
        const requiredCallbacks: Array<keyof NetworkManagerCallbacks> = [
            'onMessageReceived', 'onFileOfferReceived', 'onFileAcceptReceived',
            'onFileDeclineReceived', 'onFileTransferStart', 'onFileTransferProgress',
            'onFileTransferComplete', 'onFileTransferError', 'onNetworkError'
        ];
        for (const cbName of requiredCallbacks) {
            if (typeof callbacks[cbName] !== 'function') {
                console.warn(`NetworkManager: Callback '${cbName}' is missing or not a function.`);
                // Встановлюємо заглушку, щоб уникнути помилок під час виклику
                (callbacks as any)[cbName] = (...args: any[]) => {
                    console.warn(`NetworkManager: Called missing callback '${cbName}' with args:`, args);
                };
            }
        }

    }

    // --- Керування Сервером ---

    public startServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.server) {
                console.warn("NetworkManager: Server is already running.");
                resolve();
                return;
            }

            this.server = net.createServer();

            this.server.on('connection', (socket: net.Socket) => {
                this._handleConnection(socket);
            });

            this.server.on('error', (error: Error) => {
                console.error("NetworkManager: Server error:", error);
                this.callbacks.onNetworkError("Server listen", error);
                this.server = null; // Скидаємо сервер
                reject(error);
            });

            this.server.on('close', () => {
                console.log("NetworkManager: Server closed.");
                this.server = null;
                this.activeServerSockets.clear(); // Очищаємо список активних сокетів
                this.socketBuffers.clear();
            });

            this.server.listen(this.port, () => {
                const address = this.server?.address();
                const listeningPort = typeof address === 'string' ? this.port : address?.port ?? this.port;
                console.log(`NetworkManager: Server listening on port ${listeningPort}`);
                resolve();
            });
        });
    }

    public stopServer(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }

            console.log("NetworkManager: Stopping server...");

            // Закриваємо всі активні сокети, підключені до сервера
            this.activeServerSockets.forEach((socket, key) => {
                if (!socket.destroyed) {
                    socket.destroy(); // Примусово закриваємо
                }
            });
            this.activeServerSockets.clear();
            this.socketBuffers.clear();

            // Зупиняємо активні передачі файлів
            this.receivingFiles.forEach(rf => this._cleanupReceivingFile(rf.fileId, new Error("Server stopped")));
            this.sendingFiles.forEach(sf => this._cleanupSendingFile(sf.fileId, new Error("Server stopped")));

            this.server.close((err) => {
                if (err) {
                    console.error("NetworkManager: Error closing server:", err);
                    this.callbacks.onNetworkError("Server close", err);
                }
                this.server = null;
                console.log("NetworkManager: Server stopped successfully.");
                resolve();
            });
        });
    }

    // --- Обробка Вхідних З'єднань ---

    private _handleConnection(socket: net.Socket): void {
        const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
        const socketKey = remoteAddress; // Використовуємо адресу як ключ
        console.log(`NetworkManager: Client connected: ${remoteAddress}`);
        this.activeServerSockets.set(socketKey, socket);
        this.socketBuffers.set(socketKey, ''); // Ініціалізуємо буфер для цього сокету

        this.callbacks.onClientConnected?.({ ip: socket.remoteAddress || 'unknown', port: socket.remotePort || 0 });

        socket.on('data', (data: Buffer) => {
            this._handleData(socket, socketKey, data);
        });

        socket.on('end', () => {
            console.log(`NetworkManager: Client disconnected (end): ${remoteAddress}`);
            this._handleDisconnect(socketKey);
        });

        socket.on('close', (hadError: boolean) => {
            console.log(`NetworkManager: Client connection closed (hadError: ${hadError}): ${remoteAddress}`);
            this._handleDisconnect(socketKey); // Переконуємось, що обробляємо закриття
        });

        socket.on('error', (error: Error) => {
            console.error(`NetworkManager: Socket error from ${remoteAddress}:`, error);
            this.callbacks.onNetworkError(`Socket ${remoteAddress}`, error);
            this._handleDisconnect(socketKey); // Закриваємо з'єднання при помилці
            socket.destroy(); // Переконуємось, що сокет знищено
        });

        // Таймаут неактивності (опціонально)
        // socket.setTimeout(300000); // 5 хвилин
        // socket.on('timeout', () => {
        // 	console.log(`NetworkManager: Socket timeout: ${remoteAddress}`);
        // 	socket.end();
        // 	this._handleDisconnect(socketKey);
        // });
    }

    private _handleDisconnect(socketKey: string): void {
        const socket = this.activeServerSockets.get(socketKey);
        if (socket) {
            this.callbacks.onClientDisconnected?.({ ip: socket.remoteAddress || 'unknown', port: socket.remotePort || 0 });
        }

        // Перевіряємо, чи цей сокет використовувався для отримання файлу
        let receivingFileId: string | null = null;
        this.receivingFiles.forEach((rf, fileId) => {
            if (rf.socket === socket) {
                receivingFileId = fileId;
            }
        });

        if (receivingFileId) {
            console.warn(`NetworkManager: Connection closed during file receive: ${receivingFileId}`);
            // Помилка чи успіх? Перевіряємо байти
            const rf = this.receivingFiles.get(receivingFileId);
            if (rf && rf.receivedBytes < rf.expectedSize) {
                this._cleanupReceivingFile(receivingFileId, new Error(`Connection closed prematurely after ${rf.receivedBytes}/${rf.expectedSize} bytes`));
            } else if (rf) {
                // Якщо всі байти отримано, вважаємо успіхом
                this._finalizeReceivingFile(receivingFileId);
            }
        }


        this.activeServerSockets.delete(socketKey);
        this.socketBuffers.delete(socketKey); // Очищаємо буфер для цього сокету
        console.log(`NetworkManager: Cleaned up resources for ${socketKey}`);
    }

    // --- Обробка Вхідних Даних ---

    private _handleData(socket: net.Socket, socketKey: string, data: Buffer): void {
        const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
        const currentBuffer = (this.socketBuffers.get(socketKey) || '') + data.toString('utf-8'); // Додаємо нові дані до буфера

        // Перевіряємо, чи це сокет для передачі файлу
        let receivingFile: ReceivingFile | undefined;
        this.receivingFiles.forEach(rf => {
            if (rf.socket === socket) {
                receivingFile = rf;
            }
        });

        if (receivingFile) {
            // --- Обробка даних файлу ---
            // ВСІ дані, що надходять після заголовка, вважаються даними файлу
            try {
                receivingFile.writeStream.write(data);
                receivingFile.receivedBytes += data.length;

                this.callbacks.onFileTransferProgress(
                    receivingFile.fileId,
                    'download',
                    receivingFile.receivedBytes,
                    receivingFile.expectedSize
                );

                // Перевірка на завершення (хоча 'end' / 'close' надійніші)
                if (receivingFile.receivedBytes >= receivingFile.expectedSize) {
                    console.log(`NetworkManager: Received expected bytes for file ${receivingFile.fileId}`);
                    // Завершення відбудеться при 'end' або 'close' сокету
                }

            } catch (error: any) {
                console.error(`NetworkManager: Error writing file chunk for ${receivingFile.fileId}:`, error);
                this._cleanupReceivingFile(receivingFile.fileId, error);
                socket.destroy(); // Закриваємо сокет при помилці запису
            }
            this.socketBuffers.set(socketKey, ''); // Очищаємо буфер, дані файлу оброблені
            return; // Більше нічого не робимо з цими даними
        }

        // --- Обробка JSON повідомлень ---
        // Розділяємо буфер на повідомлення за символом нового рядка
        let lastNewlineIndex = -1;
        let startIndex = 0;
        for (let i = 0; i < currentBuffer.length; i++) {
            if (currentBuffer[i] === '\n') {
                const jsonString = currentBuffer.substring(startIndex, i).trim();
                lastNewlineIndex = i;
                startIndex = i + 1;

                if (jsonString) {
                    try {
                        const message = JSON.parse(jsonString);
                        // Визначаємо, чи це заголовок файлу
                        if (message.type === 'fileDataHeader' && message.fileId) {
                            this._handleFileHeader(socket, message.fileId);
                            // Наступні дані на цьому сокеті будуть частинами файлу
                        } else {
                            // Це звичайне JSON повідомлення
                            this._processJsonMessage(socket, message);
                        }
                    } catch (e) {
                        console.warn(`NetworkManager: Received non-JSON message or parse error from ${remoteAddress}:`, jsonString, e);
                        // Можливо, закрити з'єднання, якщо очікуємо тільки JSON?
                    }
                }
            }
        }

        // Зберігаємо залишок буфера (якщо дані не закінчуються на \n)
        if (lastNewlineIndex === -1) {
            this.socketBuffers.set(socketKey, currentBuffer); // Ціле повідомлення не прийшло
        } else {
            this.socketBuffers.set(socketKey, currentBuffer.substring(startIndex)); // Зберігаємо неповний залишок
        }
    }


    // Обробка отриманого заголовку файлу
    private _handleFileHeader(socket: net.Socket, fileId: string): void {
        const receivingFile = this.receivingFiles.get(fileId);
        if (receivingFile) {
            console.log(`NetworkManager: Received file header for ${fileId}. Starting download.`);
            receivingFile.socket = socket; // Пов'язуємо сокет з передачею
            this.callbacks.onFileTransferStart(fileId, 'download', receivingFile.expectedSize);
        } else {
            console.error(`NetworkManager: Received file header for unknown or unprepared file transfer: ${fileId}. Closing connection.`);
            socket.end(); // Закриваємо з'єднання, ми не очікували цей файл
        }
    }


    // Обробка розпарсеного JSON повідомлення
    private _processJsonMessage(socket: net.Socket, message: any): void {
        const senderInfo = { ip: socket.remoteAddress || 'unknown', port: socket.remotePort || 0 };

        // Викликаємо загальний обробник
        this.callbacks.onMessageReceived(senderInfo, message);

        // Викликаємо специфічні обробники за типом повідомлення
        switch (message.type) {
            case 'fileOffer':
                if (message.fileId && message.filename && typeof message.size === 'number') {
                    this.callbacks.onFileOfferReceived(senderInfo, {
                        fileId: message.fileId,
                        filename: message.filename,
                        size: message.size
                    });
                } else {
                    console.warn("NetworkManager: Received invalid fileOffer:", message);
                }
                break;
            case 'fileAccept':
                if (message.fileId) {
                    this.callbacks.onFileAcceptReceived(senderInfo, message.fileId);
                } else {
                    console.warn("NetworkManager: Received invalid fileAccept:", message);
                }
                break;
            case 'fileDecline':
                if (message.fileId) {
                    this.callbacks.onFileDeclineReceived(senderInfo, message.fileId);
                } else {
                    console.warn("NetworkManager: Received invalid fileDecline:", message);
                }
                break;
            // Можна додати інші типи повідомлень ('text', 'userStatus' тощо)
            // case 'text':
            //  // Можна було б викликати окремий обробник, але onMessageReceived вже є
            //  break;
        }
    }


    // --- Надсилання Даних ---

    public sendData(ip: string, port: number, payload: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            let connected = false;

            client.connect(port, ip, () => {
                connected = true;
                console.log(`NetworkManager: Connected to ${ip}:${port} for sending data.`);
                try {
                    const messageString = JSON.stringify(payload) + '\n'; // Додаємо роздільник
                    client.write(messageString, 'utf-8', (err) => {
                        if (err) {
                            console.error(`NetworkManager: Error writing data to ${ip}:${port}:`, err);
                            this.callbacks.onNetworkError(`Send data to ${ip}:${port}`, err);
                            client.destroy(); // Закриваємо сокет при помилці запису
                            reject(err);
                        } else {
                            console.log(`NetworkManager: Data sent successfully to ${ip}:${port}`);
                            client.end(); // Закриваємо сокет після успішного надсилання
                            resolve();
                        }
                    });
                } catch (error: any) {
                    console.error(`NetworkManager: Error stringifying payload or writing:`, error);
                    this.callbacks.onNetworkError(`Send data (prepare) to ${ip}:${port}`, error);
                    client.destroy();
                    reject(error);
                }
            });

            client.on('error', (error: Error) => {
                if (!connected) { // Помилка до встановлення з'єднання
                    console.error(`NetworkManager: Connection error to ${ip}:${port}:`, error.message);
                } else { // Помилка після з'єднання (малоймовірно при простому надсиланні з закриттям)
                    console.error(`NetworkManager: Socket error after connection to ${ip}:${port}:`, error.message);
                }
                this.callbacks.onNetworkError(`Connect/Send to ${ip}:${port}`, error);
                reject(error);
                client.destroy(); // Переконуємось, що сокет знищено
            });

            client.on('close', (hadError) => {
                // console.log(`NetworkManager: Connection closed for sending to ${ip}:${port} (hadError: ${hadError})`);
                // Resolve/reject вже викликані або при записі, або при помилці
            });
        });
    }


    // --- Логіка Передачі Файлів ---

    /**
     * Готує NetworkManager до прийому файлу. Створює WriteStream.
     * Повертає Promise, який завершується успішно, якщо підготовка вдалася.
     */
    public prepareToReceiveFile(fileId: string, savePath: string, expectedSize: number, senderInfoStr: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.receivingFiles.has(fileId)) {
                console.warn(`NetworkManager: Already preparing to receive file ${fileId}.`);
                // Можливо, потрібно відхилити попередню? Або відхилити нову?
                reject(new Error(`Already receiving file with ID ${fileId}`));
                return;
            }

            try {
                // Переконуємось, що директорія існує
                const dir = path.dirname(savePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    console.log(`NetworkManager: Created directory ${dir} for receiving file.`);
                }

                const writeStream = fs.createWriteStream(savePath);

                const receivingFile: ReceivingFile = {
                    fileId,
                    filePath: savePath,
                    writeStream,
                    receivedBytes: 0,
                    expectedSize,
                    senderInfo: senderInfoStr,
                    // socket буде встановлено при отриманні fileDataHeader
                };

                writeStream.on('error', (error: Error) => {
                    console.error(`NetworkManager: WriteStream error for ${fileId} (${savePath}):`, error);
                    this._cleanupReceivingFile(fileId, error);
                    reject(error); // Повідомляємо про помилку підготовки
                });

                writeStream.on('open', () => {
                    console.log(`NetworkManager: Ready to receive file ${fileId} at ${savePath}`);
                    this.receivingFiles.set(fileId, receivingFile);
                    resolve();
                });

                writeStream.on('close', () => {
                    console.log(`NetworkManager: WriteStream closed for ${fileId}`);
                    // Фіналізація відбудеться в _finalizeReceivingFile або _cleanupReceivingFile
                });

            } catch (error: any) {
                console.error(`NetworkManager: Error preparing to receive file ${fileId}:`, error);
                this.callbacks.onNetworkError(`Prepare receive ${fileId}`, error);
                reject(error);
            }
        });
    }


    /**
     * Починає процес надсилання файлу до іншого користувача.
     * Цей метод викликається ПІСЛЯ отримання 'fileAccept'.
     */
    public startFileTransfer(ip: string, port: number, fileId: string, filePath: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            console.log(`NetworkManager: Starting file transfer ${fileId} to ${ip}:${port} from ${filePath}`);
            let fileStats: fs.Stats;
            try {
                fileStats = await fs.promises.stat(filePath);
                if (!fileStats.isFile()) {
                    throw new Error("Source path is not a file.");
                }
            } catch (error: any) {
                console.error(`NetworkManager: Error accessing file ${filePath}:`, error);
                this.callbacks.onFileTransferError(fileId, 'upload', error);
                reject(error);
                return;
            }

            const totalSize = fileStats.size;
            const client = new net.Socket();

            const sendingFile: SendingFile = {
                fileId,
                filePath,
                socket: client,
                receiverInfo: `${ip}:${port}`,
                sentBytes: 0,
                totalSize: totalSize,
                // readStream буде створено нижче
            };
            this.sendingFiles.set(fileId, sendingFile);

            let headerSent = false;
            let transferStarted = false;

            client.connect(port, ip, () => {
                console.log(`NetworkManager: Connected to ${ip}:${port} for file transfer ${fileId}.`);

                // 1. Надсилаємо заголовок
                const header = { type: 'fileDataHeader', fileId: fileId };
                client.write(JSON.stringify(header) + '\n', 'utf-8', (err) => {
                    if (err) {
                        console.error(`NetworkManager: Error sending file header for ${fileId}:`, err);
                        this._cleanupSendingFile(fileId, err);
                        reject(err);
                        return;
                    }
                    headerSent = true;
                    console.log(`NetworkManager: File header sent for ${fileId}. Starting stream.`);

                    // 2. Створюємо ReadStream та починаємо передачу даних
                    try {
                        const readStream = fs.createReadStream(filePath);
                        sendingFile.readStream = readStream; // Зберігаємо посилання
                        transferStarted = true;
                        this.callbacks.onFileTransferStart(fileId, 'upload', totalSize);

                        readStream.on('data', (chunk: Buffer) => {
                            // Надсилаємо чанк даних
                            const success = client.write(chunk);
                            sendingFile.sentBytes += chunk.length;
                            this.callbacks.onFileTransferProgress(fileId, 'upload', sendingFile.sentBytes, totalSize);

                            if (!success) { // Якщо буфер сокета переповнений, призупиняємо читання
                                // console.log(`NetworkManager: Pausing stream for ${fileId}`);
                                readStream.pause();
                                client.once('drain', () => {
                                    // console.log(`NetworkManager: Resuming stream for ${fileId}`);
                                    readStream.resume();
                                });
                            }
                        });

                        readStream.on('end', () => {
                            console.log(`NetworkManager: File stream ended for ${fileId}. All data sent.`);
                            // Не закриваємо сокет тут, чекаємо 'finish' або 'close'
                            client.end(); // Сигналізуємо про завершення надсилання даних
                            resolve(); // Вважаємо успіхом на цьому етапі
                        });

                        readStream.on('error', (streamError: Error) => {
                            console.error(`NetworkManager: ReadStream error for ${fileId}:`, streamError);
                            this._cleanupSendingFile(fileId, streamError);
                            reject(streamError);
                        });

                        readStream.on('close', () => {
                            console.log(`NetworkManager: ReadStream closed for ${fileId}`);
                        });

                    } catch (streamError: any) {
                        console.error(`NetworkManager: Error creating ReadStream for ${fileId}:`, streamError);
                        this._cleanupSendingFile(fileId, streamError);
                        reject(streamError);
                    }
                }); // кінець client.write для заголовка
            }); // кінець client.connect

            client.on('error', (error: Error) => {
                console.error(`NetworkManager: File transfer socket error for ${fileId} to ${ip}:${port}:`, error.message);
                if (!headerSent) { // Помилка до надсилання заголовка
                    this._cleanupSendingFile(fileId, error); // Потрібно очистити тут
                    reject(error);
                } else if (transferStarted) { // Помилка під час передачі
                    this._cleanupSendingFile(fileId, error); // Помилка вже обробляється/обробиться readStream 'error' або 'close'
                }
                // Не викликаємо reject тут, якщо помилка після старту, щоб дозволити обробнику stream помилки спрацювати першим
            });

            client.on('close', (hadError) => {
                console.log(`NetworkManager: File transfer connection closed for ${fileId} (hadError: ${hadError})`);
                // Якщо закриття відбулося без помилки і readStream завершився, все добре.
                // Якщо була помилка, _cleanupSendingFile вже мав бути викликаний.
                // Переконуємось, що очищення відбулося, якщо помилка була, але readStream не встиг її зловити
                if (hadError && this.sendingFiles.has(fileId)) {
                    const err = new Error(`Connection closed with error during upload of ${fileId}`);
                    this._cleanupSendingFile(fileId, err);
                    reject(err); // Переконуємось, що Promise відхилено
                } else if (!hadError && this.sendingFiles.has(fileId) && sendingFile.sentBytes === sendingFile.totalSize) {
                    // Успішне закриття після надсилання всього файлу
                    this.callbacks.onFileTransferComplete(fileId, 'upload', null); // null filePath означає успішну відправку
                    this.sendingFiles.delete(fileId); // Видаляємо з активних
                } else if (this.sendingFiles.has(fileId)) {
                    // Закриття до завершення без явної помилки?
                    const err = new Error(`Connection closed prematurely during upload of ${fileId}`);
                    this._cleanupSendingFile(fileId, err);
                    reject(err);
                }
            });

        }); // кінець Promise
    }


    // --- Приватні методи очищення ресурсів ---

    /**
     * Завершує процес отримання файлу (успішно).
     */
    private _finalizeReceivingFile(fileId: string): void {
        const receivingFile = this.receivingFiles.get(fileId);
        if (!receivingFile) return;

        console.log(`NetworkManager: Finalizing received file ${fileId} at ${receivingFile.filePath}`);

        // Перевіряємо розмір
        if (receivingFile.receivedBytes !== receivingFile.expectedSize) {
            console.warn(`NetworkManager: File ${fileId} received size mismatch! Expected ${receivingFile.expectedSize}, got ${receivingFile.receivedBytes}.`);
            // Вирішуємо, чи це помилка. Можливо, expectedSize був неточним?
            // Для надійності, вважатимемо це помилкою, якщо не збігається точно.
            this._cleanupReceivingFile(fileId, new Error(`Size mismatch: expected ${receivingFile.expectedSize}, received ${receivingFile.receivedBytes}`));
            return;
        }

        receivingFile.writeStream.end(() => {
            console.log(`NetworkManager: WriteStream finalized for ${fileId}`);
            this.callbacks.onFileTransferComplete(fileId, 'download', receivingFile.filePath);
            this.receivingFiles.delete(fileId); // Видаляємо з активних
            if (receivingFile.socket && !receivingFile.socket.destroyed) {
                receivingFile.socket.destroy(); // Закриваємо сокет, якщо він ще відкритий
            }
        });
    }

    /**
     * Очищує ресурси для файлу, що приймається, у разі помилки або скасування.
     */
    private _cleanupReceivingFile(fileId: string, error: Error): void {
        const receivingFile = this.receivingFiles.get(fileId);
        if (!receivingFile) return;

        console.error(`NetworkManager: Cleaning up receiving file ${fileId} due to error:`, error.message);

        // Закриваємо WriteStream та видаляємо файл
        receivingFile.writeStream.end(); // Завершуємо запис
        receivingFile.writeStream.close(async () => { // Чекаємо закриття потоку
            try {
                if (fs.existsSync(receivingFile.filePath)) {
                    await fs.promises.unlink(receivingFile.filePath); // Видаляємо неповний файл
                    console.log(`NetworkManager: Deleted incomplete file ${receivingFile.filePath}`);
                }
            } catch (unlinkError: any) {
                console.error(`NetworkManager: Error deleting incomplete file ${receivingFile.filePath}:`, unlinkError);
            } finally {
                this.callbacks.onFileTransferError(fileId, 'download', error);
                this.receivingFiles.delete(fileId); // Видаляємо з активних
                if (receivingFile.socket && !receivingFile.socket.destroyed) {
                    receivingFile.socket.destroy(); // Закриваємо пов'язаний сокет
                }
            }
        });
    }


    /**
     * Очищує ресурси для файлу, що надсилається, у разі помилки або скасування.
     */
    private _cleanupSendingFile(fileId: string, error: Error): void {
        const sendingFile = this.sendingFiles.get(fileId);
        if (!sendingFile) return;

        console.error(`NetworkManager: Cleaning up sending file ${fileId} due to error:`, error.message);

        // Зупиняємо ReadStream, якщо він існує та активний
        if (sendingFile.readStream && !sendingFile.readStream.destroyed) {
            sendingFile.readStream.destroy();
        }

        // Закриваємо сокет
        if (!sendingFile.socket.destroyed) {
            sendingFile.socket.destroy();
        }

        this.callbacks.onFileTransferError(fileId, 'upload', error);
        this.sendingFiles.delete(fileId); // Видаляємо з активних
    }

} // кінець класу NetworkManager