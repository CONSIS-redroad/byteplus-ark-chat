/*
 * Test rozpoznawania logowania bez VS Code: sprawdza skompilowany out/logowanie.js.
 * Modul nie importuje "vscode", wiec nie trzeba zadnej zaslepki.
 *
 * Probka wyjscia w sekcji 1 to ZMIERZONY tekst `arkcli auth login --no-browser --format json`
 * (2026-10-14, arkcli 1.0.38): tekst dla czlowieka idzie na stderr, JSON na stdout, a proces
 * konczy sie sam po ok. 4 s.
 *
 * Uruchomienie:
 *   node test-logowanie.cjs
 * Wynik: "WSZYSTKIE SPRAWDZENIA OK" i kod wyjscia 0, inaczej 1.
 *
 * Czego NIE robi: nie loguje sie do BytePlus (`auth login` zostawia po sobie zadanie autoryzacji,
 * wiec test go nie wola) i nie uruchamia `arkcli`.
 */

const logowanie = require('./out/logowanie');

let bledy = 0;

function sprawdz(opis, warunek, szczegoly) {
	if (warunek) {
		console.log('  OK   ' + opis);
		return;
	}
	bledy += 1;
	console.log('  BLAD ' + opis + (szczegoly === undefined ? '' : ' -> ' + szczegoly));
}

/** Pomiar 2026-10-14: stdout fazy 1 (dokladnie te pola i ta kolejnosc). */
const WYJSCIE_FAZY_1 = [
	'',
	'{',
	'  "authorize_url": "https://signin.byteplus.com/authorize/oauth/authorize?client_id=trn%3Asignin%3A%3A%3Adevtools%2Fcross-device&code_challenge=g7GhMd4_wSgOOGIMxYpATy8Q0hiboanxoRotCIsVi0M&code_challenge_method=S256&response_type=code&scope=Console%3AAll%3AAll&state=c3d094c1e59ce9a69857dd96ceb0af3c",',
	'  "expires_in_sec": 600,',
	'  "method": "sso_no_browser",',
	'  "next_command": "arkcli auth login --no-browser --code <authorization-code>",',
	'  "stage": "authorize_pending"',
	'}',
	''
].join('\n');

console.log('1. rozpoznanie JSON fazy 1 (pomiar 2026-10-14)');
{
	const dane = logowanie.rozpoznajAutoryzacje(WYJSCIE_FAZY_1);
	sprawdz(
		'adres SSO wyciagniety',
		dane !== undefined && dane.authorizeUrl.startsWith('https://signin.byteplus.com/authorize/oauth/authorize?'),
		dane && dane.authorizeUrl
	);
	sprawdz('waznosc kodu 600 s', dane !== undefined && dane.expiresInSec === 600, dane && String(dane.expiresInSec));
	sprawdz('etap authorize_pending', dane !== undefined && dane.stage === 'authorize_pending', dane && dane.stage);
	sprawdz(
		'next_command przepisane z CLI',
		dane !== undefined && dane.nextCommand === 'arkcli auth login --no-browser --code <authorization-code>',
		dane && dane.nextCommand
	);
}

console.log('2. tekst dla czlowieka przed JSON-em nie przeszkadza');
{
	const zStderr = [
		'Open the following URL in a browser on any device to complete BytePlus SSO authentication:',
		'',
		'https://signin.byteplus.com/authorize/oauth/authorize?client_id=abc&state=def',
		'',
		'After logging in, the browser page will display an authorization code.',
		WYJSCIE_FAZY_1
	].join('\n');
	const dane = logowanie.rozpoznajAutoryzacje(zStderr);
	sprawdz('JSON wygrywa z tekstem obok', dane !== undefined && dane.expiresInSec === 600, dane && String(dane.expiresInSec));
	sprawdz(
		'adres nadal ten z JSON-a',
		dane !== undefined && dane.authorizeUrl.includes('state=c3d094c1e59ce9a69857dd96ceb0af3c'),
		dane && dane.authorizeUrl
	);
}

