/**
 * Limity planu Coding Plan (sesja 5 h / tydzien / miesiac) przez oficjalne CLI arkcli.
 *
 * Skad te liczby: `arkcli usage plan` czyta backend "My plans" konsoli BytePlus
 * (`/open/GetCodingPlanUsage`) i zwraca dokladnie to, co widac na stronie
 * https://console.byteplus.com/ark/region:ap-southeast-1/subscription/coding-plan -
 * procent zuzycia i czas resetu dla okien session / weekly / monthly.
 *
 * Pomiar 2026-10-11 (ten workspace):
 *   - odpowiedzi ARK (most 4010 oraz wprost /api/coding/v3) NIE maja zadnych naglowkow
 *     z kwotami, wiec z samego czatu nie da sie odczytac procentow,
 *   - `arkcli usage plan --api-key <klucz ARK>` konczy sie bledem "--api-key only applies
 *     to data-plane commands; \"arkcli usage plan\" is control-plane", czyli sam klucz ARK
 *     nie wystarcza. Potrzebne jest jednorazowe `arkcli auth login` (SSO konta BytePlus),
 *     a stan sesji CLI trzyma w katalogu ~/.arkcli-bp (wtyczka nie dotyka kluczy).
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	DaneAutoryzacji,
	MIN_DLUGOSC_KODU,
	rozpoznajAutoryzacje,
	skrocKomunikat,
	wygladaNaAkSk,
	wygladaNaKod,
	czyZalogowany
} from './logowanie';

export interface OknoPlanu {
	/** session | weekly | monthly (albo surowa etykieta, gdy backend poda inna). */
	kod: string;
	/** Nazwa po polsku, np. "Sesja (5 h)". */
	etykieta: string;
	/** Procent zuzycia okna (0-100) albo undefined, gdy backend go nie podal. */
	procent: number | undefined;
	/** Czas nastepnego resetu, RFC3339 w czasie pekinskim (UTC+08:00). */
	resetIso: string | undefined;
}

export interface PozycjaPlanu {
	produkt: string;
	edycja: string | undefined;
	tier: string | undefined;
	subskrybowany: boolean;
	okna: OknoPlanu[];
	blad: string | undefined;
	aktualizacjaIso: string | undefined;
}

export interface LimityPlanu {
	/** Kiedy pobrano (ISO, czas lokalny). */
	pobranoS: string;
	/** Krotki opis tozsamosci z pola `viewer`. */
	kto: string;
	pozycje: PozycjaPlanu[];
	surowyJson: string;
}

export type WynikLimitow =
	| { rodzaj: 'ok'; limity: LimityPlanu }
	| { rodzaj: 'brak-cli'; opis: string }
	| { rodzaj: 'brak-logowania'; opis: string }
	| { rodzaj: 'blad'; opis: string };

const ETYKIETY: Record<string, string> = {
	session: 'Sesja (5 h)',
	weekly: 'Tydzien (7 dni)',
	monthly: 'Miesiac (30 dni)'
};

const KOLEJNOSC = ['session', 'weekly', 'monthly'];

export const KLUCZ_OSTATNICH_LIMITOW = 'byteplusArk.limityOstatnie';

export function domyslnaStronaPlanu(): string {
	return 'https://console.byteplus.com/ark/region:ap-southeast-1/subscription/coding-plan';
}

export function arkcliSciezka(): string {
	const ustawione = vscode.workspace.getConfiguration('byteplusArk').get<string>('arkcliSciezka') ?? '';
	return ustawione.trim().length > 0 ? ustawione.trim() : 'arkcli';
}

/**
 * Nazwa profilu arkcli, z ktorego czytamy limity (puste = profil domyslny CLI).
 *
 * Potrzebne przy trasie bez SSO. W arkcli 1.0.38 AK/SK przyjmuje tylko przestarzale
 * `arkcli config init --access-key ... --secret-key ... --profile <nazwa>` (samo wypisuje
 * "Command init is deprecated, use arkcli profile create instead"); nastepca
 * `arkcli profile create` nie ma flag AK/SK i bez istniejacej tozsamosci control-plane
 * konczy sie komunikatem "not configured". Gdy profil nie jest domyslny,
 * `arkcli usage plan` trzeba wywolac z `--profile` (pomiar 2026-10-11).
 */
export function arkcliProfil(): string | undefined {
	const ustawione = vscode.workspace.getConfiguration('byteplusArk').get<string>('arkcliProfil') ?? '';
	const oczyszczone = ustawione.trim();
	return oczyszczone.length > 0 ? oczyszczone : undefined;
}

export function stronaPlanu(): string {
	const ustawione = vscode.workspace.getConfiguration('byteplusArk').get<string>('konsolaPlanuUrl') ?? '';
	return ustawione.trim().length > 0 ? ustawione.trim() : domyslnaStronaPlanu();
}

/**
 * Jeden przelacznik paska limitow (0.2.0): widocznosc elementu i rytm odczytu w jednym
 * ustawieniu `byteplusArk.limityOdswiezanie`.
 *
 * Skad taka forma: trzy osobne elementy paska (0.1.6) dawaly trzy kolory okien, ale zajmowaly
 * pol paska i wymagaly dwoch ustawien (widocznosc + interwal). Teraz jest jeden element
 * z procentami calkowitymi, a rytm odczytu wybiera sie jednym slowem z listy: `wylaczone`
 * chowa element i nie pyta CLI w tle, `tylko na zadanie` zostawia ostatni odczyt, a `co X min`
 * wlacza odczyt w tle. Dokladne wartosci i etykiety okien niesie tooltip (`tooltipPaska`).
 */
