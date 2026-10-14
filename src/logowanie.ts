/**
 * Logowanie do control-plane BytePlus (limity planu) - czesc czysta, bez importu "vscode".
 *
 * Pomiar 2026-10-14 (arkcli 1.0.38, ta maszyna): `arkcli auth login --no-browser --format json`
 * konczy sie samo po ok. 4 s (kod wyjscia 0), JSON idzie na **stdout**, a tekst dla czlowieka
 * na stderr:
 *
 *   {
 *     "authorize_url": "https://signin.byteplus.com/authorize/oauth/authorize?...",
 *     "expires_in_sec": 600,
 *     "method": "sso_no_browser",
 *     "next_command": "arkcli auth login --no-browser --code <authorization-code>",
 *     "stage": "authorize_pending"
 *   }
 *
 * Faza druga to `arkcli auth login --no-browser --code <kod z przegladarki>`. Ten modul nic nie
 * uruchamia - tylko rozpoznaje wyjscie CLI i pilnuje przypomnien; sprawdza go test-logowanie.cjs.
 */

/** Rozpoznane wyjscie fazy 1 logowania SSO. */
export interface DaneAutoryzacji {
	/** Adres do otwarcia w przegladarce (dowolne urzadzenie). */
	authorizeUrl: string;
	/** `expires_in_sec` z CLI; brak w odpowiedzi = `undefined` (nie zgadujemy wartosci). */
	expiresInSec: number | undefined;
	/** `next_command` z CLI - gotowe polecenie dla czlowieka. */
	nextCommand: string;
	/** `stage` z CLI (`authorize_pending` = czekam na kod z przegladarki). */
	stage: string;
}

/** Najkrotszy kod z przegladarki, jaki przepuszczamy (sanity wobec pustego/urwanego wklejenia). */
export const MIN_DLUGOSC_KODU = 16;

/** Ile czekamy z kolejnym powiadomieniem o logowaniu, zeby VS Code nie zamienil sie w alarm. */
export const ODSTEP_PRZYPOMNIENIA_MS = 12 * 60 * 60 * 1000;

/**
 * Znaki dopuszczone w argumencie podawanym CLI (`--code`, AK/SK, nazwa profilu).
 * Kod i klucze BytePlus to base64 albo ciagi alfanumeryczne; wszystko inne odrzucamy,
 * bo argument idzie do procesu przez powloke.
 */
const BEZPIECZNE_ZNAKI = /^[A-Za-z0-9+/=_.:@-]+$/;

function wygladaNaAdres(tekst: string): boolean {
	return /^https?:\/\/[^\s"']{8,}$/i.test(tekst);
}

/**
 * Wyciaga adres autoryzacji z wyjscia `arkcli auth login --no-browser`.
 *
 * Najpierw probujemy JSON-a (CLI wypisuje go na stdout), a gdy go nie ma - samego adresu
 * z tekstu (np. gdy ktos uruchomil komende bez `--format json`).
 */
export function rozpoznajAutoryzacje(tekst: string): DaneAutoryzacji | undefined {
	const od = tekst.indexOf('{');
	const koniec = tekst.lastIndexOf('}');
	if (od >= 0 && koniec > od) {
		try {
			const dane = JSON.parse(tekst.slice(od, koniec + 1)) as Record<string, unknown>;
			const url = typeof dane.authorize_url === 'string' ? dane.authorize_url.trim() : '';
			if (wygladaNaAdres(url)) {
				const sekundy = dane.expires_in_sec;
				return {
					authorizeUrl: url,
					expiresInSec:
						typeof sekundy === 'number' && Number.isFinite(sekundy) && sekundy > 0 ? sekundy : undefined,
					nextCommand: typeof dane.next_command === 'string' ? dane.next_command : '',
					stage: typeof dane.stage === 'string' && dane.stage.length > 0 ? dane.stage : 'nieznany'
				};
			}
		} catch {
			/* nie JSON - ponizsza proba wyciagniecia adresu z tekstu */
		}
	}
	const zTekstu = tekst.match(/https:\/\/[^\s"']+/i)?.[0];
	if (zTekstu) {
		const oczyszczony = zTekstu.replace(/[.,)\]]+$/, '');
		if (wygladaNaAdres(oczyszczony)) {
			return { authorizeUrl: oczyszczony, expiresInSec: undefined, nextCommand: '', stage: 'nieznany' };
		}
	}
	return undefined;
}

/** Czy wklejony kod z przegladarki nadaje sie do wyslania CLI jako `--code`. */
export function wygladaNaKod(kod: string): boolean {
	const oczyszczony = kod.trim();
	return oczyszczony.length >= MIN_DLUGOSC_KODU && BEZPIECZNE_ZNAKI.test(oczyszczony);
}

/** To samo dla klucza AK/SK albo nazwy profilu (krotsze niz kod, ale ten sam zbior znakow). */
export function wygladaNaAkSk(wartosc: string): boolean {
	const oczyszczona = wartosc.trim();
	return oczyszczona.length >= 8 && oczyszczona.length <= 256 && BEZPIECZNE_ZNAKI.test(oczyszczona);
}

/** `600` -> `10 min`, `45` -> `45 s`; brak wartosci -> pusty napis (nie zgadujemy). */
export function minutyWaznosci(sekundy: number | undefined): string {
	if (sekundy === undefined || !Number.isFinite(sekundy) || sekundy <= 0) {
		return '';
	}
	if (sekundy < 60) {
		return Math.round(sekundy) + ' s';
	}
	return Math.round(sekundy / 60) + ' min';
}

/** Etap z CLI po polsku; nieznanego nie tlumaczymy na sile. */
export function opisEtapu(stage: string): string {
	if (stage === 'authorize_pending') {
		return 'czekam na kod z przegladarki';
	}
	return stage === 'nieznany' ? 'etap nieznany' : stage;
}

/** Po przerwie wolno znow przypomniec o logowaniu (brak wpisu = wolno od razu). */
export function przypomnienieWolno(
	ostatnie: number | undefined,
	teraz: number,
	odstepMs: number = ODSTEP_PRZYPOMNIENIA_MS
): boolean {
	if (ostatnie === undefined || !Number.isFinite(ostatnie)) {
		return true;
	}
	return teraz - ostatnie >= odstepMs;
}

/** Komunikat CLI do dymku/logu: jedna linia, bez ogonow, maks. 300 znakow. */
export function skrocKomunikat(tekst: string): string {
	return tekst.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Czy komenda control-plane potwierdza wazne logowanie.
 *
 * Pomiar 2026-10-14: bez logowania `arkcli auth status` konczy sie kodem 1 i zwraca
 * `{"ok":false,"error":{...}}`; pomiar 2026-10-11: po SSO zwraca `{"auth_method":"sso_no_browser",
 * "path":"fresh"}` (bez pola `ok`), wiec rozstrzyga kod wyjscia plus brak jawnego `"ok": false`.
 */
export function czyZalogowany(kodWyjscia: number, wyjscie: string): boolean {
	if (kodWyjscia !== 0) {
		return false;
	}
	return !/"ok"\s*:\s*false/.test(wyjscie);
}
