// server.js
const WebSocket = require('ws'); // Потрібно: npm install ws

const PORT = process.env.PORT || 12345; // Використовуємо змінну середовища або стандартний порт

// --- Налаштування сервера ---
const wss = new WebSocket.Server({ port: PORT });
console.log(`[ChatServer] WebSocket server запущено на порті ${PORT}...`);

// --- Структури даних для керування клієнтами ---
// Зберігаємо клієнтів за унікальним ID, присвоєним сервером
const clients = new Map(); // Map<string, { ws: WebSocket, nickname: string | null }>

// Додаткова мапа для швидкого пошуку ID клієнта за нікнеймом
const nicknames = new Map(); // Map<string, string> (nickname -> clientId)

let clientIdCounter = 0; // Простий лічильник для генерації ID

// --- Допоміжні функції ---

/** Генерує унікальний ID для нового клієнта */
function generateClientId() {
    clientIdCounter++;
    return `client_${clientIdCounter}_${Date.now()}`;
}

/** Повертає список активних (ідентифікованих) користувачів */
function getUserList() {
    const userList = [];
    clients.forEach(clientInfo => {
        if (clientInfo.nickname) { // Включаємо лише тих, хто надав нікнейм
            userList.push({ nickname: clientInfo.nickname }); // Відповідає типу UserInfo в плагіні
        }
    });
    return userList;
}

/** Надсилає повідомлення конкретному клієнту за його ID */
function sendToClient(clientId, payload) {
    const clientInfo = clients.get(clientId);
    // Перевіряємо, чи клієнт існує, ідентифікований та чи з'єднання активне
    if (clientInfo && clientInfo.nickname && clientInfo.ws.readyState === WebSocket.OPEN) {
        try {
            clientInfo.ws.send(JSON.stringify(payload));
            return true;
        } catch (error) {
            console.error(`[ChatServer] Помилка надсилання до ${clientId} (${clientInfo.nickname}):`, error);
            // Якщо відправка не вдається, можливо, варто ініціювати відключення цього клієнта
            clientInfo.ws.terminate(); // Примусово закриваємо
            // Обробка відключення відбудеться в події 'close'
            return false;
        }
    }
    return false; // Клієнт не знайдений або з'єднання не відкрите/не ідентифіковане
}

/** Надсилає повідомлення конкретному клієнту за його нікнеймом */
function sendToNickname(nickname, payload) {
    const clientId = nicknames.get(nickname);
    if (clientId) {
        return sendToClient(clientId, payload);
    }
    console.warn(`[ChatServer] Не вдалося надіслати: Нікнейм '${nickname}' не знайдено.`);
    return false;
}

/** Розсилає повідомлення всім ідентифікованим клієнтам, опціонально крім одного */
function broadcast(senderClientId, payload) {
    if (!payload) return; // Не розсилати пусті повідомлення
    try {
        const messageString = JSON.stringify(payload);
        let broadcastCount = 0;
        clients.forEach((clientInfo, clientId) => {
            // Надсилаємо лише ідентифікованим клієнтам, які не є відправником
            if (clientInfo.nickname && clientInfo.ws.readyState === WebSocket.OPEN && clientId !== senderClientId) {
                try {
                    clientInfo.ws.send(messageString);
                    broadcastCount++;
                } catch (error) {
                    console.error(`[ChatServer] Помилка трансляції до ${clientId} (${clientInfo.nickname}):`, error);
                    // Розглянути можливість видалення клієнта при помилці трансляції
                }
            }
        });
        // console.log(`[ChatServer] Broadcast type '${payload.type}' to ${broadcastCount} client(s).`);
    } catch (error) {
         console.error(`[ChatServer] Помилка при підготовці broadcast: `, error);
    }
}


// --- Обробники Подій Сервера ---