export const OPCJA_WYLACZONA = 'wylaczone';
export const OPCJA_RECZNA = 'tylko na zadanie';
export const OPCJA_DOMYSLNA = 'co 15 min';

/** Wszystkie dopuszczalne wartosci ustawienia (ta sama lista jest w `package.json`). */
export const OPCJE_ODSWIEZANIA: readonly string[] = [
	OPCJA_WYLACZONA,
	OPCJA_RECZNA,
	'co 1 min',
	'co 5 min',
	'co 10 min',
	OPCJA_DOMYSLNA,
	'co 30 min',
	'co 60 min'
];

const MINUTY_OPCJI: Record<string, number> = {
	'co 1 min': 1,
	'co 5 min': 5,
	'co 10 min': 10,
	'co 15 min': 15,
	'co 30 min': 30,
	'co 60 min': 60
};

/** Interwal odczytu w milisekundach; brak wartosci = tryb bez odczytu w tle. */
export function odstepMsZOpcji(opcja: string | undefined): number | undefined {
	if (typeof opcja !== 'string') {
		return undefined;
	}
	const minut = MINUTY_OPCJI[opcja];
	return minut === undefined ? undefined : minut * 60000;
}

/** false dla `tylko na zadanie` i `wylaczone` - wtedy licznika odswiezania nie ma wcale. */
export function czyAutoOdczyt(opcja: string | undefined): boolean {
	return odstepMsZOpcji(opcja) !== undefined;
}

/** false = element paska ma byc schowany (`wylaczone`). */
export function czyPasekWidoczny(opcja: string | undefined): boolean {
	return opcja !== OPCJA_WYLACZONA;
}

/**
 * Stare `byteplusArk.limityOdswiezanieSekundy` (sekundy) na opcje z listy.
 *
 * Zaokraglamy W GORE do najblizszej dostepnej opcji, zeby po migracji nie pytac CLI czesciej,
 * niz zyczyl sobie uzytkownik (np. 120 s -> `co 5 min`, a nie `co 1 min`).
 */
export function zSekundNaOpcje(sekundy: number | undefined): string | undefined {
	if (typeof sekundy !== 'number' || !Number.isFinite(sekundy)) {
		return undefined;
	}
	const minut = Math.max(1, Math.ceil(sekundy / 60));
	for (const opcja of OPCJE_ODSWIEZANIA) {
		const wartosc = MINUTY_OPCJI[opcja];
		if (wartosc !== undefined && wartosc >= minut) {
			return opcja;
		}
	}
	return 'co 60 min';
}

/**
 * Wartosc ustawienia wpisana WPROST przez uzytkownika (pomija domyslna wartosc ze schematu).
 *
 * `get()` zwraca domyslna wartosc z package.json takze wtedy, gdy nikt nic nie ustawil, wiec nie
 * odroznia "uzytkownik wybral `co 15 min`" od "nikt nic nie wybral". Migracja ze starych kluczy
 * musi to rozrozniac, dlatego czytamy `inspect()`.
 */
function wartoscWprost<T>(klucz: string): T | undefined {
	const sprawdzone = vscode.workspace.getConfiguration('byteplusArk').inspect<T>(klucz);
	if (!sprawdzone) {
		return undefined;
	}
	for (const wartosc of [sprawdzone.workspaceFolderValue, sprawdzone.workspaceValue, sprawdzone.globalValue]) {
		if (wartosc !== undefined) {
			return wartosc;
		}
	}
	return undefined;
}

export interface WyborOpcjiOdswiezania {
	/** Opcja z `OPCJE_ODSWIEZANIA`, ktora obowiazuje. */
	opcja: string;
	/** Skad wzieta: nowe ustawienie, migracja ze starych kluczy albo wartosc domyslna. */
	zrodlo: 'ustawienie' | 'migracja' | 'domyslne';
	/** Zdanie do kanalu wyjscia (tylko gdy `zrodlo` = `migracja`). */
	opis: string | undefined;
}

/**
 * Ustala, ktora opcje paska stosowac, i mowi, skad ona pochodzi.
 *
 * Kolejnosc: nowe ustawienie wprost -> migracja starych kluczy (0.1.x: `limityWStatusBar`,
 * `limityOdswiezanieSekundy`) -> wartosc domyslna. Starych wpisow nie kasujemy - zostaja
 * w `settings.json` i ta funkcja je czyta, dopoki uzytkownik sam ich nie usunie.
 */
export function wybierzOpcjeOdswiezania(): WyborOpcjiOdswiezania {
	const wprost = wartoscWprost<string>('limityOdswiezanie');
	if (typeof wprost === 'string' && OPCJE_ODSWIEZANIA.includes(wprost)) {
		return { opcja: wprost, zrodlo: 'ustawienie', opis: undefined };
	}
	if (wartoscWprost<boolean>('limityWStatusBar') === false) {
		return {
			opcja: OPCJA_WYLACZONA,
			zrodlo: 'migracja',
			opis:
				'byteplusArk.limityWStatusBar=false -> "' + OPCJA_WYLACZONA + '" (stary wpis mozna usunac z settings.json)'
		};
	}
	const stareSekundy = wartoscWprost<number>('limityOdswiezanieSekundy');
	const zStarych = zSekundNaOpcje(stareSekundy);
	if (zStarych !== undefined) {
		return {
			opcja: zStarych,
			zrodlo: 'migracja',
			opis:
				'byteplusArk.limityOdswiezanieSekundy=' +
				String(stareSekundy) +
				' -> "' +
				zStarych +
				'" (stary wpis mozna usunac z settings.json)'
		};
	}
	return { opcja: OPCJA_DOMYSLNA, zrodlo: 'domyslne', opis: undefined };
}

