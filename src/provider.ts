/**
 * Dostawca modeli BytePlus ModelArk dla czatu VS Code.
 * Implementuje vscode.LanguageModelChatProvider (API stabilne od VS Code 1.104).
 */

import * as vscode from 'vscode';
import { ArkHttpError, ArkMessage, ArkToolCall, ArkToolDef, ArkUsage, estimateTokens, sendChatRequest } from './arkClient';
import { ArkConfig, KluczInfo, hostOf, isLocalBase, readConfig, resolveApiKey } from './config';
import { DziennikZmian } from './dziennik';

export class ArkChatProvider implements vscode.LanguageModelChatProvider {
	private readonly zmiannik = new vscode.EventEmitter<void>();
	private readonly dziennik = new DziennikZmian();
	private wskazowkaPokazana = false;

	readonly onDidChangeLanguageModelChatInformation = this.zmiannik.event;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly log: vscode.OutputChannel
	) { }

	dispose(): void {
		this.zmiannik.dispose();
	}

	/** Wymusza ponowne pobranie listy modeli (po zmianie klucza albo ustawien). */
	refresh(): void {
		this.zmiannik.fire();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		const cfg = readConfig();
		const klucz = await this.resolveKey(cfg, options);
		if (!klucz && !isLocalBase(cfg.baseUrl)) {
			if (!options.silent && !this.wskazowkaPokazana) {
				this.wskazowkaPokazana = true;
				void pokazWskazowkeOWKluczu();
			}
			return [];
		}
		const zrodlo = klucz ? klucz.source : 'most lokalny bez klucza';
		// VS Code pyta o liste modeli przy kazdym otwarciu sesji czatu, a tresc tej linii jest
		// wtedy identyczna - bez odsiewu kanal zapycha sie tym samym tekstem (pomiar: 9 sesji
		// czatu = 9 identycznych wpisow).
		const liniaInfo =
			'[info] ogloszam ' + cfg.models.length + ' model(i); trasa ' + hostOf(cfg.baseUrl) + '; klucz: ' + zrodlo;
		if (this.dziennik.czyNowy(liniaInfo)) {
			this.log.appendLine(liniaInfo);
		}
		return cfg.models.map(id => opisModelu(cfg, id, zrodlo));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const cfg = readConfig();
		const klucz = await this.resolveKey(cfg);
		const { wiadomosci, obrazy } = konwertujWiadomosci(messages);
		if (obrazy > 0) {
			this.log.appendLine('[uwaga] pominieto ' + obrazy + ' czesc(i) z obrazem - modele z planu nie przyjmuja obrazow');
		}
		const narzedzia = konwertujNarzedzia(options.tools);
		const modelOptions = options.modelOptions ?? {};
		const temperatura = typeof modelOptions.temperature === 'number' ? modelOptions.temperature : undefined;
		const maxTokens =
			typeof modelOptions.max_tokens === 'number' && modelOptions.max_tokens > 0
				? modelOptions.max_tokens
				: cfg.maxOutputTokens;
		const trybNarzedzi = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';

		if (cfg.debug) {
			this.log.appendLine(
				'[zadanie] ' +
					JSON.stringify({
						model: model.id,
						trasa: hostOf(cfg.baseUrl),
						wiadomosci: wiadomosci.length,
						narzedzia: narzedzia?.length ?? 0,
						trybNarzedzi,
						maxTokens
					})
			);
		}

		const ctrl = new AbortController();
		const subskrypcja = token.onCancellationRequested(() => ctrl.abort());
		const start = Date.now();
		let znaki = 0;
		let wywolania = 0;
		let uzycie: ArkUsage | undefined;
		try {
			await sendChatRequest({
				baseUrl: cfg.baseUrl,
				apiKey: klucz?.key,
				model: model.id,
				messages: wiadomosci,
				tools: narzedzia,
				toolMode: trybNarzedzi,
				maxTokens,
				temperature: temperatura,
				timeoutMs: cfg.timeoutSeconds * 1000,
				signal: ctrl.signal,
				onText: tekst => {
					if (tekst.length === 0) {
						return;
					}
					znaki += tekst.length;
					progress.report(new vscode.LanguageModelTextPart(tekst));
				},
				onToolCall: (callId, name, input) => {
					wywolania += 1;
					progress.report(new vscode.LanguageModelToolCallPart(callId, name, input));
				},
				onUsage: usage => {
					uzycie = usage;
				}
			});
		} catch (err) {
			const blad = naBladModelu(err, model.id, cfg);
			this.log.appendLine('[blad] ' + blad.message);
			throw blad;
		} finally {
			subskrypcja.dispose();
		}

		this.log.appendLine(
			'[odpowiedz] ' +
				model.id +
				': ' +
				(Date.now() - start) +
				' ms, ' +
				znaki +
				' znakow, ' +
				wywolania +
				' wywolanie(narzedzi)' +
				(uzycie ? ', tokeny: ' + JSON.stringify(uzycie) : '')
		);
		if (znaki === 0 && wywolania === 0) {
			progress.report(
				new vscode.LanguageModelTextPart(
					'(ARK nie zwrocilo tresci - wlacz byteplusArk.debug i sprawdz kanal wyjscia "BytePlus ARK")'
				)
			);
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		if (typeof text === 'string') {
			return estimateTokens(text);
		}
		let suma = 0;
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				suma += estimateTokens(part.value);
			}
		}
		return suma + 4;
	}

	/**
	 * Kolejnosc: wartosc z natywnej konfiguracji VS Code (jesli build ja przekazuje),
	 * potem SecretStorage, na koncu zmienna srodowiskowa.
	 */
	private async resolveKey(
		cfg: ArkConfig,
		options?: vscode.PrepareLanguageModelChatModelOptions
	): Promise<KluczInfo | undefined> {
		const zKonfiguracji = (options as unknown as { configuration?: { apiKey?: unknown } } | undefined)?.configuration
			?.apiKey;
		if (typeof zKonfiguracji === 'string' && zKonfiguracji.trim().length > 0) {
			return { key: zKonfiguracji.trim(), source: 'konfiguracja VS Code' };
		}
		return resolveApiKey(this.context, cfg);
	}
}

