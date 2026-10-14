/*
 * Test modulu limitow bez VS Code: podmienia modul "vscode" na zaslepke i sprawdza
 * skompilowany out/limity.js - parsowanie odpowiedzi `arkcli usage plan`, formatowanie
 * procentow oraz realne wywolanie CLI (spawn).
 *
 * Uruchomienie:
 *   node test-limity.cjs
 *
 * Czego NIE robi: nie loguje sie do BytePlus. Bez `arkcli auth login` test celowo
 * konczy sie na "brak-logowania" - to jest wlasnie sprawdzany stan.
 *
 * Bez zainstalowanego `arkcli` (na przyklad na runnerze GitHub Actions) sekcje 3, 5 i 6 nie maja
 * czego mierzyc: sprawdzaja wtedy rozpoznanie braku polecenia (`brak-cli`), a nie stan konta.
 * Reszta sekcji dziala bez CLI i bez VS Code.
 */

const Module = require('module');

/**
 * Ustawienia wpisane WPROST przez uzytkownika - tylko one licza sie jako wartosc jawna.
 * Stare klucze 0.1.x sa tu celowo: test sprawdza na nich migracje do `limityOdswiezanie` (sekcja 12).
 */
const konfiguracja = {
	byteplusArk: {
		arkcliSciezka: 'arkcli',
		arkcliProfil: '',
		limityWStatusBar: true,
		limityOdswiezanieSekundy: 900,
		konsolaPlanuUrl: 'https://console.byteplus.com/ark/region:ap-southeast-1/subscription/coding-plan'
	}
};

/** Wartosci domyslne ze schematu `package.json`: `get()` je zwraca, a `inspect()` tylko raportuje. */
const ustawieniaDomyslne = {
	byteplusArk: {
		arkcliSciezka: 'arkcli',
		arkcliProfil: '',
		limityOdswiezanie: 'co 15 min',
		konsolaPlanuUrl: 'https://console.byteplus.com/ark/region:ap-southeast-1/subscription/coding-plan'
	}
};

function wartoscZ(sekcja, prefiks, klucz) {
	const zbior = sekcja[prefiks] ?? {};
	return Object.prototype.hasOwnProperty.call(zbior, klucz) ? zbior[klucz] : sekcja[prefiks + '.' + klucz];
}

const vscodeZaslepka = {
	workspace: {
		getConfiguration: prefiks => ({
			get: klucz => {
				const wprost = wartoscZ(konfiguracja, prefiks, klucz);
				return wprost === undefined ? wartoscZ(ustawieniaDomyslne, prefiks, klucz) : wprost;
			},
			// VS Code trzyma wartosci jawne w `globalValue` / `workspaceValue`; `defaultValue`
			// pochodzi ze schematu i wlasnie na tym rozroznieniu opiera sie migracja starych kluczy.
			inspect: klucz => ({
				key: prefiks + '.' + klucz,
				defaultValue: wartoscZ(ustawieniaDomyslne, prefiks, klucz),
				globalValue: wartoscZ(konfiguracja, prefiks, klucz),
				workspaceValue: undefined,
				workspaceFolderValue: undefined
			})
		})
	}
};

const oryginalnyLoad = Module._load;
Module._load = function (zadanie) {
	if (zadanie === 'vscode') {
		return vscodeZaslepka;
	}
	return oryginalnyLoad.apply(this, arguments);
};

const limity = require('./out/limity');

let bledy = 0;

function sprawdz(opis, warunek, szczegoly) {
	if (warunek) {
		console.log('  OK   ' + opis);
		return;
	}
	bledy += 1;
	console.log('  BLAD ' + opis + (szczegoly === undefined ? '' : ' -> ' + szczegoly));
}

const PRZYKLAD = JSON.stringify({
	viewer: {
		auth_method: 'sso',
		is_root: true,
		user_id: '12345',
		user_name: 'redroadai',
		account_id: '3004722819',
		profile: 'default',
		tenant: 'byteplus',
		region: 'ap-southeast-1'
	},
	items: [
		{
			product: 'coding-plan',
			edition: 'personal',
			tier: 'lite',
			subscribed: true,
			periods: [
				{ label: 'monthly', percent: 26.54, reset_at: '2026-10-18T18:19:16+08:00' },
				{ label: 'session', percent: 0, reset_at: '2026-10-11T18:19:16+08:00' },
				{ label: 'weekly', percent: 0, reset_at: '2026-10-12T18:19:16+08:00' }
			],
			updated_at: 1791716000000
		},
		{ product: 'coding-plan-team', edition: 'team', subscribed: false, periods: [] }
	]
});