/** Obowiazujaca opcja paska (patrz `wybierzOpcjeOdswiezania`). */
export function opcjaOdswiezania(): string {
	return wybierzOpcjeOdswiezania().opcja;
}

function plikIstnieje(sciezka: string): boolean {
	try {
		return fs.existsSync(sciezka);
	} catch {
		return false;
	}
}

function znajdzWPath(nazwa: string): string | undefined {
	const rozszerzenia = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
	for (const katalog of (process.env.PATH ?? '').split(path.delimiter)) {
		if (katalog.trim().length === 0) {
			continue;
		}
		for (const rozszerzenie of rozszerzenia) {
			const kandydat = path.join(katalog, nazwa + rozszerzenie);
			if (plikIstnieje(kandydat)) {
				return kandydat;
			}
		}
	}
	return undefined;
}

/**
 * Zamienia ustawienie na konkretny plik wykonywalny.
 *
 * Istnienie pliku sprawdzamy sami, bo na Windows uruchomienie brakujacego polecenia przez
 * powloke daje komunikat cmd.exe w jezyku systemu (np. "System nie moze odnalezc okreslonej
 * sciezki"), ktorego nie da sie pewnie rozpoznac z tresci.
 */
function rozwiazArkcli(exe: string): string | undefined {
	if (exe.includes('/') || exe.includes('\\')) {
		if (plikIstnieje(exe)) {
			return exe;
		}
		return process.platform === 'win32' && plikIstnieje(exe + '.cmd') ? exe + '.cmd' : undefined;
	}
	const zPath = znajdzWPath(exe);
	if (zPath) {
		return zPath;
	}
	const appData = process.env.APPDATA;
	if (appData) {
		const zNpm = path.join(appData, 'npm', process.platform === 'win32' ? 'arkcli.cmd' : 'arkcli');
		if (plikIstnieje(zNpm)) {
			return zNpm;
		}
	}
	return undefined;
}

interface WynikPolecenia {
	kod: number;
	stdout: string;
	stderr: string;
	bladUruchomienia: string | undefined;
}

/**
 * Uruchamia arkcli przez powloke.
 *
 * Na Windows `arkcli` to skrypt .cmd, ktorego nie da sie uruchomic bezposrednio
 * (child_process.execFile rzuca EINVAL/ENOENT), dlatego powloka jest tu wymagana.
 */
function uruchomArkcli(exe: string, argumenty: string[], limitMs: number): Promise<WynikPolecenia> {
	return new Promise(resolve => {
		let stdout = '';
		let stderr = '';
		let zakonczone = false;
		const zakoncz = (wynik: WynikPolecenia): void => {
			if (!zakonczone) {
				zakonczone = true;
				resolve(wynik);
			}
		};
		const dziecko = spawn(exe, argumenty, {
			shell: true,
			windowsHide: true,
			env: { ...process.env, ARKCLI_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }
		});
		const licznik = setTimeout(() => {
			try {
				dziecko.kill();
			} catch {
				/* proces mogl juz zakonczyc prace */
			}
			zakoncz({ kod: -1, stdout, stderr, bladUruchomienia: 'przekroczony limit czasu ' + limitMs + ' ms' });
		}, limitMs);
		dziecko.stdout?.on('data', fragment => {
			stdout += String(fragment);
		});
		dziecko.stderr?.on('data', fragment => {
			stderr += String(fragment);
		});
		dziecko.on('error', blad => {
			clearTimeout(licznik);
			zakoncz({ kod: -1, stdout, stderr, bladUruchomienia: blad.message });
		});
		dziecko.on('close', kod => {
			clearTimeout(licznik);
			zakoncz({ kod: kod ?? -1, stdout, stderr, bladUruchomienia: undefined });
		});
	});
}

function wytnijJson(tekst: string): string {
	const od = tekst.indexOf('{');
	const koniec = tekst.lastIndexOf('}');
	return od >= 0 && koniec > od ? tekst.slice(od, koniec + 1) : tekst;
}

function naLiczbe(wartosc: unknown): number | undefined {
	if (typeof wartosc === 'number' && Number.isFinite(wartosc)) {
		return wartosc;
	}
	if (typeof wartosc === 'string' && wartosc.trim().length > 0) {
		const liczba = Number(wartosc);
		if (Number.isFinite(liczba)) {
			return liczba;
		}
	}
	return undefined;
}

function dwieCyfry(liczba: number): string {
	return liczba < 10 ? '0' + liczba : String(liczba);
}

/** Czas z odpowiedzi CLI (RFC3339, strefa +08:00) w czasie lokalnym komputera. */
export function naCzasLokalny(iso: string | undefined): string | undefined {
	if (!iso) {
		return undefined;
	}
	const data = new Date(iso);
	if (Number.isNaN(data.getTime())) {
		return iso;
	}
	return (
		data.getFullYear() +
		'-' +
		dwieCyfry(data.getMonth() + 1) +
		'-' +
		dwieCyfry(data.getDate()) +
		' ' +
		dwieCyfry(data.getHours()) +
		':' +
		dwieCyfry(data.getMinutes())
	);
}