console.log('3. JSON bez expires_in_sec - waznosc pusta, nie zgadywana');
{
	const dane = logowanie.rozpoznajAutoryzacje(
		'{"authorize_url":"https://signin.byteplus.com/a/b?x=1","stage":"authorize_pending"}'
	);
	sprawdz('adres jest', dane !== undefined, JSON.stringify(dane));
	sprawdz('brak waznosci = undefined', dane !== undefined && dane.expiresInSec === undefined, dane && String(dane.expiresInSec));
}

console.log('4. sam adres w tekscie (bez JSON-a)');
{
	const dane = logowanie.rozpoznajAutoryzacje(
		'Open this: https://signin.byteplus.com/authorize/oauth/authorize?client_id=abc&state=def'
	);
	sprawdz(
		'adres wyciagniety z tekstu',
		dane !== undefined && dane.authorizeUrl === 'https://signin.byteplus.com/authorize/oauth/authorize?client_id=abc&state=def',
		dane && dane.authorizeUrl
	);
	sprawdz('etap oznaczony jako nieznany', dane !== undefined && dane.stage === 'nieznany', dane && dane.stage);
	sprawdz('waznosc pusta', dane !== undefined && dane.expiresInSec === undefined);
}

console.log('5. smieci i puste wyjscie');
{
	sprawdz('puste wyjscie', logowanie.rozpoznajAutoryzacje('') === undefined);
	sprawdz('tekst bez adresu', logowanie.rozpoznajAutoryzacje('not configured, run arkcli auth login') === undefined);
	sprawdz(
		'JSON z innym polem niz authorize_url',
		logowanie.rozpoznajAutoryzacje('{"ok":false,"error":{"message":"boom"}}') === undefined
	);
	sprawdz('adres bez http', logowanie.rozpoznajAutoryzacje('{"authorize_url":"signin.byteplus.com/a"}') === undefined);
}

console.log('6. walidacja kodu z przegladarki');
{
	sprawdz('typowy base64 przechodzi', logowanie.wygladaNaKod('YWJjZGVmZ2hpamtsbW5vcA==') === true);
	sprawdz('base64 url-safe przechodzi', logowanie.wygladaNaKod('YWJjZGVmZ2hpamtsbW5vcA-_') === true);
	sprawdz('za krotki odpada', logowanie.wygladaNaKod('YWJjZGVm') === false);
	sprawdz('spacja odpada', logowanie.wygladaNaKod('YWJj ZGVmZ2hpamtsbW5vcA==') === false);
	sprawdz('znak powloki odpada', logowanie.wygladaNaKod('YWJjZGVmZ2hpamts&bW5vcA==') === false);
	sprawdz('puste odpada', logowanie.wygladaNaKod('   ') === false);
	sprawdz('granica dlugosci', logowanie.wygladaNaKod('a'.repeat(logowanie.MIN_DLUGOSC_KODU)) === true);
	sprawdz('o jeden znak mniej odpada', logowanie.wygladaNaKod('a'.repeat(logowanie.MIN_DLUGOSC_KODU - 1)) === false);
}

console.log('7. walidacja AK/SK i nazwy profilu');
{
	sprawdz('klucz 8+ znakow przechodzi', logowanie.wygladaNaAkSk('AKLTabcdef123456') === true);
	sprawdz('zbyt krotki odpada', logowanie.wygladaNaAkSk('AKLT12') === false);
	sprawdz('spacja w kluczu odpada', logowanie.wygladaNaAkSk('AKLT abcdef123456') === false);
	sprawdz('nazwa profilu z myslnikiem przechodzi', logowanie.wygladaNaAkSk('coding-plan-aksk') === true);
}

