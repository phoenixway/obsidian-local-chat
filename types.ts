// types.ts

/**
 * Represents basic information about a discovered user in the chat network.
 * In the WebSocket model, IP/Port are less relevant as communication goes via the server.
 */
export interface UserInfo {
    nickname: string;
    // ip?: string; // Usually not needed by clients in WS model
    // port?: number; // Usually not needed by clients in WS model
    // id?: unknown; // A unique ID assigned by the server might be useful
}

export interface IdentifyMessage extends BaseMessage {
    type: 'identify';
    nickname: string; // Обов'язкова властивість для цього типу
}

/**
 * Defines the structure for the plugin's settings.
 */
export interface LocalChatPluginSettings {
    /** The role this instance plays: client or server */
    role: 'client' | 'server';
    /** WebSocket address for clients to connect to (e.g., "ws://192.168.1.5:61338") */
    serverAddress: string;
    /** Port for the server instance to listen on */
    serverPort: number;
    /** The nickname displayed to other users */
    userNickname: string;
    /** Whether to persist chat history */
    saveHistory: boolean;
    /** Download path relative to vault root (empty for default attachment folder) */
    downloadPath: string;
}


export const DEFAULT_SETTINGS: LocalChatPluginSettings = {
    role: 'client',                     // За замовчуванням - клієнт
    serverAddress: 'ws://127.0.0.1:61338', // Приклад адреси сервера
    serverPort: 61338,                  // Новий порт за замовчуванням
    userNickname: `ObsidianUser_${Math.random().toString(36).substring(2, 8)}`,
    saveHistory: true,
    downloadPath: '',
}

/**
 * Represents the state of a file offer initiated by the local user, waiting for acceptance/rejection.
 */
export interface OutgoingFileOfferState {
    fileId: string;
    /** Absolute path to the local file. NOTE: Getting this reliably in Obsidian/Electron needs care! */
    filePath: string;
    filename: string;
    size: number;
    /** Target recipient nickname, or null for broadcast (if supported by server logic) */
    recipientNickname: string | null;
}

/**
 * Represents the state of a file offer received from another user, pending local acceptance/rejection.
 */
export interface IncomingFileOfferState {
    fileId: string;
    filename: string;
    size: number;
    senderNickname: string;
    /** Optional: Identifier of the sender (e.g., WebSocket client ID used by server) */
    senderClientId?: unknown;
    /** Optional: Original sender address (less useful in pure WS model) */
    senderAddress?: string;
}

/**
 * A generic structure for messages exchanged via WebSocket.
 * Specific message types will add their own properties.
 */
export interface BaseMessage {
    type: string; // e.g., 'text', 'fileOffer', 'fileAccept', 'fileDecline', 'userList', 'userJoin', 'userLeave', 'error'
    timestamp: number;
    senderNickname?: string; // Optional for server->client system messages
}

// --- Example Specific Message Types (extending BaseMessage) ---

export interface TextMessage extends BaseMessage {
    type: 'text';
    senderNickname: string; // Required for text
    content: string;
    recipient?: string | null; // Optional: For private messages routed by server
}

export interface FileOfferMessage extends BaseMessage {
    type: 'fileOffer';
    senderNickname: string; // Required
    fileId: string;
    filename: string;
    size: number;
    recipient?: string | null; // Optional: For private offers routed by server
}

export interface FileAcceptMessage extends BaseMessage {
    type: 'fileAccept';
    senderNickname: string; // Who accepted
    fileId: string;
    /** Nickname of the user who originally sent the offer */
    originalSender: string;
}

export interface FileDeclineMessage extends BaseMessage {
    type: 'fileDecline';
    senderNickname: string; // Who declined
    fileId: string;
    /** Nickname of the user who originally sent the offer */
    originalSender: string;
}

export interface UserListMessage extends BaseMessage {
    type: 'userList';
    users: UserInfo[]; // List of currently connected users
}

export interface UserJoinMessage extends BaseMessage {
    type: 'userJoin';
    nickname: string; // Nickname of the user who joined
    // server might add full UserInfo if needed
}

export interface UserLeaveMessage extends BaseMessage {
    type: 'userLeave';
    nickname: string; // Nickname of the user who left
}

// Union type for easier type checking in message handlers
export type WebSocketMessage =
    | BaseMessage // Generic fallback? Unlikely needed if handlers check type string
    | TextMessage
    | FileOfferMessage
    | FileAcceptMessage
    | FileDeclineMessage
    | IdentifyMessage // <-- Додано сюди
    | UserListMessage
    | UserJoinMessage
    | UserLeaveMessage;


// You can add other shared types/interfaces/enums here as your plugin evolves.
// For example:
// export type FileTransferStatus = 'pending' | 'accepted' | 'declined' | 'starting' | 'progressing' | 'completed' | 'error';
// export interface ChatHistoryEntry { ... }