export function ileDo(iso: string | undefined): string | undefined {
	if (!iso) {
		return undefined;
	}
	const data = new Date(iso);
	if (Number.isNaN(data.getTime())) {
		return undefined;
	}
	const minut = Math.round((data.getTime() - Date.now()) / 60000);
	if (minut <= 0) {
		return 'reset juz minal';
	}
	const dni = Math.floor(minut / 1440);
	const resztaPoDniach = minut - dni * 1440;
	const godziny = Math.floor(resztaPoDniach / 60);
	const minuty = resztaPoDniach - godziny * 60;
	const czesci: string[] = [];
	if (dni > 0) {
		czesci.push(dni + ' dz.');
	}
	if (godziny > 0) {
		czesci.push(godziny + ' godz.');
	}
	if (minuty > 0 && dni === 0) {
		czesci.push(minuty + ' min');
	}
	return czesci.length > 0 ? 'za ' + czesci.join(' ') : 'za chwile';
}

export function naProcent(procent: number | undefined): string {
	if (typeof procent !== 'number' || !Number.isFinite(procent)) {
		return 'brak danych';
	}
	const zaokraglone = Math.round(procent * 100) / 100;
	return String(zaokraglone).replace('.', ',') + '%';
}

/**
 * Procent na pasku stanu: liczba calkowita i znak procentu, np. `63%`.
 *
 * Na pasku nie ma miejsca na dwa miejsca po przecinku, a przy trzech oknach obok siebie liczy sie
 * kazdy znak. Dokladna wartosc zostaje w tooltipie i w linii logu, ktore uzywaja `naProcent`.
 *
 * Uwaga na progi: `79,64%` pokaze sie jako `80%`, ale kolor liczy sie z DOKLADNEJ wartosci
 * (`progPaska`), wiec taka liczba jest jeszcze zolta - tooltip nazywa przedzial slowami.
 */
export function naProcentCalkowity(procent: number | undefined): string {
	if (typeof procent !== 'number' || !Number.isFinite(procent)) {
		return '?';
	}
	return Math.round(procent) + '%';
}

/**
 * Progi kolorow elementow paska stanu.
 *
 * `StatusBarItem.color` przyjmuje `ThemeColor`, a tlo (`backgroundColor`) VS Code dopuszcza
 * tylko ze stalej whitelisty: `statusBarItem.warningBackground` i
 * `statusBarItem.errorBackground` (ALLOWED_BACKGROUND_COLORS w extensionHostProcess.js -
 * pomiar 2026-10-11). Dlatego kolor tekstu bierzemy z palety wykresow (`charts.*`, sa tez
 * w motywach kontrastowych), a tlo ostrzegawcze wlaczamy dopiero przy wysokim zuzyciu.
 *
 * Identyfikatory wracaja jako napisy celowo: ten modul nie importuje `vscode.ThemeColor`,
 * wiec testy bez VS Code (test-limity.cjs) moga sprawdzac progi bez zaslepki UI.
 */
export interface ProgKoloru {
	/** Identyfikator koloru tekstu motywu (np. charts.red); brak = kolor domyslny motywu. */
	tekst?: string;
	/** Identyfikator tla motywu (tylko ostrzegawcze); brak = tlo domyslne. */
	tlo?: string;
}

/** Od tego procentu tekst jest czerwony, a element dostaje tlo ostrzegawcze. */
export const PROG_OSTRZEZENIE = 80;
/** Od tego procentu tekst jest zolty (ponizej - zielony). */
export const PROG_SRODEK = 50;

export function progKoloru(procent: number | undefined): ProgKoloru {
	if (typeof procent !== 'number' || !Number.isFinite(procent)) {
		return {};
	}
	if (procent >= PROG_OSTRZEZENIE) {
		return { tekst: 'charts.red', tlo: 'statusBarItem.warningBackground' };
	}
	if (procent >= PROG_SRODEK) {
		return { tekst: 'charts.yellow' };
	}
	return { tekst: 'charts.green' };
}

/**
 * Pasek postepu z procentem, np. `[############........] 40,65%`.
 *
 * Panel wyjscia VS Code ("BytePlus ARK") nie renderuje sekwencji ANSI - pomiar 2026-10-11:
 * w bundlu VS Code nie ma renderera ANSI dla panelu output (symbole `ansi*` dotycza tylko
 * terminala). Dlatego pasek jest zbudowany ze znakow blokowych (U+2588 pelny, U+2591 jasny
 * cien), ktore zwykly tekst wyswietla bez udzialu koloru. Znak procentu dokladamy obok,
 * bo sam pasek nie podaje dokladnej liczby.
 */
export function pasekProcentu(procent: number | undefined, szerokosc = 20): string {
	const pelny = '\u2588';
	const pusty = '\u2591';
	if (typeof procent !== 'number' || !Number.isFinite(procent)) {
		return '[' + pusty.repeat(szerokosc) + '] ' + naProcent(procent);
	}
	const ograniczony = Math.min(100, Math.max(0, procent));
	const wypelnione = Math.round((ograniczony * szerokosc) / 100);
	return '[' + pelny.repeat(wypelnione) + pusty.repeat(szerokosc - wypelnione) + '] ' + naProcent(procent);
}

function skrotKodu(kod: string): string {
	if (kod === 'session') {
		return '5h';
	}
	if (kod === 'weekly') {
		return '7d';
	}
	if (kod === 'monthly') {
		return '30d';
	}
	return kod;
}

/**
 * Jedno okno planu przygotowane dla paska stanu (sesja 5 h, tydzien, miesiac).
 *
 * `skrot` (`5h` / `7d` / `30d`) wystepuje wylacznie w tooltipie i w linii logu - sam pasek
 * pokazuje tylko procenty calkowite (`tekstPaska`), bo od 0.2.0 okna dziela jeden element.
 */
