// Validate market-index.json with the OFFICIAL dsh-plugin-market-index parser.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const pkgDir = 'C:/Users/XTS/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js';
const { parseMarketIndex, marketInstallTarget } = await import(pathToFileURL(pkgDir).href);
const raw = JSON.parse(readFileSync('./market-index.json', 'utf8'));
const indexUrl = 'https://raw.githubusercontent.com/GITHUB_OWNER/dsh-todo-timer/main/market-index.json';
const parsed = parseMarketIndex(raw, indexUrl);
console.log('VALID. plugins:', parsed.plugins.length);
const p = parsed.plugins[0];
console.log('name:', p.name, '| versions:', p.versions.map((v) => v.version).join(','));
const target = marketInstallTarget(p.name, p.versions[0]);
console.log('install spec:', target.spec);
console.log('category:', p.metadata.category, '| labels:', p.metadata.labels.join(','));
