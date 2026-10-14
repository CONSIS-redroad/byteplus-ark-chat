# BytePlus ModelArk (ARK) - dokumentacja techniczna

Pelny opis techniczny wtyczki `byteplus-ark-chat`: pomiary CLI (arkcli 1.0.38), tabela klas bledow,
wyjasnienie ograniczen (kolor w panelu wyjscia, rozjazd kompilatorow edytora i `node_modules`,
migracja starych ustawien 0.1.x) oraz pelne tabele ustawien i komend.

- krotki opis i szybki start: [README.md](README.md)
- zasady wspolpracy i bramki: [CONTRIBUTING.md](CONTRIBUTING.md)
- historia wersji: [CHANGELOG.md](CHANGELOG.md)

## Czym jest ta wtyczka

Wtyczka do czatu VS Code (dystrybucja: GitHub Releases z plikiem `.vsix`; kanaly sklepowe opisuje
`GITHUB-PUBLIKACJA.md`), ktora dodaje modele **BytePlus ModelArk** (Coding Plan) do pickera czatu
przez oficjalne API `vscode.lm.registerLanguageModelChatProvider`.

## Autorstwo

Wtyczke napisalismy razem: **BartsGda** i **asystent AI (Cline)** - czlowiek wnosil pomysl,
decyzje architektoniczne i weryfikacje pomiarowa (kazda zmiana musiala przejsc bramke: kompilacja,
testy, pomiar na zywo), asystent AI pisal kod, testy i dokumentacje. W panelu Extensions widac to
jako **`BytePlus ModelArk (ARK) - modele do czatu`** od wydawcy `ark-local` - to nasz lokalny
identyfikator wydawcy, nie publikacja w Marketplace. Ta sama informacja jest w `package.json`
(`author`, `contributors`), w `LICENSE` (MIT, 2026) i w `CHANGELOG.md`.

## Po co, skoro dziala plik `chatLanguageModels.json` (BYOK)

| | BYOK (`customendpoint`) | ta wtyczka |
| --- | --- | --- |
| naglowek `Authorization` | ustawiany przez VS Code na sztywno (`Bearer <klucz grupy>`), nie da sie nadpisac | wtyczka buduje zapytanie sama, wiec wysyla klucz tylko wtedy, gdy go zna |
| gdzie klucz | grupa w `chatLanguageModels.json` + UI (secret storage VS Code) | `SecretStorage` wtyczki albo zmienna srodowiskowa (`BYTEPLUS_ARK_API_KEY`) |
| dodatkowy proces | przy trasie przez most: LiteLLM na `127.0.0.1:4010` | niepotrzebny |
| obsluga bledow | surowy blad HTTP w czacie | komunikat z kodem i trescia odpowiedzi ARK |
| cos jeszcze | brak | komendy: ustaw/usun klucz, stan, test polaczenia, pokaz limity planu, zaloguj sie + jeden element paska stanu z trzema procentami limitow (`$(pulse) ARK 63% 11% 52%`) |

## Instalacja (z pliku `.vsix`)

```powershell
cd wtyczka-byteplus-ark
npm install
npm run compile
npx --yes @vscode/vsce@4.0.0 package --allow-missing-repository --skip-license
code --install-extension .\byteplus-ark-chat-0.3.0.vsix --force
```

Potem `Developer: Reload Window`. Modele pojawia sie w pickerze jako **`ARK: <model>`**.

## Klucz API

Trzy drogi, w kolejnosci sprawdzania:

1. `BytePlus ARK: Ustaw klucz API` (Ctrl+Shift+P) - zapis w `SecretStorage` VS Code.
2. zmienna srodowiskowa `BYTEPLUS_ARK_API_KEY` (nazwe zmienia ustawienie
   `byteplusArk.apiKeyEnvVar`; VS Code trzeba uruchomic z tej sesji srodowiska).
3. brak klucza - dziala tylko wtedy, gdy `byteplusArk.baseUrl` wskazuje na lokalny most
   LiteLLM bez autoryzacji (`http://127.0.0.1:4010/v1`).

## Ustawienia

