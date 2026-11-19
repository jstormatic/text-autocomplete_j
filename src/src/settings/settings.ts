import { PluginSettingTab, App, Setting, Notice, DropdownComponent, ToggleComponent, SliderComponent, TextComponent, ButtonComponent } from 'obsidian';
import type TAPlugin from 'src/main';
import { destroyTAUI } from './ui';
import { DUPLICATE_FILE, DUPLICATE_WORD, EMPTY_FILE } from 'src/constants';
import { Result } from 'src/utils';

export interface DictionaryFile {
    filename: string;
    sourcePath?: string;
    words: string[];
};

export interface TASettings {
    enabled: boolean;
    language: string;
    maxSuggestions: number;
    enterAcceptKey: boolean;
    tabAcceptKey: boolean;
    addSpace: boolean;
    caseSensitive: boolean;
    learnFromTyping: boolean;
    updateImportedDictionary: boolean;
    autoReloadImportedDictionaries: boolean;
    learningThreshold: number;
    learnedWordCounts: Record<string, number>;
    typedWordCounts: Record<string, number>;
    acceptedWordCounts: Record<string, number>;
    pinnedWords: string[];
    pinnedWordScores: Record<string, number>;
    customDictPageSize: number;
    lastRemovedWord?: { word: string; index: number };
    customDict: string[];
    dictFiles: DictionaryFile[];
    wordScores: Record<string, number | undefined>;
}

export const DEFAULT_SETTINGS: TASettings = {
    enabled: true,
    language: 'English',
    maxSuggestions: 0,
    enterAcceptKey: true,
    tabAcceptKey: true,
    addSpace: false,
    caseSensitive: true,
    learnFromTyping: true,
    updateImportedDictionary: true,
    autoReloadImportedDictionaries: true,
    learningThreshold: 3,
    learnedWordCounts: {},
    typedWordCounts: {},
    acceptedWordCounts: {},
    pinnedWords: [],
    pinnedWordScores: {},
    customDictPageSize: 50,
    customDict: [],
    dictFiles: [],
    wordScores: {}
}

export class TASettingsTab extends PluginSettingTab {
    plugin: TAPlugin;
    private customSearch: string = '';
    private customSort: 'alphabetical' | 'usage' = 'alphabetical';
    private customPage: number = 0;
    private selectedCustomWords: Set<string> = new Set();

