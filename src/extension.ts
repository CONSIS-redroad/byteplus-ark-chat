/**
 * Punkt wejscia wtyczki: rejestruje dostawce modeli BytePlus ARK i komendy obslugi klucza.
 *
 * Manifest (package.json) deklaruje contributes.languageModelChatProviders.vendor = "byteplus-ark",
 * a VS Code generuje z tego zdarzenie aktywacji "onLanguageModelChatProvider:byteplus-ark",
 * dlatego pole activationEvents nie jest potrzebne.
 */

import * as vscode from 'vscode';
import { ArkHttpError, sendChatRequest } from './arkClient';
import {
	SEKRET_KLUCZ,
	VENDOR,
	deleteApiKey,
	hostOf,
	isLocalBase,
	maskKey,
	readConfig,
	resolveApiKey,
	storeApiKey
} from './config';
import { ArkChatProvider } from './provider';
import {
	KLUCZ_OSTATNICH_LIMITOW,
	KROKI_PODGLADU,
	LimityPlanu,
	OPCJA_WYLACZONA,
	OknoPaska,
	ProgKoloru,
	WynikLimitow,
	arkcliSciezka,
	czyAutoOdczyt,
	dokonczLogowanie,
	ileDo,
	limityPodgladu,
	liniaLogu,
	linieRaportu,
	naCzasLokalny,
	odstepMsZOpcji,
	oknaPaska,
	opcjaOdswiezania,
	opisProgu,
	pasekProcentu,
	pobierzLimity,
	polecenieArkcli,
	poleceniePlanu,
	progKoloru,
	progPaska,
	rozpocznijLogowanie,
	stronaPlanu,
	tekstPaska,
	tooltipPaska,
	utworzProfilAkSk,
	wybierzOpcjeOdswiezania
} from './limity';
import { MIN_DLUGOSC_KODU, minutyWaznosci, opisEtapu, przypomnienieWolno, wygladaNaKod } from './logowanie';
import { DziennikZmian, czyPonawiac } from './dziennik';

/** Nazwa jedynego elementu paska stanu (widoczna takze w menu ukrywania elementow). */
const NAZWA_PASKA = 'ARK limity planu';

/** Ile trzyma sie jeden krok podgladu kolorow z komendy diagnostycznej (kroki: 30 / 60 / 90%). */
const PODGLAD_KROK_MS = 3000;

/** Kiedy ostatnio pokazano powiadomienie o logowaniu (ms) - zeby nie zamienic VS Code w alarm. */
const KLUCZ_PRZYPOMNIENIA = 'byteplusArk.przypomnienieLogowania';

/** Ile trwa pilnowanie logowania w przegladarce: 12 prob co 15 s = 3 min. */
const PROBY_PILNOWANIA = 12;
const ODSTEP_PILNOWANIA_MS = 15000;

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('BytePlus ARK');
	const provider = new ArkChatProvider(context, log);

	context.subscriptions.push(log, provider, vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
	log.appendLine('[start] VS Code ' + vscode.version + '; dostawca "' + VENDOR + '" zarejestrowany');

	const pasek = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	pasek.name = NAZWA_PASKA;
	pasek.command = 'byteplusArk.pokazLimity';
	const limity = new KontrolerLimitow(context, log, pasek);
	context.subscriptions.push(pasek, limity);
	limity.start();

	context.subscriptions.push(
		vscode.commands.registerCommand('byteplusArk.ustawKlucz', () => ustawKlucz(context, log, provider)),
		vscode.commands.registerCommand('byteplusArk.usunKlucz', () => usunKlucz(context, log, provider)),
		vscode.commands.registerCommand('byteplusArk.pokazStan', () => pokazStan(context, log, provider)),
		vscode.commands.registerCommand('byteplusArk.testuj', () => testujPolaczenie(context, log)),
		vscode.commands.registerCommand('byteplusArk.pokazLimity', () => pokazLimity(log, limity)),
		vscode.commands.registerCommand('byteplusArk.podgladProgow', () => limity.podgladProgow()),
		vscode.commands.registerCommand('byteplusArk.zaloguj', () => panelLogowania(context, log, limity)),
		vscode.commands.registerCommand('byteplusArk.zalogujKodem', () => logowanieKodem(context, log, limity)),
		vscode.workspace.onDidChangeConfiguration(zmiana => {
			if (zmiana.affectsConfiguration('byteplusArk')) {
				provider.refresh();
				log.appendLine('[konfiguracja] zmiana ustawien byteplusArk - odswiezam liste modeli');
				limity.zmianaUstawien();
			}
		})
	);
}

export function deactivate(): void {
	/* wszystko jest w context.subscriptions */
}

