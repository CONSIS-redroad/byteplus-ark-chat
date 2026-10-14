# Historia zmian - BytePlus ModelArk (ARK) w czacie VS Code

Wtyczka autorska: **BartsGda** razem z **asystentem AI (Cline)** - czlowiek wnosil pomysl, decyzje
i weryfikacje pomiarowa, asystent AI pisal kod, testy i dokumentacje. W panelu Extensions widac ja
jako `BytePlus ModelArk (ARK) - modele do czatu` od wydawcy `ark-local` (lokalny identyfikator;
przed publikacja w Marketplace albo Open VSX trzeba go podmienic na wlasna nazwe wydawcy - patrz
`GITHUB-PUBLIKACJA.md`). Licencja: MIT (`LICENSE`).

Wpisy 0.1.0 - 0.1.3 powstaly na podstawie pomiaru zawartosci paczek `.vsix`
(skrypt `porownaj-vsix.ps1`: rozmiary i SHA256 plikow `extension/*` oraz roznica w
`contributes` miedzy wersjami), a nie z notatek.

## 0.3.0 (2026-10-14)

Logowanie do BytePlus **w oknie VS Code**: klik w pasek otwiera panel z trzema drogami, a gdy
logowanie wygasnie, wtyczka sama o tym przypomina. Terminal i `arkcli` przestaja byc czyms, co
uzytkownik musi znac.

- nowa droga bez terminala (`Wpisz kod z przegladarki`): wtyczka uruchamia faze 1
  (`arkcli auth login --no-browser --format json`), otwiera adres SSO z odpowiedzi i prosi tylko
  o wklejenie kodu (base64) w oknie VS Code - faza 2 leci juz w tle (`--code <kod>`),
- nowa droga `Zaloguj w przegladarce`: terminal z `arkcli auth login` plus **pilnowanie** wyniku
  (`KontrolerLimitow.pilnujLogowania`: co 15 s, maks. 12 prob, czyli 3 min), wiec pasek wraca do
  liczb bez klikania po zakonczeniu logowania w przegladarce,
- nowa droga `Wpisz klucz AK/SK` (`utworzProfilAkSk`): `arkcli config init --access-key ... 
  --secret-key ... --profile ... --set-default`, a nazwa profilu trafia do `byteplusArk.arkcliProfil`,
- element paska przy braku logowania jest teraz **klikalny i mowi wprost**: `$(key) ARK: zaloguj sie`
  (klik = panel logowania); `StatusBarItem.command` ustawia `ustawElement`, wiec w pozostalych
  stanach klik nadal otwiera szczegoly limitow,
- powiadomienie o logowaniu (`przypomnijLogowanie`): najwyzej raz na 12 h
  (`ODSTEP_PRZYPOMNIENIA_MS`, wpis `byteplusArk.przypomnienieLogowania` w `globalState`), przyciski
  `Zaloguj teraz` / `Pokaz limity planu` / `Wylacz pasek limitow`,
- nowy modul `src/logowanie.ts` (bez importu `vscode`): `rozpoznajAutoryzacje` (JSON fazy 1,
  z awaryjnym wyciagnieciem adresu z tekstu), `wygladaNaKod` / `wygladaNaAkSk` (walidacja znakow,
  bo argument idzie do CLI przez powolke), `minutyWaznosci`, `opisEtapu`, `przypomnienieWolno`,
  `skrocKomunikat`, `czyZalogowany`,
- nowe funkcje CLI w `src/limity.ts`: `rozpocznijLogowanie`, `dokonczLogowanie`, `sprawdzLogowanie`,
  `utworzProfilAkSk`, `brakCliOpis`; o powodzeniu logowania rozstrzyga `arkcli auth status`,
  a nie tresc komunikatu,
- nowe komendy: `BytePlus ARK: Zaloguj sie (limity planu)` i
  `BytePlus ARK: Zaloguj kodem z przegladarki (bez terminala)`,