console.log('8. waznosc kodu i opis etapu');
{
	sprawdz('600 s to 10 min', logowanie.minutyWaznosci(600) === '10 min', logowanie.minutyWaznosci(600));
	sprawdz('45 s zostaje w sekundach', logowanie.minutyWaznosci(45) === '45 s', logowanie.minutyWaznosci(45));
	sprawdz('brak wartosci = pusty napis', logowanie.minutyWaznosci(undefined) === '');
	sprawdz('zero = pusty napis', logowanie.minutyWaznosci(0) === '');
	sprawdz('authorize_pending po polsku', logowanie.opisEtapu('authorize_pending') === 'czekam na kod z przegladarki');
	sprawdz('nieznany etap nie tlumaczony na sile', logowanie.opisEtapu('nieznany') === 'etap nieznany');
	sprawdz('inny etap przepisany', logowanie.opisEtapu('cos_nowego') === 'cos_nowego');
}

console.log('9. bramka logowania: kod wyjscia + brak jawnego ok:false');
{
	sprawdz(
		'bez logowania (pomiar 2026-10-14: kod 1)',
		logowanie.czyZalogowany(1, '{"ok":false,"error":{"message":"... requires BytePlus Ark SSO STS ..."}}') === false
	);
	sprawdz(
		'kod 0, ale jawne ok:false nie jest sukcesem',
		logowanie.czyZalogowany(0, '{"ok":false,"error":{"message":"boom"}}') === false
	);
	sprawdz(
		'po SSO (pomiar 2026-10-11: auth_method sso_no_browser)',
		logowanie.czyZalogowany(0, '{"auth_method":"sso_no_browser","path":"fresh"}') === true
	);
	sprawdz('kod 0 z ok:true', logowanie.czyZalogowany(0, '{"ok":true,"data":{}}') === true);
	sprawdz('puste wyjscie z kodem 0', logowanie.czyZalogowany(0, '') === true);
}

console.log('10. odstep przypomnien o logowaniu');
{
	const teraz = 1_800_000_000_000;
	sprawdz('brak wpisu = wolno od razu', logowanie.przypomnienieWolno(undefined, teraz) === true);
	sprawdz('godzine temu = jeszcze nie', logowanie.przypomnienieWolno(teraz - 60 * 60 * 1000, teraz) === false);
	sprawdz('po 12 h = wolno znow', logowanie.przypomnienieWolno(teraz - logowanie.ODSTEP_PRZYPOMNIENIA_MS, teraz) === true);
	sprawdz('wlasny odstep dziala', logowanie.przypomnienieWolno(teraz - 5000, teraz, 4000) === true);
	sprawdz('wpis smieciowy = wolno', logowanie.przypomnienieWolno(Number.NaN, teraz) === true);
}

console.log('11. skracanie komunikatu CLI do dymku');
{
	const wielolinijkowy = 'error:\n  ' + 'x'.repeat(400) + '\n\n';
	const skrocony = logowanie.skrocKomunikat(wielolinijkowy);
	sprawdz('jedna linia', skrocony.includes('\n') === false);
	sprawdz('maks. 300 znakow', skrocony.length === 300, String(skrocony.length));
	sprawdz('puste zostaje puste', logowanie.skrocKomunikat('   \n ') === '');
}

console.log('12. kontrakt stalych (te same liczby co w opisie i w AGENTS.md)');
{
	sprawdz('MIN_DLUGOSC_KODU = 16', logowanie.MIN_DLUGOSC_KODU === 16, String(logowanie.MIN_DLUGOSC_KODU));
	sprawdz(
		'ODSTEP_PRZYPOMNIENIA_MS = 12 h',
		logowanie.ODSTEP_PRZYPOMNIENIA_MS === 12 * 60 * 60 * 1000,
		String(logowanie.ODSTEP_PRZYPOMNIENIA_MS)
	);
}

console.log(bledy === 0 ? '\nWSZYSTKIE SPRAWDZENIA OK' : '\nBLEDY: ' + bledy);
process.exitCode = bledy === 0 ? 0 : 1;
