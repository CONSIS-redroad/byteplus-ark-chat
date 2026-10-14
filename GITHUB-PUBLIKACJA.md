# Publikacja na GitHubie - gotowa instrukcja

Ten plik nie jest czescia wtyczki (`.vscodeignore` trzyma go poza paczka VSIX). Zbiera wszystko, co
trzeba wkleic w ustawienia repozytorium, oraz komendy do wypchniecia i wydania wersji.

## 1. Opis repozytorium (About)

- **Nazwa repo**: `byteplus-ark-chat`
- **Description** (pole About, do 350 znakow):

  ```
  Wtyczka VS Code: modele BytePlus ModelArk (Coding Plan) w pickerze czatu - klucz w SecretStorage,
  tryb agenta, realne okna kontekstu i pasek stanu z limitami planu (sesja 5 h / 7 dni / 30 dni).
  Autorstwo: BartsGda + asystent AI (Cline). MIT.
  ```

- **Website**: zostaw puste albo wklej link do `DOKUMENTACJA.md`.
- **Topics** (po nich repo znajduja inni):

  ```
  vscode-extension, vscode, byteplus, byteplus-modelark, coding-plan, language-model-chat,
  copilot-chat, byok, glm, deepseek, agent, typescript
  ```

## 2. Pierwsze wypchniecie

```powershell
cd wtyczka-byteplus-ark
git init -b main
git add .
git status --short      # node_modules/, out/ i *.vsix nie moga sie tu pokazac (.gitignore)
git commit -m "0.3.0: limity planu, logowanie z okna VS Code, szablony wspolpracy"
git remote add origin https://github.com/BartsGda/byteplus-ark-chat.git
git push -u origin main
```

Jesli konto albo nazwa repo sa inne niz `BartsGda/byteplus-ark-chat`, podmien adres w `git remote`,
w `package.json` (`repository`, `bugs`, `homepage`) oraz w README i `CONTRIBUTING.md` (linki).

## 3. Pola repozytorium w package.json

Sa juz wpisane (dzieki nim VS Code i Marketplace moga odeslac do Issues i README repo):

```json
"repository": { "type": "git", "url": "https://github.com/BartsGda/byteplus-ark-chat.git" },
"bugs": { "url": "https://github.com/BartsGda/byteplus-ark-chat/issues" },
"homepage": "https://github.com/BartsGda/byteplus-ark-chat#readme"
```

Po utworzeniu repo flaga `--allow-missing-repository` w skrypcie `pakuj` nie jest potrzebna (zostaje
nieszkodliwa, wiec nie trzeba jej ruszac).

## 4. Wydanie wersji (tag + Releases)

```powershell
npm run pakuj
# GitHub -> Releases -> Draft a new release -> tag: v0.3.0
# zalacznik: byteplus-ark-chat-0.3.0.vsix
```

Nazwa tagu trzyma sie numeru z `package.json` (`v0.3.0`). Tresc wydania przepisz z sekcji `0.3.0` w
`CHANGELOG.md` - tam sa pomiary (bramki, liczba plikow w paczce, bajty), a nie ogolniki.

## 5. Odznaka bramek (po pierwszym push)

Workflow `.github/workflows/bramki.yml` ruszy sam. Odznake mozna wkleic na poczatek README:

```markdown
[![Bramki](https://github.com/BartsGda/byteplus-ark-chat/actions/workflows/bramki.yml/badge.svg)](https://github.com/BartsGda/byteplus-ark-chat/actions/workflows/bramki.yml)
```

## 6. Ustawienia repozytorium warte wlaczenia

- **Issues**: wlaczone; szablony `Blad` i `Propozycja / pomysl` sa w `.github/ISSUE_TEMPLATE/`.
- **Discussions** (opcjonalnie): na luzniejsze pomysly niz zgloszenie.
- **Topics** z punktu 1 - bez nich repo jest niewidoczne dla szukajacych.
- **Branch protection** (opcjonalnie): wymagaj zielonej bramki `Bramki` przed scaleniem PR.
- **Kluczy w repo nie ma i nie bedzie**: `out/`, `node_modules/` i `*.vsix` sa w `.gitignore`, klucz
  API zyje w `SecretStorage`, a w logach jest maskowany.

## 7. Czy GitHub wystarczy? Trzy kanaly dystrybucji