- nowy test `test-logowanie.cjs` (12 sekcji) na zmierzonym wyjsciu fazy 1; `npm run sprawdz:testy`
  uruchamia go razem z `test-limity.cjs` i `test-dziennik.cjs`,
- **gotowe do publikacji na GitHubie**: `README.md` przepisany na opis publiczny (szybki start,
  funkcje, tabele komend i ustawien, drogi logowania), pelna dokumentacja techniczna przeniesiona do
  `DOKUMENTACJA.md`, nowe `CONTRIBUTING.md` (srodowisko, bramki, konwencje, jak wyglada dobry PR),
  szablony zgloszen `Blad` i `Propozycja / pomysl` oraz szablon PR w `.github/`, workflow bramek
  `.github/workflows/bramki.yml` (kompilacja oba kompilatorami, testy, kontrola paczki VSIX, artefakt),
  a w `package.json` pola `repository`, `bugs` i `homepage`; instrukcja wypchniecia i wydania wersji w
  `GITHUB-PUBLIKACJA.md`,
- sekcje testow, ktore pytaja realne `arkcli` (3, 5 i 6 w `test-limity.cjs`), **same sie pomijaja**, gdy
  CLI nie ma w srodowisku: sprawdzaja wtedy tylko rozpoznanie braku polecenia (`brak-cli`), wiec bramka
  jest zielona takze na czystym runnerze CI (pomiar lokalny bez zmian - z `arkcli` ida pelne sprawdzenia),
- paczka `.vsix` zawiera juz tylko to, co potrzebne wtyczce: testy, skrypty deweloperskie i pliki
  `.github/**` sa w `.vscodeignore` (19 -> 13 wpisow, 68375 -> 49177 B).

Pomiar CLI (2026-10-14, arkcli 1.0.38, ta maszyna): `arkcli auth login --no-browser --format json`
konczy sie samo po ok. 4 s (kod wyjscia 0), JSON na stdout (`authorize_url`, `expires_in_sec: 600`,
`method: sso_no_browser`, `next_command`, `stage: authorize_pending`), a tekst dla czlowieka na
stderr; `arkcli auth status` bez logowania konczy sie kodem 1 i `{"ok":false,...}`, a
`arkcli profile list` pokazuje komplet profili - czyli brakuje tylko swiezego tokenu.
`arkcli config init --help` potwierdza flagi `--access-key`, `--secret-key`, `--profile`,
`--set-default` (i przestarzalosc komendy).

Bramki i pomiar paczki (0.3.0, 14.10.2026): `npx tsc --noEmit -p ./` (TypeScript 5.9.3 z
`node_modules`) i `node sprawdz-ts-edytora.cjs` (wbudowany TypeScript 6.0.3 VS Code) - oba 0 bledow
(pliki 7); `npm run sprawdz:testy` (`test-limity.cjs` + `test-dziennik.cjs` + `test-logowanie.cjs`)
- wszystkie sprawdzenia OK (kod wyjscia 0); szablony YAML i workflow parsuja sie (`npx js-yaml` -
kod wyjscia 0 dla czterech plikow); `code --install-extension --force` ->
`ark-local.byteplus-ark-chat@0.3.0`. `byteplus-ark-chat-0.3.0.vsix`: 13 wpisow (bylo 19),
okolo 50 KB (49177 B przed dopisaniem tej sekcji; `out/*.js` i `package.json` bez zmian) -
`out/extension.js` 24209 -> 36814 B, `out/limity.js` 30854 -> 35893 B, `out/dziennik.js` 2065 B
(bez zmian), nowy `out/logowanie.js` 5594 B, `package.json` 8184 -> 8792 B, `readme.md`
14188 -> 9826 B (opis publiczny; pelna dokumentacja w `DOKUMENTACJA.md` poza paczka); komendy
6 -> 8, ustawienia 14 bez zmian. Testy (`test-*.cjs` 8871 B), skrypt `sprawdz-ts-edytora.cjs` i pliki
`.github/**` sa poza paczka - zostaja w repozytorium.