async function ustawKlucz(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	provider: ArkChatProvider
): Promise<void> {
	const obecny = await resolveApiKey(context, readConfig());
	const klucz = await vscode.window.showInputBox({
		title: 'BytePlus ARK - klucz API',
		prompt:
			'Klucz z ModelArk (Coding Plan) albo klucz grupy BYOK. Zapis trafia do SecretStorage VS Code' +
			(obecny ? ' (nadpisuje obecny: ' + maskKey(obecny.key) + ' ze zrodla: ' + obecny.source + ')' : ''),
		password: true,
		ignoreFocusOut: true,
		placeHolder: 'klucz API'
	});
	if (klucz === undefined) {
		return;
	}
	const oczyszczony = klucz.trim();
	if (oczyszczony.length === 0) {
		void vscode.window.showWarningMessage('BytePlus ARK: pusty klucz, nic nie zapisano.');
		return;
	}
	await storeApiKey(context, oczyszczony);
	provider.refresh();
	const cfg = readConfig();
	log.appendLine('[klucz] zapisany (' + maskKey(oczyszczony) + ') do SecretStorage pod kluczem ' + SEKRET_KLUCZ);
	void vscode.window.showInformationMessage(
		'BytePlus ARK: klucz zapisany (' +
			maskKey(oczyszczony) +
			'). Trasa: ' +
			hostOf(cfg.baseUrl) +
			', modele: ' +
			cfg.models.length +
			'.'
	);
}

async function usunKlucz(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	provider: ArkChatProvider
): Promise<void> {
	const potwierdzenie = await vscode.window.showWarningMessage(
		'BytePlus ARK: usunac klucz z SecretStorage?',
		{ modal: true },
		'Usun'
	);
	if (potwierdzenie !== 'Usun') {
		return;
	}
	await deleteApiKey(context);
	provider.refresh();
	log.appendLine('[klucz] usuniety z SecretStorage');
	void vscode.window.showInformationMessage('BytePlus ARK: klucz usuniety.');
}

async function pokazStan(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	provider: ArkChatProvider
): Promise<void> {
	const cfg = readConfig();
	const klucz = await resolveApiKey(context, cfg);
	const linie = [
		'BytePlus ARK - stan:',
		'  VS Code: ' + vscode.version,
		'  trasa: ' + cfg.baseUrl + (isLocalBase(cfg.baseUrl) ? '  [most lokalny, klucz opcjonalny]' : '  [chmura ARK]'),
		'  klucz: ' +
			(klucz
				? maskKey(klucz.key) + '  (zrodlo: ' + klucz.source + ')'
				: 'BRAK (SecretStorage i zmienna ' + (cfg.apiKeyEnvVar || '-') + ')'),
		'  modele (' + cfg.models.length + '): ' + cfg.models.join(', '),
		'  narzedzia: ' + (cfg.toolCalling ? 'wlaczone' : 'wylaczone') + ', obrazy: ' + (cfg.vision ? 'wlaczone' : 'wylaczone'),
		'  limit czasu: ' + cfg.timeoutSeconds + ' s, debug: ' + (cfg.debug ? 'wlaczony' : 'wylaczony')
	];
	for (const linia of linie) {
		log.appendLine(linia);
	}
	const wybor = await vscode.window.showInformationMessage(linie.join('\n'), 'Pokaz kanal wyjscia');
	if (wybor === 'Pokaz kanal wyjscia') {
		log.show();
	}
	provider.refresh();
}

async function testujPolaczenie(context: vscode.ExtensionContext, log: vscode.OutputChannel): Promise<void> {
	const cfg = readConfig();
	const klucz = await resolveApiKey(context, cfg);
	if (!klucz && !isLocalBase(cfg.baseUrl)) {
		void vscode.window.showWarningMessage('BytePlus ARK: najpierw ustaw klucz API.');
		return;
	}
	let model: string | undefined = cfg.models[0];
	if (cfg.models.length > 1) {
		model = await vscode.window.showQuickPick(cfg.models, { title: 'BytePlus ARK - model do testu' });
	}
	if (!model) {
		return;
	}
	const start = Date.now();
	let tekst = '';
	try {
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'BytePlus ARK: test ' + model },
			async () => {
				await sendChatRequest({
					baseUrl: cfg.baseUrl,
					apiKey: klucz?.key,
					model,
					messages: [{ role: 'user', content: 'Odpowiedz jednym slowem: OK' }],
					maxTokens: 16,
					timeoutMs: Math.min(cfg.timeoutSeconds, 60) * 1000,
					onText: fragment => {
						tekst += fragment;
					},
					onToolCall: () => undefined
				});
			}
		);
		const ms = Date.now() - start;
		const odpowiedz = tekst.trim().slice(0, 200);
		log.appendLine('[test] ' + model + ': HTTP 200 w ' + ms + ' ms; odpowiedz: "' + odpowiedz + '"');
		void vscode.window.showInformationMessage(
			'BytePlus ARK: OK (' + model + ', ' + ms + ' ms) -> "' + odpowiedz.slice(0, 80) + '"'
		);
	} catch (err) {
		const opis =
			err instanceof ArkHttpError
				? 'HTTP ' + err.status + ': ' + err.body
				: err instanceof Error
					? err.message
					: String(err);
		log.appendLine('[test] ' + model + ': BLAD - ' + opis);
		log.show();
		void vscode.window.showErrorMessage('BytePlus ARK: test nieudany - ' + opis);
	}
}

