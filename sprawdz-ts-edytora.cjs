/*
 * sprawdz-ts-edytora.cjs - kompiluje projekt kompilatorem TypeScript, ktorego realnie
 * uzywa edytor VS Code (wbudowanym w instalacje), a nie tym z node_modules.
 *
 * Po co: 2026-10-11 edytor pokazal "Cannot find name 'process'", "Cannot find name 'URL'"
 * i "Cannot find name 'setTimeout'" w src/config.ts, src/extension.ts oraz src/limity.ts,
 * choc `npx tsc -p ./` (TypeScript 5.9.3) konczyl sie kodem 0. Pomiar wykazal, ze VS Code
 * nosi wbudowany TypeScript 6.0.3, ktory nie wciaga juz automatycznie wszystkich pakietow
 * z node_modules/@types - bez wpisu "types": ["node"] w tsconfig.json typy Node sa
 * niewidoczne, mimo ze @types/node lezy na dysku.
 *
 * Uruchomienie:
 *   node sprawdz-ts-edytora.cjs
 *   node sprawdz-ts-edytora.cjs "C:\sciezka\do\typescript\lib\typescript.js"
 *   $env:VSCODE_TS_KOMPILATOR = 'C:\...\typescript.js'   # to samo przez srodowisko
 *
 * Kod wyjscia: 0 = brak bledow, 1 = sa bledy (wypisane z plikiem, linia i kodem TS).
 */

const fs = require('fs');
const path = require('path');

function istniejePlik(plik) {
	try {
		return fs.statSync(plik).isFile();
	} catch {
		return false;
	}
}

// Szuka pliku o zadanym ogonie sciezki, schodzac w dol najwyzej o kilka poziomow.
// Potrzebne, bo instalator VS Code trzyma zasoby albo w <instalacja>\resources,
// albo w <instalacja>\<hash>\resources.
function szukajPliku(katalog, ogon, glebokosc) {
	if (glebokosc < 0) {
		return null;
	}
	const kandydat = path.join(katalog, ogon);
	if (istniejePlik(kandydat)) {
		return kandydat;
	}
	let wpisy = [];
	try {
		wpisy = fs.readdirSync(katalog, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const wpis of wpisy) {
		if (!wpis.isDirectory() || wpis.name === 'node_modules' || wpis.name.startsWith('.')) {
			continue;
		}
		const wynik = szukajPliku(path.join(katalog, wpis.name), ogon, glebokosc - 1);
		if (wynik) {
			return wynik;
		}
	}
	return null;
}

const OGON = path.join('extensions', 'node_modules', 'typescript', 'lib', 'typescript.js');

function znajdzKompilatorEdytora() {
	const podane = process.argv[2] || process.env.VSCODE_TS_KOMPILATOR || '';
	if (podane) {
		return istniejePlik(podane) ? { plik: podane, zrodlo: 'podana sciezka' } : { blad: 'nie ma pliku ' + podane };
	}
	const korzenie = [
		path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code'),
		path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code Insiders'),
		path.join(process.env.ProgramFiles || '', 'Microsoft VS Code'),
		path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft VS Code')
	];
	for (const korzen of korzenie) {
		if (!korzen || !fs.existsSync(korzen)) {
			continue;
		}
		const plik = szukajPliku(korzen, OGON, 3);
		if (plik) {
			return { plik, zrodlo: korzen };
		}
	}
	const lokalny = path.join(__dirname, 'node_modules', 'typescript', 'lib', 'typescript.js');
	if (istniejePlik(lokalny)) {
		return { plik: lokalny, zrodlo: 'node_modules projektu (edytor nie znaleziony)' };
	}
	return { blad: 'nie znaleziono TypeScript ani w instalacji VS Code, ani w node_modules' };
}

function opis(plik, linia, kolumna, kod, tresc) {
	const pozycja = plik ? plik + ':' + (linia + 1) + ':' + (kolumna + 1) : '(projekt)';
	return pozycja + '  TS' + kod + ': ' + tresc;
}

const znaleziony = znajdzKompilatorEdytora();
if (znaleziony.blad) {
	console.log('  BLAD ' + znaleziony.blad);
	process.exitCode = 1;
} else {
	const ts = require(znaleziony.plik);
	console.log('kompilator edytora: TypeScript ' + ts.version + ' (' + znaleziony.zrodlo + ')');

	const plikKonfiguracji = ts.findConfigFile(__dirname, ts.sys.fileExists, 'tsconfig.json');
	if (!plikKonfiguracji) {
		console.log('  BLAD nie znaleziono tsconfig.json od ' + __dirname);
		process.exitCode = 1;
	} else {
		const problemyKonfiguracji = [];
		const host = Object.assign({}, ts.sys, {
			onUnRecoverableConfigFileDiagnostic: (d) => problemyKonfiguracji.push(d)
		});
		const przetworzona = ts.getParsedCommandLineOfConfigFile(plikKonfiguracji, {}, host);
		const diagnostyka = [];
		for (const d of problemyKonfiguracji.concat(przetworzona.errors || [])) {
			diagnostyka.push(d);
		}
		const program = ts.createProgram({ rootNames: przetworzona.fileNames, options: przetworzona.options });
		for (const d of ts.getPreEmitDiagnostics(program)) {
			diagnostyka.push(d);
		}

		let bledy = 0;
		let ostrzezenia = 0;
		for (const d of diagnostyka) {
			const kategoria = d.category === ts.DiagnosticCategory.Error ? 'BLAD' : 'uwaga';
			if (d.category === ts.DiagnosticCategory.Error) {
				bledy += 1;
			} else {
				ostrzezenia += 1;
			}
			const pozycja = d.file && d.start !== undefined
				? ts.getLineAndCharacterOfPosition(d.file, d.start)
				: null;
			const plik = d.file ? d.file.fileName : null;
			console.log(
				'  ' + kategoria + ' ' +
				opis(plik, pozycja ? pozycja.line : 0, pozycja ? pozycja.character : 0, d.code, ts.flattenDiagnosticMessageText(d.messageText, ' '))
			);
		}

		console.log('pliki: ' + przetworzona.fileNames.length + ', bledy: ' + bledy + ', uwagi: ' + ostrzezenia);
		if (bledy === 0) {
			console.log('KOD CZYSTY W OCZACH EDYTORA');
			process.exitCode = 0;
		} else {
			console.log('WSKAZOWKA: brakujace typy Node naprawia wpis "types": ["node"] w tsconfig.json.');
			process.exitCode = 1;
		}
	}
}
