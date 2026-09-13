import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const webChatSource = fs.readFileSync(path.join(rootDir, 'public', 'web-chat.js'), 'utf8');

const matchCssA = webChatSource.match(/var CANONICAL_WIDGET_CSS_A = (\[[\s\S]*?\])\.join/);
if (!matchCssA) throw new Error('Could not find CANONICAL_WIDGET_CSS_A');

const matchCssB = webChatSource.match(/var CANONICAL_WIDGET_CSS_B = (\[[\s\S]*?\])\.join/);
if (!matchCssB) throw new Error('Could not find CANONICAL_WIDGET_CSS_B');

const matchChatIcon = webChatSource.match(/var CHAT_ICON_SVG = '([^']+)'/);
const matchCloseIcon = webChatSource.match(/var CLOSE_ICON_SVG = '([^']+)'/);
const matchMinimizeIcon = webChatSource.match(/var MINIMIZE_ICON_SVG = '([^']+)'/);
const matchSendIcon = webChatSource.match(/var SEND_ICON_SVG = '([^']+)'/);
const matchTrashIcon = webChatSource.match(/var TRASH_ICON_SVG = '([^']+)'/);

const headerPart = `/**
 * Canonical Web Chat Design Contract & Shared Renderer Primitives
 * AUTO-EXTRACTED DIRECTLY FROM public/web-chat.js
 * Guarantees 100% visual parity across public widget and dashboard live preview.
 */

export const CANONICAL_WIDGET_CSS_A: string[] = ${matchCssA[1]};

export const CANONICAL_WIDGET_CSS_B: string[] = ${matchCssB[1]};

export const CANONICAL_WIDGET_CSS = CANONICAL_WIDGET_CSS_A.join('\\n') + '\\n' + CANONICAL_WIDGET_CSS_B.join('\\n');

export const CHAT_ICON_SVG = '${matchChatIcon[1]}';
export const CLOSE_ICON_SVG = '${matchCloseIcon[1]}';
export const MINIMIZE_ICON_SVG = '${matchMinimizeIcon[1]}';
export const SEND_ICON_SVG = '${matchSendIcon[1]}';
export const TRASH_ICON_SVG = '${matchTrashIcon[1]}';
`;

const helpersSource = fs.readFileSync(path.join(__dirname, 'canonical_contract_helpers.template.js'), 'utf8');

const targetPath = path.join(rootDir, 'dashboard', 'src', 'features', 'channels', 'web-chat-canonical-contract.ts');
fs.writeFileSync(targetPath, headerPart + '\n' + helpersSource, 'utf8');
console.log('Generated web-chat-canonical-contract.ts successfully at', targetPath);
