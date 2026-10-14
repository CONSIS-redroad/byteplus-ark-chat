# Wspolpraca przy `byteplus-ark-chat`

Dzieki, ze chcesz cos dodac. Projekt ma mala powierzchnie i jedna zasade nadrzedna:
**mierzymy, nie zgadujemy**. Zdanie "powinno dzialac" nie jest wynikiem - wynikiem jest komenda,
jej kod wyjscia i to, co widac w pasku stanu albo w kanale wyjscia.

## Zanim otworzysz zgloszenie (Issues)

- **Blad** - dopisz wersje wtyczki, wersje VS Code, system oraz tresc z kanalu wyjscia
  `BytePlus ARK` (View -> Output). Klucz API zamaskuj.
- **Propozycja** - opisz problem, ktory chcesz rozwiazac, i po czym poznamy, ze jest lepiej.
- **Limity planu** - dolacz zrzut `arkcli usage plan --format json` (bez danych osobowych) albo
  procenty z konsoli BytePlus.
- **Logowanie** - napisz, ktora droge wybrales/-as (przegladarka / kod / AK-SK) i jaki komunikat
  zwrocilo `arkcli auth status`.

Zgloszenia po polsku i po angielsku sa tak samo mile widziane.

## Srodowisko

Windows, Node 22 lub nowszy, VS Code 1.140 lub nowszy.

```powershell
npm install
npm run compile
npm run watch      # w trakcie pracy: kompilacja przyrostowa
# F5 w VS Code -> konfiguracja "Uruchom wtyczke (Extension Host)"
```

## Bramki (musza przejsc wszystkie)

```powershell
npx tsc --noEmit -p ./       # kompilator z node_modules (to samo robi npm run compile)
node sprawdz-ts-edytora.cjs  # kompilator wbudowany w VS Code - to realnie widzi edytor
npm run sprawdz:testy        # test-limity.cjs + test-dziennik.cjs + test-logowanie.cjs
```

Dlaczego dwa kompilatory: edytor uzywa wbudowanego TypeScript (u autora 6.0.3), a `npm run compile`
tego z `node_modules` (5.9.3). Rozjazd potrafi pokazac bledy, ktorych `tsc` nie widzi (na przyklad
brakujace typy Node), dlatego `sprawdz-ts-edytora.cjs` jest czescia bramki.

Testy dzialaja bez VS Code (moduly czyste + zaslepka `vscode`) i bez sieci. Sekcje, ktore pytaja
realne `arkcli`, same sie pomijaja, gdy CLI nie ma w srodowisku - dlatego bramka jest zielona takze
na czystym runnerze. Dokladnie te komendy uruchamia CI
([`.github/workflows/bramki.yml`](.github/workflows/bramki.yml)); zielone CI jest warunkiem zlania PR.

## Konwencje projektu

| Obszar | Zasada |
| --- | --- |
| Jezyk kodu | TypeScript `strict`, taby, `commonjs`; polskie nazwy funkcji i zmiennych (`pobierzLimity`, `tekstPaska`) |
| Zaleznosci | brak nowych zaleznosci runtime; nowa paczka dev wymaga uzasadnienia w opisie PR |
| Moduly | logika, ktora da sie sprawdzic bez VS Code, idzie do osobnego pliku bez importu `"vscode"` (`src/limity.ts`, `src/dziennik.ts`, `src/logowanie.ts`) |
| Testy | nowa logika = nowy przypadek w `test-*.cjs`; test ma wypisac, co sprawdza, i konczyc sie kodem 0/1 |
| Log | identyczna linia trafia do kanalu wyjscia raz (`src/dziennik.ts`); po nieudanym odczycie kolejna proba czeka 5 min |
| Teksty | polski bez znakow diakrytycznych w plikach i bez znakow CJK (repo trzyma ASCII, zeby pliki przeszly przez kazda konsole i kazdy diff) |
| Dokumentacja | pomiar z data (co zmierzono, jaka komenda, jaki wynik) zamiast opinii; brak zaleznosci do udokumentowania = brak akapitu |
| Bezpieczenstwo | dane od uzytkownika (kod SSO, AK/SK) sprawdzamy znak po znaku przed przekazaniem do CLI; klucza nie logujemy |

## Jak wyglada dobry PR

1. Jeden temat w jednym PR.
2. Opis: co zmienia i **jak to zmierzylem** (komenda, kod wyjscia, zrzut ekranu albo fragment logu).
3. Test dla nowej logiki (albo jasne uzasadnienie, dlaczego testu nie ma).
4. `CHANGELOG.md` zaktualizowany, gdy zmiana jest widoczna dla uzytkownika.
5. Bramki z sekcji wyzej przechodza lokalnie.
6. Bez przepisywania dzialajacych rzeczy "przy okazji" - osobny PR, osobny pomiar.

## Wydanie nowej wersji (dla opiekuna)

```powershell
# 1. podbij "version" w package.json (Recznie - to jedyne zrodlo prawdy)
npm run compile
npm run pakuj
code --install-extension .\byteplus-ark-chat-<wersja>.vsix --force
# 2. zmierz paczke (liczba plikow i bajty) i dopisz pomiar do CHANGELOG.md
# 3. tag + GitHub Release z plikiem .vsix w zalaczniku
git tag v<wersja>
git push origin v<wersja>
```