/**
 * Trzyma w pasku stanu limity planu: jeden element z procentami okien (sesja 5 h / tydzien /
 * miesiac) i kolorem najgorszego z nich.
 *
 * Zrodlem jest `arkcli usage plan` (CLI BytePlus), bo API ARK tego nie zwraca -
 * sprawdzone 2026-10-11: odpowiedzi ARK nie maja naglowkow z kwotami, a sam klucz ARK
 * jest odrzucany przez te komende CLI ("control-plane"). Bez logowania CLI pasek pokazuje
 * instrukcje, a ostatni udany odczyt lezy w globalState i sluzy jako dane awaryjne.
 *
 * Rytmem odczytu i widocznoscia elementu rzadzi jedno ustawienie
 * `byteplusArk.limityOdswiezanie` (`wylaczone` / `tylko na zadanie` / `co X min`).
 */
class KontrolerLimitow implements vscode.Disposable {
	private licznik: ReturnType<typeof setTimeout> | undefined;
	private licznikUstawien: ReturnType<typeof setTimeout> | undefined;
	private ostatniWynik: WynikLimitow | undefined;
	private ostatnieDane: LimityPlanu | undefined;
	private readonly dziennik = new DziennikZmian();
	private czasProby = 0;
	private wToku = false;
	private zatrzymany = false;
	private licznikPodgladu: ReturnType<typeof setTimeout> | undefined;
	private licznikLogowania: ReturnType<typeof setTimeout> | undefined;
	/** Powiadomienie o logowaniu juz leci - nie wysylamy drugiego, zanim uzytkownik nie odpowie. */
	private przypomnienieWRuchu = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly log: vscode.OutputChannel,
		private readonly pasek: vscode.StatusBarItem
	) {
		this.ostatnieDane = context.globalState.get<LimityPlanu>(KLUCZ_OSTATNICH_LIMITOW);
	}

	/**
	 * Start: nalezny element paska (z ostatniego odczytu z globalState, jesli jest), odczyt w tle
	 * tylko w trybie automatycznym i pierwszy licznik odswiezania. Tryb `wylaczone` nic nie robi
	 * poza schowaniem elementu, a `tylko na zadanie` czeka na klikniecie komendy.
	 */
	start(): void {
		const wybor = wybierzOpcjeOdswiezania();
		if (wybor.zrodlo === 'migracja' && wybor.opis) {
			this.log.appendLine('[ustawienia] migracja: ' + wybor.opis);
		}
		this.ustawPasek();
		if (czyAutoOdczyt(wybor.opcja)) {
			void this.odswiez();
		}
		this.zaplanuj();
	}

	dispose(): void {
		this.zatrzymany = true;
		if (this.licznik) {
			clearTimeout(this.licznik);
			this.licznik = undefined;
		}
		if (this.licznikUstawien) {
			clearTimeout(this.licznikUstawien);
			this.licznikUstawien = undefined;
		}
		if (this.licznikPodgladu) {
			clearTimeout(this.licznikPodgladu);
			this.licznikPodgladu = undefined;
		}
		if (this.licznikLogowania) {
			clearTimeout(this.licznikLogowania);
			this.licznikLogowania = undefined;
		}
	}

	/**
	 * Reakcja na zmiane ustawien: nowy interwal, nowa sciezka do CLI, ukrycie paska.
	 * Debounce 1 s, bo zapis `settings.json` wywoluje kilka zdarzen naraz, a kazdy odczyt
	 * to osobny proces `arkcli`.
	 */
	zmianaUstawien(): void {
		this.zaplanuj();
		if (this.licznikUstawien) {
			clearTimeout(this.licznikUstawien);
		}
		this.licznikUstawien = setTimeout(() => {
			this.licznikUstawien = undefined;
			if (!this.zatrzymany) {
				void this.odswiez();
			}
		}, 1000);
	}

	wynik(): WynikLimitow | undefined {
		return this.ostatniWynik;
	}

	/**
	 * Odczyt limitow z `arkcli usage plan`.
	 *
	 * `wymus` (klik uzytkownika) omija odstep po niepowodzeniu. Bez `wymus`, gdy poprzedni
	 * odczyt sie nie udal i minelo mniej niz `ODSTEP_PONOWIENIA_MS`, odpuszczamy proces CLI:
	 * powtorzony blad nic nie wnosi, a pasek zostaje na poprzednim stanie.
	 */
	async odswiez(wymus = false): Promise<WynikLimitow | undefined> {
		if (this.wToku) {
			return this.ostatniWynik;
		}
		if (
			!wymus &&
			(opcjaOdswiezania() === OPCJA_WYLACZONA || !czyPonawiac(this.ostatniWynik?.rodzaj, this.czasProby))
		) {
			// Tryb `wylaczone` nie pyta CLI w tle, a po niepowodzeniu odpuszczamy do `ODSTEP_PONOWIENIA_MS`.
			// Klikniecie komendy ma `wymus` i dziala w obu przypadkach.
			this.ustawPasek();
			return this.ostatniWynik;
		}
		this.wToku = true;
		this.czasProby = Date.now();
		if (opcjaOdswiezania() !== OPCJA_WYLACZONA) {
			this.ustawElement(
				'$(sync~spin) ARK limity: pobieram...',
				'BytePlus ARK: pytam ' + poleceniePlanu(),
				{}
			);
		}
		try {
			this.ostatniWynik = await pobierzLimity();
		} catch (err) {
			this.ostatniWynik = { rodzaj: 'blad', opis: err instanceof Error ? err.message : String(err) };
		}
		this.wToku = false;
		if (this.ostatniWynik.rodzaj === 'ok') {
			this.ostatnieDane = this.ostatniWynik.limity;
			await this.context.globalState.update(KLUCZ_OSTATNICH_LIMITOW, this.ostatnieDane);
			this.zapiszStan(liniaLogu(this.ostatniWynik.limity));
		} else {
			this.zapiszStan(this.ostatniWynik.rodzaj + ': ' + this.ostatniWynik.opis);
		}
		this.ustawPasek();
		return this.ostatniWynik;
	}

	/**
	 * Linia do kanalu wyjscia tylko wtedy, gdy rozni sie od poprzedniej. Bez tego co interwal
	 * lecial ten sam tekst (pomiar 2026-10-11: powtarzane `[limity] brak-logowania: ...`).
	 */
	private zapiszStan(tresc: string): void {
		if (this.dziennik.czyNowy(tresc)) {
			this.log.appendLine('[limity] ' + tresc);
		}
	}

	/**
	 * Nowy licznik odswiezania. Brak opcji automatycznej (`wylaczone`, `tylko na zadanie`)
	 * oznacza brak licznika - wtedy limity odswieza wylacznie komenda.
	 */
	private zaplanuj(): void {
		if (this.licznik) {
			clearTimeout(this.licznik);
			this.licznik = undefined;
		}
		if (this.zatrzymany) {
			return;
		}
		const odstep = odstepMsZOpcji(opcjaOdswiezania());
		if (odstep === undefined) {
			return;
		}
		this.licznik = setTimeout(() => {
			void this.odswiez().then(() => this.zaplanuj());
		}, odstep);
	}

	private ustawPasek(): void {
		if (opcjaOdswiezania() === OPCJA_WYLACZONA) {
			this.ukryjPasek();
			return;
		}
		const wynik = this.ostatniWynik;
		if (wynik?.rodzaj === 'ok') {
			this.pokazOkna(oknaPaska(wynik.limity), undefined);
			return;
		}
		if (wynik?.rodzaj === 'brak-cli') {
			this.ustawElement(
				'$(terminal) ARK limity: brak arkcli',
				'Nie znaleziono polecenia "' + arkcliSciezka() + '".\n' + wynik.opis + '\n\nKlik: instrukcja instalacji',
				{}
			);
			return;
		}
		if (wynik?.rodzaj === 'brak-logowania') {
			this.ustawElement(
				'$(key) ARK: zaloguj sie',
				'Limity planu wymagaja jednorazowego logowania konta BytePlus (SSO).\n' +
					wynik.opis +
					'\n\nKlik: zaloguj sie (przegladarka albo kod z przegladarki)',
				{},
				'byteplusArk.zaloguj'
			);
			void this.przypomnijLogowanie();
			return;
		}
		if (this.ostatnieDane) {
			this.pokazOkna(
				oknaPaska(this.ostatnieDane),
				'Ostatni udany odczyt: ' +
					(naCzasLokalny(this.ostatnieDane.pobranoS) ?? this.ostatnieDane.pobranoS) +
					(wynik ? '\nTeraz: ' + wynik.opis : '')
			);
			return;
		}
		this.ustawElement(
			'$(question) ARK limity: brak danych',
			(wynik && wynik.rodzaj === 'blad'
				? wynik.opis
				: 'Klik: sprawdz limity planu (' + poleceniePlanu() + ')') + '\n\nKlik: szczegoly',
			{}
		);
	}

	/** Wspolna droga udanego odczytu: tresc paska, dymek i kolor z najgorszego okna. */
	private pokazOkna(okna: OknoPaska[], naglowek: string | undefined): void {
		this.ustawElement(tekstPaska(okna), tooltipPaska(okna, naglowek), progPaska(okna));
	}

	/** Jeden element paska: tresc, dymek i (opcjonalnie) kolor progu oraz tlo ostrzegawcze. */
	private ustawElement(
		tekst: string,
		tooltip: string,
		prog: ProgKoloru,
		polecenie: string = 'byteplusArk.pokazLimity'
	): void {
		this.pasek.command = polecenie;
		this.pasek.text = tekst;
		this.pasek.tooltip = tooltip;
		this.pasek.color = prog.tekst ? new vscode.ThemeColor(prog.tekst) : undefined;
		this.pasek.backgroundColor = prog.tlo ? new vscode.ThemeColor(prog.tlo) : undefined;
		this.pasek.show();
	}

	/**
	 * Powiadomienie o koniecznosci logowania - najwyzej raz na `ODSTEP_PRZYPOMNIENIA_MS` (12 h),
	 * bo brak logowania jest trwaly, a pasek i tak pokazuje wtedy "zaloguj sie".
	 */
	private async przypomnijLogowanie(): Promise<void> {
		if (this.przypomnienieWRuchu) {
			return;
		}
		const ostatnie = this.context.globalState.get<number>(KLUCZ_PRZYPOMNIENIA);
		if (!przypomnienieWolno(ostatnie, Date.now())) {
			return;
		}
		this.przypomnienieWRuchu = true;
		try {
			await this.context.globalState.update(KLUCZ_PRZYPOMNIENIA, Date.now());
			const wybor = await vscode.window.showWarningMessage(
				'BytePlus ARK: limity planu wymagaja jednorazowego logowania konta BytePlus. ' +
					'Bez tego pasek nie pokazuje procentow. Logowanie wygasa, wiec czasem trzeba je powtorzyc.',
				'Zaloguj teraz',
				'Pokaz limity planu',
				'Wylacz pasek limitow'
			);
			if (wybor === 'Zaloguj teraz') {
				await vscode.commands.executeCommand('byteplusArk.zaloguj');
			} else if (wybor === 'Pokaz limity planu') {
				await vscode.commands.executeCommand('byteplusArk.pokazLimity');
			} else if (wybor === 'Wylacz pasek limitow') {
				await vscode.workspace
					.getConfiguration('byteplusArk')
					.update('limityOdswiezanie', OPCJA_WYLACZONA, vscode.ConfigurationTarget.Global);
			}
		} finally {
			this.przypomnienieWRuchu = false;
		}
	}

	/**
	 * Po zalogowaniu w przegladarce pasek ma wrocic do liczb bez klikania: pytamy CLI co 15 s
	 * (maks. `PROBY_PILNOWANIA` razy, czyli 3 min), dopoki odczyt nie przejdzie.
	 */
	pilnujLogowania(): void {
		if (this.licznikLogowania) {
			clearTimeout(this.licznikLogowania);
			this.licznikLogowania = undefined;
		}
		let proba = 0;
		const krok = (): void => {
			proba += 1;
			void this.odswiez(true).then(wynik => {
				if (this.zatrzymany) {
					return;
				}
				if (wynik?.rodzaj === 'ok') {
					this.log.appendLine('[logowanie] wykryto udane logowanie (proba ' + proba + ') - limity odczytane');
					void vscode.window.showInformationMessage('BytePlus ARK: zalogowano - limity planu odczytane.');
					return;
				}
				if (proba >= PROBY_PILNOWANIA) {
					this.log.appendLine(
						'[logowanie] nie doczekalem sie logowania po ' +
							PROBY_PILNOWANIA +
							' probach (' +
							(PROBY_PILNOWANIA * ODSTEP_PILNOWANIA_MS) / 60000 +
							' min); kliknij pasek, gdy sie zalogujesz'
					);
					return;
				}
				this.licznikLogowania = setTimeout(krok, ODSTEP_PILNOWANIA_MS);
			});
		};
		this.log.appendLine(
			'[logowanie] czekam na logowanie w przegladarce (co ' +
				ODSTEP_PILNOWANIA_MS / 1000 +
				' s, maks. ' +
				(PROBY_PILNOWANIA * ODSTEP_PILNOWANIA_MS) / 60000 +
				' min)'
		);
		this.licznikLogowania = setTimeout(krok, ODSTEP_PILNOWANIA_MS);
	}

	private ukryjPasek(): void {
		this.pasek.color = undefined;
		this.pasek.backgroundColor = undefined;
		this.pasek.hide();
	}


	/**
	 * Diagnostyka kolorow: trzy kroki po 3 s - 30% (zielony), 60% (zolty), 90% (czerwony z tlem),
	 * a potem powrot do prawdziwych liczb. Bez tego pojedynczego elementu w czerwieni nie da sie
	 * obejrzec inaczej niz czekajac, az zuzycie dojdzie do 80 procent.
	 */
	podgladProgow(): void {
		if (opcjaOdswiezania() === OPCJA_WYLACZONA) {
			void vscode.window.showWarningMessage(
				'BytePlus ARK: pasek limitow jest wylaczony (ustawienie byteplusArk.limityOdswiezanie = "wylaczone").'
			);
			return;
		}
		this.log.appendLine(
			'[podglad] sztuczne progi ' +
				KROKI_PODGLADU.join(' / ') +
				'% po ' +
				PODGLAD_KROK_MS / 1000 +
				' s (razem ' +
				(KROKI_PODGLADU.length * PODGLAD_KROK_MS) / 1000 +
				' s)'
		);
		this.pokazKrokPodgladu(0);
	}

	/** Jeden krok podgladu: sztuczne dane w pasku, numer kroku w dymku, potem nastepny krok. */
	private pokazKrokPodgladu(indeks: number): void {
		if (this.licznikPodgladu) {
			clearTimeout(this.licznikPodgladu);
			this.licznikPodgladu = undefined;
		}
		if (this.zatrzymany || indeks >= KROKI_PODGLADU.length) {
			this.ustawPasek();
			return;
		}
		const procent = KROKI_PODGLADU[indeks];
		const okna = oknaPaska(limityPodgladu(procent));
		this.ustawElement(
			tekstPaska(okna),
			tooltipPaska(
				okna,
				'PODGLAD KOLOROW: dane sztuczne ' +
					procent +
					'% (krok ' +
					(indeks + 1) +
					' z ' +
					KROKI_PODGLADU.length +
					') - prawdziwe limity wracaja po ' +
					(KROKI_PODGLADU.length * PODGLAD_KROK_MS) / 1000 +
					' s'
			),
			progPaska(okna)
		);
		this.licznikPodgladu = setTimeout(() => {
			this.licznikPodgladu = undefined;
			this.pokazKrokPodgladu(indeks + 1);
		}, PODGLAD_KROK_MS);
	}
}