wss.on('connection', (ws) => {
    // 1. Генеруємо ID і зберігаємо початковий стан клієнта
    const clientId = generateClientId();
    clients.set(clientId, { ws: ws, nickname: null });
    console.log(`[ChatServer] Клієнт підключився. Присвоєно ID: ${clientId}. Всього клієнтів: ${clients.size}`);

    // 2. Обробка повідомлень від цього клієнта
    ws.on('message', (messageBuffer) => {
        let message;
        try {
            // Очікуємо JSON
            message = JSON.parse(messageBuffer.toString('utf-8'));
        } catch (error) {
            console.warn(`[ChatServer] Отримано невалідний JSON від ${clientId}:`, messageBuffer.toString('utf-8'));
             try { ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON format.' })); } catch {}
            return;
        }

        const clientInfo = clients.get(clientId);
        if (!clientInfo) {
            console.error(`[ChatServer] Отримано повідомлення від невідомого clientId: ${clientId}`);
            ws.terminate();
            return;
        }

        // 3. Логіка обробки залежно від стану (ідентифікований чи ні)
        if (!clientInfo.nickname) {
            // --- Обробка Ідентифікації ---
            if (message.type === 'identify' && message.nickname && typeof message.nickname === 'string') {
                const requestedNickname = message.nickname.trim();
                if (!requestedNickname) {
                    try { ws.send(JSON.stringify({ type: 'error', message: 'Nickname cannot be empty.' })); } catch {}
                    ws.terminate();
                } else if (nicknames.has(requestedNickname)) {
                    try { ws.send(JSON.stringify({ type: 'error', message: `Nickname '${requestedNickname}' is already taken.` })); } catch {}
                    ws.terminate();
                } else {
                    // Успішна ідентифікація
                    clientInfo.nickname = requestedNickname;
                    nicknames.set(requestedNickname, clientId);
                    console.log(`[ChatServer] Клієнт ${clientId} ідентифікований як '${requestedNickname}'.`);

                    // Надіслати новому клієнту список поточних користувачів
                    const userListPayload = { type: 'userList', users: getUserList(), timestamp: Date.now() };
                    sendToClient(clientId, userListPayload);

                    // Сповістити ВСІХ ІНШИХ про нового користувача
                    const joinPayload = { type: 'userJoin', nickname: requestedNickname, timestamp: Date.now() };
                    broadcast(clientId, joinPayload); // Виключаємо самого нового користувача
                }
            } else {
                // Перше повідомлення некоректне
                try { ws.send(JSON.stringify({ type: 'error', message: 'First message must be {type: "identify", nickname: "..."}' })); } catch {}
                ws.terminate();
            }
        } else {
            // --- Обробка Повідомлень від Ідентифікованого Клієнта ---
            message.senderNickname = clientInfo.nickname; // Додаємо/перезаписуємо відправника
            message.timestamp = message.timestamp || Date.now(); // Додаємо час, якщо немає

            switch (message.type) {
                case 'text':
                    if (message.content) {
                        if (message.recipient && typeof message.recipient === 'string') {
                            // Приватне повідомлення - пересилаємо конкретному отримувачу
                            console.log(`[ChatServer] Релей: приватний текст від ${clientInfo.nickname} до ${message.recipient}`);
                            if (!sendToNickname(message.recipient, message)) {
                                 // Сповіщаємо відправника, що отримувача не знайдено
                                 sendToClient(clientId, { type: 'error', message: `User '${message.recipient}' not found or offline.` });
                            }
                        } else {
                            // Broadcast повідомлення
                            console.log(`[ChatServer] Broadcast: текст від ${clientInfo.nickname}`);
                            broadcast(clientId, message);
                        }
                    } else { console.warn(`[ChatServer] Отримано 'text' без 'content' від ${clientInfo.nickname}`); }
                    break;

                case 'fileOffer':
                     if (message.fileId && message.filename && typeof message.size === 'number') {
                         if (message.recipient && typeof message.recipient === 'string') {
                             // Приватна пропозиція файлу - релей
                             console.log(`[ChatServer] Релей: приватна пропозиція файлу від ${clientInfo.nickname} до ${message.recipient}`);
                             if (!sendToNickname(message.recipient, message)) {
                                 sendToClient(clientId, { type: 'error', message: `User '${message.recipient}' not found for file offer.` });
                             }
                         } else {
                             // Broadcast пропозиції файлу
                             console.log(`[ChatServer] Broadcast: пропозиція файлу від ${clientInfo.nickname}`);
                             broadcast(clientId, message);
                         }
                     } else { console.warn(`[ChatServer] Отримано невалідний 'fileOffer' від ${clientInfo.nickname}:`, message); }
                    break;

                case 'fileAccept':
                case 'fileDecline':
                     // Релей відповіді (Accept/Decline) до початкового відправника пропозиції
                     if (message.fileId && message.originalSender && typeof message.originalSender === 'string') {
                         console.log(`[ChatServer] Релей: '${message.type}' від ${clientInfo.nickname} до ${message.originalSender}`);
                         if (!sendToNickname(message.originalSender, message)) {
                             // Повідомляємо того, хто прийняв/відхилив, що відправник пропозиції вже офлайн
                             sendToClient(clientId, { type: 'error', message: `Original sender '${message.originalSender}' not found for file response.` });
                         }
                     } else { console.warn(`[ChatServer] Отримано невалідний '${message.type}' від ${clientInfo.nickname} (відсутній fileId або originalSender):`, message); }
                    break;

                // TODO: Обробка повідомлень типу 'fileChunk' для передачі файлів

                default:
                    console.warn(`[ChatServer] Отримано невідомий тип повідомлення '${message.type}' від ${clientInfo.nickname}`);
                    try { ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}`}));} catch {}
            }
        }
    });

    // 4. Обробка відключення клієнта
    ws.on('close', () => {
        const clientInfo = clients.get(clientId);
        if (!clientInfo) return; // Вже видалено?

        const disconnectedNickname = clientInfo.nickname;
        console.log(`[ChatServer] Клієнт ${disconnectedNickname || clientId} відключився.`);

        clients.delete(clientId);
        if (disconnectedNickname) {
            nicknames.delete(disconnectedNickname);
            // Сповістити ВСІХ РЕШТУ про відключення
            const leavePayload = { type: 'userLeave', nickname: disconnectedNickname, timestamp: Date.now() };
            broadcast(null, leavePayload); // null - розсилаємо всім
        }
        console.log(`[ChatServer] Всього клієнтів: ${clients.size}`);
    });

    // 5. Обробка помилок сокету
    ws.on('error', (error) => {
        const clientInfo = clients.get(clientId);
        console.error(`[ChatServer] Помилка WebSocket для ${clientInfo?.nickname || clientId}:`, error);
        // Подія 'close' зазвичай викликається після 'error', тому очищення відбудеться там
        // Можна примусово закрити, якщо потрібно: ws.terminate();
    });
});

// Обробка помилок самого сервера
wss.on('error', (error) => {
    console.error('[ChatServer] ПОМИЛКА СЕРВЕРА:', error);
});

// Додатково: Обробка закриття сервера (наприклад, при зупинці процесу)
process.on('SIGINT', () => {
    console.log('[ChatServer] Отримано SIGINT. Закриття сервера...');
    wss.close(() => {
        console.log('[ChatServer] Сервер закрито.');
        process.exit(0);
    });
    // Примусове закриття через деякий час, якщо звичайне не спрацювало
    setTimeout(() => process.exit(1), 5000);
});