export interface OknoPaska {
	kod: string;
	skrot: string;
	etykieta: string;
	produkt: string;
	procent: number | undefined;
	resetIso: string | undefined;
	/** Czas resetu w czasie lokalnym komputera (gotowy do tooltipa). */
	resetLokalny: string | undefined;
	/** Ile zostalo do resetu, np. "za 2 godz." (gotowe do tooltipa). */
	zostalo: string | undefined;
	prog: ProgKoloru;
}

export function oknaPaska(limity: LimityPlanu): OknoPaska[] {
	const okna: OknoPaska[] = [];
	for (const pozycja of limity.pozycje) {
		for (const okno of pozycja.okna) {
			okna.push({
				kod: okno.kod,
				skrot: skrotKodu(okno.kod),
				etykieta: okno.etykieta,
				produkt: pozycja.produkt,
				procent: okno.procent,
				resetIso: okno.resetIso,
				resetLokalny: naCzasLokalny(okno.resetIso),
				zostalo: ileDo(okno.resetIso),
				prog: progKoloru(okno.procent)
			});
		}
	}
	return okna;
}

/** Ikona pojedynczego elementu paska (codicon tej instalacji VS Code; pomiar: `pulse` istnieje). */
export const IKONA_PASKA = '$(pulse)';

/** Nazwy przedzialow progow do tooltipa - w tekscie paska koloru nie widac, wiec nazywamy go slowami. */
export const OPIS_PROGU: Record<string, string> = {
	'charts.green': 'ponizej 50% (zielony)',
	'charts.yellow': '50-79% (zolty)',
	'charts.red': '80% i wiecej (czerwony, tlo ostrzegawcze)'
};

export function opisProgu(prog: ProgKoloru): string {
	return prog.tekst ? OPIS_PROGU[prog.tekst] ?? prog.tekst : 'brak danych';
}

/**
 * Okno o najwyzszym zuzyciu - jego procent decyduje o kolorze calego elementu paska.
 *
 * Okna bez procentu (CLI ich nie podalo) sa pomijane, zeby brak danych nie udawal zera
 * i nie wygladal na niskie zuzycie.
 */
export function najgorszeOkno(okna: OknoPaska[]): OknoPaska | undefined {
	let najgorsze: OknoPaska | undefined;
	for (const okno of okna) {
		if (typeof okno.procent !== 'number' || !Number.isFinite(okno.procent)) {
			continue;
		}
		if (!najgorsze || (najgorsze.procent as number) < okno.procent) {
			najgorsze = okno;
		}
	}
	return najgorsze;
}

/**
 * Prog koloru dla calego elementu paska: liczy sie najgorsze okno.
 *
 * Prog bierzemy z DOKLADNEJ wartosci, nie z liczby calkowitej pokazanej na pasku, zeby `80%`
 * znaczylo 80% zuzycia, a nie 79,5% zaokraglone w gore. Rozjazd widac tylko przy samej granicy,
 * a tooltip go nazywa (`kolor paska: ... - decyduje ...`).
 */
export function progPaska(okna: OknoPaska[]): ProgKoloru {
	return progKoloru(najgorszeOkno(okna)?.procent);
}

/**
 * Tresc pojedynczego elementu paska: ikona, `ARK` i procenty calkowite w kolejnosci okien
 * (sesja, tydzien, miesiac), np. `$(pulse) ARK 63% 11% 52%`.
 *
 * Bez etykiet `5h` / `7d` / `30d` (0.2.0): kolejnosc jest stala, a pelne nazwy okien, dokladne
 * procenty i czasy resetu niesie tooltip (`tooltipPaska`). Okno bez procentu pokazuje `?`.
 */
export function tekstPaska(okna: OknoPaska[]): string {
	if (okna.length === 0) {
		return IKONA_PASKA + ' ARK limity: brak danych';
	}
	return IKONA_PASKA + ' ARK ' + okna.map(okno => naProcentCalkowity(okno.procent)).join(' ');
}

/**
 * Dymek po najechaniu na element paska - tu miesci sie wszystko, co nie zmiescilo sie w pasku:
 * etykiety okien, dokladne procenty, paski blokowe, czasy resetu i nazwa progu koloru.
 */
export function tooltipPaska(okna: OknoPaska[], naglowek?: string): string {
	const linie: string[] = [];
	if (naglowek) {
		linie.push(naglowek);
		linie.push('');
	}
	linie.push('BytePlus ARK - limity planu (' + poleceniePlanu() + ', dane 1:1 z konsoli)');
	if (okna.length === 0) {
		linie.push('CLI nie zwrocilo zadnych okien planu.');
	} else {
		const najgorsze = najgorszeOkno(okna);
		linie.push(
			'kolor paska: ' +
				opisProgu(progPaska(okna)) +
				(najgorsze ? ' - decyduje ' + najgorsze.skrot + ' ' + naProcent(najgorsze.procent) : '')
		);
		linie.push('');
		for (const okno of okna) {
			linie.push(
				'  ' +
					okno.skrot.padEnd(4) +
					okno.etykieta.padEnd(16) +
					pasekProcentu(okno.procent) +
					'  [plan ' +
					okno.produkt +
					']'
			);
			linie.push(
				'  ' +
					' '.repeat(4) +
					(okno.resetLokalny
						? 'reset ' + okno.resetLokalny + ' (czasu lokalnego)' + (okno.zostalo ? ', ' + okno.zostalo : '')
						: 'brak informacji o resecie')
			);
		}
	}
	linie.push('');
	linie.push('Klik: szczegoly, odswiezanie, strona planu');
	return linie.join('\n');
}

