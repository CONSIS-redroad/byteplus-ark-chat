/*
 * Test odsiewu powtorzen bez VS Code: sprawdza skompilowany out/dziennik.js.
 * Modul nie importuje "vscode", wiec nie trzeba zadnej zaslepki.
 *
 * Uruchomienie:
 *   node test-dziennik.cjs
 * Wynik: "WSZYSTKIE SPRAWDZENIA OK" i kod wyjscia 0, inaczej 1.
 */

const { DziennikZmian, ODSTEP_PONOWIENIA_MS, czyPonawiac } = require('./out/dziennik');

let bledy = 0;

function sprawdz(opis, warunek, szczegoly) {
	if (warunek) {
		console.log('  OK   ' + opis);
		return;
	}
	bledy += 1;
	console.log('  BLAD ' + opis + (szczegoly === undefined ? '' : ' -> ' + szczegoly));
}

console.log('1. DziennikZmian - identyczna linia zapisywana raz');
{
	const dziennik = new DziennikZmian();
	sprawdz('pierwsza linia jest nowa', dziennik.czyNowy('[limity] brak-logowania: zaloguj') === true);
	sprawdz('ta sama linia to powtorka', dziennik.czyNowy('[limity] brak-logowania: zaloguj') === false);
	sprawdz('trzecia identyczna tez jest powtorka', dziennik.czyNowy('[limity] brak-logowania: zaloguj') === false);
	sprawdz(
		'zmiana tresci przechodzi',
		dziennik.czyNowy('[limity] brak-logowania: inny powod') === true
	);
	sprawdz(
		'powrot do poprzedniej tresci tez przechodzi',
		dziennik.czyNowy('[limity] brak-logowania: zaloguj') === true
	);
	sprawdz('ostatnia linia nie powtarza sie', dziennik.czyNowy('[limity] brak-logowania: zaloguj') === false);
}

console.log('2. DziennikZmian - reset pamieci');
{
	const dziennik = new DziennikZmian();
	dziennik.czyNowy('[info] ogloszam 9 model(i); trasa 127.0.0.1:4010; klucz: most lokalny bez klucza');
	sprawdz(
		'po resecie identyczna linia jest znow nowa',
		dziennik.czyNowy('[info] ogloszam 9 model(i); trasa 127.0.0.1:4010; klucz: most lokalny bez klucza') === false
	);
	dziennik.reset();
	sprawdz(
		'reset przepuszcza ta sama linie',
		dziennik.czyNowy('[info] ogloszam 9 model(i); trasa 127.0.0.1:4010; klucz: most lokalny bez klucza') === true
	);
}

console.log('3. czyPonawiac - odstep po niepowodzeniu');
{
	const teraz = 1_000_000_000_000;
	sprawdz('brak wyniku -> ponawiamy', czyPonawiac(undefined, 0, teraz) === true);
	sprawdz('stan "ok" -> ponawiamy', czyPonawiac('ok', teraz - 1000, teraz) === true);
	sprawdz('swiezy blad -> odpuszczamy', czyPonawiac('blad', teraz - 1000, teraz) === false);
	sprawdz('swiezy brak-cli -> odpuszczamy', czyPonawiac('brak-cli', teraz - 60_000, teraz) === false);
	sprawdz(
		'swiezy brak-logowania -> odpuszczamy',
		czyPonawiac('brak-logowania', teraz - ODSTEP_PONOWIENIA_MS + 1, teraz) === false
	);
	sprawdz(
		'blad po odstepie -> ponawiamy',
		czyPonawiac('blad', teraz - ODSTEP_PONOWIENIA_MS, teraz) === true
	);
	sprawdz(
		'blad po odstepie z zapasem -> ponawiamy',
		czyPonawiac('blad', teraz - ODSTEP_PONOWIENIA_MS - 1, teraz) === true
	);
	sprawdz('wlasny odstep jest respektowany', czyPonawiac('blad', teraz - 30_000, teraz, 20_000) === true);
	sprawdz('staly ODSTEP_PONOWIENIA_MS = 5 min', ODSTEP_PONOWIENIA_MS === 300_000, ODSTEP_PONOWIENIA_MS);
}

if (bledy === 0) {
	console.log('WSZYSTKIE SPRAWDZENIA OK');
	process.exit(0);
}
console.log('BLEDY: ' + bledy);
process.exit(1);