function opisModelu(cfg: ArkConfig, id: string, zrodlo: string): vscode.LanguageModelChatInformation {
	return {
		id,
		name: cfg.labelPrefix + ': ' + id,
		family: 'ark',
		version: '1.0.0',
		detail: hostOf(cfg.baseUrl) + ' | ' + zrodlo,
		tooltip: 'BytePlus ModelArk\nmodel: ' + id + '\ntrasa: ' + cfg.baseUrl + '\nklucz: ' + zrodlo,
		maxInputTokens: cfg.maxInputTokens,
		maxOutputTokens: cfg.maxOutputTokens,
		capabilities: {
			toolCalling: cfg.toolCalling,
			imageInput: cfg.vision
		}
	};
}

function konwertujWiadomosci(messages: readonly vscode.LanguageModelChatRequestMessage[]): {
	wiadomosci: ArkMessage[];
	obrazy: number;
} {
	const wiadomosci: ArkMessage[] = [];
	let obrazy = 0;
	for (const message of messages) {
		const teksty: string[] = [];
		const wywolania: ArkToolCall[] = [];
		const wyniki: Array<{ callId: string; tekst: string }> = [];
		for (const czesc of message.content) {
			if (czesc instanceof vscode.LanguageModelTextPart) {
				teksty.push(czesc.value);
			} else if (czesc instanceof vscode.LanguageModelToolCallPart) {
				wywolania.push({
					id: czesc.callId,
					type: 'function',
					function: { name: czesc.name, arguments: JSON.stringify(czesc.input ?? {}) }
				});
			} else if (czesc instanceof vscode.LanguageModelToolResultPart) {
				wyniki.push({ callId: czesc.callId, tekst: zbierzTekst(czesc.content) });
			} else if (czesc instanceof vscode.LanguageModelDataPart) {
				obrazy += 1;
			}
		}
		if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			const wiadomosc: ArkMessage = {
				role: 'assistant',
				content: teksty.length > 0 ? teksty.join('') : null
			};
			if (wywolania.length > 0) {
				wiadomosc.tool_calls = wywolania;
			}
			if (wiadomosc.content !== null || wywolania.length > 0) {
				wiadomosci.push(wiadomosc);
			}
			continue;
		}
		for (const wynik of wyniki) {
			wiadomosci.push({ role: 'tool', content: wynik.tekst, tool_call_id: wynik.callId });
		}
		if (teksty.length > 0) {
			wiadomosci.push({ role: 'user', content: teksty.join('\n') });
		}
	}
	return { wiadomosci, obrazy };
}

