/*
 * Test dostawcy bez VS Code: podmienia modul "vscode" na zaslepke i uruchamia
 * prawdziwy, skompilowany out/provider.js przeciwko ARK (albo lokalnemu mostowi).
 *
 * Uruchomienie:
 *   node test-provider.cjs                       -> glm-5.2, trasa ARK z klucza w zmiennej
 *   node test-provider.cjs deepseek-v4.1-flash
 *   $env:ARK_TEST_TRASA='most'; node test-provider.cjs   -> http://127.0.0.1:4010/v1, bez klucza
 *
 * Krok 1b sprawdza odsiew powtorzen (0.1.3): 4 wywolania listy modeli maja zostawic 1 linie
 * "[info] ogloszam ..." w kanale wyjscia - to ten sam mechanizm, ktory ciszy log przy
 * wielokrotnym otwieraniu sesji czatu.
 */

const Module = require('module');

class LanguageModelTextPart {
	constructor(value) {
		this.value = value;
	}
}
class LanguageModelToolCallPart {
	constructor(callId, name, input) {
		this.callId = callId;
		this.name = name;
		this.input = input;
	}
}
class LanguageModelToolResultPart {
	constructor(callId, content) {
		this.callId = callId;
		this.content = content;
	}
}
class LanguageModelDataPart {
	constructor(mime) {
		this.mime = mime;
	}
}
class EventEmitter {
	get event() {
		return () => ({ dispose() {} });
	}
	fire() {}
	dispose() {}
}
class LanguageModelError extends Error {
	static NoPermissions(message) {
		return Object.assign(new LanguageModelError(message), { code: 'NoPermissions' });
	}
	static NotFound(message) {
		return Object.assign(new LanguageModelError(message), { code: 'NotFound' });
	}
}

const model = process.argv[2] || 'glm-5.2';
const trasa = (process.env.ARK_TEST_TRASA || 'ark').toLowerCase();
const konfiguracja = {
	baseUrl:
		trasa === 'most' ? 'http://127.0.0.1:4010/v1' : 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
	models: [model],
	labelPrefix: 'ARK',
	maxInputTokens: 1024000,
	maxOutputTokens: 256,
	toolCalling: true,
	vision: false,
	apiKeyEnvVar: 'BYTEPLUS_ARK_API_KEY',
	timeoutSeconds: 120,
	debug: true
};

const vscodeZaslepka = {
	version: '1.141.0 (zaslepka)',
	LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
	LanguageModelChatToolMode: { Auto: 1, Required: 2 },
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	LanguageModelDataPart,
	EventEmitter,
	LanguageModelError,
	ProgressLocation: { Notification: 15 },
	window: {
		createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined }),
		showWarningMessage: async () => undefined,
		showInformationMessage: async () => undefined,
		showErrorMessage: async () => undefined
	},
	workspace: {
		getConfiguration: () => ({ get: klucz => konfiguracja[klucz] }),
		onDidChangeConfiguration: () => ({ dispose() {} })
	},
	commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined },
	lm: { registerLanguageModelChatProvider: () => ({ dispose() {} }) }
};

const oryginalnyLoad = Module._load;
Module._load = function (zadanie) {
	if (zadanie === 'vscode') {
		return vscodeZaslepka;
	}
	return oryginalnyLoad.apply(this, arguments);
};

const { ArkChatProvider } = require('./out/provider');
const { LanguageModelChatMessageRole } = vscodeZaslepka;

const wpisyLogu = [];
const log = {
	appendLine: linia => {
		wpisyLogu.push(linia);
		console.log('      | ' + linia);
	},
	show: () => undefined
};
const context = {
	secrets: {
		get: async () => process.env.BYTEPLUS_ARK_API_KEY,
		store: async () => undefined,
		delete: async () => undefined
	}
};
const token = { onCancellationRequested: () => ({ dispose() {} }) };
const provider = new ArkChatProvider(context, log);
const tekst = czesci =>
	czesci
		.filter(czesc => czesc instanceof LanguageModelTextPart)
		.map(czesc => czesc.value)
		.join('');
