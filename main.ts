import { Plugin } from 'obsidian';
import { WebSocketServer } from 'ws';

export default class MyPlugin extends Plugin {
	private wss: WebSocketServer | null = null;

	async onload() {
		this.wss = new WebSocketServer({ port: 12345 });
		console.log("WS Server запущено на порту 12345");

		this.wss.on('connection', (ws) => {
			console.log("Новий клієнт підключено");

			ws.on('message', (message) => {
				console.log(`Отримано: ${message}`);
				ws.send(`Відповідь: ${message}`);
			});
		});
	}

	async onunload() {
		if (this.wss) {
			this.wss.close();
			console.log("WS Server зупинено");
		}
	}
}