const ETYKIETY_OKIEN = { session: 'Sesja (5 h)', weekly: 'Tydzien (7 dni)', monthly: 'Miesiac (30 dni)' };

/**
 * Sztuczny plan z podanymi procentami okien (sesja, tydzien, miesiac) - do sprawdzania paska,
 * progow i tooltipa bez sieci i bez VS Code.
 */
function planZ(...procenty) {
	return {
		pobranoS: '2026-10-11T00:00:00.000Z',
		kto: 'test',
		pozycje: [
			{
				produkt: 'coding-plan',
				edycja: 'personal',
				tier: 'lite',
				subskrybowany: true,
				blad: undefined,
				aktualizacjaIso: undefined,
				okna: ['session', 'weekly', 'monthly'].map((kod, indeks) => ({
					kod,
					etykieta: ETYKIETY_OKIEN[kod],
					procent: procenty[indeks],
					resetIso: indeks === 0 ? undefined : '2026-10-18T18:19:16+08:00'
				}))
			}
		],
		surowyJson: '{}'
	};
}

(async () => {
	console.log('1. parsowanie przykladowej odpowiedzi CLI');
	const sparsowane = limity.naLimity(JSON.parse(PRZYKLAD), PRZYKLAD);
	sprawdz('naLimity zwraca dane', !!sparsowane);
	const dane = sparsowane ?? { pobranoS: '', kto: '', pozycje: [], surowyJson: '' };
	sprawdz('kolejnosc okien session -> weekly -> monthly', dane.pozycje[0].okna.map(o => o.kod).join(',') === 'session,weekly,monthly', dane.pozycje[0].okna.map(o => o.kod).join(','));
	sprawdz('opis tozsamosci z viewer', dane.kto.includes('uzytkownik=redroadai') && dane.kto.includes('konto=3004722819'), dane.kto);
	sprawdz(
		'linia logu (etykiety 5h/7d/30d i dwa miejsca po przecinku): ' + limity.liniaLogu(dane),
		limity.liniaLogu(dane) === 'ARK 5h 0% | 7d 0% | 30d 26,54%',
		limity.liniaLogu(dane)
	);
	for (const linia of limity.linieRaportu(dane)) {
		console.log('       ' + linia);
	}
	const resetSesji = new Date('2026-10-11T18:19:16+08:00');
	sprawdz(
		'reset sesji w czasie lokalnym',
		limity.naCzasLokalny('2026-10-11T18:19:16+08:00') ===
			resetSesji.getFullYear() +
				'-' +
				String(resetSesji.getMonth() + 1).padStart(2, '0') +
				'-' +
				String(resetSesji.getDate()).padStart(2, '0') +
				' ' +
				String(resetSesji.getHours()).padStart(2, '0') +
				':' +
				String(resetSesji.getMinutes()).padStart(2, '0'),
		limity.naCzasLokalny('2026-10-11T18:19:16+08:00')
	);
	sprawdz('procent z przecinkiem', limity.naProcent(26.54) === '26,54%' && limity.naProcent(0) === '0%', limity.naProcent(26.54));
	sprawdz('brak procentu', limity.naProcent(undefined) === 'brak danych');

	// Pasek postepu (znaki U+2588 / U+2591) - panel wyjscia VS Code nie renderuje ANSI,
	// wiec procent jedzie jako tekstowy pasek. Wypelnienie musi byc proporcjonalne.
	const pelny = '\u2588';
	const pusty = '\u2591';
	sprawdz(
		'pasek 0% pusty',
		limity.pasekProcentu(0) === '[' + pusty.repeat(20) + '] 0%',
		limity.pasekProcentu(0)
	);
	sprawdz(
		'pasek 100% pelny',
		limity.pasekProcentu(100) === '[' + pelny.repeat(20) + '] 100%',
		limity.pasekProcentu(100)
	);
	sprawdz(
		'pasek 50% = 10/20 blokow',
		limity.pasekProcentu(50) === '[' + pelny.repeat(10) + pusty.repeat(10) + '] 50%',
		limity.pasekProcentu(50)
	);
	sprawdz(
		'pasek ponad 100% przyciety do pelna',
		limity.pasekProcentu(140) === '[' + pelny.repeat(20) + '] 140%',
		limity.pasekProcentu(140)
	);
	sprawdz(
		'pasek bez danych = same cienie',
		limity.pasekProcentu(undefined) === '[' + pusty.repeat(20) + '] brak danych',
		limity.pasekProcentu(undefined)
	);
	sprawdz(
		'pasek 26,54% pokazuje przecinek',
		limity.pasekProcentu(26.54).endsWith('] 26,54%'),
		limity.pasekProcentu(26.54)
	);
	sprawdz('pusta odpowiedz bez items', limity.naLimity({ viewer: {} }, '{}') === undefined);

	console.log('2. rozpoznawanie bledow CLI (komunikaty zmierzone 2026-10-11)');
	const bezLogowania = limity.klasyfikuj(
		'{"ok":false,"error":{"type":"error","message":"not configured, run `arkcli config init --profile default` or `arkcli auth login`"}}'
	);
	sprawdz('brak logowania', bezLogowania.rodzaj === 'brak-logowania', bezLogowania.rodzaj);
	const bezCli = limity.klasyfikuj(
		'\'arkcli\' is not recognized as an internal or external command,\r\noperable program or batch file.'
	);
	sprawdz('brak CLI', bezCli.rodzaj === 'brak-cli', bezCli.rodzaj);
	const inny = limity.klasyfikuj('{"ok":false,"error":{"type":"validation","message":"something else"}}');
	sprawdz('inny blad', inny.rodzaj === 'blad' && inny.opis === 'something else', inny.opis);

	console.log('3. realne wywolanie CLI (spawn): arkcli usage plan --format json');
	const wynik = await limity.pobierzLimity();
	// Bez zainstalowanego arkcli (na przyklad na runnerze CI) sekcje na zywo nie maja czego mierzyc,
	// wiec sprawdzamy tylko rozpoznanie braku polecenia, a sekcje 3/5/6 sa pomijane z komunikatem.
	const maCli = wynik.rodzaj !== 'brak-cli';
	console.log(
		'   rodzaj: ' + wynik.rodzaj + (wynik.rodzaj === 'ok' ? '' : ' | opis: ' + wynik.opis) +
			(maCli ? '' : ' -> brak arkcli: sprawdzamy tylko rozpoznanie braku CLI')
	);
	if (maCli) {
		sprawdz(
			'stan CLI rozpoznany (ok albo brak-logowania, nie blad)',
			wynik.rodzaj === 'ok' || wynik.rodzaj === 'brak-logowania',
			wynik.rodzaj + ': ' + (wynik.rodzaj === 'ok' ? '' : wynik.opis)
		);
	} else {
		sprawdz('brak arkcli rozpoznany jako brak-cli', wynik.rodzaj === 'brak-cli', wynik.rodzaj);
	}
	if (wynik.rodzaj === 'ok') {
		for (const linia of limity.linieRaportu(wynik.limity)) {
			console.log('       ' + linia);
		}
	}

	console.log('4. sciezka do nieistniejacego CLI -> brak-cli');
	konfiguracja.byteplusArk.arkcliSciezka = 'C:\\nie-ma-takiego-katalogu-12345\\arkcli.cmd';
	const wynikBezCli = await limity.pobierzLimity();
	console.log('   rodzaj: ' + wynikBezCli.rodzaj + (wynikBezCli.rodzaj === 'ok' ? '' : ' | opis: ' + wynikBezCli.opis));
	sprawdz('brak-cli rozpoznane', wynikBezCli.rodzaj === 'brak-cli', wynikBezCli.rodzaj);

	console.log('5. nazwa bez sciezki jest szukana takze w %APPDATA%\\npm (fallback)');
	konfiguracja.byteplusArk.arkcliSciezka = 'arkcli-ktorego-nie-ma-12345';
	const wynikFallback = await limity.pobierzLimity();
	console.log('   rodzaj: ' + wynikFallback.rodzaj + (wynikFallback.rodzaj === 'ok' ? '' : ' | opis: ' + wynikFallback.opis));
	if (maCli) {
		sprawdz(
			'fallback nie konczy sie na brak-cli, gdy arkcli jest zainstalowany',
			wynikFallback.rodzaj === 'brak-logowania' || wynikFallback.rodzaj === 'ok',
			wynikFallback.rodzaj
		);
	} else {
		sprawdz('bez arkcli fallback konczy sie na brak-cli', wynikFallback.rodzaj === 'brak-cli', wynikFallback.rodzaj);
	}

	console.log('6. wybor profilu arkcli (ustawienie byteplusArk.arkcliProfil) -> argument --profile');
	konfiguracja.byteplusArk.arkcliSciezka = 'arkcli';
	konfiguracja.byteplusArk.arkcliProfil = 'nie-ma-takiego-profilu-12345';
	sprawdz(
		'poleceniePlanu zawiera --profile',
		limity.poleceniePlanu().includes('--profile nie-ma-takiego-profilu-12345'),
		limity.poleceniePlanu()
	);
	const wynikProfil = await limity.pobierzLimity();
	console.log('   rodzaj: ' + wynikProfil.rodzaj + (wynikProfil.rodzaj === 'ok' ? '' : ' | opis: ' + wynikProfil.opis));
	if (maCli) {
		sprawdz(
			'nieistniejacy profil dociera do CLI (komunikat o profilu, nie o logowaniu)',
			wynikProfil.rodzaj === 'blad' && wynikProfil.opis.includes('profile') && wynikProfil.opis.includes('not found'),
			wynikProfil.rodzaj + ': ' + (wynikProfil.rodzaj === 'ok' ? '' : wynikProfil.opis)
		);
	} else {
		sprawdz('bez arkcli profil nie zmienia stanu (nadal brak-cli)', wynikProfil.rodzaj === 'brak-cli', wynikProfil.rodzaj);
	}
	konfiguracja.byteplusArk.arkcliProfil = '';
	sprawdz('puste ustawienie = brak argumentu --profile', !limity.poleceniePlanu().includes('--profile'), limity.poleceniePlanu());

	console.log('7. progi kolorow elementow paska (bez VS Code: same identyfikatory motywu)');
	const przypadki = [
		[undefined, undefined, undefined],
		[NaN, undefined, undefined],
		[0, 'charts.green', undefined],
		[49.99, 'charts.green', undefined],
		[50, 'charts.yellow', undefined],
		[79.99, 'charts.yellow', undefined],
		[80, 'charts.red', 'statusBarItem.warningBackground'],
		[100, 'charts.red', 'statusBarItem.warningBackground'],
		[120, 'charts.red', 'statusBarItem.warningBackground']
	];
	for (const [procent, tekst, tlo] of przypadki) {
		const prog = limity.progKoloru(procent);
		sprawdz(
			'progKoloru(' + procent + ') -> tekst=' + tekst + ', tlo=' + tlo,
			prog.tekst === tekst && prog.tlo === tlo,
			JSON.stringify(prog)
		);
	}
	sprawdz('progi sa stala: 50 i 80 procent', limity.PROG_SRODEK === 50 && limity.PROG_OSTRZEZENIE === 80);
	sprawdz(
		'progKoloru zwraca napisy motywu, nie obiekty ThemeColor',
		typeof limity.progKoloru(90).tekst === 'string' && typeof limity.progKoloru(90).tlo === 'string'
	);
	sprawdz(
		'wszystkie identyfikatory kolorow sa malymi literami (API VS Code)',
		przypadki.every(([, tekst, tlo]) => (tekst === undefined || /^[a-z.]+$/.test(tekst)) && (tlo === undefined || /^[a-zA-Z.]+$/.test(tlo)))
	);

	console.log('8. oknaPaska: dane dla paska (skrot, procent, prog)');
	const okna = limity.oknaPaska(dane);
	sprawdz(
		'skroty okien w kolejnosci paska: ' + okna.map(o => o.skrot).join(' '),
		okna.map(o => o.skrot).join(' ') === '5h 7d 30d',
		okna.map(o => o.skrot).join(' ')
	);
	sprawdz(
		'kolejnosc okien (sesja, tydzien, miesiac)',
		okna.map(o => o.kod).join(',') === 'session,weekly,monthly',
		okna.map(o => o.kod).join(',')
	);
	sprawdz('okno nie trzyma gotowego tekstu (sklada go tekstPaska)', okna.every(o => o.tekst === undefined));
	sprawdz('niskie zuzycie = wszystko zielone', okna.every(o => o.prog.tekst === 'charts.green'), JSON.stringify(okna.map(o => o.prog)));
	sprawdz(
		'reset i "ile zostalo" gotowe do tooltipa',
		typeof okna[0].resetLokalny === 'string' && typeof okna[0].zostalo === 'string',
		okna[0].resetLokalny + ' / ' + okna[0].zostalo
	);
	const oknaWysokie = limity.oknaPaska(planZ(60, 80, 95));
	sprawdz(
		'trzy progi obok siebie: zolty, czerwony z tlem, czerwony z tlem',
		oknaWysokie[0].prog.tekst === 'charts.yellow' &&
			oknaWysokie[0].prog.tlo === undefined &&
			oknaWysokie[1].prog.tekst === 'charts.red' &&
			oknaWysokie[1].prog.tlo === 'statusBarItem.warningBackground' &&
			oknaWysokie[2].prog.tekst === 'charts.red' &&
			oknaWysokie[2].prog.tlo === 'statusBarItem.warningBackground',
		JSON.stringify(oknaWysokie.map(o => o.prog))
	);
	sprawdz(
		'puste limity -> zero elementow paska',
		limity.oknaPaska({ pobranoS: '', kto: '', pozycje: [], surowyJson: '{}' }).length === 0
	);

	console.log('9. tekst paska: jeden element, procenty calkowite, bez etykiet 5h/7d/30d');
	sprawdz('tekst paska z przykladu', limity.tekstPaska(okna) === '$(pulse) ARK 0% 0% 27%', limity.tekstPaska(okna));
	sprawdz(
		'pasek nie powtarza etykiet okien',
		['5h', '7d', '30d'].every(etykieta => !limity.tekstPaska(okna).includes(etykieta)),
		limity.tekstPaska(okna)
	);
	sprawdz('procent calkowity: 0,4 -> 0%', limity.naProcentCalkowity(0.4) === '0%', limity.naProcentCalkowity(0.4));
	sprawdz('procent calkowity: 49,6 -> 50%', limity.naProcentCalkowity(49.6) === '50%', limity.naProcentCalkowity(49.6));
	sprawdz('procent calkowity: 79,64 -> 80%', limity.naProcentCalkowity(79.64) === '80%', limity.naProcentCalkowity(79.64));
	sprawdz('procent calkowity: brak danych -> ?', limity.naProcentCalkowity(undefined) === '?', limity.naProcentCalkowity(undefined));
	sprawdz('brak okien -> komunikat zamiast liczb', limity.tekstPaska([]) === '$(pulse) ARK limity: brak danych', limity.tekstPaska([]));
	const oknaBezProcentu = limity.oknaPaska(planZ(undefined, 0, 27));
	sprawdz(
		'okno bez procentu pokazuje ? i nie udaje zera',
		limity.tekstPaska(oknaBezProcentu) === '$(pulse) ARK ? 0% 27%',
		limity.tekstPaska(oknaBezProcentu)
	);

	console.log('10. kolor paska z najgorszego okna');
	sprawdz('same niskie -> zielony', limity.progPaska(okna).tekst === 'charts.green', JSON.stringify(limity.progPaska(okna)));
	sprawdz(
		'najgorsze okno to 30d 95%',
		limity.najgorszeOkno(oknaWysokie).kod === 'monthly' && limity.najgorszeOkno(oknaWysokie).procent === 95,
		JSON.stringify(limity.najgorszeOkno(oknaWysokie))
	);
	sprawdz(
		'kolor calego elementu bierze sie z najgorszego okna',
		limity.progPaska(oknaWysokie).tekst === 'charts.red' &&
			limity.progPaska(oknaWysokie).tlo === 'statusBarItem.warningBackground',
		JSON.stringify(limity.progPaska(oknaWysokie))
	);
	const oknaKrancowe = limity.oknaPaska(planZ(1, 2, 79.64));
	sprawdz(
		'79,64% pokazuje 80% jeszcze na zoltym progu (prog z dokladnej wartosci)',
		limity.tekstPaska(oknaKrancowe).endsWith('80%') && limity.progPaska(oknaKrancowe).tekst === 'charts.yellow',
		limity.tekstPaska(oknaKrancowe) + ' / ' + JSON.stringify(limity.progPaska(oknaKrancowe))
	);
	sprawdz(
		'brak okien -> kolor motywu domyslny (bez identyfikatora)',
		limity.progPaska([]).tekst === undefined && limity.progPaska([]).tlo === undefined
	);
	sprawdz(
		'okna bez procentu nie decyduja o kolorze',
		limity.najgorszeOkno(limity.oknaPaska(planZ(undefined, undefined, undefined))) === undefined
	);
	sprawdz(
		'opis progu slowami',
		limity.opisProgu(limity.progPaska(oknaWysokie)) === '80% i wiecej (czerwony, tlo ostrzegawcze)' &&
			limity.opisProgu({}) === 'brak danych',
		limity.opisProgu(limity.progPaska(oknaWysokie))
	);

	console.log('11. tooltip jednego elementu (etykiety i dokladne procenty zostaja w dymku)');
	const dymek = limity.tooltipPaska(oknaWysokie);
	for (const etykieta of ['Sesja (5 h)', 'Tydzien (7 dni)', 'Miesiac (30 dni)']) {
		sprawdz('pelna etykieta w dymku: ' + etykieta, dymek.includes(etykieta));
	}
	sprawdz(
		'nazwany prog i okno decydujace',
		dymek.includes('kolor paska: 80% i wiecej (czerwony, tlo ostrzegawcze) - decyduje 30d 95%'),
		dymek.split('\n')[1]
	);
	sprawdz('pasek blokowy z dokladnym procentem', dymek.includes(limity.pasekProcentu(95)), limity.pasekProcentu(95));
	sprawdz('plan i reset w dymku', dymek.includes('[plan coding-plan]') && dymek.includes('reset '), dymek);
	sprawdz('skrot i zrodlo odczytu', dymek.includes('5h') && dymek.includes('arkcli usage plan'), dymek.split('\n')[0]);
	sprawdz('pusty dymek mowi o braku okien', limity.tooltipPaska([]).includes('CLI nie zwrocilo zadnych okien planu.'));
	sprawdz(
		'dymek konczy sie podpowiedzia o kliknieciu',
		dymek.endsWith('Klik: szczegoly, odswiezanie, strona planu'),
		JSON.stringify(dymek.slice(-50))
	);
	sprawdz(
		'naglowek trafia na poczatek dymka (ostatni odczyt, podglad)',
		limity.tooltipPaska(okna, 'Ostatni udany odczyt: 2026-10-11 00:00').startsWith('Ostatni udany odczyt: 2026-10-11 00:00')
	);

	console.log('12. jedno ustawienie paska: tryb (wylaczone / na zadanie / co X min)');
	sprawdz(
		'osiem opcji z domyslna co 15 min',
		limity.OPCJE_ODSWIEZANIA.join('|') ===
			'wylaczone|tylko na zadanie|co 1 min|co 5 min|co 10 min|co 15 min|co 30 min|co 60 min' &&
			limity.OPCJA_DOMYSLNA === 'co 15 min',
		limity.OPCJE_ODSWIEZANIA.join('|')
	);
	sprawdz(
		'opcja -> odstep w ms',
		limity.odstepMsZOpcji('co 1 min') === 60000 && limity.odstepMsZOpcji('co 15 min') === 900000,
		String(limity.odstepMsZOpcji('co 15 min'))
	);
	sprawdz(
		'bez licznika: tylko na zadanie, wylaczone i nieznana wartosc',
		limity.czyAutoOdczyt(limity.OPCJA_RECZNA) === false &&
			limity.czyAutoOdczyt(limity.OPCJA_WYLACZONA) === false &&
			limity.odstepMsZOpcji('bzdura') === undefined
	);
	sprawdz(
		'wylaczone chowa element',
		limity.czyPasekWidoczny(limity.OPCJA_WYLACZONA) === false && limity.czyPasekWidoczny('co 5 min') === true
	);
	sprawdz(
		'sekundy -> najblizsza opcja nie krotsza',
		limity.zSekundNaOpcje(30) === 'co 1 min' &&
			limity.zSekundNaOpcje(120) === 'co 5 min' &&
			limity.zSekundNaOpcje(900) === 'co 15 min' &&
			limity.zSekundNaOpcje(5000) === 'co 60 min' &&
			limity.zSekundNaOpcje(undefined) === undefined,
		[limity.zSekundNaOpcje(30), limity.zSekundNaOpcje(120), limity.zSekundNaOpcje(900), limity.zSekundNaOpcje(5000)].join(' | ')
	);
	sprawdz(
		'migracja ze starych kluczy zaslepki (900 s)',
		limity.opcjaOdswiezania() === 'co 15 min' &&
			(limity.wybierzOpcjeOdswiezania().opis ?? '').includes('limityOdswiezanieSekundy=900'),
		JSON.stringify(limity.wybierzOpcjeOdswiezania())
	);
	sprawdz(
		'ustawienie wpisane wprost wygrywa i konczy migracje',
		(() => {
			konfiguracja.byteplusArk.limityOdswiezanie = 'co 5 min';
			const ok =
				limity.opcjaOdswiezania() === 'co 5 min' &&
				limity.wybierzOpcjeOdswiezania().zrodlo === 'ustawienie' &&
				limity.wybierzOpcjeOdswiezania().opis === undefined;
			delete konfiguracja.byteplusArk.limityOdswiezanie;
			return ok;
		})()
	);
	sprawdz(
		'stary limityWStatusBar=false -> wylaczone',
		(() => {
			konfiguracja.byteplusArk.limityWStatusBar = false;
			const wybor = limity.wybierzOpcjeOdswiezania();
			konfiguracja.byteplusArk.limityWStatusBar = true;
			return wybor.opcja === 'wylaczone' && wybor.zrodlo === 'migracja' && wybor.opis.includes('limityWStatusBar=false');
		})()
	);
	sprawdz(
		'bez starych kluczy zostaje wartosc domyslna',
		(() => {
			delete konfiguracja.byteplusArk.limityOdswiezanieSekundy;
			const wybor = limity.wybierzOpcjeOdswiezania();
			konfiguracja.byteplusArk.limityOdswiezanieSekundy = 900;
			return wybor.opcja === 'co 15 min' && wybor.zrodlo === 'domyslne' && wybor.opis === undefined;
		})()
	);
	sprawdz(
		'tylko na zadanie nie wola CLI w tle (brak licznika = brak automatu)',
		limity.czyAutoOdczyt(limity.OPCJA_RECZNA) === false && limity.czyPasekWidoczny(limity.OPCJA_RECZNA) === true
	);

	console.log('13. kroki podgladu kolorow (diagnostyka)');
	sprawdz('trzy kroki 30 / 60 / 90', limity.KROKI_PODGLADU.join(',') === '30,60,90', limity.KROKI_PODGLADU.join(','));
	for (const [procent, kolor, tlo] of [
		[30, 'charts.green', undefined],
		[60, 'charts.yellow', undefined],
		[90, 'charts.red', 'statusBarItem.warningBackground']
	]) {
		const krok = limity.oknaPaska(limity.limityPodgladu(procent));
		sprawdz(
			'krok ' + procent + '% -> ' + kolor,
			limity.progPaska(krok).tekst === kolor &&
				limity.progPaska(krok).tlo === tlo &&
				limity.tekstPaska(krok) === '$(pulse) ARK ' + procent + '% ' + procent + '% ' + procent + '%',
			JSON.stringify(limity.progPaska(krok)) + ' / ' + limity.tekstPaska(krok)
		);
	}
	sprawdz(
		'dane podgladu sa opisane jako sztuczne',
		limity.limityPodgladu(30).kto.includes('sztuczne'),
		limity.limityPodgladu(30).kto
	);

	console.log(bledy === 0 ? '\nWSZYSTKIE SPRAWDZENIA OK' : '\nBLEDY: ' + bledy);
	process.exitCode = bledy === 0 ? 0 : 1;
})();