/**
 * Ekran logowania do control-plane BytePlus (limity planu).
 *
 * Klucz API ARK nie wystarcza, a `arkcli` to szczegol implementacyjny - dlatego wszystko, co trzeba
 * zrobic, sprowadza sie do jednego panelu: przegladarka, kod z przegladarki albo klucz AK/SK.
 */
async function panelLogowania(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	limity: KontrolerLimitow
): Promise<void> {
	for (;;) {
		const wybor = await vscode.window.showQuickPick(
			[
				{
					label: '$(globe) Zaloguj w przegladarce',
					description: 'zalecane',
					detail:
						'Otwiera przegladarke i logowanie konta BytePlus. Wroc do VS Code po zalogowaniu - pasek limitow sam sie odswiezy.'
				},
				{
					label: '$(clippy) Wpisz kod z przegladarki',
					description: 'bez terminala i bez polecen',
					detail:
						'Wtyczka otworzy strone logowania, a ty wklejasz w oknie VS Code kod, ktory pokaze przegladarka.'
				},
				{
					label: '$(key) Wpisz klucz AK/SK',
					description: 'trasa bez logowania SSO',
					detail:
						'Wtyczka zapisze profil CLI z kluczem AK/SK (control-plane) i ustawi odczyt limitow na ten profil.'
				},
				{
					label: '$(question) Po co to logowanie?',
					description: 'krotkie wyjasnienie',
					detail: 'Limity planu sa po stronie control-plane, ktory nie przyjmuje klucza API ARK.'
				}
			],
			{
				title: 'BytePlus ARK - zaloguj sie (limity planu)',
				placeHolder: 'Procenty planu czyta oficjalne CLI BytePlus; klucz API ARK dziala tylko dla czatu.'
			}
		);
		if (!wybor) {
			return;
		}
		if (wybor.label.includes('Zaloguj w przegladarce')) {
			await logowaniePrzegladarka(context, log, limity);
			return;
		}
		if (wybor.label.includes('Wpisz kod')) {
			await logowanieKodem(context, log, limity);
			return;
		}
		if (wybor.label.includes('AK/SK')) {
			await logowanieAkSk(context, log, limity);
			return;
		}
		const odp = await vscode.window.showInformationMessage(
			'Limity planu (sesja 5 h / tydzien / miesiac) sa po stronie control-plane BytePlus, a ten ' +
				'wymaga jednorazowego logowania konta. Klucz API ARK obsluguje tylko czat (data-plane) i jest ' +
				'odrzucany przez `usage plan`. Logowanie wygasa (pomiar 2026-10-14: `refresh_token is invalid`), ' +
				'wtedy trzeba zalogowac sie ponownie - tak samo jak w konsoli BytePlus.',
			'Zaloguj teraz'
		);
		if (odp !== 'Zaloguj teraz') {
			return;
		}
	}
}

