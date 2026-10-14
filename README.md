# BytePlus ModelArk (ARK) w czacie VS Code

Wtyczka dodaje modele **BytePlus ModelArk** (Coding Plan) do pickera czatu w VS Code przez oficjalne
API `vscode.lm.registerLanguageModelChatProvider` - bez mostu LiteLLM, bez zaleznosci runtime, z
kluczem API w `SecretStorage` i z paskiem stanu, ktory pokazuje zuzycie planu (sesja 5 h / 7 dni /
30 dni) na podstawie oficjalnego CLI `arkcli`.

> *In short: a VS Code chat provider for BytePlus ModelArk - OpenAI-compatible API, API key in
> SecretStorage, agent/tool calling, real context windows per model and a Coding Plan usage status
> bar. Docs are in Polish; issues and pull requests in English are welcome.*

| | |
| --- | --- |
| Wersja | 0.3.0 (autorstwo: BartsGda + asystent AI Cline) |
| VS Code | 1.140 lub nowszy |
| Zaleznosci | brak zaleznosci runtime (wlasny klient HTTP + SSE w `src/arkClient.ts`) |
| Jezyk | TypeScript (`commonjs`, `strict`), kompilowany do `out/` |
| Licencja | MIT |

## Co potrafi

- **Modele w pickerze czatu** - `ARK: glm-5.2`, `ARK: deepseek-v4-pro` i pozostale z planu; lista jest
  ustawieniem, wiec dziala tez z dowolnym OpenAI-compatible endpointem (na przyklad z lokalnym mostem
  LiteLLM).
- **Klucz API bez wyciekania** - `SecretStorage` VS Code albo zmienna srodowiskowa (domyslnie
  `BYTEPLUS_ARK_API_KEY`); klucz nigdy nie trafia do logow (jest maskowany).
- **Brak klucza to nie blad czatu** - zamiast surowego 401 wtyczka pokazuje raz komunikat z
  przyciskiem ustawienia klucza i nie zasmieca pickera modelami, ktore i tak nie odpowiedza.
- **Tryb agenta** - function calling, skladanie `tool_calls`, retry, timeout i anulowanie zapytania.
- **Prawdziwe okno kontekstu** - wpisy modeli maja `contextWindow` i limity wejscia/wyjscia per model,
  wiec picker pokazuje realne liczby, a wtyczka wysyla `max_tokens` (domyslny limit wyjscia u
  dostawcy to tylko 4K).
- **Limity planu w pasku stanu** - jeden element `$(pulse) ARK 63% 11% 52%`, kolor z najgorszego okna
  (zielony < 50%, zolty 50-79%, czerwony >= 80%), pelne szczegoly i czasy resetu w tooltipie.
- **Logowanie do BytePlus z okna VS Code** (od 0.3.0) - panel z trzema drogami: przegladarka, kod z
  przegladarki, klucz AK/SK. Bez terminala i bez znajomosci `arkcli`.
- **Kanaly wyjscia bez duplikatow** - identyczna linia logu trafia do panelu raz, a po nieudanym
  odczycie kolejna proba czeka 5 minut (`src/dziennik.ts`).

## Szybki start

```powershell
git clone https://github.com/BartsGda/byteplus-ark-chat.git
cd byteplus-ark-chat
npm install          # 3 paczki dev: typescript, @types/vscode, @types/node
npm run compile
npm run pakuj        # tworzy byteplus-ark-chat-0.3.0.vsix
code --install-extension .\byteplus-ark-chat-0.3.0.vsix --force
```

Potem `Developer: Reload Window` w oknie VS Code, a modele pojawia sie w pickerze jako `ARK: <model>`.
W dalszej pracy przydaje sie `npm run watch` plus F5 (konfiguracja `Uruchom wtyczke (Extension Host)`
w `.vscode/launch.json`).

Droga bez budowania: pobierz `.vsix` z zakladki **Releases** i zainstaluj komenda powyzej.

### Klucz API

Trzy drogi, sprawdzane w tej kolejnosci:

1. `BytePlus ARK: Ustaw klucz API` (Ctrl+Shift+P) - zapis w `SecretStorage` VS Code.
2. zmienna srodowiskowa `BYTEPLUS_ARK_API_KEY` (nazwe zmienia ustawienie `byteplusArk.apiKeyEnvVar`);
   VS Code musi byc uruchomiony z tej sesji srodowiska.