| Ustawienie | Domyslnie | Opis |
| --- | --- | --- |
| `byteplusArk.baseUrl` | `https://ark.ap-southeast.bytepluses.com/api/coding/v3` | baza OpenAI-compatible |
| `byteplusArk.models` | `glm-5.2`, `glm-5.3-flash`, `deepseek-v4.1-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `dola-seed-2.0-pro`, `dola-seed-2.0-lite`, `seed-2-0-lite-260428`, `ark-code-latest` | identyfikatory modeli (wszystkie sprawdzone na zywo 2026-10-11) |
| `byteplusArk.labelPrefix` | `ARK` | prefiks nazwy w pickerze |
| `byteplusArk.maxInputTokens` / `maxOutputTokens` | `1024000` / `131072` | limity oglaszane VS Code (modele z planu maja 1024K = 1M kontekstu) |
| `byteplusArk.toolCalling` | `true` | tryb agenta (function calling) |
| `byteplusArk.vision` | `false` | modele z planu nie przyjmuja obrazow |
| `byteplusArk.apiKeyEnvVar` | `BYTEPLUS_ARK_API_KEY` | nazwa zmiennej srodowiskowej z kluczem (puste pole wylacza ten mechanizm) |
| `byteplusArk.timeoutSeconds` | `300` | limit czasu zapytania |
| `byteplusArk.debug` | `false` | log zapytan/odpowiedzi w kanale wyjscia (klucz maskowany) |
| `byteplusArk.limityOdswiezanie` | `co 15 min` | jeden przelacznik paska limitow: `wylaczone` (element schowany, bez pytania CLI w tle), `tylko na zadanie` (element z ostatnim odczytem), `co 1 min` ... `co 60 min`; kolor calego elementu bierze sie z najgorszego okna: `charts.green` < 50%, `charts.yellow` 50-79%, `charts.red` >= 80% (od 80% takze tlo `statusBarItem.warningBackground`) |
| `byteplusArk.arkcliSciezka` | `arkcli` | polecenie albo pelna sciezka do CLI BytePlus (`@byteplus/ark-cli`) |
| `byteplusArk.arkcliProfil` | puste | nazwa profilu arkcli do odczytu limitow (przydatne, gdy limity czyta profil z kluczem AK/SK, nie domyslny) |
| `byteplusArk.konsolaPlanuUrl` | link do `subscription/coding-plan` | strona konsoli otwierana z komendy limitow |

## Limity planu (sesja 5 h / 7 dni / 30 dni)

Strona `console.byteplus.com/ark/.../subscription/coding-plan` pokazuje procenty i czas resetu dla
trzech okien. Te same liczby zwraca `arkcli usage plan` (backend `My plans`, `/open/GetCodingPlanUsage`),
wiec wtyczka czyta je z CLI, a nie z czatu - odpowiedzi ARK **nie maja** naglowkow z kwotami
(sprawdzone 2026-10-11 dla trasy wprost i przez most LiteLLM).

Wymagane jednorazowe logowanie do konta BytePlus (control-plane nie przyjmuje klucza ARK).

Od 0.3.0 wystarczy klik w element paska (albo `BytePlus ARK: Zaloguj sie (limity planu)`) - otwiera
sie panel z trzema drogami, bez terminala i bez wpisywania polecen:

| Droga w panelu | Co robi wtyczka | Kiedy wybrac |
| --- | --- | --- |
| `Zaloguj w przegladarce` | otwiera terminal z `arkcli auth login`, a potem sama sprawdza co 15 s (do 3 min), czy logowanie sie udalo - pasek wraca do liczb bez klikania | najprostsza, gdy przegladarka jest na tej samej maszynie |
| `Wpisz kod z przegladarki` | faza 1 leci w tle (`arkcli auth login --no-browser --format json`), wtyczka otwiera adres SSO i prosi tylko o wklejenie kodu (base64) w oknie VS Code | gdy wolisz nie miec terminala albo logujesz sie na innym urzadzeniu |
| `Wpisz klucz AK/SK` | zapisuje profil CLI (`arkcli config init --access-key ... --secret-key ... --profile ... --set-default`) i wpisuje jego nazwe w `byteplusArk.arkcliProfil` | gdy nie chcesz SSO, a masz AK/SK konta |

Logowanie **wygasa** (pomiar 2026-10-14: `refresh_token is invalid`), wtedy pasek pokazuje
`$(key) ARK: zaloguj sie`, a wtyczka przypomina o tym powiadomieniem najwyzej raz na 12 h
(przyciski: `Zaloguj teraz`, `Pokaz limity planu`, `Wylacz pasek limitow`).

Te same kroki z terminala, gdy wolisz CLI:

```powershell
npm install -g @byteplus/ark-cli@latest
arkcli auth login                       # SSO konta BytePlus (otwiera przegladarke)
# bez przegladarki (dwie fazy): arkcli auth login --no-browser, potem --code <kod base64>
# albo bez SSO, kluczem AK/SK z konsoli (przestarzale w arkcli 1.0.38, ale wciaz jedyna droga z AK/SK):
# arkcli config init --access-key <AK> --secret-key <SK> --profile ak --set-default
arkcli usage plan                       # kontrolne sprawdzenie: trzy okna
arkcli profile list                     # jakie profile ma CLI (do byteplusArk.arkcliProfil)
```

W arkcli 1.0.38 `config init` wypisuje `Command "init" is deprecated, use arkcli profile create
instead (cmd/config will be removed in next minor)`. Nastepca `arkcli profile create` **nie ma** flag
`--access-key` / `--secret-key`, a samo `--default-api-key <klucz ARK>` nie tworzy dzialajacego
profilu (bez tozsamosci control-plane zwraca `not configured`, sprawdzone 2026-10-11). Trasa bez SSO
zostaje wiec na przestarzalym `config init` do czasu, gdy CLI nie usunie `cmd/config`.

Wtyczka: jeden element paska stanu + `BytePlus ARK: Pokaz limity planu (sesja 5 h / 7 dni / 30 dni)`
(szczegoly, czasy resetu w czasie lokalnym, przyciski: odswiez, strona planu, zaloguj sie w oknie VS
Code, kanal wyjscia). Gdy CLI nie ma albo nie ma logowania, zamiast liczb pojawia sie zaproszenie do
zalogowania, a ostatni udany odczyt sluzy jako dane awaryjne.

### Pasek stanu: jeden element, kolor z najgorszego okna (od 0.2.0)

Element pokazuje ikone, `ARK` i trzy procenty calkowite w stalej kolejnosci **sesja / tydzien /
miesiac**, np. `$(pulse) ARK 63% 11% 52%`. Etykiet `5h` / `7d` / `30d` ani miejsc po przecinku
w samym pasku nie ma - to wszystko jest w tooltipie:

```
BytePlus ARK - limity planu (arkcli usage plan, dane 1:1 z konsoli)
kolor paska: 80% i wiecej (czerwony, tlo ostrzegawcze) - decyduje 30d 95%

  5h   Sesja (5 h)      [###########.........] 63,05%   [plan coding-plan]
       reset 2026-10-12 01:22 (czasu lokalnego), za 3 godz. 43 min

Klik: szczegoly, odswiezanie, strona planu
```

Kolor calego elementu bierze sie z najgorszego okna, a prog liczy sie z **dokladnej** wartosci
(dlatego `79,64%` pokazuje `80%` jeszcze w kolorze zoltym):

| Procent najgorszego okna | Kolor tekstu (`StatusBarItem.color`) | Tlo |
| --- | --- | --- |
| mniej niz 50% | `charts.green` | domyslne |
| 50-79% | `charts.yellow` | domyslne |
| 80% i wiecej | `charts.red` | `statusBarItem.warningBackground` |
| brak danych | domyslny kolor motywu | domyslne |

Innego tla ustawic nie mozna: VS Code przyjmuje tylko `statusBarItem.warningBackground`
i `statusBarItem.errorBackground` (stala `ALLOWED_BACKGROUND_COLORS` w `extensionHostProcess.js`).
Progi obejrzysz bez czekania na realne zuzycie komenda
`BytePlus ARK: Podglad kolorow paska limitow (diagnostyka)` - pokazuje sztuczne 30 / 60 / 90%
po 3 s (numer kroku widac w dymku), potem wraca do prawdziwych liczb. Stany awaryjne zajmuja ten
samo elementu tekstem: `$(terminal) ARK limity: brak arkcli`,
`$(key) ARK: zaloguj sie` (ten wariant jest klikalny i otwiera panel logowania),
`$(question) ARK limity: brak danych`, a w czasie odczytu `$(sync~spin) ARK limity: pobieram...`.

Koloru **nie da sie** pokazac w panelu wyjscia ani na liscie szczegolow: panel nie renderuje
sekwencji ANSI (pomiar 2026-10-11 - w bundlu VS Code brak renderera ANSI dla panelu output;
symbole `ansi*` dotycza tylko terminala), a `ThemeIcon.color` dziala tylko w drzewach. Dlatego
panel i lista pokazuja pasek blokowy z procentem:

```
Sesja (5 h): [##########..........] 40,65%   reset 2026-10-12 01:22 (czasu lokalnego), za 3 godz. 43 min
```

Pasek blokowy to zwykly tekst (znaki U+2588 pelny blok / U+2591 jasny cien), wiec widac go
i w `Output`, i po skopiowaniu. Ten sam odczyt z kolorem progowym w terminalu daje
`limity-ark.ps1` (zielony < 50%, zolty 50-79%, czerwony >= 80%; `-BezKoloru` albo `NO_COLOR=1`
wylacza kolor, a paski zostaja).

Logowanie SSO **samo tworzy profile** (pomiar 2026-10-11): `arkcli auth login --no-browser --code
<kod base64>` konczy sie komunikatem `[arkcli] Created 2 profiles; "coding-plan_ap-southeast-1_personal"
is the default.` Powstaja `coding-plan_ap-southeast-1_personal` (Coding Plan Lite, wlasciciel
`trn:iam::3004722819:root`, to konto planu) oraz `platform_ap-southeast-1_accountwide`
(Pay-as-you-go), dlatego `byteplusArk.arkcliProfil` moze zostac puste.

Zeby kanal wyjscia nie zapychal sie tym samym tekstem (od 0.1.3): identyczna linia trafia do niego raz
(`src/dziennik.ts`), po nieudanym odczycie kolejna proba czeka 5 min (`ODSTEP_PONOWIENIA_MS`),
a zmiana ustawien ma debounce 1 s. Klik "Pokaz limity planu" i "Odswiez teraz" zawsze pyta CLI i
zapisuje wynik do kanalu bez odsiewu (dlatego po kliknieciu ta sama linia moze stac obok tej samej
z odczytu w tle).

## Komendy

- `BytePlus ARK: Ustaw klucz API`
- `BytePlus ARK: Usun klucz API`
- `BytePlus ARK: Pokaz stan (klucz, trasa, modele)`
- `BytePlus ARK: Testuj polaczenie z ARK`
- `BytePlus ARK: Pokaz limity planu (sesja 5 h / 7 dni / 30 dni)`
- `BytePlus ARK: Podglad kolorow paska limitow (diagnostyka)` - trzy kroki po 3 s: 30 / 60 / 90%
  (zielony / zolty / czerwony z tlem, numer kroku w dymku), potem wraca prawdziwy odczyt
- `BytePlus ARK: Zaloguj sie (limity planu)` - panel logowania (przegladarka / kod z przegladarki /
  AK-SK); ten sam panel otwiera klik w element paska, gdy brakuje logowania
- `BytePlus ARK: Zaloguj kodem z przegladarki (bez terminala)` - od razu droga "kod z przegladarki"

## Rozwoj (bez pakowania)

```powershell
cd wtyczka-byteplus-ark
npm install
npm run watch
```

W VS Code: F5 (konfiguracja `Uruchom wtyczke (Extension Host)` w `.vscode/launch.json`).

Paczka `.vsix` i instalacja:

```powershell
npm run pakuj     # wola npx --yes @vscode/vsce: `vsce` nie ma ani lokalnie, ani w PATH (pomiar 2026-10-11)
code --install-extension .\byteplus-ark-chat-<wersja>.vsix --force
```

Numer wersji w `package.json` podbijasz recznie; VSIX w tej samej wersji instalator podmienia
tylko z flaga `--force`, po czym w oknie trzeba dac `Developer: Reload Window`.

## Zgodnosc z kompilatorem edytora

Edytor kompiluje projekt **wbudowanym** TypeScript (w tej instalacji 6.0.3), a `npm run compile`
uzywa tego z `node_modules` (5.9.3). TypeScript 6.x nie wciaga juz automatycznie wszystkich paczek
z `node_modules/@types`, dlatego w `tsconfig.json` jest jawny wpis `"types": ["node"]` - bez niego
Problems pokazuje `Cannot find name 'process'` / `'URL'` / `'setTimeout'` / `'fetch'`, mimo ze
`tsc` konczy sie kodem 0. Rozjazd wersji sprawdzisz bez otwierania edytora:

```powershell
node sprawdz-ts-edytora.cjs   # npm run sprawdz:ts-edytora; kod wyjscia 0 = brak bledow
```

## Testy bez VS Code

```powershell
$env:BYTEPLUS_ARK_API_KEY = [Environment]::GetEnvironmentVariable('BYTEPLUS_ARK_API_KEY','User')
node test-na-zywo.cjs        # klient HTTP + SSE: strumien, narzedzia, zly klucz, most 4010
node test-provider.cjs       # caly dostawca z zaslepka modulu "vscode" (pelna petla agenta; krok 1b: odsiew powtorzen)
$env:ARK_TEST_TRASA='most'; $env:BYTEPLUS_ARK_API_KEY=''; node test-provider.cjs   # trasa bez klucza
```

Testy korzystaja z `out/`, wiec przed ich uruchomieniem wywolaj `npm run compile`.
`npm install` instaluje 3 bezposrednie paczki: `typescript`, `@types/vscode`, `@types/node`.

Bramka bez sieci i bez klucza (parsowanie odpowiedzi CLI + odsiew powtorzen w logu):

```powershell
npm run sprawdz:testy   # test-limity.cjs + test-dziennik.cjs; kod wyjscia 0 = wszystko OK
```

`test-limity.cjs` (13 sekcji) wola takze realne `arkcli usage plan`: przy zalogowanym CLI stan to `ok`
(z trzema oknami), przed logowaniem `brak-logowania`, a brak polecenia `brak-cli`. Poza tym sprawdza
tekst i zaokraglenia paska, brak etykiet okien w tresci paska, progi koloru (takze `79,64%` -> prog
zolty przy wyswietlanych `80%`), tooltip, mapowanie starych sekund na nowe opcje i migracje starych
kluczy (`limityWStatusBar`, `limityOdswiezanieSekundy`).
`test-dziennik.cjs` sprawdza `out/dziennik.js` bez zaslepki "vscode" (modul jest czysty).

## Rozwiazywanie problemow: `brak-cli` w kanale wyjscia

Komunikat `[limity] brak-cli: nie znaleziono polecenia "arkcli" ...` i pasek
`$(terminal) ARK limity: brak arkcli` oznaczaja, ze **binarki naprawde nie ma**: wtyczka nie
uruchamia wtedy zadnego polecenia w powloce, tylko sama sprawdza plik (najpierw PATH, potem
`%APPDATA%\npm\arkcli.cmd`). Pomiar 2026-10-14: katalog `%APPDATA%\npm` zniknal z maszyny miedzy
udanym odczytem limitow a odczytem w tle, a po `npm install -g @byteplus/ark-cli@latest` wszystko
wrocilo bez ponownego logowania (`~/.arkcli-bp` z profilami przezywa reinstalacje). Sciezka do CLI
jest rozwiazywana przy kazdym odczycie, wiec po instalacji wystarczy komenda
`BytePlus ARK: Pokaz limity planu` - bez `Developer: Reload Window`. Komendy pomiarowe i pelna
chronologia: `../limity-planu-ark.md`.

## Znane ograniczenia

- Plan Coding Plan wygasa **17.10.2026** i nie odnawia sie sam.
- Limity modeli (stan na 2026-10-11, zrodlo: lista modeli BytePlus ModelArk, region
  ap-southeast-1): `glm-5.2`, `glm-5.3-flash`, `deepseek-v4.1-flash`, `deepseek-v4-flash`,
  `deepseek-v4-pro` - 1024K kontekstu, 128K-384K wyjscia;
  `dola-seed-2.0-pro` / `dola-seed-2.0-lite` - 256K; `seed-2-0-lite-260428` - 256K;
  `ark-code-latest` - alias planu, nie ma go na oficjalnej liscie, wiec przyjmuje limit
  modelu docelowego (traktowac ostroznie i sprawdzac pomiarem).
  Domyslny limit wyjscia u dostawcy to tylko 4K, dlatego wtyczka wysyla `max_tokens`.
- Poza planem (HTTP 404): `dola-seed-2.1-turbo`, `dola-seed-2-1-turbo-260628`, `auto`.
- Bez zadnego klucza i bez lokalnego mostu modele nie pojawia sie w pickerze (celowo:
  zamiast zwracac blad z ARK, wtyczka pokazuje raz komunikat z prosba o klucz).
- Tryb `tools` zalezy od modelu; `glm-5.2` i `deepseek-v4.1-flash` przyjmuja narzedzia,
  ale nie kazdy model z planu wspiera rownolegle wywolania.
- VS Code zglasza w `package.json` ostrzezenie, ze `contributes.languageModelChatProviders.managementCommand`
  jest przestarzale. Zostaje celowo: nastepca (`configuration`) zapisuje wartosci - takze sekrety -
  po stronie hosta (klucz `chat.lm.secret.<hex>`), a `LanguageModelChatProvider` z `@types/vscode` 1.140
  nie daje wtyczce API do ich odczytu, wiec klucz wpisany tam nie dotarlby do klienta HTTP.
- Wtyczka nie jest (jeszcze) w Marketplace ani Open VSX - instaluje sie ja z pliku `.vsix`.
  Publikacja w sklepie wymaga konta (Marketplace: konto Microsoft + organizacja Azure DevOps + PAT
  albo trusted publishing po OIDC; Open VSX: konto Eclipse i umowa wydawcy) oraz wydawcy zamiast
  lokalnego `ark-local` - komendy i checklista sa w `GITHUB-PUBLIKACJA.md`.
