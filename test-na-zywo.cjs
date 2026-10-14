/*
 * Test klienta ARK bez VS Code (ten sam plik out/arkClient.js, ktorego uzywa wtyczka).
 *
 * Uruchomienie:
 *   node test-na-zywo.cjs            -> model glm-5.2
 *   node test-na-zywo.cjs deepseek-v4.1-flash
 *
 * Klucz pobierany jest ze zmiennej BYTEPLUS_ARK_API_KEY (ta sama, ktorej szuka wtyczka).
 */

const { sendChatRequest } = require('./out/arkClient');

const BAZA_ARK = 'https://ark.ap-southeast.bytepluses.com/api/coding/v3';
const BAZA_MOST = 'http://127.0.0.1:4010/v1';

async function cwiczenie(nazwa, opcje) {
	const start = Date.now();
	let tekst = '';
	const wywolania = [];
	try {
		await sendChatRequest({
			timeoutMs: 60000,
			maxTokens: 128,
			onText: fragment => {
				tekst += fragment;
			},
			onToolCall: (id, name, input) => {
				wywolania.push({ id, name, input });
			},
			...opcje
		});
		console.log(
			'OK   ' +
				nazwa +
				' (' +
				(Date.now() - start) +
				' ms): ' +
				JSON.stringify(tekst.trim().slice(0, 120)) +
				(wywolania.length > 0 ? ' narzedzia=' + JSON.stringify(wywolania) : '')
		);
		return true;
	} catch (err) {
		console.log('BLAD ' + nazwa + ': ' + (err && err.message ? err.message : String(err)));
		return false;
	}
}

(async () => {
	const model = process.argv[2] || 'glm-5.2';
	const klucz = process.env.BYTEPLUS_ARK_API_KEY;
	console.log(
		'Srodowisko: klucz ' + (klucz ? 'ustawiony (' + klucz.length + ' znakow)' : 'BRAK') + '; model ' + model
	);

	const dobre = [];
	dobre.push(
		await cwiczenie('1. ARK + klucz, strumien', {
			baseUrl: BAZA_ARK,
			apiKey: klucz,
			model,
			messages: [{ role: 'user', content: 'Odpowiedz jednym slowem: OK' }]
		})
	);
	dobre.push(
		await cwiczenie('2. ARK + klucz, narzedzia', {
			baseUrl: BAZA_ARK,
			apiKey: klucz,
			model,
			messages: [{ role: 'user', content: 'Uzyj narzedzia policz, aby obliczyc 21*2. Podaj wynik.' }],
			tools: [
				{
					type: 'function',
					function: {
						name: 'policz',
						description: 'Liczy iloczyn dwoch liczb',
						parameters: {
							type: 'object',
							properties: { a: { type: 'number' }, b: { type: 'number' } },
							required: ['a', 'b']
						}
					}
				}
			],
			toolMode: 'auto'
		})
	);
	dobre.push(
		await cwiczenie('3. most 4010 bez klucza', {
			baseUrl: BAZA_MOST,
			model,
			messages: [{ role: 'user', content: 'Odpowiedz jednym slowem: MOST' }]
		})
	);

	const zlyKluczOdrzucony = !(await cwiczenie('4. zly klucz -> oczekiwany blad HTTP', {
		baseUrl: BAZA_ARK,
		apiKey: 'niepoprawny-klucz-testowy',
		model,
		messages: [{ role: 'user', content: 'OK' }]
	}));

	console.log(
		'Wynik: ' +
			(klucz ? dobre.filter(Boolean).length + '/3 OK' : 'brak klucza - pomijam cwiczenia 1, 2, 4') +
			'; zly klucz odrzucony: ' +
			(zlyKluczOdrzucony ? 'tak' : 'NIE (uwaga!)')
	);
})();