Poprawka dokumentacji z przegladu przed publikacja (ten sam dzien, po powyzszym pomiarze): cztery
miejsca twierdzily, ze wtyczka ma pole `private` i `nie jest publikowana` - pola `private`
w `package.json` **nie ma** (wyszukiwanie `"private"` bez wyniku), wiec zdanie bylo nieprawdziwe.
`README.md`, `DOKUMENTACJA.md` (dwa miejsca) i naglowek `CHANGELOG.md` mowia teraz wprost
o dystrybucji plikiem `.vsix` z GitHub Releases i o tym, czego wymaga sklep; `GITHUB-PUBLIKACJA.md`
dostal sekcje 7-9 (trzy kanaly dystrybucji z wymaganym kontem, instalacja z pliku `.vsix`,
publikacja `--oidc` bez PAT, checklista przed sklepem i kolejnosc po wypchnieciu). `package-lock.json`
mial `"version": "0.2.0"` przy `package.json` 0.3.0 - wyrownane przez `npm install
--package-lock-only` (`up to date, audited 5 packages`, exit 0), zeby `npm ci` nie przerwal workflow.
Bramki po poprawkach: `npm run compile` (TypeScript 5.9.3) exit 0, `node sprawdz-ts-edytora.cjs`
(TypeScript 6.0.3 VS Code) 0 bledow, `npm run sprawdz:testy` wszystkie sprawdzenia OK exit 0,
`npm run pakuj` exit 0. Paczka z poprawionym README (pomiar **przed** dopisaniem tego akapitu, bo
`changelog.md` jest w paczce): **13 wpisow, 49966 B**, `readme.md` 9826 -> 10060 B, `package.json`
i `out/*.js` bez zmian, a po `code --install-extension --force` znow
`ark-local.byteplus-ark-chat@0.3.0`.

Realne `arkcli usage plan` w tej sesji nadal zwraca `rodzaj: brak-logowania` (token SSO
`refresh_token is invalid`), wiec pelna sciezka "procenty na pasku" jest zmierzona tylko
w warstwie CLI (`--no-browser` faza 1, `auth status`, `config init --help`) i w testach bez sieci;
sam odczyt procentow wymaga ponownego `arkcli auth login` (panel w oknie VS Code).

## 0.2.0 (2026-10-14)

Jeden element paska stanu zamiast trzech i **jedno** ustawienie zamiast dwoch: procenty calkowite,
kolor z najgorszego okna, migracja starych kluczy bez utraty ustawien.

- pasek stanu to **jeden element**: `$(pulse) ARK 63% 11% 52%` (kolejnosc sesja / tydzien / miesiac),
  bez etykiet `5h` / `7d` / `30d`; pelne nazwy okien, dokladne procenty, paski blokowe i czasy
  resetu niesie tooltip (`tooltipPaska`), a kolor bierze sie z najgorszego okna,
- procenty na pasku sa calkowite (`naProcentCalkowity`: 0,4 -> `0%`, 49,6 -> `50%`, 79,64 -> `80%`),
  a prog liczy sie z **dokladnej** wartosci (`progPaska`), dlatego `79,64%` pokazuje `80%` jeszcze
  w kolorze zoltym; tooltip nazywa przedzial slowami i wskazuje okno decydujace,
- nowe ustawienie `byteplusArk.limityOdswiezanie` (enum: `wylaczone`, `tylko na zadanie`, `co 1 min`,
  `co 5 min`, `co 10 min`, `co 15 min` - domyslnie, `co 30 min`, `co 60 min`) zastapilo
  `byteplusArk.limityWStatusBar` + `byteplusArk.limityOdswiezanieSekundy`; `wylaczone` chowa element
  i nie pyta CLI w tle, `tylko na zadanie` zostawia ostatni odczyt z `globalState`, a komenda
  `Pokaz limity planu` dziala zawsze (pyta CLI mimo trybu),
