// Додайте ці імпорти на початку файлу SettingsTab.ts
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import LocalChatPlugin, { DEFAULT_SETTINGS } from './main'; // Імпортуємо головний клас плагіну та налаштування за замовчуванням

// Додайте 'export' перед оголошенням класу
export class ChatSettingTab extends PluginSettingTab {
    plugin: LocalChatPlugin;

    constructor(app: App, plugin: LocalChatPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Налаштування Локального Чату' });

        // Налаштування псевдоніму
        new Setting(containerEl)
            .setName('Ваш Псевдонім')
            .setDesc('Як вас бачитимуть інші користувачі в мережі.')
            .addText(text => text
                .setPlaceholder('Введіть псевдонім')
                .setValue(this.plugin.settings.userNickname)
                .onChange(async (value) => {
                    // Використовуємо DEFAULT_SETTINGS для fallback, якщо значення порожнє
                    this.plugin.settings.userNickname = value?.trim() || DEFAULT_SETTINGS.userNickname;
                    await this.plugin.saveSettings();
                    // TODO: Можливо, потрібно повідомити UserDiscovery про зміну нікнейму
                    // this.plugin.userDiscovery?.updateNickname(this.plugin.settings.userNickname);
                }));

        // Налаштування порту
        new Setting(containerEl)
            .setName('Порт для прослуховування')
            .setDesc('TCP порт, який буде використовувати плагін. Потребує перезапуску Obsidian для застосування.')
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.listenPort))
                .setValue(String(this.plugin.settings.listenPort))
                .onChange(async (value) => {
                    const port = parseInt(value);
                    let changed = false;
                    if (!isNaN(port) && port > 1024 && port < 65535) {
                        if (this.plugin.settings.listenPort !== port) {
                            this.plugin.settings.listenPort = port;
                            changed = true;
                        }
                    } else {
                        // Якщо некоректне значення, просто залишаємо поточне і нічого не зберігаємо
                        // Можна вивести повідомлення про помилку
                        text.setValue(String(this.plugin.settings.listenPort)); // Повертаємо старе значення в поле
                        new Notice("Некоректний порт. Введіть число від 1025 до 65534.");
                    }
                    // Зберігаємо налаштування лише якщо порт змінився і валідний
                    if (changed) {
                        await this.plugin.saveSettings();
                        new Notice("Порт змінено. Перезапустіть Obsidian, щоб зміни вступили в силу.");
                    }
                }));

        // Налаштування шляху завантаження
        new Setting(containerEl)
            .setName('Папка для завантажень')
            .setDesc('Куди зберігати отримані файли. Залиште порожнім, щоб використовувати папку вкладень сховища.')
            .addText(text => text
                .setPlaceholder('Наприклад, Downloads/ObsidianChat')
                .setValue(this.plugin.settings.downloadPath)
                .onChange(async (value) => {
                    this.plugin.settings.downloadPath = value?.trim() || ''; // Зберігаємо порожній рядок, якщо очищено
                    await this.plugin.saveSettings();
                }));


        // Налаштування збереження історії
        new Setting(containerEl)
            .setName('Зберігати історію чату')
            .setDesc('Чи зберігати повідомлення між сесіями Obsidian.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.saveHistory)
                .onChange(async (value) => {
                    this.plugin.settings.saveHistory = value;
                    await this.plugin.saveSettings();
                }));

        // Кнопка очищення історії (якщо реалізовано)
        /*
        new Setting(containerEl)
            .setName('Очистити історію')
            .setDesc('Видаляє всі збережені повідомлення.')
            .addButton(button => button
                .setButtonText('Очистити')
                .setWarning()
                .onClick(async () => {
                    if (confirm('Ви впевнені, що хочете видалити всю історію чату?')) {
                        // await this.plugin.clearChatHistory(); // Потрібно реалізувати цей метод в main.ts
                        new Notice('Історію чату очищено.');
                    }
                }));
        */
    }
}

// Додавати 'export {}' в кінці файлу НЕ потрібно, оскільки імпорти та експорт класу вже роблять його модулем.