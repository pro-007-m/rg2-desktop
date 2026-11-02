<img src="data/app-icon.png" width="128" alt="RG2 Desktop">

# RG2 · Desktop

Десктопное приложение для Windows с алгоритмами сборки кубиков и других головоломок. Материалы, формулы, схемы и порядок разделов перенесены из RG2F 4.241017.6; библиотека работает без интернета.

[Скачать приложение для Windows](https://github.com/pro-007-m/rg2-desktop/releases/latest)

## Возможности

- Исходные разделы для 2×2, 3×3, больших кубов, модификаций 3×3, скьюбов и других головоломок.
- Темы **Atelier** и **Graphite**. По умолчанию — **«Как в системе»**, с переключением вслед за темой Windows.
- Поиск по названиям, формулам и тексту; избранное; история переходов; увеличение схем.
- Таймер с сессиями, предварительным осмотром, штрафами +2/DNF и средними ao5/ao12.
- Генератор скрамблов 2×2–7×7, тренажёры PLL и азбуки для слепой сборки.
- Азбука вращений: 11 групп и 212 исходных схем с обозначениями.
- Настройки, избранное и результаты сохраняются локально. Видеоуроки открываются в браузере по исходным ссылкам.

| Atelier | Graphite |
| --- | --- |
| ![Atelier](docs/atelier.png) | ![Graphite](docs/graphite.png) |

## Запуск

Распакуйте архив из [Releases](https://github.com/pro-007-m/rg2-desktop/releases/latest) и откройте `RG2.Desktop.exe`. Сохраните папку `data` и остальные файлы рядом с программой.

Требуются Windows x64, [.NET Desktop Runtime 10](https://dotnet.microsoft.com/download/dotnet/10.0) и [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## Сборка

Установите .NET SDK 10 и выполните в корне репозитория:

```powershell
dotnet restore --locked-mode
dotnet publish RG2.Desktop.csproj -c Release -r win-x64 --self-contained false -o publish
```

Готовая программа появится в `publish/`. Чтобы включить .NET Runtime в сборку, замените `--self-contained false` на `--self-contained true`.

## Проверки

Для проверки данных нужен Python 3, для проверки вычислений — Node.js. Дополнительные пакеты для этих проверок не требуются:

```powershell
python tests/catalog.test.py
node tests/tools.test.cjs
```

Проверки сверяют исходные ресурсы по SHA-256, полноту материалов, пути к схемам, обозначения вращений, скрамблы, штрафы и средние результаты, повороты куба и буквенные соответствия.

## Структура

- `MainWindow.xaml.cs` — окно Windows, WebView2, системная тема и открытие внешних ссылок.
- `data/index.html`, `styles.css`, `app.js` — интерфейс и навигация.
- `data/tools.js` — таймер, скрамблы и тренажёры.
- `data/catalog.json`, `trainer-data.json`, `assets/` — материалы и исходные ресурсы.
- `data/migration-report.json` и файлы с исходными строками/массивами — проверяемые сведения о переносе.