- migracja starych kluczy: `limityWStatusBar=false` -> `wylaczone`, a `limityOdswiezanieSekundy`
  -> najblizsza opcja nie krotsza (120 -> `co 5 min`, 900 -> `co 15 min`); wartosci jawne czyta
  `inspect()` (bo `get()` zwraca tez domyslna wartosc ze schematu), a migracja trafia raz do kanalu
  wyjscia jako `[ustawienia] migracja: ...`,
- komenda diagnostyczna pokazuje teraz trzy kroki po 3 s (30% zielony, 60% zolty, 90% czerwony
  z tlem ostrzegawczym), a w dymku widac numer kroku,
- `liniaStatusu` -> `liniaLogu`: linia kanalu wyjscia zostaje z etykietami `5h` / `7d` / `30d`
  i dwoma miejscami po przecinku, bo w logu miejsca nie brakuje,
- nowe funkcje bez VS Code w `src/limity.ts`: `tekstPaska`, `progPaska`, `najgorszeOkno`,
  `naProcentCalkowity`, `tooltipPaska`, `opisProgu`, `odstepMsZOpcji`, `czyAutoOdczyt`,
  `czyPasekWidoczny`, `zSekundNaOpcje`, `wybierzOpcjeOdswiezania`, `limityPodgladu`, `KROKI_PODGLADU`
  (pole `OknoPaska.tekst` wypadlo - tekst sklada `tekstPaska`),
- nowe przypadki w `test-limity.cjs` (sekcje 9-13): tekst i zaokraglenia paska, brak etykiet okien
  w tresci paska, najgorsze okno i prog, tooltip, mapowanie sekund na opcje, migracja starych
  kluczy, kolory trzech krokow podgladu; zaslepka `vscode` ma teraz `inspect()`, ktory rozroznia
  wartosc wpisana od domyslnej.

Bramki i pomiar paczki (0.2.0, 14.10.2026): `npx tsc --noEmit -p ./` (TypeScript 5.9.3 z
`node_modules`) i `node sprawdz-ts-edytora.cjs` (wbudowany TypeScript 6.0.3 VS Code) - oba 0 bledow;
`npm run sprawdz:testy` - wszystkie sprawdzenia OK (kod wyjscia 0). Realne `arkcli usage plan` w tej
sesji zwrocilo `rodzaj: brak-logowania` (`STS refresh failed: invalid_request - The request parameter
refresh_token is invalid`), wiec pasek pokazuje wariant `ARK limity: zaloguj arkcli` - bramka testowa
przyjmuje `ok` albo `brak-logowania` i nie wymaga ponownego logowania SSO do przejscia.
`byteplus-ark-chat-0.2.0.vsix`: 17 plikow, 56826 B - `out/extension.js` 25834 -> 24209 B,
`out/limity.js` 20528 -> 30854 B, `out/dziennik.js` 2065 B (bez zmian), `package.json` 7131 -> 8184 B,
`readme.md` 13031 -> 14188 B, `changelog.md` 6890 -> 9755 B, `test-limity.cjs` 11827 -> 21398 B;
komendy 6 bez zmian, ustawienia 15 -> 14.

## 0.1.6 (2026-10-11)

Kolor progowy na pasku stanu: pasek rozbity na trzy osobne elementy - kazdy w swoim kolorze;
nowa komenda diagnostyczna (komendy 6, ustawienia 15).

- pasek stanu to teraz **trzy elementy** (sesja 5 h / tydzien 7 dni / miesiac 30 dni) zamiast jednej
  linii `ARK 5h 0% | 7d 0% | 30d 26,54%`; kazdy element ma wlasny kolor tekstu z palety motywu:
  `charts.green` ponizej 50%, `charts.yellow` od 50%, `charts.red` od 80%, a od 80% dochodzi
  dodatkowo tlo `statusBarItem.warningBackground` (VS Code dopuszcza tylko ostrzegawcze i bledne
  tlo elementu paska - stala `ALLOWED_BACKGROUND_COLORS` w `extensionHostProcess.js`),