3. brak klucza - dziala tylko wtedy, gdy `byteplusArk.baseUrl` wskazuje lokalny most bez autoryzacji
   (`http://127.0.0.1:4010/v1`).

## Limity planu i pasek stanu

Konsola `console.byteplus.com/ark/.../subscription/coding-plan` i `arkcli usage plan` pokazuja te same
trzy okna. Odpowiedzi ARK **nie maja** naglowkow z kwotami (sprawdzone pomiarem), dlatego wtyczka czyta
je z CLI - a CLI wymaga jednorazowego logowania do konta BytePlus (control-plane nie przyjmuje klucza
ARK). Od 0.3.0 nie trzeba do tego terminala: klik w element paska (albo komenda
`BytePlus ARK: Zaloguj sie (limity planu)`) otwiera panel:

| Droga w panelu | Co robi wtyczka |
| --- | --- |
| `Zaloguj w przegladarce` | otwiera terminal z `arkcli auth login`, potem sama sprawdza co 15 s (do 3 min), czy logowanie sie udalo - pasek wraca do liczb bez klikania |
| `Wpisz kod z przegladarki` | faza 1 leci w tle (`--no-browser --format json`), wtyczka otwiera adres SSO, a Ty wklejasz tylko kod (base64) w oknie VS Code |
| `Wpisz klucz AK/SK` | zaklada profil CLI (`arkcli config init --access-key ... --profile ...`) i wpisuje jego nazwe w `byteplusArk.arkcliProfil` |

Gdy logowanie wygasnie, pasek zmienia sie w klikalny `$(key) ARK: zaloguj sie`, a wtyczka przypomina
o tym powiadomieniem najwyzej raz na 12 h. Element paska pokazuje procenty calkowite w stalej kolejnosci
**sesja / tydzien / miesiac** i bierze kolor z najgorszego okna:

| Procent najgorszego okna | Kolor tekstu | Tlo |
| --- | --- | --- |
| mniej niz 50% | `charts.green` | domyslne |
| 50-79% | `charts.yellow` | domyslne |
| 80% i wiecej | `charts.red` | `statusBarItem.warningBackground` |

### Bramki

```powershell
npm run compile              # tsc -p ./
npx tsc --noEmit -p ./       # kompilator z node_modules (to robi npm run compile)
node sprawdz-ts-edytora.cjs  # kompilator wbudowany w VS Code (to realnie widzi edytor)
npm run sprawdz:testy        # test-limity.cjs + test-dziennik.cjs + test-logowanie.cjs
```

Tak wyglada tez CI (`.github/workflows/bramki.yml`). Sekcje testow, ktore pytaja realne `arkcli`, same
sie pomijaja, gdy CLI nie ma w srodowisku, wiec bramka przechodzi takze na czystym runnerze.

## Komendy

| Komenda | Do czego |
| --- | --- |
| `BytePlus ARK: Ustaw klucz API` | zapis klucza w `SecretStorage` |
| `BytePlus ARK: Usun klucz API` | usuniecie klucza z `SecretStorage` |
| `BytePlus ARK: Pokaz stan (klucz, trasa, modele)` | co wtyczka widzi: klucz, trasa, lista modeli |
| `BytePlus ARK: Testuj polaczenie z ARK` | krotkie zapytanie kontrolne do dostawcy |
| `BytePlus ARK: Pokaz limity planu (sesja 5 h / 7 dni / 30 dni)` | raport, czasy resetu, przyciski akcji |
| `BytePlus ARK: Zaloguj sie (limity planu)` | panel logowania (przegladarka / kod / AK-SK) |
| `BytePlus ARK: Zaloguj kodem z przegladarki (bez terminala)` | od razu droga "kod z przegladarki" |
| `BytePlus ARK: Podglad kolorow paska limitow (diagnostyka)` | progi 30 / 60 / 90% po 3 s |

## Ustawienia