    constructor(app: App, plugin: TAPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const containerEl: HTMLElement = this.containerEl;
        containerEl.empty();

        // AUTOCOMPLETE
        new Setting(containerEl)
            .setName('Autocomplete')
            .setDesc('Enable/disable the autocomplete feature.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.enabled)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('enabled', val, !val);
                    }));

        // LANGUAGE
        new Setting(containerEl)
            .setName('Language')
            .setDesc('Specify text language support (only English is supported at the moment).')
            .addDropdown((dropdown: DropdownComponent) =>
                dropdown.addOption('English', 'English')
                    .setValue(this.plugin.settings.language)
                    .onChange(async (val: string) => {
                        await this.updateSetting('language', val, true);
                    }));

        // MAX SUGGESTIONS
        new Setting(containerEl)
            .setName('Maximum suggestions')
            .setDesc('Maximum number of suggestions shown at once (0-10). Set to 0 to disable suggestions.')
            .addSlider((slider: SliderComponent) =>
                slider.setLimits(0, 10, 1)
                    .setValue(this.plugin.settings.maxSuggestions)
                    .setDynamicTooltip()
                    .onChange(async (val: number) => {
                        await this.updateSetting('maxSuggestions', val, true);
                    }));

        // ACCEPT KEY
        new Setting(containerEl)
            .setName('Enter as accept suggestion key')
            .setDesc('Enable/disable ability to use `Enter` key to accept word suggestion.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.enterAcceptKey)
                    .onChange(async (val: boolean) => {
                        if (!val && !this.plugin.settings.tabAcceptKey) {
                            new Notice('At least one accept key must remain enabled.');
                            toggle.setValue(true);
                            return;
                        }
                        
                        await this.updateSetting('enterAcceptKey', val, false);
                    }));

        new Setting(containerEl)
            .setName('Tab as accept suggestion key')
            .setDesc('Enable/disable ability to use `Tab` key to accept word suggestion.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.tabAcceptKey)
                    .onChange(async (val: boolean) => {
                        if (!val && !this.plugin.settings.enterAcceptKey) {
                            new Notice('At least one accept key must remain enabled.');
                            toggle.setValue(true);
                            return;
                        }
                        
                        await this.updateSetting('tabAcceptKey', val, false);
                    }));

        // SPACE TERMINATOR
        new Setting(containerEl)
            .setName('Space terminator after autocomplete')
            .setDesc('Enable/disable adding space terminator to autocompleted words.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.addSpace)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('addSpace', val, false);
                    }));

        // CASE SENSITIVE
        new Setting(containerEl)
            .setName('Case sensitive suggestions')
            .setDesc('Enable/disable case sensitivity for word suggestions.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.caseSensitive)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('caseSensitive', val, true);
                    }));

        new Setting(containerEl)
            .setName('Learn from typing')
            .setDesc('Automatically add frequently typed words to the custom dictionary.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.learnFromTyping)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('learnFromTyping', val, false);
                    }));

        new Setting(containerEl)
            .setName('Learning threshold')
            .setDesc('Number of times a word must be typed before it is learned.')
            .addSlider((slider: SliderComponent) =>
                slider.setLimits(2, 10, 1)
                    .setValue(this.plugin.settings.learningThreshold)
                    .setDynamicTooltip()
                    .onChange(async (val: number) => {
                        await this.updateSetting('learningThreshold', val, false);
                    }));

        new Setting(containerEl)
            .setName('Update imported dictionary')
            .setDesc('Append learned words to the source Text File (.txt).')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.updateImportedDictionary)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('updateImportedDictionary', val, false);
                    }));

        new Setting(containerEl)
            .setName('Auto-reload imported dictionaries')
            .setDesc('Watch source Text Files and reload only when a file changes.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.autoReloadImportedDictionaries)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('autoReloadImportedDictionaries', val, false);
                        await this.plugin.setImportedDictionaryWatching(val);
                    }))
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Reload now')
                    .onClick(async () => {
                        await this.plugin.reloadImportedDictionaries(true);
                        this.display();
                    }));

        // CUSTOM DICT
        new Setting(containerEl)
            .setName('Custom dictionary')
            .setDesc(`Manage ${this.plugin.settings.customDict.length} custom word(s).`)
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Export')
                    .setTooltip('Export custom words as a Text File')
                    .onClick(async () => this.exportCustomDictionary()));

        new Setting(containerEl)
            .setName('Add custom word')
            .setDesc('Enter a word and press Enter.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Add word, then press Enter');
                text.inputEl.addEventListener('keydown', async (e: KeyboardEvent) => {
                    if (e.key !== 'Enter') return;

                    const word: string = text.getValue().trim();
                    const result: Result = await this.plugin.addCustomWord(word);

                    if (!result.ok && result === DUPLICATE_WORD) {
                        new Notice(`"${word}" is already in your custom dictionary.`);
                    } else if (result.ok) {
                        text.setValue('');
                    }

                    this.customPage = 0;
                    this.display();
                });
            });

        new Setting(containerEl)
            .setName('Dictionary controls')
            .setDesc('Search and sort custom words.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Search custom words');
                text.setValue(this.customSearch);
                text.inputEl.addEventListener('input', () => {
                    this.customSearch = text.getValue();
                    this.customPage = 0;
                    this.renderCustomWordList(containerEl);
                });
            })
            .addDropdown((dropdown: DropdownComponent) =>
                dropdown.addOption('alphabetical', 'Alphabetical')
                    .addOption('usage', 'Most accepted')
                    .setValue(this.customSort)
                    .onChange(async (value: string) => {
                        this.customSort = value === 'usage' ? 'usage' : 'alphabetical';
                        this.customPage = 0;
                        this.renderCustomWordList(containerEl);
                    }));

        new Setting(containerEl)
            .setName('Words per page')
            .setDesc('Limit the number of custom words displayed at once.')
            .addSlider((slider: SliderComponent) =>
                slider.setLimits(10, 200, 10)
                    .setValue(this.plugin.settings.customDictPageSize)
                    .setDynamicTooltip()
                    .onChange(async (value: number) => {
                        await this.updateSetting('customDictPageSize', value, false);
                        this.customPage = 0;
                        this.renderCustomWordList(containerEl);
                    }));

        this.renderCustomWordList(containerEl);

        new Setting(containerEl)
            .setName('Statistics')
            .setDesc([
                `${this.plugin.settings.customDict.length} custom`,
                `${this.plugin.settings.dictFiles.reduce((count, file) => count + file.words.length, 0)} imported`,
                `${Object.values(this.plugin.settings.acceptedWordCounts).reduce((sum, count) => sum + count, 0)} accepted suggestions`
            ].join(' | '))
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Remove selected')
                    .setDisabled(this.selectedCustomWords.size === 0)
                    .onClick(async () => {
                        await this.plugin.removeCustomWords([...this.selectedCustomWords]);
                        this.selectedCustomWords.clear();
                        this.customPage = 0;
                        this.display();
                    }))
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Undo remove')
                    .setDisabled(!this.plugin.settings.lastRemovedWord)
                    .onClick(async () => {
                        await this.plugin.undoRemoveCustomWord();
                        this.display();
                    }))
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Reset')
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.clearCustomWords();
                        this.selectedCustomWords.clear();
                        this.customPage = 0;
                        this.display();
                    }));

        // IMPORT DICT
        new Setting(containerEl)
            .setName('Imported dictionaries')
            .setDesc('Import words from a one word per line Text File (.txt).')
            .addButton((b: ButtonComponent) => 
                b.setButtonText('Import')
                    .onClick(async () => {
                        await this.importDictionary();
                    }));

        if (this.plugin.settings.dictFiles.length > 0) {
            const importContainer = containerEl.createDiv({ cls: 'custom-word-scroll' }) as HTMLDivElement & {
                scrollTimeout?: number;
            };

            this.addDefaultScrollContainerBehavior(importContainer);

            this.plugin.settings.dictFiles.forEach((file: DictionaryFile, index: number) => {
                new Setting(importContainer)
                    .setDesc(`${file.filename} ~ ${file.words.length} word(s${file.sourcePath ? ` | ${file.sourcePath}` : ''})`)
                    .addButton((b: ButtonComponent) =>
                        b.setButtonText('Remove')
                            .setTooltip(`Remove "${file.filename}" and its words from imported dictionaries`)
                            .onClick(async () => {
                                await this.plugin.removeImportedDictFile(index);
                                this.display();
                            }));
            });
        };
    }

    private renderCustomWordList(containerEl: HTMLElement): void {
        containerEl.querySelector('.ta-custom-list')?.remove();

        const search = this.customSearch.trim().toLowerCase();
        const managedWords = new Set<string>([
            ...this.plugin.settings.customDict,
            ...this.plugin.settings.dictFiles.flatMap((file) => file.words)
        ]);
        let words = [...managedWords].filter((word) =>
            search.length === 0 || word.toLowerCase().includes(search)
        );

        words = words.sort((left, right) => {
            const leftPinned = this.plugin.settings.pinnedWords.includes(left);
            const rightPinned = this.plugin.settings.pinnedWords.includes(right);
            if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
            if (this.customSort === 'usage') {
                const leftCount = this.plugin.settings.acceptedWordCounts[left] ?? 0;
                const rightCount = this.plugin.settings.acceptedWordCounts[right] ?? 0;
                if (leftCount !== rightCount) return rightCount - leftCount;
            }
            return left.localeCompare(right);
        });

        const pageSize = this.plugin.settings.customDictPageSize;
        const pageCount = Math.max(1, Math.ceil(words.length / pageSize));
        this.customPage = Math.min(this.customPage, pageCount - 1);
        const pageWords = words.slice(this.customPage * pageSize, (this.customPage + 1) * pageSize);

        const list = containerEl.createDiv({ cls: 'ta-custom-list custom-word-scroll' });
        this.addDefaultScrollContainerBehavior(list);

        for (const word of pageWords) {
            const index = this.plugin.settings.customDict.indexOf(word);
            const importedFiles = this.plugin.settings.dictFiles
                .filter((file) => file.words.includes(word))
                .map((file) => file.filename);
            const isCustom = index !== -1;
            const isPinned = this.plugin.settings.pinnedWords.includes(word);
            const source = isCustom
                ? importedFiles.length > 0
                    ? `Custom + imported: ${importedFiles.join(', ')}`
                    : 'Custom'
                : `Imported: ${importedFiles.join(', ')}`;
            new Setting(list)
                .setName(word)
                .setDesc(`${source} | Suggestion accepts: ${this.plugin.settings.acceptedWordCounts[word] ?? 0}`)
                .addText((text: TextComponent) =>
                    text
                        .setValue(word)
                        .setPlaceholder('Edit word')
                        .setDisabled(!isCustom))
                .addButton((button: ButtonComponent) =>
                    button
                        .setButtonText('Save')
                        .setTooltip(`Rename "${word}"`)
                        .setDisabled(!isCustom)
                        .onClick(async () => {
                            const row = button.buttonEl.closest('.setting-item');
                            const input = row?.querySelector('input') as HTMLInputElement | null;
                            if (!input) return;
                            const result = await this.plugin.editCustomWord(index, input.value);
                            if (result === DUPLICATE_WORD) {
                                new Notice(`"${input.value.trim()}" is already in the custom dictionary.`);
                                return;
                            }
                            if (result.ok) this.display();
                            else new Notice('Enter a valid word.');
                        }))
                .addButton((button: ButtonComponent) =>
                    button
                        .setButtonText(this.selectedCustomWords.has(word) ? 'Unselect' : 'Select')
                        .setTooltip(`Select "${word}" for bulk removal`)
                        .setDisabled(!isCustom)
                        .onClick(() => {
                            if (this.selectedCustomWords.has(word)) {
                                this.selectedCustomWords.delete(word);
                            } else {
                                this.selectedCustomWords.add(word);
                            }
                            this.renderCustomWordList(containerEl);
                        }))
                .addButton((button: ButtonComponent) =>
                    button.setIcon('trash')
                        .setTooltip(`Remove "${word}"`)
                        .setDisabled(!isCustom)
                        .onClick(async () => {
                            await this.plugin.removeCustomWord(index);
                            this.selectedCustomWords.delete(word);
                            this.display();
                        }))
                .addButton((button: ButtonComponent) =>
                    button
                        .setButtonText(isPinned ? 'Unpin' : 'Pin')
                        .setTooltip(isPinned ? `Unpin "${word}"` : `Pin "${word}" at the top`)
                        .onClick(async () => {
                            await this.plugin.setWordPinned(word, !isPinned);
                            this.customPage = 0;
                            this.display();
                        }));
        }

        if (pageWords.length === 0) {
            list.createDiv({ cls: 'ta-empty-list', text: search ? 'No matching custom words.' : 'No custom words yet.' });
        }

        containerEl.querySelector('.ta-custom-pagination')?.remove();
        const pagination = containerEl.createDiv({ cls: 'ta-custom-pagination' });
        pagination.createEl('span', { text: `${words.length} matching word(s) - Page ${this.customPage + 1} of ${pageCount}` });
        const previous = pagination.createEl('button', { text: 'Previous', cls: 'mod-cta' });
        previous.disabled = this.customPage === 0;
        previous.addEventListener('click', () => {
            this.customPage -= 1;
            this.renderCustomWordList(containerEl);
        });
        const next = pagination.createEl('button', { text: 'Next', cls: 'mod-cta' });
        next.disabled = this.customPage >= pageCount - 1;
        next.addEventListener('click', () => {
            this.customPage += 1;
            this.renderCustomWordList(containerEl);
        });
    }

    private async exportCustomDictionary(): Promise<void> {
        const text = [...this.plugin.settings.customDict].sort((a, b) => a.localeCompare(b)).join('\n');
        if (!text) {
            new Notice('The custom dictionary is empty.');
            return;
        }

        const electron = require('electron') as {
            dialog?: {
                showSaveDialog(options: {
                    defaultPath: string;
                    filters: { name: string; extensions: string[] }[];
                }): Promise<{ canceled: boolean; filePath?: string }>;
            };
        };

        if (electron?.dialog) {
            const result = await electron.dialog.showSaveDialog({
                defaultPath: 'Custom_Dictionary.txt',
                filters: [{ name: 'Text files', extensions: ['txt'] }]
            });
            if (!result.canceled && result.filePath) {
                const fs = require('fs') as { writeFileSync(path: string, data: string): void };
                fs.writeFileSync(result.filePath, text);
                new Notice(`Exported ${this.plugin.settings.customDict.length} custom word(s).`);
            }
            return;
        }

        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Custom_Dictionary.txt';
        link.click();
        URL.revokeObjectURL(url);
        new Notice(`Exported ${this.plugin.settings.customDict.length} custom word(s).`);
    }

    private async updateSetting<K extends keyof TASettings>(
        key: K, 
        val: TASettings[K], 
        destroyUI: boolean
    ): Promise<void> {
        this.plugin.settings[key] = val;
        if (destroyUI) destroyTAUI();
        await this.plugin.saveSettings();
    }

    private addDefaultScrollContainerBehavior(container: HTMLDivElement & { scrollTimeout?: number }): void {
        container.addEventListener('scroll', () => {
            container.classList.add('show');
            window.clearTimeout(container.scrollTimeout);
            container.scrollTimeout = window.setTimeout(() => {
                container.classList.remove('show');
            }, 1000);
        });
    }

    private async importDictionary(): Promise<void> {
        const electron = require('electron') as {
            dialog?: {
                showOpenDialog(options: {
                    properties: string[];
                    filters: { name: string; extensions: string[] }[];
                }): Promise<{ canceled: boolean; filePaths: string[] }>;
            };
            remote?: {
                dialog?: {
                    showOpenDialog(options: {
                        properties: string[];
                        filters: { name: string; extensions: string[] }[];
                    }): Promise<{ canceled: boolean; filePaths: string[] }>;
                };
            };
        };
        const dialog = electron?.dialog ?? electron?.remote?.dialog;

        if (dialog) {
            try {
                const result = await dialog.showOpenDialog({
                    properties: ['openFile'],
                    filters: [{ name: 'Text files', extensions: ['txt'] }]
                });

                if (result.canceled || result.filePaths.length === 0) return;

                const fs = require('fs') as {
                    readFileSync(path: string, encoding: BufferEncoding): string;
                };
                const path = require('path') as {
                    basename(path: string): string;
                };
                const filePath = result.filePaths[0];
                const file = new File(
                    [fs.readFileSync(filePath, 'utf8')],
                    path.basename(filePath),
                    { type: 'text/plain' }
                );

                await this.processImportedFile(file, filePath);
            } catch (error) {
                console.error('Text Autocomplete: failed to open or read dictionary file.', error);
                new Notice('Failed to open or read the dictionary file.');
            }
            return;
        }

        const input: HTMLInputElement = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt';
        input.style.display = 'none';

        document.body.appendChild(input);

        input.onchange = async () => {
            const file: File | undefined = input.files?.[0];
            if (file) await this.processImportedFile(file);
            input.remove();
        };
        input.addEventListener('cancel', () => input.remove());

        input.click();
    }

    private async processImportedFile(file: File, sourcePath?: string): Promise<void> {
        try {
            const res: { result: Result, wordCount?: number } =
                await this.plugin.importDictFile(file, sourcePath);

            if (!res.result.ok) {
                if (res.result === DUPLICATE_FILE) {
                    new Notice(`"${file.name}" has already been imported.`);
                } else if (res.result === EMPTY_FILE) {
                    new Notice('No words found in file.');
                } else {
                    new Notice('Failed to import dictionary file.');
                }
                return;
            }

            new Notice(`Imported ${res.wordCount} word(s) from "${file.name}".`);
            this.display();
        } catch (error) {
            console.error('Text Autocomplete: failed to import dictionary file.', error);
            new Notice('Failed to import dictionary file.');
        }
    }
}
