import { App, Notice, PluginSettingTab, Setting, Platform } from 'obsidian';
import LocalChatPlugin from './main'; // Import main plugin class and defaults
import { DEFAULT_SETTINGS, LocalChatPluginSettings } from './types';
export class ChatSettingTab extends PluginSettingTab {
    plugin: LocalChatPlugin;
    constructor(app: App, plugin: LocalChatPlugin) { super(app, plugin); this.plugin = plugin; }
    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Local Chat Settings' });

        new Setting(containerEl) // Role
            .setName('Instance Role') /* ... as before ... */
        const serverAddrSetting = new Setting(containerEl) // Server Address
            .setName('Server Address') /* ... as before ... */
        const serverPortSetting = new Setting(containerEl) // Server Port
            .setName('Server Port') /* ... as before ... */

        // Show/Hide logic based on role
        if (this.plugin.settings.role === 'server' && !Platform.isMobile) {
            serverAddrSetting.settingEl.style.display = 'none'; serverPortSetting.settingEl.style.display = '';
        } else {
            serverAddrSetting.settingEl.style.display = ''; serverPortSetting.settingEl.style.display = 'none';
        }
        if (Platform.isMobile) serverPortSetting.settingEl.style.display = 'none';

        new Setting(containerEl) // Nickname
            .setName('Your Nickname') /* ... as before ... */

        // REMOVED Download Path Setting

        new Setting(containerEl) // Save History
            .setName('Save Chat History') /* ... as before ... */

        // TODO: Add "Clear History" button
    }
}