/** Progi, ktore pokazuje diagnostyczna komenda podgladu (zielony / zolty / czerwony). */
export const KROKI_PODGLADU: readonly number[] = [30, 60, 90];

/** Sztuczne dane jednego kroku podgladu: wszystkie trzy okna maja ten sam procent. */
export function limityPodgladu(procent: number): LimityPlanu {
	return {
		pobranoS: new Date().toISOString(),
		kto: 'podglad kolorow (dane sztuczne)',
		pozycje: [
			{
				produkt: 'podglad',
				edycja: 'podglad',
				tier: 'podglad',
				subskrybowany: false,
				blad: undefined,
				aktualizacjaIso: undefined,
				okna: [
					{ kod: 'session', etykieta: 'Sesja (5 h)', procent, resetIso: undefined },
					{ kod: 'weekly', etykieta: 'Tydzien (7 dni)', procent, resetIso: undefined },
					{ kod: 'monthly', etykieta: 'Miesiac (30 dni)', procent, resetIso: undefined }
				]
			}
		],
		surowyJson: '{}'
	};
}

function opisViewer(viewer: unknown): string {
	if (!viewer || typeof viewer !== 'object') {
		return 'nieznana (CLI nie zwrocilo pola viewer)';
	}
	const v = viewer as Record<string, unknown>;
	const czesci = ['auth=' + (typeof v.auth_method === 'string' ? v.auth_method : '?')];
	czesci.push('root=' + (v.is_root === true ? 'tak' : v.is_root === false ? 'nie' : '?'));
	if (typeof v.user_name === 'string' && v.user_name.length > 0) {
		czesci.push('uzytkownik=' + v.user_name);
	}
	if (typeof v.account_id === 'string' && v.account_id.length > 0) {
		czesci.push('konto=' + v.account_id);
	}
	if (typeof v.region === 'string' && v.region.length > 0) {
		czesci.push('region=' + v.region);
	}
	return czesci.join(', ');
}

function naOkna(okresy: unknown): OknoPlanu[] {
	if (!Array.isArray(okresy)) {
		return [];
	}
	const okna: OknoPlanu[] = [];
	for (const surowe of okresy) {
		const o = surowe as { label?: unknown; percent?: unknown; reset_at?: unknown };
		const kod = typeof o.label === 'string' && o.label.length > 0 ? o.label : 'okno';
		okna.push({
			kod,
			etykieta: ETYKIETY[kod] ?? kod,
			procent: naLiczbe(o.percent),
			resetIso: typeof o.reset_at === 'string' && o.reset_at.length > 0 ? o.reset_at : undefined
		});
	}
	okna.sort((a, b) => {
		const indeksA = KOLEJNOSC.indexOf(a.kod);
		const indeksB = KOLEJNOSC.indexOf(b.kod);
		return (indeksA < 0 ? 99 : indeksA) - (indeksB < 0 ? 99 : indeksB);
	});
	return okna;
}

export function naLimity(payload: unknown, surowy: string): LimityPlanu | undefined {
	if (!payload || typeof payload !== 'object') {
		return undefined;
	}
	const obj = payload as { viewer?: unknown; items?: unknown };
	if (!Array.isArray(obj.items)) {
		return undefined;
	}
	const pozycje: PozycjaPlanu[] = [];
	for (const surowe of obj.items) {
		const i = surowe as {
			product?: unknown;
			edition?: unknown;
			tier?: unknown;
			subscribed?: unknown;
			periods?: unknown;
			error?: unknown;
			updated_at?: unknown;
		};
		const aktualizacja = naLiczbe(i.updated_at);
		pozycje.push({
			produkt: typeof i.product === 'string' ? i.product : '(bez nazwy)',
			edycja: typeof i.edition === 'string' ? i.edition : undefined,
			tier: typeof i.tier === 'string' && i.tier.length > 0 ? i.tier : undefined,
			subskrybowany: i.subscribed === true,
			okna: naOkna(i.periods),
			blad: typeof i.error === 'string' && i.error.length > 0 ? i.error : undefined,
			aktualizacjaIso: aktualizacja !== undefined ? new Date(aktualizacja).toISOString() : undefined
		});
	}
	return { pobranoS: new Date().toISOString(), kto: opisViewer(obj.viewer), pozycje, surowyJson: surowy };
}

/**
 * Jedna linia do kanalu wyjscia (diagnostyka). Zostawia skroty okien i dokladne procenty,
 * bo w logu miejsca nie brakuje, a przy szukaniu przyczyny liczy sie liczba, nie zaokraglenie.
 */
export function liniaLogu(limity: LimityPlanu): string {
	const czesci: string[] = [];
	for (const pozycja of limity.pozycje) {
		for (const okno of pozycja.okna) {
			czesci.push(skrotKodu(okno.kod) + ' ' + naProcent(okno.procent));
		}
	}
	return czesci.length > 0 ? 'ARK ' + czesci.join(' | ') : 'ARK limity: brak okien w odpowiedzi';
}

