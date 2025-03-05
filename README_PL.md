# Scoreboard

Aplikacja tablicy wyników czasu rzeczywistego do streamingu meczów Ultimate Frisbee z statystykami na żywo, składami drużyn i dynamicznym sterowaniem.

## Przegląd

Aplikacja Scoreboard zapewnia kompletne rozwiązanie do streamingu meczów Ultimate Frisbee z:
- Aktualizacjami wyników na żywo
- Statystykami zawodników
- Składami drużyn
- Informacjami o wietrze
- Konfigurowalnymi kolorami koszulek
- Interfejsem kontrolnym

## Rozpoczęcie pracy

### Uruchamianie z Dockerem

Najłatwiejszym sposobem uruchomienia aplikacji Scoreboard jest użycie Dockera:

```bash
docker-compose up
```

Uruchomi to wszystkie wymagane usługi i udostępni aplikację pod adresami:
- Frontend internetowy: http://localhost:8000
- API: http://localhost:5000
- WebSocket: ws://localhost:5005

### Ręczna konfiguracja

1. Instalacja wymagań:
```bash
pip install -r scores_server/requirements.txt
```

2. Uruchomienie serwera backendowego:
```bash
cd scores_server
gunicorn -b 0.0.0.0:5000 app:app
```

3. Uruchomienie serwera frontendowego:
```bash
cd scores_html
gunicorn -b 0.0.0.0:8000 web:app
```

## Korzystanie z tablicy wyników

### Interfejs kontrolera

Dostęp do kontrolera pod adresem: http://localhost:8000/controller

Kontroler jest centralnym punktem zarządzania tym, co pojawia się na tablicy wyników:

1. **Ustawienie numeru meczu**: Wprowadź ID meczu z scores.frisbee.pl, aby załadować dane meczu
2. **Ustawienie kolorów koszulek**: Użyj selektorów kolorów, aby dopasować kolory koszulek drużyn
3. **Kontrola wyświetlania**: Przełączanie informacji o wietrze, składów drużyn i statystyk
4. **Kontrola timera**: Uruchamianie, zatrzymywanie i resetowanie timera gry

Wszystkie zmiany dokonane w kontrolerze są natychmiast odzwierciedlane w innych widokach poprzez połączenia WebSocket.

### Główna tablica wyników

Dostęp do głównej tablicy wyników pod adresem: http://localhost:8000/scoreboard

Jest to główny widok pokazujący:
- Nazwy drużyn i wyniki
- Timer gry
- Ostatnie punkty (zdobywca i asysta)
- Kolory drużyn dopasowane do koszulek

Aby używać w OBS:
1. Dodaj źródło "Przeglądarka"
2. Ustaw URL na http://localhost:8000/scoreboard
3. Ustaw szerokość na 1920 i wysokość na 1080 (dla pełnego HD)

### Widok statystyk

Dostęp do statystyk pod adresem: http://localhost:8000/stats

Pokazuj ten widok podczas przerw czasowych lub po meczu, aby wyświetlić:
- Punkty zdobyte przez każdą drużynę
- Punkty ofensywne/defensywne
- Czas w ataku
- Straty
- Pozostałe przerwy czasowe

Przełączaj ten widok włączając/wyłączając z interfejsu kontrolera.

### Składy drużyn

Dostęp do składów pod adresem: http://localhost:8000/roster

Wyświetla składy drużyn pokazując:
- Nazwiska zawodników
- Numery na koszulkach
- Kolory drużyn

Przełączaj ten widok włączając/wyłączając z interfejsu kontrolera.

## Połączenie WebSocket

Aplikacja używa WebSocketów do aktualizacji w czasie rzeczywistym we wszystkich widokach.

### Szczegóły połączenia

Serwer WebSocket działa domyślnie na porcie 5005:
```
ws://localhost:5005/
```

W środowiskach produkcyjnych zaktualizuj URL WebSocketa w plikach JavaScript:
- scores_html/static/js/scoreboard.js
- scores_html/static/js/controller.js

### Typy komunikatów

WebSocket obsługuje różne typy komunikatów:
- `team`: Aktualizacje informacji o drużynie (kolory, nazwy)
- `game`: Aktualizacje stanu gry (wynik, timer)
- `wind`: Kontrola wyświetlania wiatru
- `stats`: Kontrola wyświetlania statystyk

## Dostosowywanie

Aby dostosować aplikację do różnych lig lub turniejów:
1. Zaktualizuj URL API w scores_server/app.py (zmienna `SCORES_URL`)
2. Zmodyfikuj CSS w scores_html/static/css/ dla zmian wizualnych
3. Zaktualizuj szablony w scores_html/templates/ dla zmian układu

## Rozwiązywanie problemów

### Typowe problemy

1. **Nie pojawiają się dane**: Upewnij się, że ID meczu jest poprawne i zewnętrzne API jest dostępne
2. **Rozłączenie WebSocket**: Sprawdź łączność sieciową i ustawienia zapory sieciowej
3. **Zmiany kolorów nie są stosowane**: Odśwież stronę tablicy wyników po zmianie kolorów

W celu uzyskania pomocy technicznej sprawdź logi aplikacji w konsoli Dockera lub wyjściu serwera.