function zbierzTekst(content: ReadonlyArray<unknown>): string {
	const czesci: string[] = [];
	for (const czesc of content) {
		if (czesc instanceof vscode.LanguageModelTextPart) {
			czesci.push(czesc.value);
		} else if (typeof czesc === 'string') {
			czesci.push(czesc);
		} else if (czesc !== null && typeof czesc === 'object' && 'value' in czesc) {
			const wartosc = (czesc as { value?: unknown }).value;
			if (typeof wartosc === 'string') {
				czesci.push(wartosc);
			}
		}
	}
	return czesci.join('\n');
}

function konwertujNarzedzia(
	narzedzia: readonly vscode.LanguageModelChatTool[] | undefined
): ArkToolDef[] | undefined {
	if (!narzedzia || narzedzia.length === 0) {
		return undefined;
	}
	return narzedzia.map(narzedzie => ({
		type: 'function',
		function: {
			name: narzedzie.name,
			description: narzedzie.description,
			parameters: narzedzie.inputSchema
		}
	}));
}

function naBladModelu(err: unknown, idModelu: string, cfg: ArkConfig): Error {
	if (err instanceof ArkHttpError) {
		const tresc = err.body.replace(/\s+/g, ' ').slice(0, 300);
		if (err.status === 401 || err.status === 403) {
			return vscode.LanguageModelError.NoPermissions(
				'ARK ' +
					err.status +
					' (' +
					hostOf(cfg.baseUrl) +
					'): ' +
					tresc +
					'\nSprawdz klucz: komenda "BytePlus ARK: Ustaw klucz API"' +
					(cfg.apiKeyEnvVar ? ' albo zmienna ' + cfg.apiKeyEnvVar : '') +
					'. Plan Coding Plan wygasa 17.10.2026.'
			);
		}
		if (err.status === 404) {
			return vscode.LanguageModelError.NotFound(
				'ARK 404: model "' + idModelu + '" albo trasa ' + hostOf(cfg.baseUrl) + ' nie istnieje. ' + tresc
			);
		}
		return new Error('ARK HTTP ' + err.status + ' (' + hostOf(cfg.baseUrl) + '): ' + tresc);
	}
	if (err instanceof Error) {
		if (err.name === 'AbortError') {
			return new Error(
				'ARK: zapytanie przerwane (anulowane albo przekroczony limit czasu ' + cfg.timeoutSeconds + ' s).'
			);
		}
		return err;
	}
	return new Error(String(err));
}

async function pokazWskazowkeOWKluczu(): Promise<void> {
	const wybor = await vscode.window.showWarningMessage(
		'BytePlus ARK: brak klucza API, dlatego modele nie sa widoczne w pickerze czatu.',
		'Ustaw klucz API',
		'Pokaz stan'
	);
	if (wybor === 'Ustaw klucz API') {
		await vscode.commands.executeCommand('byteplusArk.ustawKlucz');
	} else if (wybor === 'Pokaz stan') {
		await vscode.commands.executeCommand('byteplusArk.pokazStan');
	}
}