export function linieRaportu(limity: LimityPlanu): string[] {
	const linie = ['Limity planu BytePlus (arkcli usage plan, dane 1:1 z konsoli):'];
	linie.push('  kto: ' + limity.kto);
	linie.push('  pobrano: ' + limity.pobranoS);
	if (limity.pozycje.length === 0) {
		linie.push('  CLI nie zwrocilo zadnej pozycji planu');
	}
	for (const pozycja of limity.pozycje) {
		linie.push(
			'  plan: ' +
				pozycja.produkt +
				' (' +
				(pozycja.edycja ?? 'brak edycji') +
				', ' +
				(pozycja.tier ?? 'brak tier') +
				') subskrypcja: ' +
				(pozycja.subskrybowany ? 'aktywna' : 'brak') +
				(pozycja.blad ? ' BLAD: ' + pozycja.blad : '')
		);
		for (const okno of pozycja.okna) {
			const reset = naCzasLokalny(okno.resetIso);
			const zostalo = ileDo(okno.resetIso);
			linie.push(
				'    ' +
					okno.etykieta +
					': ' +
					pasekProcentu(okno.procent) +
					(reset ? '   reset ' + reset + ' (czasu lokalnego)' + (zostalo ? ', ' + zostalo : '') : '')
			);
		}
	}
	return linie;
}

function opisBledu(tekst: string): string {
	try {
		const json = JSON.parse(wytnijJson(tekst)) as { error?: { message?: unknown } };
		const komunikat = json.error?.message;
		if (typeof komunikat === 'string' && komunikat.length > 0) {
			return komunikat;
		}
	} catch {
		/* odpowiedz nie jest JSON-em - zwracamy tekst */
	}
	const oczyszczony = tekst.replace(/\s+/g, ' ').trim();
	return oczyszczony.length > 0 ? oczyszczony.slice(0, 400) : '(brak komunikatu)';
}

/** Rozpoznaje dwie najczestsze przeszkody: brak CLI i brak logowania SSO. */
export function klasyfikuj(tekst: string): WynikLimitow {
	const maly = tekst.toLowerCase();
	if (maly.includes('not recognized') || maly.includes('nie jest rozpoznawane') || maly.includes('no such file')) {
		return { rodzaj: 'brak-cli', opis: opisBledu(tekst) };
	}
	if (maly.includes('not configured') || maly.includes('auth login')) {
		return { rodzaj: 'brak-logowania', opis: opisBledu(tekst) };
	}
	return { rodzaj: 'blad', opis: opisBledu(tekst) };
}

/** Gotowe polecenie do wklejenia w terminalu VS Code (PowerShell). */
export function polecenieArkcli(dalszaCzesc: string): string {
	const exe = arkcliSciezka();
	return exe === 'arkcli' ? 'arkcli ' + dalszaCzesc : '& "' + exe + '" ' + dalszaCzesc;
}

/** To samo, co `polecenieArkcli('usage plan')`, ale z wybranym profilem (gdy ustawiono). */
export function poleceniePlanu(): string {
	const profil = arkcliProfil();
	return polecenieArkcli('usage plan' + (profil ? ' --profile ' + profil : ''));
}

/**
 * Profil z AK/SK - jedyna droga bez SSO. W arkcli 1.0.38 flagi AK/SK ma tylko przestarzale
 * `arkcli config init` (`--access-key`, `--secret-key`, `--profile`, `--set-default`); nastepca
 * `arkcli profile create` ich nie przyjmuje i bez istniejacej tozsamosci konczy sie "not configured"
 * (pomiar 2026-10-11 i pomiar flag 2026-10-14: `arkcli config init --help`).
 *
 * O powodzeniu rozstrzyga `arkcli auth status`, a nie tresc komunikatu.
 */
export async function utworzProfilAkSk(
	ak: string,
	sk: string,
	nazwa: string
): Promise<{ ok: boolean; opis: string }> {
	const plik = rozwiazArkcli(arkcliSciezka());
	if (!plik) {
		return { ok: false, opis: brakCliOpis() };
	}
	if (!wygladaNaAkSk(ak) || !wygladaNaAkSk(sk)) {
		return { ok: false, opis: 'klucz AK/SK jest za krotki albo ma znaki spoza base64' };
	}
	const profil = nazwa.trim().length > 0 ? nazwa.trim() : 'default';
	if (!wygladaNaAkSk(profil)) {
		return { ok: false, opis: 'nazwa profilu "' + profil + '" ma niedozwolone znaki' };
	}
	const wynik = await uruchomArkcli(
		plik,
		['config', 'init', '--access-key', ak.trim(), '--secret-key', sk.trim(), '--profile', profil, '--set-default'],
		60000
	);
	const tekst = (wynik.stdout.trim().length > 0 ? wynik.stdout : wynik.stderr).trim();
	if (wynik.bladUruchomienia) {
		return { ok: false, opis: wynik.bladUruchomienia };
	}
	const stan = await sprawdzLogowanie();
	if (wynik.kod === 0 && stan.ok) {
		return { ok: true, opis: 'profil ' + profil + ' zapisany i domyslny' };
	}
	return { ok: false, opis: skrocKomunikat(tekst) || stan.opis };
}

/** Komunikat o brakujacym CLI - ten sam w kazdym miejscu, z gotowym poleceniem instalacji. */
function brakCliOpis(): string {
	return (
		'nie znaleziono polecenia "' +
		arkcliSciezka() +
		'" w PATH ani w %APPDATA%\\npm; zainstaluj: npm install -g @byteplus/ark-cli@latest'
	);
}

/**
 * Faza 1 logowania SSO: `arkcli auth login --no-browser --format json`.
 *
 * Pomiar 2026-10-14: proces konczy sie sam po ok. 4 s (kod wyjscia 0), JSON z adresem idzie na
 * stdout, a tekst dla czlowieka na stderr. Wtyczka otwiera ten adres w przegladarce i czeka na kod.
 */
export async function rozpocznijLogowanie(): Promise<
	{ ok: true; dane: DaneAutoryzacji } | { ok: false; opis: string }