| Kanal | Konto (wszystkie darmowe) | Co daje | Komenda |
| --- | --- | --- | --- |
| GitHub Releases | konto GitHub | zgloszenia i PR (szablony w `.github/`), plik `.vsix` do pobrania, historia zmian | `git push`, potem Release z zalacznikiem `.vsix` |
| VS Code Marketplace | konto Microsoft (Entra ID) + organizacja Azure DevOps + PAT (zakres `Marketplace: Manage`, organizacja "All accessible organizations") albo trusted publishing | wtyczka w wyszukiwarce VS Code, instalacja jednym klikiem, auto-aktualizacje | `npx @vscode/vsce login <publisher>`, `npx @vscode/vsce publish` |
| Open VSX (open-vsx.org) | konto Eclipse (umowa wydawcy) + logowanie kontem GitHub | to samo dla VSCodium, Cursor, Windsurf, Gitpod | `npx ovsx create-namespace <publisher> -p <token>`, `npx ovsx publish <plik.vsix> -p <token>` |

**Do zgloszen i propozycji od innych osob GitHub wystarczy** i jest jedynym miejscem, gdzie dzialaja
szablony Issues oraz PR. Marketplace doklada wyszukiwarke i auto-aktualizacje, ale wymaga konta
Microsoft powiazanego z Entra ID i nie przyjmuje dwoch wtyczek o tej samej nazwie. Publikacja nie
kosztuje w zadnym z trzech kanalow - placi sie tylko czasem na zalozenie kont, akceptacja regulaminu
wydawcy i limitem 30 tagow w `package.json`.

Instalacja paczki u kogos, kto repozytorium nie klonuje:

```powershell
code --install-extension .\byteplus-ark-chat-0.3.0.vsix
# albo w VS Code: Extensions -> "..." -> Install from VSIX
```

Bez PAT (stan vsce 2026-10-14): `npx @vscode/vsce publish --oidc` publikuje z GitHub Actions na
podstawie zaufania OIDC (polityka "trusted publishing" ustawiona dla repozytorium i workflow na
Marketplace, w workflow `permissions: id-token: write`). Wtedy zaden sekret nie lezy ani w repo,
ani w ustawieniach konta.

## 8. Zanim wtyczka trafi do sklepu (pomiar 2026-10-14)

- `publisher` w `package.json` to `ark-local` - identyfikator lokalny z instalacji na tej maszynie.
  Marketplace i Open VSX wymagaja, zeby zgadzal sie z nazwa wydawcy (namespace) utworzona na ich
  stronie, wiec przed publikacja podmien go na wlasna nazwe.
- Zmiana `publisher` zmienia identyfikator wtyczki (`<publisher>.byteplus-ark-chat`): stara instalacja
  zostaje na dysku osobno, a nazwa `byteplus-ark-chat` musi byc unikalna w calym Marketplace.
- W polach `repository`, `bugs`, `homepage` oraz w linkach w README i `CONTRIBUTING.md` jest
  `BartsGda/byteplus-ark-chat` - podmien na wlasne konto, jesli rozni sie od tej nazwy (pomiar: konto
  GitHub istnieje jako login `Bartsgda`, nazwa wyswietlana "Consis"; adresy GitHub nie rozrozniaja
  wielkosci liter, wiec obecne linki dzialaja).
- Do rozpoznawalnosci w sklepie warto dopisac `keywords` (chipy w wyszukiwarce) i `icon`
  (128x128 PNG). Oba sa opcjonalne: bez nich Marketplace pokaze domyslna ikone i nie da tagow.
- Kazda kolejna publikacja wymaga **wyzszej** wersji w `package.json`; `npx @vscode/vsce publish patch`
  podnosi ja sam i tworzy commit.
- Wtyczka nie ma pola `private` (pomiar 2026-10-14: wyszukiwanie `"private"` w `package.json` nie
  zwraca wyniku), wiec `vsce publish` nie zatrzyma sie na bledzie "Cannot publish a private extension".
- `package-lock.json` musi byc zgodny z `package.json` - inaczej `npm ci` w bramkach GitHub przerywa
  workflow. Po kazdej zmianie wersji albo zaleznosci: `npm install --package-lock-only`.

## 9. Co zrobic po wypchnieciu (kolejnosc)

1. `gh auth login` i `gh repo create byteplus-ark-chat --public --source . --remote origin --push`.
2. Wlacz Issues i topics z punktu 1, dopisz odznake bramek z punktu 5.
3. `gh release create v0.3.0 .\byteplus-ark-chat-0.3.0.vsix --title "0.3.0" --notes-file <plik>`.
4. Poczekaj na zielone `Bramki` (artifact `vsix` jest w kazdym przebiegu).
5. Dopiero gdy chcesz wyszukiwarke i auto-aktualizacje: wydawca na Marketplace (punkt 7) i wtedy
   `publisher` w `package.json` rowna sie jego identyfikatorowi.
