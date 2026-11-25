import { Editor, EditorPosition } from 'obsidian';

export interface Result {
    ok: boolean;
    reason?: string;
};

export const inCodeBlock = (editor: Editor, cursor: EditorPosition): boolean => {
    const lines = editor.getValue().split('\n');
    let inCodeBlock = false;

    for (let i = 0; i <= cursor.line; i++) {
        const line = lines[i].trim();
        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        }
    }

    return inCodeBlock;
};

export const stringInWordOrBeforePunctuation = (s: string): boolean => {
    return /^[\w.,;:!?'"()\[\]{}\-_+=<>@#$%^&*]/.test(s);
};

export const closingDelimiterAfterCursor = (
    afterCursor: string,
    punctuationEnabled: boolean
): boolean => {
    if (!punctuationEnabled) return false;
    return /^[\)\]\}"']/.test(afterCursor);
};

export const wordBeforeString = (
    s: string,
    punctuationEnabled: boolean = false,
    enabledDelimiters: {
        quotes?: boolean;
        apostrophes?: boolean;
        squareBrackets?: boolean;
        braces?: boolean;
        parentheses?: boolean;
    } = {}
): RegExpMatchArray | null => {
    const cleaned = s
        .replace(/^\s*(?:#{1,6}\s*|\>+\s*|[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/, '')
        .replace(/^\s+/, '');
    if (punctuationEnabled) {
        let delimiterPattern = '';
        if (enabledDelimiters.quotes) delimiterPattern += '"';
        if (enabledDelimiters.apostrophes) delimiterPattern += "'";
        if (enabledDelimiters.squareBrackets) delimiterPattern += '\\[\\]';
        if (enabledDelimiters.braces) delimiterPattern += '{}';
        if (enabledDelimiters.parentheses) delimiterPattern += '()';

        let lastSegment = cleaned;
        if (delimiterPattern) {
            const parts = cleaned.split(
                new RegExp(`[${delimiterPattern}]`)
            );
            lastSegment = parts[parts.length - 1] ?? cleaned;
        }
        return lastSegment.match(/([A-Za-z][A-Za-z'-]*\.?$)/);
    }
    return cleaned.match(/([A-Za-z][A-Za-z'-]*\.?$)/);
};