> {
	const plik = rozwiazArkcli(arkcliSciezka());
	if (!plik) {
		return { ok: false, opis: brakCliOpis() };
	}
	const wynik = await uruchomArkcli(plik, ['auth', 'login', '--no-browser', '--format', 'json'], 30000);
	if (wynik.bladUruchomienia) {
		return { ok: false, opis: wynik.bladUruchomienia };
	}
	const tekst = (wynik.stdout.trim().length > 0 ? wynik.stdout : wynik.stderr).trim();
	const dane = rozpoznajAutoryzacje(tekst);
	if (!dane) {
		return { ok: false, opis: 'arkcli nie zwrocil adresu autoryzacji: ' + skrocKomunikat(tekst) };
	}
	return { ok: true, dane };
}

/**
 * Faza 2 logowania SSO: wymiana kodu z przegladarki na token.
 *
 * O powodzeniu rozstrzyga `arkcli auth status` (nie zgadujemy z tresci komunikatu). Kod idzie do
 * CLI jako argument, dlatego najpierw sprawdzamy, ze sklada sie wylacznie ze znakow base64.
 */
export async function dokonczLogowanie(kod: string): Promise<{ ok: boolean; opis: string }> {
	const plik = rozwiazArkcli(arkcliSciezka());
	if (!plik) {
		return { ok: false, opis: brakCliOpis() };
	}
	if (!wygladaNaKod(kod)) {
		return {
			ok: false,
			opis: 'kod z przegladarki wyglada na niepelny (min. ' + MIN_DLUGOSC_KODU + ' znakow, same znaki base64)'
		};
	}
	const wynik = await uruchomArkcli(
		plik,
		['auth', 'login', '--no-browser', '--code', kod.trim()],
		60000
	);
	if (wynik.bladUruchomienia) {
		return { ok: false, opis: wynik.bladUruchomienia };
	}
	const stan = await sprawdzLogowanie();
	if (stan.ok) {
		return { ok: true, opis: 'zalogowano' };
	}
	const tekst = (wynik.stdout.trim().length > 0 ? wynik.stdout : wynik.stderr).trim();
	return { ok: false, opis: skrocKomunikat(tekst) || stan.opis };
}

/**
 * Czy CLI ma wazna tozsamosc control-plane (`arkcli auth status --format json`).
 * Uzywane takze po logowaniu w przegladarce i po zapisie profilu AK/SK - to jedyna bramka prawdy.
 */
export async function sprawdzLogowanie(): Promise<{ ok: boolean; opis: string }> {
	const plik = rozwiazArkcli(arkcliSciezka());
	if (!plik) {
		return { ok: false, opis: brakCliOpis() };
	}
	const wynik = await uruchomArkcli(plik, ['auth', 'status', '--format', 'json'], 30000);
	if (wynik.bladUruchomienia) {
		return { ok: false, opis: wynik.bladUruchomienia };
	}
	const tekst = (wynik.stdout.trim().length > 0 ? wynik.stdout : wynik.stderr).trim();
	return { ok: czyZalogowany(wynik.kod, tekst), opis: skrocKomunikat(tekst) };
}

/**
 * Pobiera trzy okna limitu (sesja 5 h, tydzien, miesiac) z `arkcli usage plan`.
 *
 * Sciezke do CLI rozwiazujemy sami (PATH, potem %APPDATA%\npm), bo menedzer rozszerzen
 * VS Code moze miec wezsze PATH niz terminal.
 */
export async function pobierzLimity(): Promise<WynikLimitow> {
	const exe = arkcliSciezka();
	const plik = rozwiazArkcli(exe);
	if (!plik) {
		return {
			rodzaj: 'brak-cli',
			opis:
				'nie znaleziono polecenia "' +
				exe +
				'" w PATH ani w %APPDATA%\\npm; zainstaluj: npm install -g @byteplus/ark-cli@latest'
		};
	}
	const profil = arkcliProfil();
	const argumenty = ['usage', 'plan', '--format', 'json'];
	if (profil) {
		argumenty.push('--profile', profil);
	}
	const wynik = await uruchomArkcli(plik, argumenty, 45000);
	if (wynik.bladUruchomienia) {
		return { rodzaj: 'blad', opis: wynik.bladUruchomienia };
	}
	const surowy = (wynik.stdout.trim().length > 0 ? wynik.stdout : wynik.stderr).trim();
	if (wynik.kod !== 0) {
		return klasyfikuj(surowy);
	}
	let sparsowane: unknown;
	try {
		sparsowane = JSON.parse(wytnijJson(surowy)) as unknown;
	} catch {
		return { rodzaj: 'blad', opis: 'arkcli nie zwrocil JSON-a: ' + surowy.replace(/\s+/g, ' ').slice(0, 300) };
	}
	const koperta = sparsowane as { ok?: unknown; error?: { message?: unknown }; data?: unknown };
	if (koperta.ok === false) {
		const komunikat = typeof koperta.error?.message === 'string' ? koperta.error.message : surowy;
		const klasyfikacja = klasyfikuj(komunikat);
		return klasyfikacja.rodzaj === 'blad' ? { rodzaj: 'blad', opis: komunikat } : klasyfikacja;
	}
	const limity = naLimity(koperta.data ?? sparsowane, surowy);
	if (!limity) {
		return {
			rodzaj: 'blad',
			opis: 'nieznany ksztalt odpowiedzi arkcli: ' + surowy.replace(/\s+/g, ' ').slice(0, 300)
		};
	}
	return { rodzaj: 'ok', limity };
}