- nowe funkcje w `src/limity.ts`: `progKoloru(procent)` (zwraca identyfikatory motywu jako napisy,
  wiec testy bez VS Code sprawdzaja progi bez zaslepki UI) oraz `oknaPaska(limity)` (rozklad okien
  na osobne elementy paska, z gotowym tekstem, resetem i progiem); stale `PROG_SRODEK` = 50
  i `PROG_OSTRZEZENIE` = 80,
- nowa komenda `BytePlus ARK: Podglad kolorow paska limitow (diagnostyka)` - pokazuje sztuczne
  30 / 60 / 90% na 10 s, zeby zobaczyc trzy progi bez czekania, az realne zuzycie dojdzie do 50 i 80%,
- tooltip kazdego elementu: nazwa okna z nazwa planu, pasek blokowy z procentem, czas resetu
  w czasie lokalnym i slowami nazwany prog (w samym pasku koloru nie widac); okno nieobecne
  w odpowiedzi CLI gasnie (`hide`), a stany awaryjne (brak CLI, brak logowania, brak danych)
  zajmuja tylko pierwszy element,
- dlaczego tylko pasek stanu: panel wyjscia VS Code **nie renderuje ANSI** (pomiar 2026-10-11),
  a `ThemeIcon.color` dziala wylacznie w drzewach - pasek jest jedynym miejscem, gdzie kolor
  progu jest widoczny,
- nowe przypadki w `test-limity.cjs`: progi 0 / 49,99 / 50 / 79,99 / 80 / 100 / 120 / brak danych,
  brak polskich znakow w identyfikatorach kolorow, rozklad okien na trzy elementy, puste limity,
- pomiar bramek 2026-10-11: `npm run compile` bez bledow, `npx tsc --noEmit` 0 bledow,
  `sprawdz-ts-edytora.cjs` (TS 6.0.3) 0 bledow, `npm run sprawdz:testy` - wszystkie sprawdzenia OK
  (`test-limity` kod wyjscia 0, `test-dziennik` kod wyjscia 0); odczyt na zywo po zmianie:
  sesja 63,05% (zolta), tydzien 10,56% (zielony), miesiac 51,57% (zolta).
- pomiar paczki (`byteplus-ark-chat-0.1.6.vsix`: 17 plikow, 48,55 KB): `out/extension.js`
  19722 -> 25834 B, `out/limity.js` 18122 -> 20528 B, `package.json` 6740 -> 7131 B,
  `readme.md` 11005 -> 13031 B, `changelog.md` 4625 -> 6890 B, `test-limity.cjs` 7410 -> 11827 B;
  komendy 5 -> 6, ustawienia 15 bez zmian.

## 0.1.5 (2026-10-11)

Pasek procentu w panelu tekstowym limitow; bez zmian w `contributes` (komendy 5, ustawienia 15).

- panel `BytePlus ARK` i lista szczegolow pokazuja pasek postepu zlozony z tekstu:
  `Sesja (5 h): [##########..........] 40,65%   reset ...` - nowa funkcja `pasekProcentu`
  w `src/limity.ts` (znaki U+2588 pelny blok / U+2591 jasny cien),
- dlaczego nie kolor: panel wyjscia VS Code nie renderuje sekwencji ANSI (pomiar 2026-10-11:
  w bundlu VS Code brak renderera ANSI dla panelu output - symbole `ansi*` dotycza tylko
  terminala), dlatego pasek jest zwyklym tekstem: widac go w `Output` i po skopiowaniu,
- `naProcent` zostaje (uzywa go `liniaStatusu`), pasek stanu bez zmian,
- nowe przypadki w `test-limity.cjs`: 0%, 100%, 50% (10/20 blokow), ponad 100% przyciete,
  brak danych = same cienie, przecinek w procencie,
- pomiar bramek 2026-10-11: `npx tsc --noEmit` 0 bledow, `sprawdz-ts-edytora.cjs` (TS 6.0.3)
  0 bledow, `npm run sprawdz:testy` - wszystkie sprawdzenia OK.

## 0.1.4 (2026-10-11)

Metadane autorstwa i test; pliki `out/*.js` bez zmian.

