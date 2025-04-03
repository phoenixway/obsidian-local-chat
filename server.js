const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 12345 });

wss.on("connection", (ws) => {
    console.log("Новий клієнт!");
    ws.on("message", (message) => {
        console.log("Отримано:", message);
        ws.send(`Відповідь: ${message}`);
    });
});

console.log("WS Server запущено на порту 12345");