/** Droga 1: terminal z `arkcli auth login` plus pilnowanie, czy logowanie sie udalo. */
async function logowaniePrzegladarka(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	limity: KontrolerLimitow
): Promise<void> {
	const polecenie = polecenieArkcli('auth login');
	terminalZPoleceniami('BytePlus ARK - logowanie', [polecenie]);
	log.appendLine('[logowanie] start w terminalu: ' + polecenie);
	await zapamietajPrzypomnienie(context);
	const wybor = await vscode.window.showInformationMessage(
		'BytePlus ARK: zaloguj sie w przegladarce, ktora wlasnie sie otworzyla. Pasek limitow odswieze sam, gdy logowanie sie uda (do 3 min).',
		'Wole wpisac kod w oknie VS Code',
		'Pokaz kanal wyjscia'
	);
	if (wybor === 'Wole wpisac kod w oknie VS Code') {
		await logowanieKodem(context, log, limity);
		return;
	}
	if (wybor === 'Pokaz kanal wyjscia') {
		log.show();
	}
	limity.pilnujLogowania();
}

/** Droga 2: bez terminala - faza 1 (adres) w wtyczce, potem kod wklejony w oknie VS Code. */
async function logowanieKodem(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	limity: KontrolerLimitow
): Promise<void> {
	const start = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'BytePlus ARK: przygotowuje logowanie' },
		() => rozpocznijLogowanie()
	);
	if (!start.ok) {
		log.appendLine('[logowanie] nie udalo sie zaczac logowania: ' + start.opis);
		await zglosBladLogowania(log, start.opis);
		return;
	}
	const wazny = minutyWaznosci(start.dane.expiresInSec);
	log.appendLine(
		'[logowanie] etap: ' +
			opisEtapu(start.dane.stage) +
			(wazny ? ', kod wazny ' + wazny : '') +
			'; adres: ' +
			start.dane.authorizeUrl
	);
	await vscode.env.openExternal(vscode.Uri.parse(start.dane.authorizeUrl));
	const kod = await vscode.window.showInputBox({
		title: 'BytePlus ARK - kod z przegladarki',
		prompt:
			'W przegladarce zakoncz logowanie i skopiuj kod autoryzacji (base64)' +
			(wazny ? ' (wazny ' + wazny + ')' : '') +
			'. Adres otworzylem przed chwila.',
		placeHolder: 'kod autoryzacji (base64)',
		ignoreFocusOut: true,
		validateInput: wartosc => {
			if (wartosc.trim().length === 0) {
				return 'Wklej kod z przegladarki.';
			}
			return wygladaNaKod(wartosc)
				? undefined
				: 'Kod wyglada na niepelny: min. ' + MIN_DLUGOSC_KODU + ' znakow, same znaki base64.';
		}
	});
	if (kod === undefined) {
		log.appendLine('[logowanie] przerwane: nie podano kodu');
		return;
	}
	const wynik = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'BytePlus ARK: wymieniam kod na token' },
		() => dokonczLogowanie(kod)
	);
	log.appendLine('[logowanie] wynik: ' + (wynik.ok ? 'OK' : 'BLAD') + ' - ' + wynik.opis);
	if (!wynik.ok) {
		await zglosBladLogowania(log, wynik.opis);
		return;
	}
	await zapamietajPrzypomnienie(context);
	void vscode.window.showInformationMessage('BytePlus ARK: zalogowano - odczytuje limity planu.');
	await limity.odswiez(true);
}