- `author` (BartsGda) i `contributors` (asystent AI - Cline) w `package.json`,
- zdanie o autorstwie w `description` (widoczne w panelu Extensions) i sekcja "Autorstwo" w `README.md`,
- nowe pliki w paczce: `LICENSE.txt` (MIT, copyright 2026 BartsGda) i `changelog.md`,
- krok 1b w `test-provider.cjs`: 4 wywolania listy modeli maja zostawic 1 linie `[info] ogloszam`
  w kanale wyjscia - mierzy ten sam odsiew, ktory ciszy log przy otwieraniu kolejnych sesji czatu,
- pomiar paczki (0.1.3 -> 0.1.4): `out/*.js` **bez zmian** (identyczne sumy SHA256), `package.json`
  6567 -> 6740 B, `readme.md` 9109 -> 11005 B, `test-provider.cjs` 6517 -> 7299 B, doszly
  `changelog.md` i `LICENSE.txt`; komendy 5, ustawienia 15 - bez zmian.

## 0.1.3 (2026-10-11)

- kanal wyjscia nie powtarza identycznych linii: `[info] ogloszam ... model(i)` oraz `[limity] ...`
  ida tylko przy zmianie tresci - nowy modul `src/dziennik.ts` (`DziennikZmian`), `out/dziennik.js`,
- po nieudanym odczycie limitow kolejna proba `arkcli usage plan` nie czesciej niz co 5 min
  (`ODSTEP_PONOWIENIA_MS` w `czyPonawiac`); komendy `Pokaz limity planu` i `Odswiez teraz`
  omijaja odstep (`odswiez(true)`),
- zmiana ustawien ma debounce 1 s, zeby zapis `settings.json` nie wolal `arkcli` kilka razy,
- nowy test bez sieci `test-dziennik.cjs` i skrypt `npm run sprawdz:testy`,
- pomiar paczki: `out/dziennik.js` nowy (2065 B), `out/extension.js` 18181 -> 19722 B,
  `out/provider.js` 12319 -> 12741 B; bez nowych komend i ustawien.

## 0.1.2 (2026-10-11)

- nowe ustawienie `byteplusArk.arkcliProfil` - wskazanie profilu `arkcli`, z ktorego wtyczka czyta
  limity (puste = profil domyslny CLI),
- nowy skrypt bramki `sprawdz-ts-edytora.cjs` - sprawdza kod kompilatorem wbudowanym w VS Code,
  obok `npx tsc` z `node_modules` (dwa rozne kompilatory),
- pomiar paczki: `out/limity.js` 16856 -> 18122 B, `readme.md` 5018 -> 9109 B
  (dokumentacja tras, limitow planu i logowania `arkcli`), `test-limity.cjs` 6349 -> 7410 B;
  bez nowych komend.

## 0.1.1 (2026-10-11)

- limity planu (sesja 5 h / 7 dni / 30 dni): nowa komenda
  `BytePlus ARK: Pokaz limity planu (sesja 5 h / 7 dni / 30 dni)` i pasek stanu,
- cztery nowe ustawienia: `byteplusArk.limityWStatusBar`, `byteplusArk.limityOdswiezanieSekundy`,
  `byteplusArk.arkcliSciezka`, `byteplusArk.konsolaPlanuUrl`,
- nowy modul `src/limity.ts` (`out/limity.js`, 16856 B) i jego test `test-limity.cjs` (6349 B),
- pomiar paczki: `out/extension.js` 8206 -> 18207 B, komendy 4 -> 5, ustawienia 10 -> 14.

## 0.1.0 (2026-10-11)

- pierwsza wersja: dostawca czatu `byteplus-ark` (9 modeli planu Coding Plan), klucz w
  SecretStorage albo w zmiennej srodowiskowej, 4 komendy (ustaw/usun klucz, stan, test polaczenia),
  10 ustawien, kanal wyjscia `BytePlus ARK`,
- pomiar paczki: 4 pliki `out/*.js`, brak modulu limitow.
