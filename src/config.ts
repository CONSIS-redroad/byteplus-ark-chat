/**
 * Ustawienia wtyczki, rozpoznanie trasy i obsluga klucza API.
 *
 * Kolejnosc szukania klucza:
 *   1. SecretStorage VS Code (komenda "BytePlus ARK: Ustaw klucz API" albo natywne UI),
 *   2. zmienna srodowiskowa (domyslnie BYTEPLUS_ARK_API_KEY) - tak samo jak w mostach LiteLLM,
 *   3. brak klucza - dopuszczalny tylko dla lokalnego mostu bez autoryzacji (127.0.0.1).
 */

import * as vscode from 'vscode';

export const SEKRET_KLUCZ = 'byteplusArk.apiKey';
export const VENDOR = 'byteplus-ark';

export interface ArkConfig {
	baseUrl: string;
	models: string[];
	labelPrefix: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	toolCalling: boolean;
	vision: boolean;
	apiKeyEnvVar: string;
	timeoutSeconds: number;
	debug: boolean;
}

export interface KluczInfo {
	key: string;
	source: string;
}

export function readConfig(): ArkConfig {
	const c = vscode.workspace.getConfiguration('byteplusArk');
	const maxInput = c.get<number>('maxInputTokens') ?? 1024000;
	const maxOutput = c.get<number>('maxOutputTokens') ?? 131072;
	const timeout = c.get<number>('timeoutSeconds') ?? 300;
	return {
		baseUrl: (c.get<string>('baseUrl') ?? '').trim(),
		models: (c.get<string[]>('models') ?? []).map(m => m.trim()).filter(m => m.length > 0),
		labelPrefix: c.get<string>('labelPrefix') ?? 'ARK',
		maxInputTokens: maxInput > 0 ? maxInput : 1024000,
		maxOutputTokens: maxOutput > 0 ? maxOutput : 131072,
		toolCalling: c.get<boolean>('toolCalling') ?? true,
		vision: c.get<boolean>('vision') ?? false,
		apiKeyEnvVar: (c.get<string>('apiKeyEnvVar') ?? '').trim(),
		timeoutSeconds: timeout > 0 ? timeout : 300,
		debug: c.get<boolean>('debug') ?? false
	};
}

export async function resolveApiKey(context: vscode.ExtensionContext, cfg: ArkConfig): Promise<KluczInfo | undefined> {
	const zSekretu = (await context.secrets.get(SEKRET_KLUCZ))?.trim();
	if (zSekretu) {
		return { key: zSekretu, source: 'SecretStorage' };
	}
	if (cfg.apiKeyEnvVar) {
		const zeSrodowiska = process.env[cfg.apiKeyEnvVar]?.trim();
		if (zeSrodowiska) {
			return { key: zeSrodowiska, source: 'zmienna ' + cfg.apiKeyEnvVar };
		}
	}
	return undefined;
}

export async function storeApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
	await context.secrets.store(SEKRET_KLUCZ, key);
}

export async function deleteApiKey(context: vscode.ExtensionContext): Promise<void> {
	await context.secrets.delete(SEKRET_KLUCZ);
}

export function isLocalBase(baseUrl: string): boolean {
	try {
		const host = new URL(baseUrl).hostname.toLowerCase();
		return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
	} catch {
		return false;
	}
}

export function hostOf(baseUrl: string): string {
	try {
		const u = new URL(baseUrl);
		return u.host + u.pathname.replace(/\/+$/, '');
	} catch {
		return baseUrl;
	}
}

export function maskKey(key: string): string {
	if (key.length <= 8) {
		return '*'.repeat(key.length);
	}
	return key.slice(0, 4) + '...' + key.slice(-4) + ' (' + key.length + ' znakow)';
}