/** Droga 3: klucz AK/SK - profil CLI bez SSO (flagi `config init` zmierzone 2026-10-14). */
async function logowanieAkSk(
	context: vscode.ExtensionContext,
	log: vscode.OutputChannel,
	limity: KontrolerLimitow
): Promise<void> {
	const ak = await vscode.window.showInputBox({
		title: 'BytePlus ARK - klucz AK/SK (1 z 2)',
		prompt: 'Access Key konta BytePlus (control-plane, nie klucz API ARK).',
		password: true,
		ignoreFocusOut: true
	});
	if (ak === undefined) {
		return;
	}
	const sk = await vscode.window.showInputBox({
		title: 'BytePlus ARK - klucz AK/SK (2 z 2)',
		prompt: 'Secret Key konta BytePlus.',
		password: true,
		ignoreFocusOut: true
	});
	if (sk === undefined) {
		return;
	}
	const nazwa = await vscode.window.showInputBox({
		title: 'BytePlus ARK - nazwa profilu CLI',
		prompt: 'Nazwa profilu, ktory powstanie w CLI (zostanie ustawiony jako domyslny).',
		value: 'coding-plan-aksk',
		ignoreFocusOut: true
	});
	if (nazwa === undefined) {
		return;
	}
	const wynik = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'BytePlus ARK: zapisuje profil AK/SK' },
		() => utworzProfilAkSk(ak, sk, nazwa)
	);
	log.appendLine('[logowanie] profil AK/SK: ' + (wynik.ok ? 'OK' : 'BLAD') + ' - ' + wynik.opis);
	if (!wynik.ok) {
		await zglosBladLogowania(log, wynik.opis);
		return;
	}
	await vscode.workspace
		.getConfiguration('byteplusArk')
		.update('arkcliProfil', nazwa.trim(), vscode.ConfigurationTarget.Global);
	await zapamietajPrzypomnienie(context);
	void vscode.window.showInformationMessage(
		'BytePlus ARK: profil ' + nazwa.trim() + ' gotowy (wpisalem go w ustawienie byteplusArk.arkcliProfil).'
	);
	await limity.odswiez(true);
}