| Ustawienie | Domyslnie | Opis |
| --- | --- | --- |
| `byteplusArk.baseUrl` | `.../api/coding/v3` | baza OpenAI-compatible (plan albo lokalny most) |
| `byteplusArk.models` | 9 modeli planu | identyfikatory modeli; wszystkie sprawdzone na zywo (HTTP 200) |
| `byteplusArk.labelPrefix` | `ARK` | prefiks nazwy w pickerze czatu |
| `byteplusArk.maxInputTokens` / `maxOutputTokens` | `1024000` / `131072` | limity oglaszane VS Code |
| `byteplusArk.toolCalling` | `true` | tryb agenta (function calling) |
| `byteplusArk.vision` | `false` | modele z planu nie przyjmuja obrazow |
| `byteplusArk.apiKeyEnvVar` | `BYTEPLUS_ARK_API_KEY` | nazwa zmiennej srodowiskowej (puste wylacza) |
| `byteplusArk.timeoutSeconds` | `300` | limit czasu zapytania |
| `byteplusArk.debug` | `false` | zapis zapytan i odpowiedzi w kanale wyjscia |
| `byteplusArk.limityOdswiezanie` | `co 15 min` | pasek limitow: `wylaczone` / `tylko na zadanie` / `co 1 min` ... `co 60 min` |
| `byteplusArk.arkcliSciezka` | `arkcli` | polecenie albo sciezka do CLI BytePlus |
| `byteplusArk.arkcliProfil` | puste | profil `arkcli` do odczytu limitow |
| `byteplusArk.konsolaPlanuUrl` | link do `subscription/coding-plan` | strona konsoli otwierana z raportu |

Stare klucze 0.1.x (`byteplusArk.limityWStatusBar`, `byteplusArk.limityOdswiezanieSekundy`) sa nadal
czytane i tlumaczone przy pierwszym starcie.

## Zglaszanie propozycji

Pomysly, bledy i uwagi sa mile widziane - to repo powstalo z mysla o wspolpracy:

- **Masz pomysl albo znalazles blad?** Otworz zgloszenie (Issues) - sa dwa szablony: *Blad* i
  *Propozycja / pomysl*. Zgloszenie bez szablonu tez przejdzie, ale wtedy dopisz wersje wtyczki,
  VS Code i co dokladnie widzisz w kanale wyjscia `BytePlus ARK`.
- **Chcesz zmienic kod?** Zacznij od [CONTRIBUTING.md](CONTRIBUTING.md) - tam jest srodowisko, bramki,
  ktore musza przejsc, i konwencje projektu (miedzy innymi zasada "mierzymy, nie zgadujemy").
- **Nie chcesz pisac kodu?** Zgloszenie z samym pomiarem (zrzut `arkcli usage plan`, log z kanalu
  wyjscia) jest tak samo wartosciowe - w tym projekcie kazda zmiana konczy sie pomiarem.

## Znane ograniczenia

- Dystrybucja: GitHub Releases z plikiem `.vsix` (sekcja Instalacja). W Marketplace i Open VSX
  wtyczki nie ma - co trzeba zmienic przed publikacja w sklepie (konto, `publisher`, `keywords`,
  `icon`), opisuje [GITHUB-PUBLIKACJA.md](GITHUB-PUBLIKACJA.md).
- Plan Coding Plan wygasa **17.10.2026** i nie odnawia sie sam; poza planem sa
  `dola-seed-2.1-turbo`, `dola-seed-2-1-turbo-260628` i `auto` (HTTP 404).
- Limity modeli pochodza z listy BytePlus (stan 2026-10-11, region `ap-southeast-1`);
  `ark-code-latest` to alias planu, wiec jego limit trzeba sprawdzac pomiarem.
- Kolor progu widac tylko w pasku stanu: panel wyjscia VS Code nie renderuje ANSI, a `ThemeIcon.color`
  dziala tylko w drzewach. Szczegoly i pomiary: [DOKUMENTACJA.md](DOKUMENTACJA.md).
- `contributes.languageModelChatProviders.managementCommand` jest oznaczone jako przestarzale, ale
  zostaje celowo - nastepca (`configuration`) nie daje wtyczce API do odczytu zapisanych tam sekretow.

## Autorstwo i licencja

Wtyczke napisalismy razem: **BartsGda** (pomysl, decyzje architektoniczne, weryfikacja pomiarowa) i
**asystent AI (Cline)** jako wspolautor kodu, testow i dokumentacji. Ta sama informacja jest w
`package.json` (`author`, `contributors`), w `CHANGELOG.md` i w `LICENSE` (MIT, 2026).