const wywolania = czesci => czesci.filter(czesc => czesc instanceof LanguageModelToolCallPart);
const zadanie = { role: LanguageModelChatMessageRole.User, content: [], name: undefined };
const zTekstem = tekstZapytania => ({ ...zadanie, content: [new LanguageModelTextPart(tekstZapytania)] });

(async () => {
	console.log('Trasa: ' + konfiguracja.baseUrl + '; model: ' + model);

	const modele = await provider.provideLanguageModelChatInformation({ silent: false }, token);
	console.log('1. provideLanguageModelChatInformation -> ' + modele.length + ' model(i)');
	for (const m of modele) {
		console.log(
			'   ' + m.name + ' | ' + m.detail + ' | maxInput=' + m.maxInputTokens + ' maxOutput=' + m.maxOutputTokens
		);
	}
	if (modele.length === 0) {
		console.log('BRAK modeli - koniec testu (brak klucza i trasa nie jest lokalna?)');
		return;
	}

	// 1b. Odsiew powtorzen (0.1.3): VS Code pyta o liste modeli przy kazdym otwarciu sesji czatu.
	for (let i = 0; i < 3; i += 1) {
		await provider.provideLanguageModelChatInformation({ silent: true }, token);
	}
	const linieInfo = wpisyLogu.filter(linia => linia.includes('[info] ogloszam')).length;
	console.log(
		'1b. odsiew powtorzen: 4 wywolania listy modeli -> ' +
			linieInfo +
			' linia(e) "[info] ogloszam" (oczekiwana 1) ' +
			(linieInfo === 1 ? 'OK' : 'BLAD')
	);

	const czesci1 = [];
	await provider.provideLanguageModelChatResponse(
		modele[0],
		[zTekstem('Odpowiedz jednym slowem: OK')],
		{ toolMode: 1 },
		{ report: czesc => czesci1.push(czesc) },
		token
	);
	console.log('2. zapytanie tekstowe -> "' + tekst(czesci1).trim().slice(0, 80) + '"');

	console.log(
		'3. provideTokenCount("abcdefgh") = ' + (await provider.provideTokenCount(modele[0], 'abcdefgh', token))
	);

	const czesci2 = [];
	await provider.provideLanguageModelChatResponse(
		modele[0],
		[zTekstem('Uzyj narzedzia policz, aby obliczyc 21*2. Podaj wynik.')],
		{
			toolMode: 1,
			tools: [
				{
					name: 'policz',
					description: 'Liczy iloczyn dwoch liczb',
					inputSchema: {
						type: 'object',
						properties: { a: { type: 'number' }, b: { type: 'number' } },
						required: ['a', 'b']
					}
				}
			]
		},
		{ report: czesc => czesci2.push(czesc) },
		token
	);
	const wykonane = wywolania(czesci2);
	console.log('4. zapytanie z narzedziem -> wywolania=' + wykonane.length);
	for (const w of wykonane) {
		console.log('   ' + w.name + '(' + JSON.stringify(w.input) + ') callId=' + w.callId);
	}
	if (wykonane.length === 0) {
		console.log('   (model nie wywolal narzedzia - to zalezy od modelu, nie od wtyczki)');
		return;
	}

	const czesci3 = [];
	await provider.provideLanguageModelChatResponse(
		modele[0],
		[
			zTekstem('Uzyj narzedzia policz, aby obliczyc 21*2. Podaj wynik.'),
			{
				role: LanguageModelChatMessageRole.Assistant,
				content: [new LanguageModelToolCallPart(wykonane[0].callId, wykonane[0].name, wykonane[0].input)],
				name: undefined
			},
			{
				role: LanguageModelChatMessageRole.User,
				content: [new LanguageModelToolResultPart(wykonane[0].callId, [new LanguageModelTextPart('42')])],
				name: undefined
			}
		],
		{ toolMode: 1 },
		{ report: czesc => czesci3.push(czesc) },
		token
	);
	console.log('5. odpowiedz po wyniku narzedzia -> "' + tekst(czesci3).trim().slice(0, 120) + '"');
	console.log('Wynik: pelna petla (modele -> zapytanie -> narzedzie -> wynik) zakonczona');
})();