/** Wspolny koniec nieudanego logowania: kanal wyjscia z bledem plus droga powrotu. */
async function zglosBladLogowania(log: vscode.OutputChannel, opis: string): Promise<void> {
	log.show();
	const wybor = await vscode.window.showErrorMessage(
		'BytePlus ARK: logowanie nieudane - ' + opis,
		'Sprobuj kodem z przegladarki',
		'Pokaz limity planu'
	);
	if (wybor === 'Sprobuj kodem z przegladarki') {
		await vscode.commands.executeCommand('byteplusArk.zalogujKodem');
	}
}

/** Zapisuje czas ostatniego powiadomienia o logowaniu (wspolne dla wszystkich drog). */
async function zapamietajPrzypomnienie(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(KLUCZ_PRZYPOMNIENIA, Date.now());
}

async function pokazLimity(log: vscode.OutputChannel, kontroler: KontrolerLimitow): Promise<void> {
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'BytePlus ARK: limity planu (arkcli usage plan)' },
		() => kontroler.odswiez(true)
	);
	zapiszRaport(log, kontroler.wynik());
	for (;;) {
		const wybor = await vscode.window.showQuickPick(elementyLimitow(kontroler), {
			title: 'BytePlus ARK - limity planu (sesja 5 h / tydzien / miesiac)',
			placeHolder: 'Limity pochodza z arkcli usage plan (dane 1:1 z konsoli BytePlus)'
		});
		if (!wybor) {
			return;
		}
		const etykieta = wybor.label;
		if (etykieta.includes('Odswiez teraz')) {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'BytePlus ARK: odswiezam limity' },
				() => kontroler.odswiez(true)
			);
			zapiszRaport(log, kontroler.wynik());
			continue;
		}
		if (etykieta.includes('Zaloguj sie (okno VS Code)')) {
			await vscode.commands.executeCommand('byteplusArk.zaloguj');
			return;
		}
		if (etykieta.includes('Instaluj')) {
			terminalZPoleceniami('BytePlus ARK - instalacja arkcli', [
				'npm install -g @byteplus/ark-cli@latest',
				polecenieArkcli('auth login'),
				poleceniePlanu()
			]);
			return;
		}
		if (etykieta.includes('Otworz strone planu')) {
			await vscode.env.openExternal(vscode.Uri.parse(stronaPlanu()));
			return;
		}
		if (etykieta.includes('Pokaz kanal wyjscia')) {
			log.show();
			return;
		}
		return;
	}
}

