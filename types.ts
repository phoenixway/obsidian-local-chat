// types.ts (Чиста версія)

/** Information about a chat user */
export interface UserInfo {
    nickname: string;
    // ip?: string; // Usually not needed by clients in WS model
    // port?: number; // Usually not needed by clients in WS model
    // id?: unknown; // A unique ID assigned by the server might be useful
}

/** Plugin settings structure */
export interface LocalChatPluginSettings {
    role: 'client' | 'server';
    serverAddress: string;
    serverPort: number;
    userNickname: string;
    saveHistory: boolean;
    downloadPath: string;
}

/** State for a file offer initiated by the local user */
export interface OutgoingFileOfferState {
    fileId: string;
    // filePath: string; // Path might be less relevant than the File object itself for WS
    fileObject?: File; // Store the File object directly? Needs careful thought on memory/serialization
    filePath?: string; // Or path to a temporary copy
    filename: string;
    size: number;
    recipientNickname: string | null; // null for broadcast
}

/** State for a file offer received from another user */
export interface IncomingFileOfferState {
    fileId: string;
    filename: string;
    size: number;
    senderNickname: string; // Nickname of the user who sent the offer (Required)
    senderClientId?: unknown;  // Store WebSocket client identifier (if server needs it)
    senderAddress?: string; // Optional: Original sender address
}

/** Base interface for all WebSocket messages */
export interface BaseMessage {
    type: string;
    timestamp: number;
    senderNickname?: string; // Optional for system messages like errors or user lists from server
}

// --- Specific Message Types ---

export interface IdentifyMessage extends BaseMessage {
    type: 'identify';
    nickname: string;
    // No senderNickname needed here, server identifies sender by connection
}

export interface TextMessage extends BaseMessage {
    type: 'text';
    senderNickname: string; // Required
    content: string;
    recipient?: string | null; // Optional: For private messages routed by server
}

export interface FileOfferMessage extends BaseMessage {
    type: 'fileOffer';
    senderNickname: string; // Required
    fileId: string;
    filename: string;
    size: number;
    recipient?: string | null;
}

export interface FileAcceptMessage extends BaseMessage {
    type: 'fileAccept';
    senderNickname: string; // Who accepted
    fileId: string;
    originalSender: string; // Nickname of the user who originally sent the offer
}

export interface FileDeclineMessage extends BaseMessage {
    type: 'fileDecline';
    senderNickname: string; // Who declined
    fileId: string;
    originalSender: string;
}

export interface UserListMessage extends BaseMessage {
    type: 'userList';
    users: UserInfo[]; // List of currently connected users
    // No senderNickname needed, comes from server
}

export interface UserJoinMessage extends BaseMessage {
    type: 'userJoin';
    nickname: string; // Nickname of the user who joined
    // No senderNickname needed, comes from server
}

export interface UserLeaveMessage extends BaseMessage {
    type: 'userLeave';
    nickname: string; // Nickname of the user who left
    // No senderNickname needed, comes from server
}

export interface ErrorMessage extends BaseMessage {
    type: 'error';
    message: string; // The error description
    // No senderNickname needed, comes from server
}

// --- WebSocket Message Union Type ---
export type WebSocketMessage =
    | IdentifyMessage // Should come first? Order usually doesn't matter
    | TextMessage
    | FileOfferMessage
    | FileAcceptMessage
    | FileDeclineMessage
    | UserListMessage
    | UserJoinMessage
    | UserLeaveMessage
    | ErrorMessage;
// DO NOT include BaseMessage here directly if all messages have a specific type

export const DEFAULT_SETTINGS: LocalChatPluginSettings = {
    role: 'client',                     // За замовчуванням - клієнт
    serverAddress: 'ws://127.0.0.1:61338', // Приклад адреси сервера
    serverPort: 61338,                  // Новий порт за замовчуванням
    userNickname: `ObsidianUser_${Math.random().toString(36).substring(2, 8)}`,
    saveHistory: true,
    downloadPath: '',
}