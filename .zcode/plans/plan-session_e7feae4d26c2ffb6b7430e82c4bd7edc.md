# Вложения в чат (фото, видео, файлы) — чтобы модель могла их смотреть и анализировать

## Что получится

- В композере появляется кнопка-скрепка, drag-and-drop файлов на поле ввода и вставка из буфера (Ctrl+V — включая скриншоты).
- Вложения показываются чипами над полем ввода (превью для картинок/видео) и в сообщении пользователя после отправки.
- Модель получает вложения так:
  - **Изображения** (png/jpg/webp/gif/bmp/avif) — нативно как `image_url` content-части (data URL), модель видит их по-настоящему. Большие картинки сжимаются до 1568px по длинной стороне.
  - **Видео** (mp4/webm и др., что декодирует Chromium) — без тяжёлых зависимостей (ffmpeg нет): в рендерере через скрытый `<video>` + canvas извлекаются 4 кадра (10/30/50/70/90% длительности, JPEG ~0.8, максимум 1024px) и уходят как картинки + пометка «это кадры видео X». Если кодек не декодируется — только метаданные.
  - **Текстовые файлы** (код, .md, .json, .csv, .txt) — содержимое читается и уходит текстовым блоком `[file: name] …` (excerpt до 50 000 символов).
  - **Прочее** (архивы, exe, pdf…) — модель видит имя, тип и размер (`[attachment: build.zip (application/zip, 4.2 MB)]`), внутрь заглянуть нельзя — честное ограничение без новых зависимостей.
- Вложения уходят модели **только с текущим сообщением**; в последующих ходах они остаются в истории как текстовая заметка `[attachment: photo.jpg (image)]` — иначе картинки раздували бы контекст каждый ход.

## Изменения по файлам

### 1. Новый `src/shared/attachments.ts` (чистые типы и функции, тестируемые в Node)
- `AttachmentKind = 'image' | 'video' | 'text' | 'binary'`; `AttachmentRef { id, name, mime, bytes, kind, dataUrl?, frames?, text?, status?, error? }`.
- `classifyAttachment(name, mime)` — по mime/расширению.
- `attachmentNote(a)` — `[attachment: name (image, 1.4 MB)]` для истории и wire.
- `buildUserContent(content, attachments)` — чистая сборка: строка без визуальных вложений, иначе массив `[{type:'text'…}, {type:'image_url', image_url:{url}}…]`; text-вложения и binary — текстовыми частями. Локальный минимальный тип ContentPart (без импорта SDK в shared).
- Константы лимитов: ≤8 вложений на сообщение; image ≤12 МБ, video ≤200 МБ, text ≤2 МБ (excerpt 50k), binary ≤100 МБ (только метаданные).

### 2. `src/shared/ipc.ts`
- `ChatMessagePayload` получает необязательное `attachments?: AttachmentRef[]` (content остаётся строкой — `lastUserText`, exchange-log и т.п. не ломаются).

### 3. Новый `src/renderer/src/lib/attachments.ts` (конвейер File → AttachmentRef)
- `fileToAttachment(file)`: классификация → чтение (FileReader/canvas для картинок с даунскейлом >1568px; `file.text()` для текстовых; `extractVideoFrames()` для видео).
- `extractVideoFrames(file, 4, 1024)`: blob URL, ожидание metadata, посик, `drawImage` в canvas; таймауты (8s metadata, 4s на кадр, ~15s всего), при сбое — пустой массив (метаданные-only). Статус чипа: `pending → ready/error`.

### 4. `src/renderer/src/components/layout/ChatPanel.tsx`
- Состояние `draftAttachments`; кнопка-скрепка (Paperclip, рядом с ThinkingMenu, `data-testid="chat-attach"`, скрыта во время стрима) + скрытый `<input type="file" multiple>`.
- `onPaste` на Textarea (`clipboardData.files`), `onDragOver`/`onDrop` на composer-frame с подсветкой рамки.
- Ряд чипов над Textarea: превью-миниатюра (картинка / первый кадр видео), спиннер пока видео обрабатывается, красное состояние при ошибке (превышен лимит), кнопка убрать (X). Стиль — как блок очереди (около строк 479–529).
- Отправка: `send(draft, undefined, draftAttachments)`; кнопка активна если есть текст **или** готовые вложения; при pending-вложении заблокирована.
- Пузырь пользователя (строки 365–380): решётка миниатюр с зумом по клику (Dialog-лайтбокс по образцу ImageCard) + чипы для нетекстовых файлов.

### 5. `src/renderer/src/stores/chat.ts`
- Новый `AttachmentPart { kind: 'attachment'; attachment: AttachmentRef }` в объединении `ChatPart` (части-вложения ставятся перед текстом).
- `send(text, chatId?, attachments?)`: userMessage с attachment-частями; в payload вложения добавляются **только** новому сообщению (`history.push({role:'user', content, attachments})`).
- `messageText()` (строки 260–287): attachment-части старых сообщений → заметка `[attachment: …]`.
- `persist()` (строки 440–490): в existing-ветке переполнения STORAGE_BUDGET (3.5 МБ) дополнительно выкидывать `dataUrl`/`frames` у attachment-частей (превью деградирует до чипа с именем).

### 6. `src/main/agent.ts` (строки 699–708 — единственное место сборки исходящих сообщений)
- В map истории: если у сообщения есть `attachments` → `content: buildUserContent(message.content, message.attachments)`. Тип `ChatCompletionMessageParam[]` уже принимает массивы контента, `body()` и стрим не меняются; `trimForWire` проверен — массивы контента проходят нетронутыми (`textOf` уже умеет массивы, укорачивание трогает только `role:'tool'`).

### 7. `src/shared/i18n.ts` — ключи в **обе** словаря (ru + en)
`chat.attach.title`, `chat.attach.drop`, `chat.attach.remove`, `chat.attach.tooLarge {limit}`, `chat.attach.tooMany {n}`, `chat.attach.videoProcessing`, `chat.attach.image`, `chat.attach.video`, `chat.attach.file`.

### 8. Тесты: новый `scripts/attachments.test.mjs` + `"test:attachments"` в package.json
По паттерну `repetition.test.mjs` (импорт из `../src/shared/attachments.ts`): классификация типов, `buildUserContent` (картинка → image_url; видео → N кадров; text → текстовая часть; binary → заметка; пустой текст не теряется), `attachmentNote`.

## Проверка
`npm run typecheck`, `npm run test:attachments`, `npm run test:i18n`, `npm run test:saving`, `npm run test:exchange-log`. Ручная проверка в `npm run dev` остаётся за вами (нужна vision-модель, например gpt-4o / gemini-flash через OpenRouter).

## Ограничения (сознательные)
- Провайдер/модель должны поддерживать vision-вход, иначе придёт обычная ошибка API.
- Видео анализируется по 4 кадрам, не целиком; архивы/PDF — только метаданные.
- Новых зависимостей (ffmpeg/sharp) не добавляется.