function zapiszRaport(log: vscode.OutputChannel, wynik: WynikLimitow | undefined): void {
	if (wynik?.rodzaj === 'ok') {
		for (const linia of linieRaportu(wynik.limity)) {
			log.appendLine(linia);
		}
		return;
	}
	if (wynik) {
		log.appendLine('[limity] ' + wynik.rodzaj + ': ' + wynik.opis);
		log.show();
	}
}

function elementyLimitow(kontroler: KontrolerLimitow): vscode.QuickPickItem[] {
	const biezacy = kontroler.wynik();
	const elementy: vscode.QuickPickItem[] = [];
	if (biezacy?.rodzaj === 'ok') {
		for (const pozycja of biezacy.limity.pozycje) {
			for (const okno of pozycja.okna) {
				const reset = naCzasLokalny(okno.resetIso);
				const zostalo = ileDo(okno.resetIso);
				const prog = progKoloru(okno.procent);
				elementy.push({
					label: '$(dashboard) ' + okno.etykieta,
					description: pasekProcentu(okno.procent),
					detail:
						(reset
							? 'reset: ' + reset + ' (czasu lokalnego)' + (zostalo ? ', ' + zostalo : '')
							: 'brak informacji o resecie') +
						'   [plan ' +
						pozycja.produkt +
						']' +
						'\nkolor paska: ' +
						opisProgu(prog)
				});
			}
			if (pozycja.blad) {
				elementy.push({
					label: '$(warning) ' + pozycja.produkt,
					description: 'blad z backendu',
					detail: pozycja.blad
				});
			}
		}
		elementy.push({ label: '$(refresh) Odswiez teraz', description: poleceniePlanu() });
	} else if (biezacy?.rodzaj === 'brak-logowania') {
		elementy.push({
			label: '$(key) Zaloguj sie (okno VS Code)',
			description: 'przegladarka albo kod z przegladarki',
			detail: 'Bez terminala i bez wpisywania polecen. Wtyczka nie dotyka zadnych kluczy.'
		});
		elementy.push({
			label: '$(cloud-download) Instaluj albo zaktualizuj arkcli',
			description: 'npm install -g @byteplus/ark-cli@latest'
		});
	} else if (biezacy?.rodzaj === 'brak-cli') {
		elementy.push({
			label: '$(cloud-download) Instaluj arkcli (npm)',
			description: 'npm install -g @byteplus/ark-cli@latest',
			detail: 'Potem: ' + polecenieArkcli('auth login')
		});
	} else if (biezacy) {
		elementy.push({ label: '$(warning) Blad odczytu limitow', description: biezacy.opis.slice(0, 120) });
	}
	elementy.push({
		label: '$(link-external) Otworz strone planu w konsoli',
		description: stronaPlanu(),
		detail: 'Strona My subscription pokazuje te same trzy procenty.'
	});
	elementy.push({ label: '$(output) Pokaz kanal wyjscia', description: 'BytePlus ARK' });
	return elementy;
}

function terminalZPoleceniami(nazwa: string, polecenia: string[]): void {
	const terminal = vscode.window.createTerminal(nazwa);
	terminal.show();
	for (const polecenie of polecenia) {
		terminal.sendText(polecenie);
	}
}
