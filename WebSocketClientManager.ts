// WebSocketClientManager.ts
import { UserInfo, WebSocketMessage, BaseMessage } from './types'; // Import shared types
import { Notice } from 'obsidian';

// Callbacks для сповіщення main.ts
export interface WebSocketClientCallbacks {
    onOpen: (event: Event) => void;
    onClose: (event: CloseEvent) => void;
    onError: (event: Event) => void;
    /** Called when a structured message is received from the server */
    onMessage: (message: WebSocketMessage) => void;
    /** TODO: Callback for receiving binary data (file chunks) */
    // onBinaryMessage: (data: ArrayBuffer) => void;
}

export class WebSocketClientManager {
    private callbacks: WebSocketClientCallbacks;
    private socket: WebSocket | null = null;
    private serverAddress: string | null = null;
    private _isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5; // Max attempts before giving up
    private reconnectDelay: number = 5000; // Delay between attempts (ms)
    private requestedNickname: string | null = null; // Nickname to send on connect

    constructor(callbacks: WebSocketClientCallbacks) {
        this.callbacks = callbacks;
        // TODO: Validate callbacks
    }
    public get isConnected(): boolean {
        // Можна зробити перевірку надійнішою, враховуючи стан сокету
        return this._isConnected && !!this.socket && this.socket.readyState === WebSocket.OPEN;
    }
    // --- КІНЕЦЬ ГЕТЕРА ---
    /** Ініціює підключення до сервера */
    public connect(address: string, nickname: string): void {
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
            console.warn(`[WSClient] Already connected or connecting to ${this.serverAddress}.`);
            return;
        }

        if (!address) {
            console.error("[WSClient] Cannot connect: Server address is empty.");
            return;
        }

        this.serverAddress = address;
        this.requestedNickname = nickname; // Store nickname for identification
        this._isConnected = false;
        console.log(`[WSClient] Attempting to connect to ${this.serverAddress}...`);

        try {
            this.socket = new WebSocket(this.serverAddress);

            this.socket.onopen = (event) => this._handleOpen(event);
            this.socket.onmessage = (event) => this._handleMessage(event);
            this.socket.onerror = (event) => this._handleError(event);
            this.socket.onclose = (event) => this._handleClose(event);

        } catch (error: any) {
            console.error(`[WSClient] Error creating WebSocket connection to ${this.serverAddress}:`, error);
            this.callbacks.onError(error); // Use a generic Event or create one
            this.socket = null;
            // TODO: Schedule reconnect attempt?
        }
    }

    /** Закриває поточне з'єднання */
    public disconnect(): void {
        if (this.socket) {
            console.log(`[WSClient] Disconnecting from ${this.serverAddress}...`);
            // Prevent automatic reconnection attempts when manually disconnecting
            this.reconnectAttempts = this.maxReconnectAttempts + 1; // Exceed max attempts
            this.socket.close(1000, "Client disconnecting normally"); // 1000 = Normal closure
        }
        this.socket = null;
        this._isConnected = false;
        this.serverAddress = null;
        this.requestedNickname = null;
    }

    /** Надсилає JSON повідомлення на сервер */
    public async sendMessage(payload: any): Promise<void> {
        // Wrap send in a Promise for potential future queueing/error handling
        return new Promise((resolve, reject) => {
            if (!this._isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
                console.warn("[WSClient] Cannot send message: Not connected.");
                reject(new Error("WebSocket is not connected."));
                return;
            }
            try {
                this.socket.send(JSON.stringify(payload));
                resolve();
            } catch (error: any) {
                console.error("[WSClient] Error sending message:", error);
                this.callbacks.onError(error); // Notify main.ts about send error
                reject(error);
            }
        });
    }

    // TODO: Method to send binary data (file chunks)
    /*
    public async sendBinaryChunk(data: ArrayBuffer): Promise<void> {
        return new Promise((resolve, reject) => {
           if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
               reject(new Error("WebSocket is not connected.")); return;
           }
           try {
               this.socket.send(data); // Send ArrayBuffer directly
               resolve();
           } catch (error: any) {
               console.error("[WSClient] Error sending binary chunk:", error);
               this.callbacks.onError(error);
               reject(error);
           }
        });
    }
    */


    /** Обробник події відкриття з'єднання */
    private _handleOpen(event: Event): void {
        console.log(`[WSClient] Connection opened successfully to ${this.serverAddress}`);
        this._isConnected = true;
        this.reconnectAttempts = 0; // Reset reconnect counter on successful connection

        // Send identification message immediately after opening
        if (this.requestedNickname) {
            const identifyPayload = { type: 'identify', nickname: this.requestedNickname };
            console.log(`[WSClient] Sending identification:`, identifyPayload);
            this.sendMessage(identifyPayload).catch(err => {
                console.error("[WSClient] Failed to send identification message:", err);
                // Consider closing the connection if identification fails?
            });
        } else {
            console.error("[WSClient] Cannot identify: Nickname was not provided during connect.");
            this.disconnect(); // Disconnect if no nickname is set
            return;
        }

        // Notify main.ts
        this.callbacks.onOpen(event);
    }

    /** Обробник події отримання повідомлення */
    private _handleMessage(event: MessageEvent): void {
        // TODO: Handle binary data (ArrayBuffer/Blob) for file transfers
        if (typeof event.data === 'string') {
            try {
                const message: WebSocketMessage = JSON.parse(event.data);
                this.callbacks.onMessage(message); // Pass parsed JSON to main.ts
            } catch (e) {
                console.error("[WSClient] Received non-JSON text message or parse error:", event.data, e);
                // Handle error appropriately - maybe send error back to server?
            }
        } else if (event.data instanceof ArrayBuffer) {
            console.log(`[WSClient] Received binary message (ArrayBuffer), ${event.data.byteLength} bytes.`);
            // TODO: Pass to binary message handler
            // this.callbacks.onBinaryMessage?.(event.data);
        } else if (event.data instanceof Blob) {
            console.log(`[WSClient] Received binary message (Blob), ${event.data.size} bytes.`);
            // TODO: Convert Blob to ArrayBuffer if needed and pass to handler
            // event.data.arrayBuffer().then(buffer => this.callbacks.onBinaryMessage?.(buffer));
        } else {
            console.warn("[WSClient] Received message with unknown data type:", event.data);
        }
    }

    /** Обробник події помилки з'єднання */
    private _handleError(event: Event): void {
        console.error("[WSClient] WebSocket error:", event);
        // Note: The 'close' event will usually fire immediately after 'error'
        this._isConnected = false; // Assume connection is lost on error
        this.callbacks.onError(event);
    }

    /** Обробник події закриття з'єднання */
    private _handleClose(event: CloseEvent): void {
        console.warn(`[WSClient] WebSocket closed. Code: ${event.code}, Reason: '${event.reason}', Clean: ${event.wasClean}`);
        this._isConnected = false;
        this.socket = null; // Clear the socket reference
        this.callbacks.onClose(event);

        // --- Simple Reconnection Logic ---
        // Avoid reconnecting if closed normally by client or server (code 1000) or if max attempts reached
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1); // Exponential backoff
            console.log(`[WSClient] Attempting reconnect #${this.reconnectAttempts} in ${delay / 1000}s...`);
            setTimeout(() => {
                if (this.serverAddress && this.requestedNickname) { // Check if we still have connection info
                    this.connect(this.serverAddress, this.requestedNickname);
                } else {
                    console.log("[WSClient] Cannot reconnect: connection info missing.");
                }
            }, delay);
        } else if (event.code !== 1000) {
            console.error(`[WSClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            new Notice("Failed to reconnect to chat server.", 10000);
        }
    }

}