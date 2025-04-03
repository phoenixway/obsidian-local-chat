import { App, Notice, PluginSettingTab, Setting, Platform } from 'obsidian';
import LocalChatPlugin from './main'; // Import main plugin class and defaults
import { DEFAULT_SETTINGS, LocalChatPluginSettings } from './types';
export class ChatSettingTab extends PluginSettingTab {
    plugin: LocalChatPlugin;

    constructor(app: App, plugin: LocalChatPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Local Chat Settings' });

        // Role Setting
        new Setting(containerEl)
            .setName('Instance Role')
            .setDesc('Client connects to a server. Server accepts connections (Desktop Only). Restart required.')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('client', 'Client')
                    .addOption('server', 'Server')
                    .setValue(this.plugin.settings.role)
                    .onChange(async (value: 'client' | 'server') => {
                        if (Platform.isMobile && value === 'server') {
                            new Notice("Server role not supported on mobile.");
                            dropdown.setValue('client'); // Revert
                            return;
                        }
                        if (this.plugin.settings.role !== value) {
                            this.plugin.settings.role = value;
                            await this.plugin.saveSettings();
                            this.display(); // Re-render
                            new Notice("Role changed. Restart Obsidian for changes to take effect.", 7000);
                        }
                    });
                if (Platform.isMobile) {
                    const serverOption = dropdown.selectEl.querySelector('option[value="server"]');
                    if (serverOption) (serverOption as HTMLOptionElement).disabled = true;
                    // Ensure client is selected if mobile loaded with server role somehow
                    if (this.plugin.settings.role === 'server') dropdown.setValue('client');
                }
            });

        // Server Address Setting (Client role)
        const serverAddrSetting = new Setting(containerEl)
            .setName('Server Address')
            .setDesc('WebSocket address (e.g., ws://192.168.1.100:61338)')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.serverAddress)
                .setValue(this.plugin.settings.serverAddress)
                .onChange(async (value) => {
                    this.plugin.settings.serverAddress = value?.trim() || DEFAULT_SETTINGS.serverAddress;
                    await this.plugin.saveSettings();
                }));

        // Server Port Setting (Server role)
        const serverPortSetting = new Setting(containerEl)
            .setName('Server Port')
            .setDesc('Port for the server to listen on. Restart required.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.serverPort))
                .setValue(String(this.plugin.settings.serverPort))
                .onChange(async (value) => {
                    const port = parseInt(value);
                    let portChanged = false;
                    if (!isNaN(port) && port > 1024 && port < 65535) {
                        if (this.plugin.settings.serverPort !== port) {
                            this.plugin.settings.serverPort = port;
                            portChanged = true;
                        }
                    } else if (value !== String(this.plugin.settings.serverPort)) {
                        text.setValue(String(this.plugin.settings.serverPort));
                        new Notice("Invalid port (1025-65534).");
                    }
                    if (portChanged) {
                        await this.plugin.saveSettings();
                        new Notice("Server port changed. Restart Obsidian to apply.", 7000);
                    }
                }));

        // Show/Hide based on role
        if (this.plugin.settings.role === 'server' && !Platform.isMobile) {
            serverAddrSetting.settingEl.style.display = 'none';
            serverPortSetting.settingEl.style.display = '';
        } else { // Client or Mobile
            serverAddrSetting.settingEl.style.display = '';
            serverPortSetting.settingEl.style.display = 'none';
        }

        // Nickname Setting
        new Setting(containerEl)
            .setName('Your Nickname')
            .setDesc('How you appear to others.')
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.userNickname)
                .setValue(this.plugin.settings.userNickname)
                .onChange(async (value) => {
                    const newNickname = value?.trim() || DEFAULT_SETTINGS.userNickname;
                    if (this.plugin.settings.userNickname !== newNickname) {
                        this.plugin.settings.userNickname = newNickname;
                        await this.plugin.saveSettings();
                        // TODO: If connected as client, send nickname update to server?
                        // if (this.plugin.webSocketClientManager?.isConnected) { ... send update message ... }
                        // If server, update own info and maybe broadcast? Requires more logic.
                    }
                }));

        // Download Path Setting
        new Setting(containerEl)
            .setName('Download Folder')
            .setDesc('Relative to vault root. Leave empty for vault attachment folder.')
            // Викликаємо addText і конфігуруємо текстове поле ('text') всередині callback
            .addText(text => {
                // --- Логіка для placeholder ---
                let placeholder = 'Default: Vault attachment folder'; // Стандартний текст
                try {
                    // Намагаємося отримати реальний шлях (використовуючи workaround 'as any')
                    const attachmentPath = (this.app.vault as any).getConfig('attachmentFolderPath');
                    // Перевіряємо, чи отримали валідний рядок
                    if (attachmentPath && typeof attachmentPath === 'string' && attachmentPath.trim()) {
                        placeholder = attachmentPath.trim(); // Використовуємо отриманий шлях як підказку
                    }
                } catch (e) {
                    console.warn("[Local Chat Settings] Could not read attachment folder path for placeholder:", e);
                    // Ігноруємо помилку, залишаємо стандартний placeholder
                }
                // --- Кінець логіки для placeholder ---

                // Ланцюжок методів тепер застосовується до 'text'
                text
                    .setPlaceholder(placeholder) // Встановлюємо підказку
                    .setValue(this.plugin.settings.downloadPath) // <-- Перенесено сюди
                    .onChange(async (value) => { // <-- Перенесено сюди
                        // Зберігаємо значення (порожній рядок, якщо користувач все стер)
                        this.plugin.settings.downloadPath = value?.trim() ?? ''; // Використовуємо ?? для ясності
                        await this.plugin.saveSettings();
                    });
            }); // Кінець конфігурації addText

        // Save History Setting
        new Setting(containerEl)
            .setName('Save Chat History')
            .setDesc('Keep messages between sessions.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.saveHistory)
                .onChange(async (value) => {
                    this.plugin.settings.saveHistory = value;
                    await this.plugin.saveSettings();
                }));

        // TODO: Add "Clear History" button
    }
}