/**
 * Odsiew powtorzen w kanale wyjscia "BytePlus ARK".
 *
 * Powod (pomiar 2026-10-11): VS Code wola `provideLanguageModelChatInformation` przy kazdym
 * otwarciu sesji czatu, a `KontrolerLimitow` odswieza limity co interwal. Identyczne co do znaku
 * linie zapychaly kanal tym samym tekstem (przy 9 sesjach czatu 9 x "[info] ogloszam 9 model(i)").
 * Modul jest czysty (bez importu "vscode"), zeby dalo sie go sprawdzic zwyklym node
 * - patrz test-dziennik.cjs.
 */

/** Pamiec ostatniej linii: identyczny tekst przepuszczamy tylko raz, dopoki sie nie zmieni. */
export class DziennikZmian {
	private ostatni: string | undefined;

	/** true = tekst jest nowy (nalezy go zapisac); false = to powtorka poprzedniej linii. */
	czyNowy(tekst: string): boolean {
		if (tekst === this.ostatni) {
			return false;
		}
		this.ostatni = tekst;
		return true;
	}

	/** Zapomina ostatnia linie - nastepne wywolanie zapisze nawet identyczna tresc. */
	reset(): void {
		this.ostatni = undefined;
	}
}

/**
 * Po nieudanym odczycie nie pytamy CLI (ani nie piszemy do logu) czesciej niz co tyle milisekund.
 * Ten sam blad nic nowego nie wnosi, a `arkcli usage plan` to dodatkowy proces node.
 */
export const ODSTEP_PONOWIENIA_MS = 5 * 60 * 1000;

/**
 * Decyzja "czy wolno ponowic odczyt".
 *
 * @param rodzaj    rodzaj ostatniego wyniku (`ok`, `brak-cli`, `brak-logowania`, `blad`)
 * @param czasProby czas ostatniej proby (ms, `Date.now()`)
 * @param teraz     czas biezacy; parametr istnieje po to, zeby test nie zalezal od zegara
 * @param odstepMs  minimalny odstep miedzy probami po niepowodzeniu
 */
export function czyPonawiac(
	rodzaj: string | undefined,
	czasProby: number,
	teraz: number = Date.now(),
	odstepMs: number = ODSTEP_PONOWIENIA_MS
): boolean {
	if (rodzaj === undefined || rodzaj === 'ok') {
		return true;
	}
	return teraz - czasProby >= odstepMs;
}
