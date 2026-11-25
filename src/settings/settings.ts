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
    punctuationAutocomplete: boolean;
    punctuationQuotes: boolean;
    punctuationApostrophes: boolean;
    punctuationSquareBrackets: boolean;
    punctuationBraces: boolean;
    punctuationParentheses: boolean;
    learnFromTyping: boolean;
    learnedWordChime: boolean;
    updateImportedDictionary: boolean;
    autoReloadImportedDictionaries: boolean;
    learningThreshold: number;
    ignoredWordRecoveryThreshold: number;
    ignoredWordRecoveryCounts: Record<string, number>;
    experimentalReplacementDetection: boolean;
    replacementSimilarityThreshold: number;
    contextRankingEnabled: boolean;
    contextWordCounts: Record<string, Record<string, number>>;
    deletedWordCount: number;
    ignoredWordCount: number;
    newlyLearnedWordCount: number;
    firstUsedAt: string | null;
    learnedWordCounts: Record<string, number>;
    typedWordCounts: Record<string, number>;
    lastLearnedWord: string | null;
    learnedWordHistory: string[];
    ignoredWords: string[];
    acceptedWordCounts: Record<string, number>;
    acceptedActivity: Record<string, number>;
    acceptedWordLengths: Record<'short' | 'medium' | 'long', number>;
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
    punctuationAutocomplete: false,
    punctuationQuotes: true,
    punctuationApostrophes: true,
    punctuationSquareBrackets: true,
    punctuationBraces: true,
    punctuationParentheses: true,
    learnFromTyping: true,
    learnedWordChime: false,
    updateImportedDictionary: true,
    autoReloadImportedDictionaries: true,
    learningThreshold: 3,
    ignoredWordRecoveryThreshold: 4,
    ignoredWordRecoveryCounts: {},
    experimentalReplacementDetection: false,
    replacementSimilarityThreshold: 55,
    contextRankingEnabled: true,
    contextWordCounts: {},
    deletedWordCount: 0,
    ignoredWordCount: 0,
    newlyLearnedWordCount: 0,
    firstUsedAt: null,
    learnedWordCounts: {},
    typedWordCounts: {},
    lastLearnedWord: null,
    learnedWordHistory: [],
    ignoredWords: [],
    acceptedWordCounts: {},
    acceptedActivity: {},
    acceptedWordLengths: { short: 0, medium: 0, long: 0 },
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
    private ignoredPage: number = 0;
    private ignoredSearch: string = '';
    private selectedCustomWords: Set<string> = new Set();
    private savedScrollTop: number | null = null;
    private scoreSearch: string = '';
    private scorePage: number = 0;

    constructor(app: App, plugin: TAPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private createSettingsSection(
        containerEl: HTMLElement,
        title: string,
        description: string
    ): HTMLElement {
        const section = containerEl.createDiv({ cls: 'ta-settings-section' });
        const heading = section.createDiv({ cls: 'ta-settings-section-heading' });
        heading.createEl('span', { cls: 'ta-settings-section-rule', text: '' });
        heading.createEl('h3', { text: title });
        heading.createEl('span', { cls: 'ta-settings-section-rule', text: '' });
        section.createDiv({
            cls: 'ta-settings-section-description',
            text: description
        });
        return section.createDiv({ cls: 'ta-settings-section-content' });
    }

    private preserveScrollAndDisplay(): void {
        const scrollContainer =
            this.containerEl.closest('.vertical-tab-content') ??
            this.containerEl.closest('.modal') ??
            this.containerEl;
        this.savedScrollTop = scrollContainer.scrollTop;
        this.display();
    }


    display(): void {
        const existingScrollTop =
            this.savedScrollTop ??
            this.containerEl.querySelector('.vertical-tab-content')?.scrollTop ??
            this.containerEl.closest('.vertical-tab-content')?.scrollTop ??
            this.containerEl.closest('.modal')?.scrollTop ??
            this.containerEl.scrollTop ??
            0;

        const containerEl: HTMLElement = this.containerEl;
        containerEl.empty();
        const titleBanner = containerEl.createDiv({ cls: 'ta-settings-title-banner' });
        titleBanner.createEl('span', { cls: 'ta-settings-title-rule', text: '' });
        const titleBlock = titleBanner.createDiv({ cls: 'ta-settings-title-block' });
        titleBlock.createEl('h2', { text: 'Text Autocomplete' });
        titleBlock.createDiv({
            cls: 'ta-settings-title-description',
            text: 'Smart suggestions, dictionaries, learning, and usage statistics.'
        });
        titleBanner.createEl('span', { cls: 'ta-settings-title-rule', text: '' });
        let sectionContent = this.createSettingsSection(
            containerEl,
            'General',
            'Core enablement and language preferences.'
        );

        // AUTOCOMPLETE
        new Setting(sectionContent)
            .setName('Autocomplete')
            .setDesc('Enable/disable the autocomplete feature.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.enabled)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('enabled', val, !val);
                    }));

        // LANGUAGE
        new Setting(sectionContent)
            .setName('Language')
            .setDesc('Specify text language support (only English is supported at the moment).')
            .addDropdown((dropdown: DropdownComponent) =>
                dropdown.addOption('English', 'English')
                    .setValue(this.plugin.settings.language)
                    .onChange(async (val: string) => {
                        await this.updateSetting('language', val, true);
                    }));

        sectionContent = this.createSettingsSection(
            containerEl,
            'Suggestions',
            'Control visible suggestions, acceptance keys, and formatting.'
        );

        // MAX SUGGESTIONS
        new Setting(sectionContent)
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
        new Setting(sectionContent)
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

        new Setting(sectionContent)
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
        new Setting(sectionContent)
            .setName('Space terminator after autocomplete')
            .setDesc('Enable/disable adding space terminator to autocompleted words.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.addSpace)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('addSpace', val, false);
                    }));

        // CASE SENSITIVE
        new Setting(sectionContent)
            .setName('Case sensitive suggestions')
            .setDesc('Enable/disable case sensitivity for word suggestions.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.caseSensitive)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('caseSensitive', val, true);
                    }));

        sectionContent = this.createSettingsSection(
            containerEl,
            'Punctuation',
            'Choose where autocomplete can appear inside formatted text.'
        );

        new Setting(sectionContent)
            .setName('Autocomplete inside punctuation')
            .setDesc('Allow suggestions between supported quotes, brackets, braces, and parentheses.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.punctuationAutocomplete)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('punctuationAutocomplete', val, true);
                    }));

        new Setting(sectionContent)
            .setName('Allow inside quotation marks')
            .setDesc('Enable suggestions between "double" or \'single\' quotation marks.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.punctuationQuotes)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('punctuationQuotes', val, true);
                    }));

        new Setting(sectionContent)
            .setName('Allow inside apostrophes')
            .setDesc('Enable suggestions after and between apostrophes.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.punctuationApostrophes)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('punctuationApostrophes', val, true);
                    }));

        new Setting(sectionContent)
            .setName('Allow inside square brackets')
            .setDesc('Enable suggestions between [square brackets].')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.punctuationSquareBrackets)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('punctuationSquareBrackets', val, true);
                    }));

        new Setting(sectionContent)
            .setName('Allow inside braces')
            .setDesc('Enable suggestions between {curly braces}.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.punctuationBraces)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('punctuationBraces', val, true);
                    }));

        new Setting(sectionContent)
            .setName('Allow inside parentheses')
            .setDesc('Enable suggestions between (round brackets).')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.punctuationParentheses)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('punctuationParentheses', val, true);
                    }));

        sectionContent = this.createSettingsSection(
            containerEl,
            'Learning',
            'Configure automatic learning, recovery, and audio feedback.'
        );

        new Setting(sectionContent)
            .setName('Learn from typing')
            .setDesc('Automatically add frequently typed words to the custom dictionary.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.learnFromTyping)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('learnFromTyping', val, false);
                    }));

        new Setting(sectionContent)
            .setName('Learned-word chime')
            .setDesc('Play a quiet chime when a new word is learned.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.learnedWordChime)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('learnedWordChime', val, false);
                    }))
            .addButton((button: ButtonComponent) =>
                button
                    .setButtonText('Test')
                    .setTooltip('Play the learned-word chime')
                    .onClick(async () => {
                        await this.plugin.unlockLearnedWordChime();
                        await this.plugin.testLearnedWordChime();
                    }));

        new Setting(sectionContent)
            .setName('Learning threshold')
            .setDesc('Number of times a word must be typed before it is learned.')
            .addSlider((slider: SliderComponent) =>
                slider.setLimits(2, 10, 1)
                    .setValue(this.plugin.settings.learningThreshold)
                    .setDynamicTooltip()
                    .onChange(async (val: number) => {
                        await this.updateSetting('learningThreshold', val, false);
                    }));

        new Setting(sectionContent)
            .setName('Context ranking')
            .setDesc('Rank suggestions using nearby words and the current note context.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.contextRankingEnabled)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('contextRankingEnabled', val, false);
                    }));

        new Setting(sectionContent)
            .setName('Ignored-word recovery threshold')
            .setDesc('Add an ignored word after this many correct completions. Any deletion resets its count.')
            .addSlider((slider: SliderComponent) =>
                slider.setLimits(2, 20, 1)
                    .setValue(this.plugin.settings.ignoredWordRecoveryThreshold)
                    .setDynamicTooltip()
                    .onChange(async (val: number) => {
                        await this.updateSetting('ignoredWordRecoveryThreshold', val, false);
                    }));

        new Setting(sectionContent)
            .setName('Experimental replacement detection')
            .setDesc('Try to distinguish replacements and synonyms from accidental deleted words.')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.experimentalReplacementDetection)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('experimentalReplacementDetection', val, false);
                    }));

        new Setting(sectionContent)
            .setName('Replacement similarity threshold')
            .setDesc('Higher values identify fewer replacement words. Used only with experimental detection.')
            .addSlider((slider: SliderComponent) =>
                slider.setLimits(20, 90, 5)
                    .setValue(this.plugin.settings.replacementSimilarityThreshold)
                    .setDynamicTooltip()
                    .onChange(async (val: number) => {
                        await this.updateSetting('replacementSimilarityThreshold', val, false);
                    }));

        new Setting(sectionContent)
            .setName('Ignored words')
            .setDesc('Words that should not be learned automatically.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Search ignored words');
                text.setValue(this.ignoredSearch);
                text.inputEl.addEventListener('input', () => {
                    this.ignoredSearch = text.getValue();
                    this.ignoredPage = 0;
                    this.renderIgnoredWordList(sectionContent);
                });
            });

        new Setting(sectionContent)
            .setName('Add ignored word')
            .setDesc('Manually prevent a word from being learned.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Add word to ignore');
                text.inputEl.addEventListener('keydown', async (event: KeyboardEvent) => {
                    if (event.key !== 'Enter') return;
                    await this.plugin.addIgnoredWord(text.getValue());
                    text.setValue('');
                    this.display();
                });
            });

        new Setting(sectionContent)
            .setName('Reset ignored words')
            .setDesc('Allow all ignored words to be learned normally.')
            .addButton((button: ButtonComponent) =>
                button
                    .setButtonText('Reset')
                    .setWarning()
                    .setTooltip('Allow all ignored words to be learned normally')
                    .onClick(async () => {
                        await this.plugin.clearIgnoredWords();
                        this.ignoredPage = 0;
                        this.ignoredSearch = '';
                        this.display();
                    }));

        this.renderIgnoredWordList(sectionContent);

        sectionContent = this.createSettingsSection(
            containerEl,
            'Imported dictionaries',
            'Manage external .txt and .md dictionaries and synchronization.'
        );

        new Setting(sectionContent)
            .setName('Update imported dictionary')
            .setDesc('Append learned words to the source Text File (.txt).')
            .addToggle((toggle: ToggleComponent) =>
                toggle.setValue(this.plugin.settings.updateImportedDictionary)
                    .onChange(async (val: boolean) => {
                        await this.updateSetting('updateImportedDictionary', val, false);
                    }));

        new Setting(sectionContent)
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
        sectionContent = this.createSettingsSection(
            containerEl,
            'Custom dictionary',
            'Search, edit, pin, export, and manage custom entries.'
        );
        new Setting(sectionContent)
            .setName('Custom dictionary')
            .setDesc(`Manage ${this.plugin.settings.customDict.length} custom word(s).`)
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Export')
                    .setTooltip('Export custom words as a Text File')
                    .onClick(async () => this.exportCustomDictionary()));

        new Setting(sectionContent)
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

        new Setting(sectionContent)
            .setName('Dictionary controls')
            .setDesc('Search and sort custom words.')
            .addText((text: TextComponent) => {
                text.setPlaceholder('Search custom words');
                text.setValue(this.customSearch);
                text.inputEl.addEventListener('input', () => {
                    this.customSearch = text.getValue();
                    this.customPage = 0;
                    this.renderCustomWordList(sectionContent);
                });
            })
            .addDropdown((dropdown: DropdownComponent) =>
                dropdown.addOption('alphabetical', 'Alphabetical')
                    .addOption('usage', 'Most accepted')
                    .setValue(this.customSort)
                    .onChange(async (value: string) => {
                        this.customSort = value === 'usage' ? 'usage' : 'alphabetical';
                        this.customPage = 0;
                        this.renderCustomWordList(sectionContent);
                    }));

        new Setting(sectionContent)
            .setName('Words per page')
            .setDesc('Limit the number of custom words displayed at once.')
            .addSlider((slider: SliderComponent) =>
                slider.setLimits(10, 200, 10)
                    .setValue(this.plugin.settings.customDictPageSize)
                    .setDynamicTooltip()
                    .onChange(async (value: number) => {
                        await this.updateSetting('customDictPageSize', value, false);
                        this.customPage = 0;
                        this.renderCustomWordList(sectionContent);
                    }));

        this.renderCustomWordList(sectionContent);
        this.renderStatisticsDashboard(sectionContent);

        new Setting(sectionContent)
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
                        this.preserveScrollAndDisplay();
                    }))
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Undo remove')
                    .setDisabled(!this.plugin.settings.lastRemovedWord)
                    .onClick(async () => {
                        await this.plugin.undoRemoveCustomWord();
                        this.preserveScrollAndDisplay();
                    }))
            .addButton((button: ButtonComponent) =>
                button.setButtonText('Reset')
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.clearCustomWords();
                        this.selectedCustomWords.clear();
                        this.customPage = 0;
                        this.preserveScrollAndDisplay();
                    }));

        // IMPORT DICT
        new Setting(sectionContent)
            .setName('Imported dictionaries')
            .setDesc('Import words or phrases from Text or Markdown files (.txt, .md), one entry per line.')
            .addButton((b: ButtonComponent) => 
                b.setButtonText('Import')
                    .onClick(async () => {
                        await this.importDictionary();
                    }));

        if (this.plugin.settings.dictFiles.length > 0) {
            const importContainer = sectionContent.createDiv({ cls: 'custom-word-scroll' }) as HTMLDivElement & {
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
                                this.preserveScrollAndDisplay();
                            }));
            });
        };

        requestAnimationFrame(() => {
            const scrollContainer =
                containerEl.closest('.vertical-tab-content') ??
                containerEl.closest('.modal') ??
                containerEl;
            scrollContainer.scrollTop = existingScrollTop;
            this.savedScrollTop = null;
        });
    }

    private renderStatisticsDashboard(containerEl: HTMLElement): void {
        containerEl.querySelector('.ta-statistics-dashboard')?.remove();

        const acceptedTotal = Object.values(this.plugin.settings.acceptedWordCounts)
            .reduce((sum, count) => sum + count, 0);
        const importedTotal = this.plugin.settings.dictFiles
            .reduce((sum, file) => sum + file.words.length, 0);
        const ignoredTotal = this.plugin.settings.ignoredWords.length;
        const learnedTotal = this.plugin.settings.newlyLearnedWordCount;
        const deletedTotal = this.plugin.settings.deletedWordCount;

        const wrapper = containerEl.createDiv({ cls: 'ta-statistics-dashboard' });

        const heading = wrapper.createDiv({ cls: 'ta-statistics-heading' });
        heading.createEl('span', { cls: 'ta-statistics-heading-rule', text: '' });
        heading.createEl('h3', { text: 'Text Autocomplete Statistics' });
        heading.createEl('span', { cls: 'ta-statistics-heading-rule', text: '' });
        const resetRow = wrapper.createDiv({ cls: 'ta-statistics-reset-row' });
        const resetButton = resetRow.createEl('button', {
            text: 'Reset counters',
            cls: 'mod-warning'
        });
        resetButton.addEventListener('click', async () => {
            await this.plugin.resetStatistics();
            this.preserveScrollAndDisplay();
        });

        const firstUsedAt = this.plugin.settings.firstUsedAt;
        if (firstUsedAt) {
            const firstUsedDate = new Date(firstUsedAt);
            if (!Number.isNaN(firstUsedDate.getTime())) {
                const elapsedMilliseconds = Math.max(0, Date.now() - firstUsedDate.getTime());
                const elapsedDays = Math.floor(elapsedMilliseconds / (24 * 60 * 60 * 1000));
                const elapsedHours = Math.floor(
                    (elapsedMilliseconds % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)
                );
                const usageDuration =
                    elapsedDays > 0
                        ? `${elapsedDays} day${elapsedDays === 1 ? '' : 's'}, ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'}`
                        : `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'}`;
                const day = String(firstUsedDate.getDate()).padStart(2, '0');
                const month = String(firstUsedDate.getMonth() + 1).padStart(2, '0');
                const year = firstUsedDate.getFullYear();
                const hours = String(firstUsedDate.getHours()).padStart(2, '0');
                const minutes = String(firstUsedDate.getMinutes()).padStart(2, '0');
                const exactDate = `${day}/${month}/${year}, ${hours}:${minutes}`;

                const usageStart = wrapper.createDiv({ cls: 'ta-statistics-usage-start' });
                usageStart.createEl('strong', { text: 'Using Text Autocomplete since ' });
                usageStart.createSpan({ text: `${exactDate} (${usageDuration})` });
            }
        }

        const cards = wrapper.createDiv({ cls: 'ta-statistics-cards' });
        const addCard = (label: string, value: number, tone: string) => {
            const card = cards.createDiv({ cls: `ta-statistics-card ${tone}` });
            card.createDiv({ cls: 'ta-statistics-card-value', text: String(value) });
            card.createDiv({ cls: 'ta-statistics-card-label', text: label });
        };

        addCard('Accepted suggestions', acceptedTotal, 'tone-accepted');
        addCard('Learned words', learnedTotal, 'tone-learned');
        addCard('Ignored words', ignoredTotal, 'tone-ignored');
        addCard('Deleted words', deletedTotal, 'tone-deleted');

        const summary = wrapper.createDiv({ cls: 'ta-statistics-summary' });
        summary.createDiv({
            cls: 'ta-statistics-summary-item',
            text: `Custom: ${this.plugin.settings.customDict.length}`
        });
        summary.createDiv({
            cls: 'ta-statistics-summary-item',
            text: `Imported: ${importedTotal}`
        });
        summary.createDiv({
            cls: 'ta-statistics-summary-item',
            text: `Pinned: ${this.plugin.settings.pinnedWords.length}`
        });

        const chart = wrapper.createDiv({ cls: 'ta-statistics-chart' });
        chart.createEl('h4', { text: 'Most accepted words' });

        const topWords = Object.entries(this.plugin.settings.acceptedWordCounts)
            .sort(([, left], [, right]) => right - left);

        if (topWords.length === 0) {
            chart.createDiv({
                cls: 'ta-statistics-empty',
                text: 'No suggestions accepted yet.'
            });
        } else {
            const acceptedPageSize = 25;
            const acceptedPageCount = Math.max(1, Math.ceil(topWords.length / acceptedPageSize));
            let acceptedPage = 0;
            const renderAcceptedWords = () => {
                chart.querySelector('.ta-statistics-accepted-list')?.remove();
                chart.querySelector('.ta-statistics-accepted-pagination')?.remove();
                const list = chart.createDiv({ cls: 'ta-statistics-accepted-list' });
                const maxCount = Math.max(
                    ...topWords
                        .slice(acceptedPage * acceptedPageSize, (acceptedPage + 1) * acceptedPageSize)
                        .map(([, count]) => count),
                    1
                );
                for (const [word, count] of topWords.slice(
                    acceptedPage * acceptedPageSize,
                    (acceptedPage + 1) * acceptedPageSize
                )) {
                    const row = list.createDiv({ cls: 'ta-statistics-bar-row' });
                    row.createDiv({ cls: 'ta-statistics-bar-label', text: word });
                    const track = row.createDiv({ cls: 'ta-statistics-bar-track' });
                    const fill = track.createDiv({ cls: 'ta-statistics-bar-fill' });
                    fill.style.width = `${Math.max(6, (count / maxCount) * 100)}%`;
                    row.createDiv({ cls: 'ta-statistics-bar-count', text: String(count) });
                }

                const pagination = chart.createDiv({ cls: 'ta-statistics-accepted-pagination' });
                const previous = pagination.createEl('button', { text: 'Previous' });
                previous.disabled = acceptedPage === 0;
                previous.addEventListener('click', () => {
                    acceptedPage -= 1;
                    renderAcceptedWords();
                });
                pagination.createSpan({
                    text: `Page ${acceptedPage + 1} of ${acceptedPageCount}`
                });
                const next = pagination.createEl('button', { text: 'Next' });
                next.disabled = acceptedPage >= acceptedPageCount - 1;
                next.addEventListener('click', () => {
                    acceptedPage += 1;
                    renderAcceptedWords();
                });
            };
            renderAcceptedWords();
        }

        const heatmap = wrapper.createDiv({ cls: 'ta-statistics-heatmap' });
        heatmap.createEl('h4', { text: 'Acceptance activity' });

        const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const activityMax = Math.max(
            1,
            ...Object.values(this.plugin.settings.acceptedActivity)
        );
        const heatmapGrid = heatmap.createDiv({ cls: 'ta-statistics-heatmap-grid' });

        heatmapGrid.createDiv({ cls: 'ta-statistics-heatmap-hour-label', text: '' });
        for (let hour = 0; hour < 24; hour += 3) {
            heatmapGrid.createDiv({
                cls: 'ta-statistics-heatmap-hour-label',
                text: String(hour).padStart(2, '0')
            });
        }

        for (let day = 0; day < 7; day++) {
            heatmapGrid.createDiv({
                cls: 'ta-statistics-heatmap-day-label',
                text: weekdayLabels[day]
            });
            for (let hour = 0; hour < 24; hour += 3) {
                let count = 0;
                for (let hourOffset = 0; hourOffset < 3; hourOffset++) {
                    count += this.plugin.settings.acceptedActivity[`${day}-${hour + hourOffset}`] ?? 0;
                }
                const level = count === 0
                    ? 0
                    : Math.max(1, Math.ceil((count / activityMax) * 4));
                const cell = heatmapGrid.createDiv({
                    cls: `ta-statistics-heatmap-cell ta-statistics-heatmap-level-${level}`,
                    title: `${weekdayLabels[day]} ${hour}:00-${hour + 2}:59: ${count} acceptance(s)`
                });
                cell.setAttribute('aria-label', `${weekdayLabels[day]} ${hour}:00: ${count} acceptance(s)`);
            }
        }

        const lengthDistribution = wrapper.createDiv({ cls: 'ta-statistics-length' });
        lengthDistribution.createEl('h4', { text: 'Accepted word length' });
        const lengths = this.plugin.settings.acceptedWordLengths;
        const lengthTotal =
            lengths.short + lengths.medium + lengths.long;
        const lengthData = [
            { label: 'Short · 1–4', value: lengths.short, className: 'short' },
            { label: 'Medium · 5–8', value: lengths.medium, className: 'medium' },
            { label: 'Long · 9+', value: lengths.long, className: 'long' }
        ];

        if (lengthTotal === 0) {
            lengthDistribution.createDiv({
                cls: 'ta-statistics-empty',
                text: 'No accepted-word length data yet.'
            });
        } else {
            for (const item of lengthData) {
                const row = lengthDistribution.createDiv({ cls: 'ta-statistics-length-row' });
                row.createDiv({ cls: 'ta-statistics-length-label', text: item.label });
                const track = row.createDiv({ cls: 'ta-statistics-length-track' });
                const fill = track.createDiv({
                    cls: `ta-statistics-length-fill ${item.className}`
                });
                const percentage = (item.value / lengthTotal) * 100;
                fill.style.width = `${Math.max(item.value > 0 ? 4 : 0, percentage)}%`;
                row.createDiv({
                    cls: 'ta-statistics-length-count',
                    text: `${item.value} (${Math.round(percentage)}%)`
                });
            }
        }

        const learnedHistory = this.plugin.settings.learnedWordHistory.slice(0, 8);
        const history = wrapper.createDiv({ cls: 'ta-statistics-history' });
        history.createEl('h4', { text: 'Recently learned' });
        if (learnedHistory.length === 0) {
            history.createDiv({
                cls: 'ta-statistics-empty',
                text: 'No learned words recorded.'
            });
        } else {
            for (const word of learnedHistory) {
                history.createDiv({ cls: 'ta-statistics-history-item', text: word });
            }
        }

        this.renderWordPriorityPanel(wrapper);
    }

    private updateWordPriorityRows(
        panel: HTMLElement,
        searchText: string
    ): void {
        panel.querySelector('.ta-word-priority-list')?.remove();
        panel.querySelector('.ta-word-priority-pagination')?.remove();

        let ranked = Object.entries(this.plugin.settings.wordScores)
            .filter(([word]) =>
                searchText.length === 0 || word.toLowerCase().includes(searchText)
            )
            .map(([word, score]) => ({ word, score: score ?? 0 }))
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return left.word.localeCompare(right.word);
            });

        const pageSize = 50;
        const pageCount = Math.max(1, Math.ceil(ranked.length / pageSize));
        this.scorePage = Math.min(this.scorePage, pageCount - 1);
        ranked = ranked.slice(this.scorePage * pageSize, (this.scorePage + 1) * pageSize);
        const maxScore = Math.max(1, ...ranked.map((entry) => entry.score));

        const list = panel.createDiv({ cls: 'ta-word-priority-list' });
        if (ranked.length === 0) {
            list.createDiv({
                cls: 'ta-statistics-empty',
                text: searchText ? 'No matching ranked words.' : 'No word scores available.'
            });
        } else {
            ranked.forEach((entry, index) => {
                const isPinned = this.plugin.settings.pinnedWords.includes(entry.word);
                const isCustom = this.plugin.settings.customDict.includes(entry.word);
                const isImported = this.plugin.settings.dictFiles.some((file) =>
                    file.words.includes(entry.word)
                );
                const source = isPinned ? 'Pinned' : isCustom ? 'Custom' : isImported ? 'Imported' : 'Built-in';
                const row = list.createDiv({ cls: 'ta-word-priority-row' });
                row.createDiv({
                    cls: 'ta-word-priority-rank',
                    text: String(this.scorePage * pageSize + index + 1)
                });
                const wordColumn = row.createDiv({ cls: 'ta-word-priority-word-column' });
                wordColumn.createDiv({ cls: 'ta-word-priority-word', text: entry.word });
                wordColumn.createDiv({ cls: 'ta-word-priority-source', text: source });
                const track = row.createDiv({ cls: 'ta-word-priority-track' });
                const fill = track.createDiv({ cls: 'ta-word-priority-fill' });
                fill.style.width = `${Math.max(entry.score > 0 ? 3 : 0, (entry.score / maxScore) * 100)}%`;
                row.createDiv({
                    cls: 'ta-word-priority-score',
                    text: String(entry.score)
                });
            });
        }

        const pagination = panel.createDiv({ cls: 'ta-word-priority-pagination' });
        const previous = pagination.createEl('button', { text: 'Previous' });
        previous.disabled = this.scorePage === 0;
        previous.addEventListener('click', () => {
            this.scorePage -= 1;
            this.updateWordPriorityRows(panel, this.scoreSearch.trim().toLowerCase());
        });
        pagination.createSpan({ text: `Page ${this.scorePage + 1} of ${pageCount}` });
        const next = pagination.createEl('button', { text: 'Next' });
        next.disabled = this.scorePage >= pageCount - 1;
        next.addEventListener('click', () => {
            this.scorePage += 1;
            this.updateWordPriorityRows(panel, this.scoreSearch.trim().toLowerCase());
        });
    }

    private renderWordPriorityPanel(containerEl: HTMLElement): void {
        containerEl.querySelector('.ta-word-priority')?.remove();

        const panel = containerEl.createDiv({ cls: 'ta-word-priority' });
        const heading = panel.createDiv({ cls: 'ta-word-priority-heading' });
        heading.createEl('h4', { text: 'Word priority ranking' });
        panel.createEl('p', {
            cls: 'ta-word-priority-description',
            text: 'Progress bar: relative score compared with words on this page. Number: exact priority score used to rank suggestions.'
        });

        const controls = panel.createDiv({ cls: 'ta-word-priority-controls' });
        const search = controls.createEl('input', {
            type: 'text',
            cls: 'ta-word-priority-search',
            attr: { placeholder: 'Search ranked words' }
        });
        search.value = this.scoreSearch;
        search.addEventListener('input', () => {
            this.scoreSearch = search.value;
            this.scorePage = 0;
            const selectionStart = search.selectionStart;
            const selectionEnd = search.selectionEnd;
            this.updateWordPriorityRows(panel, search.value.trim().toLowerCase());
            search.focus();
            if (selectionStart !== null && selectionEnd !== null) {
                search.setSelectionRange(selectionStart, selectionEnd);
            }
        });

        const searchText = this.scoreSearch.trim().toLowerCase();
        let ranked = Object.entries(this.plugin.settings.wordScores)
            .filter(([word]) =>
                searchText.length === 0 || word.toLowerCase().includes(searchText)
            )
            .map(([word, score]) => ({ word, score: score ?? 0 }))
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return left.word.localeCompare(right.word);
            });

        const pageSize = 50;
        const pageCount = Math.max(1, Math.ceil(ranked.length / pageSize));
        this.scorePage = Math.min(this.scorePage, pageCount - 1);
        ranked = ranked.slice(this.scorePage * pageSize, (this.scorePage + 1) * pageSize);

        const maxScore = Math.max(
            1,
            ...ranked.map((entry) => entry.score)
        );

        const list = panel.createDiv({ cls: 'ta-word-priority-list' });
        if (ranked.length === 0) {
            list.createDiv({
                cls: 'ta-statistics-empty',
                text: searchText ? 'No matching ranked words.' : 'No word scores available.'
            });
        } else {
            ranked.forEach((entry, index) => {
                const isPinned = this.plugin.settings.pinnedWords.includes(entry.word);
                const isCustom = this.plugin.settings.customDict.includes(entry.word);
                const isImported = this.plugin.settings.dictFiles.some((file) =>
                    file.words.includes(entry.word)
                );
                const source = isPinned
                    ? 'Pinned'
                    : isCustom
                        ? 'Custom'
                        : isImported
                            ? 'Imported'
                            : 'Built-in';

                const row = list.createDiv({ cls: 'ta-word-priority-row' });
                row.createDiv({
                    cls: 'ta-word-priority-rank',
                    text: String(this.scorePage * pageSize + index + 1)
                });
                const wordColumn = row.createDiv({ cls: 'ta-word-priority-word-column' });
                wordColumn.createDiv({ cls: 'ta-word-priority-word', text: entry.word });
                wordColumn.createDiv({ cls: 'ta-word-priority-source', text: source });

                const track = row.createDiv({ cls: 'ta-word-priority-track' });
                const fill = track.createDiv({ cls: 'ta-word-priority-fill' });
                fill.style.width = `${Math.max(
                    entry.score > 0 ? 3 : 0,
                    (entry.score / maxScore) * 100
                )}%`;

                row.createDiv({
                    cls: 'ta-word-priority-score',
                    text: String(entry.score)
                });
            });
        }

        const pagination = panel.createDiv({ cls: 'ta-word-priority-pagination' });
        const previous = pagination.createEl('button', { text: 'Previous' });
        previous.disabled = this.scorePage === 0;
        previous.addEventListener('click', () => {
            this.scorePage -= 1;
            this.renderWordPriorityPanel(containerEl);
        });
        pagination.createSpan({
            text: `Page ${this.scorePage + 1} of ${pageCount}`
        });
        const next = pagination.createEl('button', { text: 'Next' });
        next.disabled = this.scorePage >= pageCount - 1;
        next.addEventListener('click', () => {
            this.scorePage += 1;
            this.renderWordPriorityPanel(containerEl);
        });
    }

    private renderIgnoredWordList(containerEl: HTMLElement): void {
        containerEl.querySelector('.ta-ignored-list')?.remove();

        const search = this.ignoredSearch.trim().toLowerCase();
        const words = [...this.plugin.settings.ignoredWords]
            .filter((word) => search.length === 0 || word.toLowerCase().includes(search))
            .filter((word) => /^[A-Za-z][A-Za-z'-]{1,40}$/.test(word))
            .sort((a, b) => a.localeCompare(b));
        if (words.length === 0) return;

        const pageSize = this.plugin.settings.customDictPageSize;
        const pageCount = Math.max(1, Math.ceil(words.length / pageSize));
        this.ignoredPage = Math.min(this.ignoredPage, pageCount - 1);
        const pageWords = words.slice(this.ignoredPage * pageSize, (this.ignoredPage + 1) * pageSize);

        let host = containerEl.querySelector('.ta-ignored-pager') as HTMLElement | null;
        if (!host) {
            host = containerEl.createDiv({ cls: 'ta-ignored-pager' });
        }

        const list = host.createDiv({ cls: 'ta-ignored-list' });
        this.addDefaultScrollContainerBehavior(list);
        const existingIgnoredPagination =
            host.querySelector('.ta-ignored-pagination') as HTMLElement | null;
        if (existingIgnoredPagination) {
            host.insertBefore(list, existingIgnoredPagination);
        }

        for (const word of pageWords) {
            const recoveryCount = this.plugin.settings.ignoredWordRecoveryCounts[word] ?? 0;
            new Setting(list)
                .setName(word)
                .setDesc(`Ignored: ${recoveryCount}/${this.plugin.settings.ignoredWordRecoveryThreshold} intentional completions`)
                .addButton((button: ButtonComponent) =>
                    button
                        .setButtonText('Allow learning')
                        .setTooltip(`Stop ignoring "${word}"`)
                        .onClick(async () => {
                            await this.plugin.removeIgnoredWord(word);
                            this.ignoredPage = 0;
                            this.preserveScrollAndDisplay();
                        }));
        }

        let pagination = host.querySelector('.ta-ignored-pagination') as HTMLElement | null;
        if (!pagination) {
            pagination = host.createDiv({ cls: 'ta-ignored-pagination ta-custom-pagination' });
            const previous = pagination.createEl('button', { text: 'Previous' });
            previous.disabled = this.ignoredPage === 0;
            previous.addEventListener('click', (event) => {
                event.preventDefault();
                if (this.ignoredPage > 0) {
                    this.ignoredPage -= 1;
                    this.renderIgnoredWordList(containerEl);
                }
            });
            pagination.createEl('span');
            const next = pagination.createEl('button', { text: 'Next' });
            next.disabled = this.ignoredPage >= pageCount - 1;
            next.addEventListener('click', (event) => {
                event.preventDefault();
                if (this.ignoredPage < pageCount - 1) {
                    this.ignoredPage += 1;
                    this.renderIgnoredWordList(containerEl);
                }
            });
        }

        const previous = pagination.querySelector('button:first-child') as HTMLButtonElement | null;
        const label = pagination.querySelector('span');
        const next = pagination.querySelector('button:last-child') as HTMLButtonElement | null;
        if (previous) previous.disabled = this.ignoredPage === 0;
        if (label) label.textContent =
            `${words.length} ignored word(s) - Page ${this.ignoredPage + 1} of ${pageCount}`;
        if (next) next.disabled = this.ignoredPage >= pageCount - 1;
    }

    private renderCustomWordList(containerEl: HTMLElement): void {
        containerEl.querySelector('.ta-custom-list:not(.ta-ignored-list)')?.remove();
        let host = containerEl.querySelector('.ta-custom-pager') as HTMLElement | null;
        if (!host) {
            host = containerEl.createDiv({ cls: 'ta-custom-pager' });
        }

        const search = this.customSearch.trim().toLowerCase();
        const managedWords = new Set<string>([
            ...this.plugin.settings.customDict,
            ...this.plugin.settings.dictFiles.flatMap((file) => file.words)
        ]);
        let words = [...managedWords].filter((word) =>
            search.length === 0 || word.toLowerCase().includes(search)
        ).filter((word) =>
            !this.plugin.settings.ignoredWords.includes(word.toLowerCase())
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

        const list = host.createDiv({ cls: 'ta-custom-list custom-word-scroll' });
        this.addDefaultScrollContainerBehavior(list);
        const existingCustomPagination =
            host.querySelector('.ta-custom-pagination') as HTMLElement | null;
        if (existingCustomPagination) {
            host.insertBefore(list, existingCustomPagination);
        }

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
                            this.preserveScrollAndDisplay();
                        }))
                .addButton((button: ButtonComponent) =>
                    button
                        .setButtonText(isPinned ? 'Unpin' : 'Pin')
                        .setTooltip(isPinned ? `Unpin "${word}"` : `Pin "${word}" at the top`)
                        .onClick(async () => {
                            await this.plugin.setWordPinned(word, !isPinned);
                            this.customPage = 0;
                            this.renderCustomWordList(containerEl);
                        }));
        }

        if (pageWords.length === 0) {
            list.createDiv({ cls: 'ta-empty-list', text: search ? 'No matching custom words.' : 'No custom words yet.' });
        }

        let pagination = host.querySelector('.ta-custom-pagination') as HTMLElement | null;
        if (!pagination) {
            pagination = host.createDiv({ cls: 'ta-custom-pagination' });
            const previous = pagination.createEl('button', { text: 'Previous' });
            previous.disabled = this.customPage === 0;
            previous.addEventListener('click', (event) => {
                event.preventDefault();
                if (this.customPage > 0) {
                    this.customPage -= 1;
                    this.renderCustomWordList(containerEl);
                }
            });
            pagination.createEl('span');
            const next = pagination.createEl('button', { text: 'Next' });
            next.disabled = this.customPage >= pageCount - 1;
            next.addEventListener('click', (event) => {
                event.preventDefault();
                if (this.customPage < pageCount - 1) {
                    this.customPage += 1;
                    this.renderCustomWordList(containerEl);
                }
            });
        }

        const previous = pagination.querySelector('button:first-child') as HTMLButtonElement | null;
        const label = pagination.querySelector('span');
        const next = pagination.querySelector('button:last-child') as HTMLButtonElement | null;
        if (previous) previous.disabled = this.customPage === 0;
        if (label) label.textContent =
            `${words.length} matching word(s) - Page ${this.customPage + 1} of ${pageCount}`;
        if (next) next.disabled = this.customPage >= pageCount - 1;
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
                filters: [
                    { name: 'Text or Markdown files', extensions: ['txt', 'md'] },
                    { name: 'Text files', extensions: ['txt'] },
                    { name: 'Markdown files', extensions: ['md'] }
                ]
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
                    filters: [
                        { name: 'Dictionary files', extensions: ['txt', 'md'] },
                        { name: 'Text files', extensions: ['txt'] },
                        { name: 'Markdown files', extensions: ['md'] }
                    ]
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
                    { type: filePath.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain' }
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
        input.accept = '.txt,.md,text/plain,text/markdown';
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
